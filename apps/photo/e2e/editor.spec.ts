import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decode } from 'fast-png';
import { unzipSync, strFromU8 } from 'fflate';
import {
  BLEND_MODES,
  addLayer,
  createDocument,
  flatten,
  setLayerProps,
  writeProject,
} from '@auram/photo-engine';
import {
  createSandbox,
  forceClose,
  launch,
  newImage,
  stubOpenDialog,
  stubSaveDialog,
  type Sandbox,
} from './fixtures';

let sandbox: Sandbox;
test.beforeEach(async () => {
  sandbox = await createSandbox();
});
test.afterEach(async () => {
  await sandbox.cleanup();
});

function pixel(
  png: { data: ArrayLike<number>; width: number; channels: number },
  x: number,
  y: number,
) {
  const i = (y * png.width + x) * png.channels;
  return Array.from({ length: png.channels }, (_, k) => png.data[i + k]);
}

test('paints with the brush and exports exactly what was painted', async () => {
  const { app, window } = await launch(sandbox);
  try {
    await expect(window.getByRole('heading', { name: 'Auram Photo' })).toBeVisible();
    await newImage(window, 200, 100);
    const canvas = window.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    // The 200×100 image is centred at 100% zoom.
    const origin = { x: box.x + (box.width - 200) / 2, y: box.y + (box.height - 100) / 2 };
    await window.mouse.move(origin.x + 20, origin.y + 50);
    await window.mouse.down();
    await window.mouse.move(origin.x + 180, origin.y + 50, { steps: 20 });
    await window.mouse.up();

    const target = path.join(sandbox.root, 'out.png');
    await stubSaveDialog(app, target);
    await window.keyboard.press('Control+Shift+E');
    await window
      .getByRole('dialog', { name: 'Export image' })
      .getByRole('button', { name: 'Export' })
      .click();
    await expect(window.getByText('Exported out.png')).toBeVisible();

    const png = decode(await readFile(target));
    expect([png.width, png.height]).toEqual([200, 100]);
    expect(pixel(png, 100, 50)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 100, 5)).toEqual([255, 255, 255, 255]);

    // Undo removes the stroke from the next export.
    await window.keyboard.press('Control+Z');
    await stubSaveDialog(app, path.join(sandbox.root, 'undone.png'));
    await window.keyboard.press('Control+Shift+E');
    await window
      .getByRole('dialog', { name: 'Export image' })
      .getByRole('button', { name: 'Export' })
      .click();
    await expect(window.getByText('Exported undone.png')).toBeVisible();
    expect(pixel(decode(await readFile(path.join(sandbox.root, 'undone.png'))), 100, 50)).toEqual([
      255, 255, 255, 255,
    ]);
  } finally {
    await forceClose(app);
  }
});

test('the GPU compositor matches the reference compositor for every blend mode', async () => {
  // One stripe per blend mode over a horizontal gradient, built with the engine itself.
  const stripe = 12;
  const width = stripe * BLEND_MODES.length;
  const height = 64;
  const doc = createDocument(width, height, 'white');
  const base = doc.layers[0]!.raster.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      base[i] = (x * 255) / width;
      base[i + 1] = (y * 255) / height;
      base[i + 2] = 128;
    }
  }
  BLEND_MODES.forEach((mode, index) => {
    addLayer(doc, mode);
    const data = doc.activeLayer.raster.data;
    for (let y = 0; y < height; y++) {
      for (let x = index * stripe; x < (index + 1) * stripe; x++) {
        const i = (y * width + x) * 4;
        data.set([200, 60 + index * 10, 30, 255 - y * 2], i);
      }
    }
    setLayerProps(doc, doc.activeLayerId, { blendMode: mode, opacity: 0.8 });
  });
  const expected = flatten(doc);
  const file = path.join(sandbox.root, 'blend.cproj');
  await writeFile(
    file,
    writeProject(doc, {
      id: crypto.randomUUID(),
      name: 'blend',
      createdAt: new Date().toISOString(),
      appVersion: '0.1.0',
    }),
  );

  const { app, window } = await launch(sandbox);
  try {
    await stubOpenDialog(app, file);
    await window.keyboard.press('Control+O');
    await expect(window.getByText('blend', { exact: true })).toBeVisible();
    const canvas = window.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    const shot = decode(await canvas.screenshot());
    const ox = Math.round((box.width - width) / 2);
    const oy = Math.round((box.height - height) / 2);
    BLEND_MODES.forEach((mode, index) => {
      for (const y of [4, 32, 60]) {
        const x = index * stripe + stripe / 2;
        const want = Array.from(expected.subarray((y * width + x) * 4, (y * width + x) * 4 + 3));
        const got = pixel(shot, ox + x, oy + y).slice(0, 3);
        got.forEach((value, channel) =>
          expect(Math.abs(value! - want[channel]!), `${mode} at y=${y}`).toBeLessThanOrEqual(3),
        );
      }
    });
  } finally {
    await forceClose(app);
  }
});

