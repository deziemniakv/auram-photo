import { describe, expect, it } from 'vitest';
import { isProjectFileName, parseProjectManifest } from './index';

const manifest = {
  format: 'auram.project',
  formatVersion: 1,
  id: '0b6f1d2e-6a3c-4c1e-9f55-3c2c8f1b9a10',
  name: 'Poster',
  appId: 'auram.photo',
  createdAt: '2026-09-01T10:00:00Z',
  modifiedAt: '2026-09-02T10:00:00+02:00',
};

describe('parseProjectManifest', () => {
  it('accepts a valid manifest and keeps application-specific fields', () => {
    const result = parseProjectManifest(JSON.stringify({ ...manifest, canvas: { width: 100 } }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe('Poster');
      expect(result.manifest.canvas).toEqual({ width: 100 });
    }
  });

  it('reports invalid JSON and schema violations', () => {
    expect(parseProjectManifest('{')).toEqual({
      ok: false,
      error: 'manifest.json is not valid JSON',
    });
    const wrongFormat = parseProjectManifest(JSON.stringify({ ...manifest, formatVersion: 2 }));
    expect(wrongFormat.ok).toBe(false);
    const noName = parseProjectManifest(JSON.stringify({ ...manifest, name: '   ' }));
    expect(noName.ok).toBe(false);
  });
});

describe('isProjectFileName', () => {
  it('matches .cproj files case-insensitively', () => {
    expect(isProjectFileName('Poster.cproj')).toBe(true);
    expect(isProjectFileName('POSTER.CPROJ')).toBe(true);
    expect(isProjectFileName('.cproj')).toBe(false);
    expect(isProjectFileName('poster.cproj.bak')).toBe(false);
  });
});
