/** Straight (non-premultiplied) 8-bit RGBA colour. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

/** Parses `#rgb`, `#rrggbb` or `#rrggbbaa`. Returns null for anything else. */
export function parseHex(input: string): Rgba | null {
  const hex = input.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) : 255,
  };
}

export function toHex(color: Rgba, includeAlpha = false): string {
  const parts = [color.r, color.g, color.b, ...(includeAlpha ? [color.a] : [])];
  return `#${parts.map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')}`;
}

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clampByte(a) };
}
