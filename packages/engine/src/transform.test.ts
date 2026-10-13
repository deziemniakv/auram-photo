import { describe, expect, it } from 'vitest';
import { compose, invert, multiply, rotation, scaling, translation, applyAffine } from './affine';
import { History } from './history';
import { addLayer, createDocument, fill, select, translate } from './operations';
import { Raster } from './raster';
import { RESAMPLE_METHODS, resampleRaster, resampleSelection } from './resample';
import { Selection } from './selection';
import {
  crop,
  resizeCanvas,
  resizeImage,
  rotateDocument,
  rotateRaster,
  transformLayer,
} from './transform';

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };

function pattern(width: number, height: number): Raster {
  const raster = new Raster(width, height);
  for (let i = 0; i < width * height; i++) {
    raster.data[i * 4] = (i * 37) % 256;
    raster.data[i * 4 + 1] = (i * 91) % 256;
    raster.data[i * 4 + 2] = (i * 13) % 256;
    raster.data[i * 4 + 3] = 255 - ((i * 7) % 200);
  }
  return raster;
}

/** Pixels with zero alpha compare equal whatever colour they keep. */
function visible(raster: Raster): number[] {
  const out: number[] = [];
  for (let i = 0; i < raster.data.length; i += 4) {
    if (raster.data[i + 3] === 0) out.push(0, 0, 0, 0);
    else out.push(...raster.data.subarray(i, i + 4));
  }
  return out;
}