test('saves a project the launcher can read and reopens it with its layers', async () => {
  const project = path.join(sandbox.projectsDir, 'Poster.cproj');
  let { app, window } = await launch(sandbox);
  try {
    await newImage(window, 64, 48, 'Transparent');
    await window.keyboard.press('Control+Shift+N');
    await window.getByRole('button', { name: 'Layer 1' }).dblclick();
    await window.getByLabel('Layer name').fill('Ink');
    await window.getByLabel('Layer name').press('Enter');
    await window.getByLabel('Blend mode').selectOption('multiply');
    await stubSaveDialog(app, project);
    await window.keyboard.press('Control+S');
    await expect(window.getByText('Saved Poster.cproj')).toBeVisible();
    await expect(window.getByText('Unsaved changes')).toHaveCount(0);
  } finally {
    await forceClose(app);
  }

  const entries = unzipSync(await readFile(project));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']!));
  expect(manifest).toMatchObject({
    format: 'auram.project',
    formatVersion: 1,
    appId: 'auram.photo',
    name: 'Poster',
  });
  expect(entries['thumbnail.png']).toBeDefined();

  ({ app, window } = await launch(sandbox));
  try {
    // Recent files list on the start screen.
    await window.getByRole('button', { name: /Poster\.cproj/ }).click();
    await expect(window.getByRole('button', { name: /^Ink/ })).toBeVisible();
    await expect(window.getByRole('button', { name: /^Background/ })).toBeVisible();
    await expect(window.getByLabel('Blend mode')).toHaveValue('multiply');
  } finally {
    await forceClose(app);
  }
});

test('opens a project passed on the command line, as Auram Launcher does', async () => {
  const doc = createDocument(32, 32, 'white');
  const file = path.join(sandbox.projectsDir, 'From launcher.cproj');
  await (await import('node:fs/promises')).mkdir(sandbox.projectsDir, { recursive: true });
  await writeFile(
    file,
    writeProject(doc, {
      id: crypto.randomUUID(),
      name: 'From launcher',
      createdAt: new Date().toISOString(),
      appVersion: '0.1.0',
    }),
  );
  const { app, window } = await launch(sandbox, [file]);
  try {
    await expect(window.getByText('From launcher', { exact: true })).toBeVisible();
    await expect(window.getByText('32 × 32 px')).toBeVisible();
  } finally {
    await forceClose(app);
  }
});

test('asks before closing with unsaved changes', async () => {
  const { app, window } = await launch(sandbox);
  try {
    await newImage(window, 50, 50);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    const dialog = window.getByRole('dialog', { name: 'Save changes?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    // The window closes while the click is being handled.
    const discard = window
      .getByRole('dialog', { name: 'Save changes?' })
      .getByRole('button', { name: "Don't save" });
    await Promise.all([closed, discard.click().catch(() => {})]);
  } catch (error) {
    await forceClose(app).catch(() => {});
    throw error;
  }
});

test('selects, fills, moves and clears pixels', async () => {
  const { app, window } = await launch(sandbox);
  try {
    await newImage(window, 100, 100);
    await window.keyboard.press('Control+Shift+N');
    const box = (await window.getByTestId('canvas').boundingBox())!;
    const at = (x: number, y: number) => ({
      x: box.x + (box.width - 100) / 2 + x,
      y: box.y + (box.height - 100) / 2 + y,
    });

    // Marquee 10..30 × 10..30, fill with the primary colour (black).
    await window.keyboard.press('m');
    await window.mouse.move(at(10, 10).x, at(10, 10).y);
    await window.mouse.down();
    await window.mouse.move(at(30, 30).x, at(30, 30).y, { steps: 5 });
    await window.mouse.up();
    await window.keyboard.press('Alt+Backspace');

    // Move the selected pixels 40 px right.
    await window.keyboard.press('v');
    await window.mouse.move(at(20, 20).x, at(20, 20).y);
    await window.mouse.down();
    await window.mouse.move(at(60, 20).x, at(60, 20).y, { steps: 8 });
    await window.mouse.up();

    const exported = async (name: string) => {
      const file = path.join(sandbox.root, name);
      await stubSaveDialog(app, file);
      await window.keyboard.press('Control+Shift+E');
      await window
        .getByRole('dialog', { name: 'Export image' })
        .getByRole('button', { name: 'Export' })
        .click();
      await expect(window.getByText(`Exported ${name}`)).toBeVisible();
      return decode(await readFile(file));
    };

    let png = await exported('moved.png');
    expect(pixel(png, 20, 20)).toEqual([255, 255, 255, 255]);
    expect(pixel(png, 60, 20)).toEqual([0, 0, 0, 255]);

    // The selection moved with the pixels, so Delete clears them again.
    await window.keyboard.press('Delete');
    png = await exported('cleared.png');
    expect(pixel(png, 60, 20)).toEqual([255, 255, 255, 255]);

    // Deselect, then the layer menu reflects the two layers.
    await window.keyboard.press('Control+D');
    await window.getByRole('menuitem', { name: 'Layer' }).click();
    await expect(window.getByRole('menuitem', { name: /Merge down/ })).toBeEnabled();
    await window.keyboard.press('Escape');
  } finally {
    await forceClose(app);
  }
});
