/**
 * Blend modes from the W3C Compositing and Blending Level 1 specification.
 *
 * This CPU implementation is the reference: the WebGL compositor implements
 * the same formulas in GLSL, and tests compare the two.
 */

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Index of each mode, shared with the GLSL implementation. */
export function blendModeIndex(mode: BlendMode): number {
  return BLEND_MODES.indexOf(mode);
}

type Vec3 = [number, number, number];

function separable(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'multiply':
      return cb * cs;
    case 'screen':
      return cb + cs - cb * cs;
    case 'overlay':
      return separable('hard-light', cs, cb);
    case 'darken':
      return Math.min(cb, cs);
    case 'lighten':
      return Math.max(cb, cs);
    case 'color-dodge':
      if (cb === 0) return 0;
      if (cs >= 1) return 1;
      return Math.min(1, cb / (1 - cs));
    case 'color-burn':
      if (cb >= 1) return 1;
      if (cs <= 0) return 0;
      return 1 - Math.min(1, (1 - cb) / cs);
    case 'hard-light':
      return cs <= 0.5 ? cb * 2 * cs : separable('screen', cb, 2 * cs - 1);
    case 'soft-light': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 'difference':
      return Math.abs(cb - cs);
    case 'exclusion':
      return cb + cs - 2 * cb * cs;
    default:
      return cs;
  }
}

const lum = (c: Vec3) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(c: Vec3): Vec3 {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: Vec3 = [...c];
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as Vec3;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as Vec3;
  return out;
}

function setLum(c: Vec3, l: number): Vec3 {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

const sat = (c: Vec3) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c: Vec3, s: number): Vec3 {
  const max = Math.max(c[0], c[1], c[2]);
  const min = Math.min(c[0], c[1], c[2]);
  if (max === min) return [0, 0, 0];
  return c.map((v) => ((v - min) * s) / (max - min)) as Vec3;
}

/** B(Cb, Cs) for straight colours in 0..1. */
export function blendColors(mode: BlendMode, cb: Vec3, cs: Vec3): Vec3 {
  switch (mode) {
    case 'normal':
      return cs;
    case 'hue':
      return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation':
      return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color':
      return setLum(cs, lum(cb));
    case 'luminosity':
      return setLum(cb, lum(cs));
    default:
      return [
        separable(mode, cb[0], cs[0]),
        separable(mode, cb[1], cs[1]),
        separable(mode, cb[2], cs[2]),
      ];
  }
}

/**
 * Accumulator holding premultiplied colour in floating point, so repeated
 * compositing does not lose precision between layers.
 */
export class FloatCanvas {
  readonly data: Float32Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Float32Array(width * height * 4);
  }

  /** Composites a straight-alpha RGBA8 layer onto the accumulator. */
  composite(layer: Uint8ClampedArray, mode: BlendMode, opacity: number): void {
    const out = this.data;
    const cb: Vec3 = [0, 0, 0];
    const cs: Vec3 = [0, 0, 0];
    for (let i = 0; i < out.length; i += 4) {
      const as = (layer[i + 3]! / 255) * opacity;
      if (as <= 0) continue;
      const ab = out[i + 3]!;
      cs[0] = layer[i]! / 255;
      cs[1] = layer[i + 1]! / 255;
      cs[2] = layer[i + 2]! / 255;
      let mixed: Vec3 = cs;
      if (ab > 0 && mode !== 'normal') {
        cb[0] = out[i]! / ab;
        cb[1] = out[i + 1]! / ab;
        cb[2] = out[i + 2]! / ab;
        const b = blendColors(mode, cb, cs);
        mixed = [
          (1 - ab) * cs[0] + ab * b[0],
          (1 - ab) * cs[1] + ab * b[1],
          (1 - ab) * cs[2] + ab * b[2],
        ];
      }
      out[i] = as * mixed[0] + (1 - as) * out[i]!;
      out[i + 1] = as * mixed[1] + (1 - as) * out[i + 1]!;
      out[i + 2] = as * mixed[2] + (1 - as) * out[i + 2]!;
      out[i + 3] = as + ab * (1 - as);
    }
  }

  /** Converts to straight-alpha RGBA8. */
  toRgba8(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.data.length);
    for (let i = 0; i < out.length; i += 4) {
      const a = this.data[i + 3]!;
      if (a <= 0) continue;
      out[i] = Math.round((this.data[i]! / a) * 255);
      out[i + 1] = Math.round((this.data[i + 1]! / a) * 255);
      out[i + 2] = Math.round((this.data[i + 2]! / a) * 255);
      out[i + 3] = Math.round(a * 255);
    }
    return out;
  }
}