function pixel(raster: Raster, x: number, y: number): number[] {
  return Array.from(
    raster.data.subarray((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4),
  );
}

describe('affine transforms', () => {
  it('composes, applies and inverts', () => {
    const m = compose(scaling(2, 3), rotation(Math.PI / 2), translation(10, 0));
    // (1, 0) → scaled (2, 0) → rotated (0, 2) → translated (10, 2)
    const p = applyAffine(m, 1, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(2);
    const back = applyAffine(invert(m), p.x, p.y);
    expect(back.x).toBeCloseTo(1);
    expect(back.y).toBeCloseTo(0);
    expect(() => invert(scaling(0, 1))).toThrow(RangeError);
    expect(multiply(translation(1, 2), translation(3, 4))).toEqual(translation(4, 6));
  });
});

describe('resampling', () => {
  it('keeps pixels exactly at the same size, for every method', () => {
    const source = pattern(7, 5);
    for (const method of RESAMPLE_METHODS) {
      expect(resampleRaster(source, 7, 5, method).data).toEqual(source.data);
    }
  });

  it('keeps a uniform colour uniform, including at the edges', () => {
    const source = new Raster(9, 7);
    source.fill({ r: 40, g: 120, b: 200, a: 255 });
    for (const method of RESAMPLE_METHODS) {
      for (const [w, h] of [
        [20, 3],
        [4, 15],
        [1, 1],
      ] as const) {
        const out = resampleRaster(source, w, h, method);
        for (let i = 0; i < w * h; i++) {
          expect(Array.from(out.data.subarray(i * 4, i * 4 + 4))).toEqual([40, 120, 200, 255]);
        }
      }
    }
  });

  it('averages every source pixel when shrinking', () => {
    // A 1-pixel checkerboard halves to mid grey instead of picking every other pixel.
    const source = new Raster(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        source.fill(
          (x + y) % 2 ? { r: 255, g: 255, b: 255, a: 255 } : { r: 0, g: 0, b: 0, a: 255 },
          {
            x,
            y,
            width: 1,
            height: 1,
          },
        );
    const out = resampleRaster(source, 4, 4, 'bilinear');
    // Interior pixels (the edges repeat the border pixel, which tips the balance).
    for (const [x, y] of [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ] as const) {
      expect(Math.abs(pixel(out, x, y)[0]! - 128)).toBeLessThanOrEqual(1);
    }
  });

  it('does not darken edges next to transparent pixels', () => {
    // White opaque left half, fully transparent (black) right half.
    const source = new Raster(8, 1);
    source.fill({ r: 255, g: 255, b: 255, a: 255 }, { x: 0, y: 0, width: 4, height: 1 });
    for (const method of ['bilinear', 'bicubic', 'lanczos'] as const) {
      const out = resampleRaster(source, 20, 1, method);
      for (let x = 0; x < 20; x++) {
        const [r, g, b, a] = pixel(out, x, 0);
        if (a! > 0) expect([r, g, b]).toEqual([255, 255, 255]);
      }
    }
  });

  it('copies whole pixels with nearest neighbour', () => {
    const source = pattern(3, 2);
    const out = resampleRaster(source, 6, 4, 'nearest');
    expect(pixel(out, 5, 3)).toEqual(pixel(source, 2, 1));
    expect(pixel(out, 0, 0)).toEqual(pixel(source, 0, 0));
    expect(pixel(out, 2, 1)).toEqual(pixel(source, 1, 0));
  });

  it('resamples selection masks', () => {
    const selection = Selection.rect(10, 10, { x: 0, y: 0, width: 5, height: 10 });
    const out = resampleSelection(selection, 20, 20, 'bicubic');
    expect(out.coverage(2, 10)).toBe(255);
    expect(out.coverage(18, 10)).toBe(0);
  });
});

describe('document geometry', () => {
  it('resizes every layer and the selection, and undoes exactly', () => {
    const doc = createDocument(20, 10, 'white');
    const history = new History(doc);
    history.push(addLayer(doc));
    history.push(select(doc, { type: 'rect', rect: { x: 0, y: 0, width: 10, height: 10 } })!);
    history.push(fill(doc, doc.activeLayerId, RED)!);
    const before = doc.layers.map((layer) => layer.raster.data.slice());
    const sizes: unknown[] = [];
    doc.on((change) => sizes.push(change));

    history.push(resizeImage(doc, 40, 5, 'bicubic')!);
    expect([doc.width, doc.height]).toEqual([40, 5]);
    expect(sizes).toEqual([{ kind: 'size' }]);
    for (const layer of doc.layers)
      expect([layer.raster.width, layer.raster.height]).toEqual([40, 5]);
    expect(pixel(doc.activeLayer.raster, 5, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(doc.activeLayer.raster, 35, 2)[3]).toBe(0);
    expect(doc.selection?.coverage(5, 2)).toBe(255);
    expect(doc.selection?.coverage(35, 2)).toBe(0);

    history.undo();
    expect([doc.width, doc.height]).toEqual([20, 10]);
    doc.layers.forEach((layer, i) => expect(layer.raster.data).toEqual(before[i]));
    history.redo();
    expect([doc.width, doc.height]).toEqual([40, 5]);
    expect(resizeImage(doc, 40, 5, 'bicubic')).toBeNull();
    expect(() => resizeImage(doc, 0, 5, 'bicubic')).toThrow(RangeError);
  });

  it('keeps edits made after a resize when undoing and redoing around them', () => {
    const doc = createDocument(8, 8, 'white');
    const history = new History(doc);
    history.push(resizeImage(doc, 16, 16, 'nearest')!);
    history.push(fill(doc, doc.activeLayerId, BLUE)!);
    const painted = doc.activeLayer.raster.data.slice();
    history.undo();
    history.undo();
    expect(doc.width).toBe(8);
    history.redo();
    history.redo();
    expect(doc.activeLayer.raster.data).toEqual(painted);
  });

  it('grows the canvas around an anchor and fills only the bottom layer', () => {
    const doc = createDocument(4, 4, 'white');
    const history = new History(doc);
    history.push(addLayer(doc));
    history.push(fill(doc, doc.activeLayerId, RED)!);
    history.push(resizeCanvas(doc, 8, 6, { x: 0.5, y: 1 }, BLUE)!);
    expect([doc.width, doc.height]).toEqual([8, 6]);
    const [bottom, top] = doc.layers;
    // Old pixels sit at x 2..5, y 2..5.
    expect(pixel(top!.raster, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(top!.raster, 1, 2)[3]).toBe(0);
    expect(pixel(bottom!.raster, 2, 2)).toEqual([255, 255, 255, 255]);
    expect(pixel(bottom!.raster, 0, 0)).toEqual([0, 0, 255, 255]);
    history.undo();
    expect([doc.width, doc.height]).toEqual([4, 4]);
  });

  it('shrinks the canvas around an anchor', () => {
    const doc = createDocument(4, 4, 'transparent');
    doc.activeLayer.raster.fill(RED, { x: 3, y: 3, width: 1, height: 1 });
    resizeCanvas(doc, 2, 2, { x: 1, y: 1 });
    expect(pixel(doc.activeLayer.raster, 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it('crops to a rectangle and clears the selection', () => {
    const doc = createDocument(10, 10, 'transparent');
    doc.activeLayer.raster.fill(RED, { x: 4, y: 5, width: 1, height: 1 });
    select(doc, { type: 'rect', rect: { x: 2, y: 2, width: 5, height: 5 } });
    const command = crop(doc, { x: 3, y: 3, width: 20, height: 4 })!;
    expect([doc.width, doc.height]).toEqual([7, 4]);
    expect(pixel(doc.activeLayer.raster, 1, 2)).toEqual([255, 0, 0, 255]);
    expect(doc.selection).toBeNull();
    command.undo(doc);
    expect([doc.width, doc.height]).toEqual([10, 10]);
    expect(doc.selection).not.toBeNull();
    expect(crop(doc, { x: 20, y: 20, width: 5, height: 5 })).toBeNull();
    expect(crop(doc, { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });

  it('rotates by quarter turns exactly', () => {
    const source = pattern(5, 3);
    const cw = rotateRaster(source, 1);
    expect([cw.width, cw.height]).toEqual([3, 5]);
    // The top-left pixel ends up top-right after a clockwise turn.
    expect(pixel(cw, 2, 0)).toEqual(pixel(source, 0, 0));
    expect(pixel(rotateRaster(source, 3), 0, 4)).toEqual(pixel(source, 0, 0));
    expect(pixel(rotateRaster(source, 2), 4, 2)).toEqual(pixel(source, 0, 0));
    let r = source;
    for (let i = 0; i < 4; i++) r = rotateRaster(r, 1);
    expect(r.data).toEqual(source.data);

    const doc = createDocument(6, 2, 'white');
    select(doc, { type: 'rect', rect: { x: 0, y: 0, width: 1, height: 1 } });
    rotateDocument(doc, 1);
    expect([doc.width, doc.height]).toEqual([2, 6]);
    expect(doc.selection?.coverage(1, 0)).toBe(255);
  });
});

describe('free transform', () => {
  function single(width = 16, height = 16) {
    const doc = createDocument(width, height, 'transparent');
    doc.activeLayer.raster.fill(RED, { x: 4, y: 4, width: 4, height: 2 });
    return doc;
  }

  it('moves pixels exactly like the move tool for whole-pixel translations', () => {
    const a = single();
    const b = single();
    transformLayer(a, a.activeLayerId, translation(3, -2), 'bicubic');
    translate(b, b.activeLayerId, 3, -2);
    expect(visible(a.activeLayer.raster)).toEqual(visible(b.activeLayer.raster));
  });

  it('rotates a quarter turn about a pixel corner exactly', () => {
    const doc = single();
    const original = doc.activeLayer.raster.clone();
    const m = compose(translation(-8, -8), rotation(Math.PI / 2), translation(8, 8));
    transformLayer(doc, doc.activeLayerId, m, 'bicubic');
    const expected = rotateRaster(original, 1);
    expect(visible(doc.activeLayer.raster)).toEqual(visible(expected));
  });

  it('scales with soft edges and keeps the colour', () => {
    const doc = single();
    const m = compose(translation(-4, -4), scaling(1.5, 1.5), translation(4, 4));
    transformLayer(doc, doc.activeLayerId, m, 'bilinear');
    // The 4 × 2 block at (4, 4) becomes 6 × 3; its outermost pixels are partly covered.
    const raster = doc.activeLayer.raster;
    expect(pixel(raster, 6, 5)).toEqual([255, 0, 0, 255]);
    expect(pixel(raster, 8, 5)).toEqual([255, 0, 0, 255]);
    expect(pixel(raster, 9, 5)[3]).toBeGreaterThan(128);
    expect(pixel(raster, 11, 5)[3]).toBe(0);
    expect(pixel(raster, 6, 7)[3]).toBe(0);
    for (let i = 0; i < raster.width * raster.height; i++) {
      if (raster.data[i * 4 + 3]! > 0) expect(raster.data[i * 4]).toBe(255);
    }
  });

  it('transforms only the selected pixels, moves the selection, and undoes exactly', () => {
    const doc = createDocument(16, 16, 'white');
    const history = new History(doc);
    select(doc, { type: 'rect', rect: { x: 0, y: 0, width: 4, height: 4 } });
    history.push(fill(doc, doc.activeLayerId, BLUE)!);
    const before = doc.activeLayer.raster.data.slice();
    const selectionBefore = doc.selection;
    history.push(transformLayer(doc, doc.activeLayerId, translation(8, 8), 'bicubic')!);
    const raster = doc.activeLayer.raster;
    // The vacated area becomes transparent; the moved block lands at 8..11.
    expect(pixel(raster, 1, 1)[3]).toBe(0);
    expect(pixel(raster, 9, 9)).toEqual([0, 0, 255, 255]);
    expect(pixel(raster, 13, 13)).toEqual([255, 255, 255, 255]);
    expect(doc.selection?.coverage(9, 9)).toBe(255);
    expect(doc.selection?.coverage(1, 1)).toBe(0);
    history.undo();
    expect(raster.data).toEqual(before);
    expect(doc.selection).toBe(selectionBefore);
  });

  it('discards pixels moved off the canvas and does nothing for an identity transform', () => {
    const doc = single();
    expect(transformLayer(doc, doc.activeLayerId, translation(0, 0), 'bicubic')).toBeNull();
    transformLayer(doc, doc.activeLayerId, translation(100, 0), 'bicubic');
    expect(doc.activeLayer.raster.contentBounds().width).toBe(0);
  });
});
