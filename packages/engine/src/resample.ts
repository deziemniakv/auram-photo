import { invert, type Affine } from './affine';
import type { Rect } from './geometry';
import { Raster } from './raster';
import { Selection } from './selection';

/*
 * Resampling of straight-alpha RGBA8 rasters and 8-bit selection masks.
 *
 * Colour is filtered premultiplied by alpha, so transparent pixels never bleed
 * dark fringes into opaque ones. Downscaling widens the filter by the scale
 * factor, so every source pixel contributes (no aliasing or skipped pixels).
 */

export const RESAMPLE_METHODS = ['bicubic', 'bilinear', 'lanczos', 'nearest'] as const;
export type ResampleMethod = (typeof RESAMPLE_METHODS)[number];

interface Kernel {
  radius: number;
  weight(x: number): number;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

const KERNELS: Record<Exclude<ResampleMethod, 'nearest'>, Kernel> = {
  bilinear: { radius: 1, weight: (x) => Math.max(0, 1 - Math.abs(x)) },
  // Catmull-Rom (B = 0, C = 0.5): sharp, and exact at integer positions.
  bicubic: {
    radius: 2,
    weight: (x) => {
      const t = Math.abs(x);
      if (t < 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
      if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
      return 0;
    },
  },
  lanczos: { radius: 3, weight: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) },
};

interface Taps {
  /** First source index for each output index. */
  start: Int32Array;
  count: Int32Array;
  /** `maxTaps` weights per output index, normalised to sum to 1. */
  weights: Float32Array;
  maxTaps: number;
}

/** Filter taps for resizing one axis from `srcLen` to `dstLen`, with clamped edges. */
function computeTaps(srcLen: number, dstLen: number, kernel: Kernel): Taps {
  const scale = dstLen / srcLen;
  const filterScale = Math.max(1, 1 / scale);
  const support = kernel.radius * filterScale;
  const maxTaps = Math.min(srcLen, Math.ceil(support * 2) + 2);
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const weights = new Float32Array(dstLen * maxTaps);
  for (let o = 0; o < dstLen; o++) {
    const center = (o + 0.5) / scale - 0.5;
    const lo = Math.ceil(center - support);
    const hi = Math.floor(center + support);
    const first = Math.min(srcLen - 1, Math.max(0, lo));
    const last = Math.max(0, Math.min(srcLen - 1, hi));
    const base = o * maxTaps;
    let total = 0;
    for (let i = lo; i <= hi; i++) {
      const w = kernel.weight((i - center) / filterScale);
      if (w === 0) continue;
      // Positions outside the image reuse the edge pixel.
      const index = Math.min(last, Math.max(first, i)) - first;
      weights[base + index] = weights[base + index]! + w;
      total += w;
    }
    start[o] = first;
    count[o] = last - first + 1;
    if (total !== 0)
      for (let k = 0; k < count[o]!; k++) weights[base + k] = weights[base + k]! / total;
  }
  return { start, count, weights, maxTaps };
}

/**
 * Resizes interleaved 8-bit pixels with `channels` channels. With four channels
 * the last one is alpha and colour is filtered premultiplied.
 */
function resizeChannels(
  src: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  channels: 1 | 4,
  method: ResampleMethod,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * channels);
  if (method === 'nearest') {
    const xs = new Int32Array(dstW);
    for (let x = 0; x < dstW; x++)
      xs[x] = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dstW));
    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dstH));
      for (let x = 0; x < dstW; x++) {
        const s = (sy * srcW + xs[x]!) * channels;
        const d = (y * dstW + x) * channels;
        for (let c = 0; c < channels; c++) out[d + c] = src[s + c]!;
      }
    }
    return out;
  }

  const kernel = KERNELS[method];
  const xt = computeTaps(srcW, dstW, kernel);
  const yt = computeTaps(srcH, dstH, kernel);
  const premultiply = channels === 4;
  const row = new Float32Array(srcW * channels);
  // Output is produced in bands of rows so the intermediate buffer stays small.
  const BAND = 32;
  let tmp = new Float32Array(0);

  for (let y0 = 0; y0 < dstH; y0 += BAND) {
    const y1 = Math.min(dstH, y0 + BAND);
    let r0 = srcH;
    let r1 = 0;
    for (let y = y0; y < y1; y++) {
      r0 = Math.min(r0, yt.start[y]!);
      r1 = Math.max(r1, yt.start[y]! + yt.count[y]!);
    }
    const rows = r1 - r0;
    if (tmp.length < rows * dstW * channels) tmp = new Float32Array(rows * dstW * channels);

    // Horizontal pass: source rows r0..r1 → tmp (dstW wide).
    for (let r = 0; r < rows; r++) {
      const s = (r0 + r) * srcW * channels;
      if (premultiply) {
        for (let x = 0; x < srcW; x++) {
          const i = s + x * 4;
          const a = src[i + 3]!;
          const k = a / 255;
          row[x * 4] = src[i]! * k;
          row[x * 4 + 1] = src[i + 1]! * k;
          row[x * 4 + 2] = src[i + 2]! * k;
          row[x * 4 + 3] = a;
        }
      } else {
        for (let x = 0; x < srcW; x++) row[x] = src[s + x]!;
      }
      const t = r * dstW * channels;
      if (premultiply) {
        for (let x = 0; x < dstW; x++) {
          const n = xt.count[x]!;
          const wBase = x * xt.maxTaps;
          let i = xt.start[x]! * 4;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let sa = 0;
          for (let k = 0; k < n; k++, i += 4) {
            const w = xt.weights[wBase + k]!;
            sr += row[i]! * w;
            sg += row[i + 1]! * w;
            sb += row[i + 2]! * w;
            sa += row[i + 3]! * w;
          }
          const o = t + x * 4;
          tmp[o] = sr;
          tmp[o + 1] = sg;
          tmp[o + 2] = sb;
          tmp[o + 3] = sa;
        }
        continue;
      }
      for (let x = 0; x < dstW; x++) {
        const first = xt.start[x]!;
        const n = xt.count[x]!;
        const wBase = x * xt.maxTaps;
        for (let c = 0; c < channels; c++) {
          let sum = 0;
          for (let k = 0; k < n; k++)
            sum += row[(first + k) * channels + c]! * xt.weights[wBase + k]!;
          tmp[t + x * channels + c] = sum;
        }
      }
    }

    // Vertical pass: tmp → output rows y0..y1.
    for (let y = y0; y < y1; y++) {
      const first = yt.start[y]! - r0;
      const n = yt.count[y]!;
      const wBase = y * yt.maxTaps;
      for (let x = 0; x < dstW; x++) {
        const d = (y * dstW + x) * channels;
        if (!premultiply) {
          let sum = 0;
          for (let k = 0; k < n; k++)
            sum += tmp[((first + k) * dstW + x) * channels]! * yt.weights[wBase + k]!;
          out[d] = sum;
          continue;
        }
        let pr = 0;
        let pg = 0;
        let pb = 0;
        let pa = 0;
        for (let k = 0; k < n; k++) {
          const w = yt.weights[wBase + k]!;
          const i = ((first + k) * dstW + x) * 4;
          pr += tmp[i]! * w;
          pg += tmp[i + 1]! * w;
          pb += tmp[i + 2]! * w;
          pa += tmp[i + 3]! * w;
        }
        writeUnpremultiplied(out, d, pr, pg, pb, pa);
      }
    }
  }
  return out;
}

