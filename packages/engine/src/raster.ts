import type { Rgba } from './color';
import { intersectRects, isEmptyRect, sizeRect, type Rect } from './geometry';

/**
 * A straight-alpha RGBA8 pixel buffer. Rows are tightly packed, top to bottom.
 * All region operations clip to the raster bounds.
 */
export class Raster {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8ClampedArray,
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`Invalid raster size ${width}×${height}`);
    }
    const length = width * height * 4;
    if (data && data.length !== length)
      throw new RangeError('Pixel data does not match raster size');
    this.data = data ?? new Uint8ClampedArray(length);
  }

  get bounds(): Rect {
    return sizeRect(this.width, this.height);
  }

  clone(): Raster {
    return new Raster(this.width, this.height, this.data.slice());
  }

  clip(rect: Rect): Rect {
    return intersectRects(rect, this.bounds);
  }

  /** Copies a region out. The rectangle must already be clipped. */
  readRegion(rect: Rect): Uint8ClampedArray {
    const out = new Uint8ClampedArray(rect.width * rect.height * 4);
    const rowBytes = rect.width * 4;
    for (let row = 0; row < rect.height; row++) {
      const start = ((rect.y + row) * this.width + rect.x) * 4;
      out.set(this.data.subarray(start, start + rowBytes), row * rowBytes);
    }
    return out;
  }

  /** Writes a region previously produced by {@link readRegion}. */
  writeRegion(rect: Rect, pixels: Uint8ClampedArray): void {
    const rowBytes = rect.width * 4;
    if (pixels.length !== rowBytes * rect.height) throw new RangeError('Region size mismatch');
    for (let row = 0; row < rect.height; row++) {
      this.data.set(
        pixels.subarray(row * rowBytes, (row + 1) * rowBytes),
        ((rect.y + row) * this.width + rect.x) * 4,
      );
    }
  }

  fill(color: Rgba, rect: Rect = this.bounds): void {
    const area = this.clip(rect);
    if (isEmptyRect(area)) return;
    for (let y = area.y; y < area.y + area.height; y++) {
      let i = (y * this.width + area.x) * 4;
      for (let x = 0; x < area.width; x++, i += 4) {
        this.data[i] = color.r;
        this.data[i + 1] = color.g;
        this.data[i + 2] = color.b;
        this.data[i + 3] = color.a;
      }
    }
  }

  getPixel(x: number, y: number): Rgba {
    const i = (y * this.width + x) * 4;
    return { r: this.data[i]!, g: this.data[i + 1]!, b: this.data[i + 2]!, a: this.data[i + 3]! };
  }

  /** Bounding box of pixels with non-zero alpha, or an empty rect. */
  contentBounds(): Rect {
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.height; y++) {
      let i = y * this.width * 4 + 3;
      for (let x = 0; x < this.width; x++, i += 4) {
        if (this.data[i] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }
}
