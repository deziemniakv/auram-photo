import { describe, expect, it } from 'vitest';
import { BLEND_MODES, FloatCanvas, blendColors } from './blend';
import { parseHex, toHex } from './color';

function px(r: number, g: number, b: number, a = 255) {
  return new Uint8ClampedArray([r, g, b, a]);
}

function compose(layers: Array<[Uint8ClampedArray, (typeof BLEND_MODES)[number], number]>) {
  const canvas = new FloatCanvas(1, 1);
  for (const [data, mode, opacity] of layers) canvas.composite(data, mode, opacity);
  return [...canvas.toRgba8()];
}

describe('blend modes', () => {
  it('implements the W3C separable formulas', () => {
    const cb: [number, number, number] = [0.25, 0.5, 0.75];
    const cs: [number, number, number] = [0.5, 0.5, 0.5];
    expect(blendColors('multiply', cb, cs)).toEqual([0.125, 0.25, 0.375]);
    expect(blendColors('screen', cb, cs)).toEqual([0.625, 0.75, 0.875]);
    expect(blendColors('difference', cb, cs)).toEqual([0.25, 0, 0.25]);
    expect(blendColors('darken', cb, cs)).toEqual([0.25, 0.5, 0.5]);
    expect(blendColors('lighten', cb, cs)).toEqual([0.5, 0.5, 0.75]);
    expect(
      blendColors('color-dodge', [0, 0.5, 1], [1, 0.5, 0.5]).map((v) => +v.toFixed(3)),
    ).toEqual([0, 1, 1]);
  });

  it('keeps luminosity-based modes within gamut', () => {
    for (const mode of ['hue', 'saturation', 'color', 'luminosity'] as const) {
      for (const value of blendColors(mode, [0.9, 0.1, 0.2], [0.1, 0.8, 0.95])) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('composites normal layers with opacity (source-over)', () => {
    expect(
      compose([
        [px(255, 255, 255), 'normal', 1],
        [px(0, 0, 0), 'normal', 0.5],
      ]),
    ).toEqual([128, 128, 128, 255]);
    expect(compose([[px(255, 0, 0, 128), 'normal', 1]])).toEqual([255, 0, 0, 128]);
  });

  it('applies blend modes only where the backdrop exists', () => {
    // Multiply over nothing behaves like normal.
    expect(compose([[px(100, 150, 200), 'multiply', 1]])).toEqual([100, 150, 200, 255]);
    expect(
      compose([
        [px(255, 128, 0), 'normal', 1],
        [px(128, 128, 128), 'multiply', 1],
      ]),
    ).toEqual([128, 64, 0, 255]);
  });

  it('ignores fully transparent layers for every mode', () => {
    for (const mode of BLEND_MODES) {
      expect(
        compose([
          [px(10, 20, 30), 'normal', 1],
          [px(200, 200, 200, 0), mode, 1],
        ]),
        mode,
      ).toEqual([10, 20, 30, 255]);
    }
  });
});

describe('colour helpers', () => {
  it('parses and formats hex colours', () => {
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 255 });
    expect(parseHex('11223380')).toEqual({ r: 17, g: 34, b: 51, a: 128 });
    expect(parseHex('nope')).toBeNull();
    expect(toHex({ r: 255, g: 136, b: 0, a: 128 })).toBe('#ff8800');
    expect(toHex({ r: 255, g: 136, b: 0, a: 128 }, true)).toBe('#ff880080');
  });
});
