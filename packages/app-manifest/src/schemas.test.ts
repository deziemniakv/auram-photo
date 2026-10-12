import { describe, expect, it } from 'vitest';
import { sampleManifest } from './fixtures';
import {
  AppDescriptorSchema,
  CatalogSchema,
  ReleaseManifestSchema,
  isSafeRelativePath,
} from './schemas';

describe('ReleaseManifestSchema', () => {
  it('accepts a valid manifest', () => {
    expect(ReleaseManifestSchema.safeParse(sampleManifest()).success).toBe(true);
  });

  it('defaults dependencies to an empty list', () => {
    const { dependencies: _omit, ...rest } = sampleManifest();
    expect(ReleaseManifestSchema.parse(rest).dependencies).toEqual([]);
  });

  it.each([
    ['plain http artifact url', { url: 'http://example.com/a.zip' }],
    ['uppercase sha256', { sha256: 'A'.repeat(64) }],
    ['short sha256', { sha256: 'abc' }],
    ['zero size', { size: 0 }],
    ['unknown platform', { platform: 'freebsd' }],
    ['unknown format', { format: 'exe' }],
  ])('rejects %s', (_label, change) => {
    const manifest = sampleManifest();
    const artifact = { ...manifest.artifacts[0], ...change };
    expect(ReleaseManifestSchema.safeParse({ ...manifest, artifacts: [artifact] }).success).toBe(
      false,
    );
  });

  it('rejects manifests without artifacts or with invalid ids and versions', () => {
    expect(ReleaseManifestSchema.safeParse(sampleManifest({ artifacts: [] })).success).toBe(false);
    expect(ReleaseManifestSchema.safeParse({ ...sampleManifest(), id: 'photo' }).success).toBe(
      false,
    );
    expect(ReleaseManifestSchema.safeParse({ ...sampleManifest(), version: '1.2' }).success).toBe(
      false,
    );
  });
});

describe('CatalogSchema', () => {
  const entry = {
    id: 'auram.photo',
    name: 'Auram Photo',
    description: 'Photo editing',
    category: 'photo',
    availability: 'in-development',
    releaseSource: null,
  };

  it('accepts a catalog and applies defaults', () => {
    const catalog = CatalogSchema.parse({ schemaVersion: 1, apps: [entry] });
    expect(catalog.apps[0]?.projectExtensions).toEqual([]);
  });

  it('rejects duplicate application ids', () => {
    expect(CatalogSchema.safeParse({ schemaVersion: 1, apps: [entry, entry] }).success).toBe(false);
  });
});

describe('AppDescriptorSchema', () => {
  const descriptor = {
    schemaVersion: 1,
    id: 'auram.photo',
    name: 'Auram Photo',
    version: '1.0.0',
    executable: { win32: 'Auram Photo.exe' },
  };

  it('accepts a descriptor and defaults the project argument', () => {
    expect(AppDescriptorSchema.parse(descriptor).openProjectArgument).toBe('positional');
  });

  it('rejects executables outside the installation directory', () => {
    for (const executable of ['../evil.exe', '/bin/sh', 'C:/Windows/notepad.exe', 'bin\\app.exe']) {
      expect(
        AppDescriptorSchema.safeParse({ ...descriptor, executable: { win32: executable } }).success,
        executable,
      ).toBe(false);
    }
  });

  it('only allows simple flags for passing projects', () => {
    expect(
      AppDescriptorSchema.safeParse({ ...descriptor, openProjectArgument: '--open' }).success,
    ).toBe(true);
    expect(
      AppDescriptorSchema.safeParse({ ...descriptor, openProjectArgument: '--open; rm -rf' })
        .success,
    ).toBe(false);
  });
});

describe('isSafeRelativePath', () => {
  it('accepts nested relative paths', () => {
    expect(isSafeRelativePath('bin/auram-photo')).toBe(true);
  });

  it.each(['', '.', '..', 'a/../b', '/abs', 'C:/x', 'a//b', 'a\\b', 'a/./b'])(
    'rejects %j',
    (value) => {
      expect(isSafeRelativePath(value)).toBe(false);
    },
  );
});