/** Stores a premultiplied colour (alpha 0..255) as straight RGBA8, clamping filter overshoot. */
function writeUnpremultiplied(
  out: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const alpha = Math.min(255, a);
  if (alpha < 0.5) {
    out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    return;
  }
  const k = 255 / alpha;
  out[i] = Math.min(alpha, Math.max(0, r)) * k;
  out[i + 1] = Math.min(alpha, Math.max(0, g)) * k;
  out[i + 2] = Math.min(alpha, Math.max(0, b)) * k;
  out[i + 3] = alpha;
}

export function resampleRaster(
  raster: Raster,
  width: number,
  height: number,
  method: ResampleMethod,
): Raster {
  if (width === raster.width && height === raster.height) return raster.clone();
  return new Raster(
    width,
    height,
    resizeChannels(raster.data, raster.width, raster.height, width, height, 4, method),
  );
}

export function resampleSelection(
  selection: Selection,
  width: number,
  height: number,
  method: ResampleMethod,
): Selection {
  // Masks have no colour to sharpen; a soft filter avoids ringing along their edges.
  const maskMethod = method === 'nearest' ? 'nearest' : 'bilinear';
  const mask = resizeChannels(
    selection.mask,
    selection.width,
    selection.height,
    width,
    height,
    1,
    maskMethod,
  );
  return new Selection(width, height, new Uint8Array(mask.buffer));
}

