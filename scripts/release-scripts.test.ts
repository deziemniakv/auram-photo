import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDescriptorSchema, ReleaseManifestSchema } from '@auram/app-manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JavaScript build script
import { appDescriptor } from './write-app-descriptor.mjs';
// @ts-expect-error -- plain JavaScript build script
import { releaseManifest } from './write-release-manifest.mjs';

/* Auram Launcher validates these files strictly; keep the generators in step with its schemas. */

describe('release scripts', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'auram-release-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes an app descriptor the launcher accepts', () => {
    expect(AppDescriptorSchema.parse(appDescriptor('1.2.3')).executable.win32).toBe(
      'Auram Photo.exe',
    );
  });

  it("lists only this version's artifacts with exact size and SHA-256", () => {
    writeFileSync(path.join(dir, 'auram-photo-1.2.3-win32-x64.zip'), 'zip bytes');
    writeFileSync(path.join(dir, 'auram-photo-1.2.2-win32-x64.zip'), 'older');
    const manifest = ReleaseManifestSchema.parse(
      releaseManifest({
        version: '1.2.3',
        dir,
        releasedAt: '2026-10-12T00:00:00.000Z',
        summary: 'First preview',
      }),
    );
    expect(manifest.channel).toBe('stable');
    expect(manifest.artifacts).toEqual([
      {
        platform: 'win32',
        arch: 'x64',
        format: 'zip',
        url: 'https://github.com/deziemniakv/auram-photo/releases/download/v1.2.3/auram-photo-1.2.3-win32-x64.zip',
        sha256: createHash('sha256').update('zip bytes').digest('hex'),
        size: 9,
      },
    ]);
  });

  it('marks SemVer prereleases and refuses to publish without artifacts', () => {
    writeFileSync(path.join(dir, 'auram-photo-2.0.0-beta.1-win32-x64.zip'), 'b');
    const manifest = releaseManifest({
      version: '2.0.0-beta.1',
      dir,
      releasedAt: '2026-10-12T00:00:00.000Z',
    });
    expect(ReleaseManifestSchema.parse(manifest).channel).toBe('prerelease');
    expect(() =>
      releaseManifest({ version: '3.0.0', dir, releasedAt: '2026-10-12T00:00:00.000Z' }),
    ).toThrow(/No artifacts/);
  });
});
