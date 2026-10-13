import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decode } from 'fast-png';
import {
  createSandbox,
  forceClose,
  launch,
  newImage,
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

type Png = ReturnType<typeof decode>;

function pixel(png: Png, x: number, y: number) {
  const i = (y * png.width + x) * png.channels;
  return Array.from({ length: png.channels }, (_, k) => png.data[i + k]);
}

async function exported(app: ElectronApplication, window: Page, name: string): Promise<Png> {
  const file = path.join(sandbox.root, name);
  await stubSaveDialog(app, file);
  await window.keyboard.press('Control+Shift+E');
  await window
    .getByRole('dialog', { name: 'Export image' })
    .getByRole('button', { name: 'Export' })
    .click();
  await expect(window.getByText(`Exported ${name}`)).toBeVisible();
  return decode(await readFile(file));
}

async function menu(window: Page, top: string, item: string | RegExp) {
  await window.getByRole('menuitem', { name: top, exact: true }).click();
  await window.getByRole('menuitem', { name: item }).click();
}

/** Screen position of a document point, for a document shown at 100% in the centre. */
async function mapper(window: Page, width: number, height: number) {
  const box = (await window.getByTestId('canvas').boundingBox())!;
  const ox = box.x + Math.round((box.width - width) / 2);
  const oy = box.y + Math.round((box.height - height) / 2);
  return (x: number, y: number) => ({ x: ox + x, y: oy + y });
}

async function drag(
  window: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await window.mouse.move(from.x, from.y);
  await window.mouse.down();
  await window.mouse.move(to.x, to.y, { steps: 8 });
  await window.mouse.up();
}

async function selectAndFill(
  window: Page,
  at: Awaited<ReturnType<typeof mapper>>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  await window.keyboard.press('m');
  await drag(window, at(x0, y0), at(x1, y1));
  await window.keyboard.press('Alt+Backspace');
}

const status = (window: Page, text: string) =>
  expect(window.getByRole('contentinfo').getByText(text, { exact: true })).toBeVisible();

test('resizes the image, changes the canvas size and crops, each undoable', async () => {
  const { app, window } = await launch(sandbox);
  try {
    await newImage(window, 100, 50);
    let at = await mapper(window, 100, 50);
    // Left half black.
    await selectAndFill(window, at, 0, 0, 50, 50);
    await window.keyboard.press('Control+D');

    await menu(window, 'Image', 'Image size…');
    const sizeDialog = window.getByRole('dialog', { name: 'Image size' });
    await sizeDialog.getByLabel('Width (px)').fill('200');
    // Proportions are kept by default.
    await expect(sizeDialog.getByLabel('Height (px)')).toHaveValue('100');
    await sizeDialog.getByLabel('Resampling').selectOption('nearest');
    await sizeDialog.getByRole('button', { name: 'Resize' }).click();
    await status(window, '200 × 100 px');
    let png = await exported(app, window, 'resized.png');
    expect([png.width, png.height]).toEqual([200, 100]);
    expect(pixel(png, 99, 50)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 100, 50)).toEqual([255, 255, 255, 255]);

    await menu(window, 'Image', 'Canvas size…');
    const canvasDialog = window.getByRole('dialog', { name: 'Canvas size' });
    await canvasDialog.getByLabel('Width (px)').fill('300');
    await canvasDialog.getByRole('button', { name: 'Left', exact: true }).click();
    await canvasDialog.getByLabel('Transparent').check();
    await canvasDialog.getByRole('button', { name: 'Resize canvas' }).click();
    await status(window, '300 × 100 px');
    png = await exported(app, window, 'canvas.png');
    expect([png.width, png.height]).toEqual([300, 100]);
    expect(pixel(png, 50, 50)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 150, 50)).toEqual([255, 255, 255, 255]);
    expect(pixel(png, 250, 50)[3]).toBe(0);

    // Crop tool: drag a rectangle, then press Enter.
    at = await mapper(window, 300, 100);
    await window.keyboard.press('c');
    await drag(window, at(80.2, 10.2), at(130.2, 40.2));
    await expect(
      window.getByRole('toolbar', { name: 'Tool options' }).getByText('50 × 30 px'),
    ).toBeVisible();
    await window.keyboard.press('Enter');
    await status(window, '50 × 30 px');
    png = await exported(app, window, 'cropped.png');
    expect([png.width, png.height]).toEqual([50, 30]);
    expect(pixel(png, 19, 10)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 20, 10)).toEqual([255, 255, 255, 255]);

    await window.keyboard.press('Control+Z');
    await status(window, '300 × 100 px');
    await window.keyboard.press('Control+Z');
    await status(window, '200 × 100 px');
    await window.keyboard.press('Control+Z');
    await status(window, '100 × 50 px');
  } finally {
    await forceClose(app);
  }
});