/** Resizes a region of pixels; used to prefilter before a shrinking transform. */
export function resizePixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  dstWidth: number,
  dstHeight: number,
  channels: 1 | 4,
  method: ResampleMethod,
): Uint8ClampedArray {
  if (width === dstWidth && height === dstHeight) return new Uint8ClampedArray(data);
  return resizeChannels(data, width, height, dstWidth, dstHeight, channels, method);
}

/**
 * Renders `source` (a `width` × `height` image whose top-left pixel corner is at
 * `origin`) through `transform` into the document-space rectangle `dest`.
 * Areas that map outside the source are transparent (alpha or mask 0). Returns
 * `dest.width × dest.height × channels` values.
 */
export function transformPixels(
  source: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  origin: { x: number; y: number },
  transform: Affine,
  dest: Rect,
  channels: 1 | 4,
  method: ResampleMethod,
): Uint8ClampedArray {
  // Prefilter when the transform shrinks the source, so small results do not alias.
  const scaleX = Math.hypot(transform.a, transform.b);
  const scaleY = Math.hypot(transform.c, transform.d);
  let src = source;
  let srcW = width;
  let srcH = height;
  if (method !== 'nearest' && (scaleX < 0.99 || scaleY < 0.99)) {
    srcW = Math.max(1, Math.round(width * Math.min(1, scaleX)));
    srcH = Math.max(1, Math.round(height * Math.min(1, scaleY)));
    src = resizeChannels(source, width, height, srcW, srcH, channels, method);
  }
  const fx = srcW / width;
  const fy = srcH / height;
  const inv = invert(transform);
  const out = new Uint8ClampedArray(dest.width * dest.height * channels);
  const kernel = method === 'nearest' ? null : KERNELS[method];
  const radius = kernel?.radius ?? 0;
  const wx = new Float64Array(radius * 2);
  const wy = new Float64Array(radius * 2);

  for (let y = 0; y < dest.height; y++) {
    const py = dest.y + y + 0.5;
    for (let x = 0; x < dest.width; x++) {
      const px = dest.x + x + 0.5;
      // Source position in (possibly prefiltered) pixel units, pixel centres at i + 0.5.
      const sx = (inv.a * px + inv.c * py + inv.e - origin.x) * fx;
      const sy = (inv.b * px + inv.d * py + inv.f - origin.y) * fy;
      const o = (y * dest.width + x) * channels;
      if (sx <= -radius || sy <= -radius || sx >= srcW + radius || sy >= srcH + radius) continue;

      if (!kernel) {
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        if (ix < 0 || iy < 0 || ix >= srcW || iy >= srcH) continue;
        const s = (iy * srcW + ix) * channels;
        for (let c = 0; c < channels; c++) out[o + c] = src[s + c]!;
        continue;
      }

      const cx = sx - 0.5;
      const cy = sy - 0.5;
      const x0 = Math.floor(cx) - radius + 1;
      const y0 = Math.floor(cy) - radius + 1;
      for (let k = 0; k < radius * 2; k++) {
        wx[k] = kernel.weight(cx - (x0 + k));
        wy[k] = kernel.weight(cy - (y0 + k));
      }
      if (channels === 1) {
        let sum = 0;
        for (let j = 0; j < radius * 2; j++) {
          const yy = y0 + j;
          if (yy < 0 || yy >= srcH || wy[j] === 0) continue;
          for (let i = 0; i < radius * 2; i++) {
            const xx = x0 + i;
            if (xx < 0 || xx >= srcW) continue;
            sum += src[yy * srcW + xx]! * wx[i]! * wy[j]!;
          }
        }
        out[o] = sum;
        continue;
      }
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let j = 0; j < radius * 2; j++) {
        const yy = y0 + j;
        if (yy < 0 || yy >= srcH || wy[j] === 0) continue;
        for (let i = 0; i < radius * 2; i++) {
          const xx = x0 + i;
          if (xx < 0 || xx >= srcW) continue;
          const s = (yy * srcW + xx) * 4;
          const a = src[s + 3]!;
          if (a === 0) continue;
          const w = wx[i]! * wy[j]!;
          const k = (a / 255) * w;
          pr += src[s]! * k;
          pg += src[s + 1]! * k;
          pb += src[s + 2]! * k;
          pa += a * w;
        }
      }
      writeUnpremultiplied(out, o, pr, pg, pb, pa);
    }
  }
  return out;
}
