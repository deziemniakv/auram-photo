import { intersectRects, isEmptyRect, sizeRect, type Rect } from './geometry';

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

/**
 * A selection as an 8-bit coverage mask the size of the document
 * (0 = not selected, 255 = fully selected; values between give soft edges).
 * Instances are immutable: every operation returns a new selection.
 */
export class Selection {
  private cachedBounds: Rect | null = null;
  private cachedOutline: Float32Array | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly mask: Uint8Array,
  ) {
    if (mask.length !== width * height) throw new RangeError('Mask does not match selection size');
  }

  static all(width: number, height: number): Selection {
    return new Selection(width, height, new Uint8Array(width * height).fill(255));
  }

  static rect(width: number, height: number, rect: Rect): Selection {
    const mask = new Uint8Array(width * height);
    const area = intersectRects(rect, sizeRect(width, height));
    for (let y = area.y; y < area.y + area.height; y++) {
      mask.fill(255, y * width + area.x, y * width + area.x + area.width);
    }
    return new Selection(width, height, mask);
  }

  /** Ellipse inscribed in `rect`, with an anti-aliased edge. */
  static ellipse(width: number, height: number, rect: Rect): Selection {
    const mask = new Uint8Array(width * height);
    const area = intersectRects(rect, sizeRect(width, height));
    const rx = rect.width / 2;
    const ry = rect.height / 2;
    if (rx <= 0 || ry <= 0) return new Selection(width, height, mask);
    const cx = rect.x + rx;
    const cy = rect.y + ry;
    const scale = Math.min(rx, ry);
    for (let y = area.y; y < area.y + area.height; y++) {
      const dy = (y + 0.5 - cy) / ry;
      for (let x = area.x; x < area.x + area.width; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const distance = (Math.sqrt(dx * dx + dy * dy) - 1) * scale;
        const coverage = Math.min(1, Math.max(0, 0.5 - distance));
        mask[y * width + x] = Math.round(coverage * 255);
      }
    }
    return new Selection(width, height, mask);
  }

  coverage(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.mask[y * this.width + x]!;
  }

  combine(other: Selection, mode: SelectionMode): Selection {
    if (mode === 'replace') return other;
    const out = new Uint8Array(this.mask.length);
    for (let i = 0; i < out.length; i++) {
      const a = this.mask[i]!;
      const b = other.mask[i]!;
      out[i] =
        mode === 'add'
          ? Math.max(a, b)
          : mode === 'subtract'
            ? Math.min(a, 255 - b)
            : Math.min(a, b);
    }
    return new Selection(this.width, this.height, out);
  }

  invert(): Selection {
    const out = new Uint8Array(this.mask.length);
    for (let i = 0; i < out.length; i++) out[i] = 255 - this.mask[i]!;
    return new Selection(this.width, this.height, out);
  }

  /** Same mask shifted by a whole number of pixels; pixels leaving the document are dropped. */
  translate(dx: number, dy: number): Selection {
    const out = new Uint8Array(this.mask.length);
    for (let y = 0; y < this.height; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= this.height) continue;
      for (let x = 0; x < this.width; x++) {
        const sx = x - dx;
        if (sx >= 0 && sx < this.width) out[y * this.width + x] = this.mask[sy * this.width + sx]!;
      }
    }
    return new Selection(this.width, this.height, out);
  }

  flip(horizontal: boolean): Selection {
    const out = new Uint8Array(this.mask.length);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const sx = horizontal ? this.width - 1 - x : x;
        const sy = horizontal ? y : this.height - 1 - y;
        out[y * this.width + x] = this.mask[sy * this.width + sx]!;
      }
    }
    return new Selection(this.width, this.height, out);
  }

  /** Bounding box of selected pixels. */
  bounds(): Rect {
    if (this.cachedBounds) return this.cachedBounds;
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.height; y++) {
      const row = y * this.width;
      for (let x = 0; x < this.width; x++) {
        if (this.mask[row + x] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    this.cachedBounds =
      maxX < 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    return this.cachedBounds;
  }

  isEmpty(): boolean {
    return isEmptyRect(this.bounds());
  }

  /**
   * Boundary between selected (coverage ≥ 50%) and unselected pixels, as line
   * segments `[x1, y1, x2, y2, ...]` in document coordinates. Collinear edges are
   * merged so the outline stays cheap to draw.
   */
  outline(): Float32Array {
    if (this.cachedOutline) return this.cachedOutline;
    const segments: number[] = [];
    const inside = (x: number, y: number) => this.coverage(x, y) >= 128;
    const b = this.bounds();
    if (isEmptyRect(b)) return (this.cachedOutline = new Float32Array(0));
    const x0 = b.x;
    const x1 = b.x + b.width;
    const y0 = b.y;
    const y1 = b.y + b.height;
    // Horizontal edges between row y-1 and row y.
    for (let y = y0; y <= y1; y++) {
      let start = -1;
      for (let x = x0; x <= x1; x++) {
        const edge = x < x1 && inside(x, y - 1) !== inside(x, y);
        if (edge && start < 0) start = x;
        if (!edge && start >= 0) {
          segments.push(start, y, x, y);
          start = -1;
        }
      }
    }
    // Vertical edges between column x-1 and column x.
    for (let x = x0; x <= x1; x++) {
      let start = -1;
      for (let y = y0; y <= y1; y++) {
        const edge = y < y1 && inside(x - 1, y) !== inside(x, y);
        if (edge && start < 0) start = y;
        if (!edge && start >= 0) {
          segments.push(x, start, x, y);
          start = -1;
        }
      }
    }
    return (this.cachedOutline = new Float32Array(segments));
  }
}