test('rotates the canvas and crops to the selection', async () => {
  const { app, window } = await launch(sandbox);
  try {
    await newImage(window, 40, 20);
    const at = await mapper(window, 40, 20);
    await selectAndFill(window, at, 0, 0, 10, 10);
    await window.keyboard.press('Control+D');

    await menu(window, 'Image', 'Rotate 90° clockwise');
    await status(window, '20 × 40 px');
    let png = await exported(app, window, 'rotated.png');
    expect([png.width, png.height]).toEqual([20, 40]);
    // The top-left block is now in the top-right corner.
    expect(pixel(png, 15, 5)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 5, 5)).toEqual([255, 255, 255, 255]);

    const rotated = await mapper(window, 20, 40);
    await window.keyboard.press('m');
    await drag(window, rotated(10, 0), rotated(20, 20));
    await menu(window, 'Image', 'Crop to selection');
    await status(window, '10 × 20 px');
    png = await exported(app, window, 'crop-selection.png');
    expect([png.width, png.height]).toEqual([10, 20]);
    expect(pixel(png, 5, 5)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 5, 15)).toEqual([255, 255, 255, 255]);
  } finally {
    await forceClose(app);
  }
});

test('free transform previews on the GPU and applies as one undoable step', async () => {
  const { app, window } = await launch(sandbox);
  try {
    await newImage(window, 100, 100);
    await window.keyboard.press('Control+Shift+N');
    const at = await mapper(window, 100, 100);
    await selectAndFill(window, at, 10, 10, 30, 30);

    await window.keyboard.press('Control+T');
    const options = window.getByRole('toolbar', { name: 'Tool options' });
    await expect(options.getByText('Free transform')).toBeVisible();
    // Drag the right-hand handle 20 px further right: twice as wide, anchored at the left edge.
    await drag(window, at(30, 20), at(50, 20));
    await expect(options.getByText('W 200%')).toBeVisible();

    // The preview already shows the scaled pixels.
    const canvas = window.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    const shot = decode(await canvas.screenshot());
    const local = (x: number, y: number) => {
      const p = at(x, y);
      return pixel(shot, Math.round(p.x - box.x), Math.round(p.y - box.y)).slice(0, 3);
    };
    expect(local(40, 25)).toEqual([0, 0, 0]);
    expect(local(60, 25)).toEqual([255, 255, 255]);

    await window.keyboard.press('Enter');
    await expect(options.getByText('Free transform')).toHaveCount(0);
    let png = await exported(app, window, 'scaled.png');
    expect(pixel(png, 45, 20)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 55, 20)).toEqual([255, 255, 255, 255]);

    // Arrow keys nudge; Escape cancels without changing anything.
    await window.keyboard.press('Control+T');
    await window.keyboard.press('Shift+ArrowDown');
    await window.keyboard.press('Escape');
    await expect(options.getByText('Free transform')).toHaveCount(0);
    png = await exported(app, window, 'cancelled.png');
    expect(pixel(png, 45, 20)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 45, 35)).toEqual([255, 255, 255, 255]);

    await window.keyboard.press('Control+T');
    for (let i = 0; i < 5; i++) await window.keyboard.press('ArrowRight');
    await window.keyboard.press('Enter');
    await expect(options.getByText('Free transform')).toHaveCount(0);
    png = await exported(app, window, 'nudged.png');
    expect(pixel(png, 52, 20)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 12, 20)).toEqual([255, 255, 255, 255]);

    // One undo step per transform.
    await window.keyboard.press('Control+Z');
    await window.keyboard.press('Control+Z');
    png = await exported(app, window, 'undone.png');
    expect(pixel(png, 20, 20)).toEqual([0, 0, 0, 255]);
    expect(pixel(png, 45, 20)).toEqual([255, 255, 255, 255]);
  } finally {
    await forceClose(app);
  }
});
