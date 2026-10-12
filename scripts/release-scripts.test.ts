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
// @ts-expect-error -- plain JavaScript build script
import { verifyRelease } from './verify-release.mjs';

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

describe('verify-release', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'auram-verify-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const repository = 'deziemniakv/auram-photo';
  const assets = ['auram-photo-0.1.0-win32-x64.zip', 'auram-release.json'];

  function publishable() {
    writeFileSync(path.join(dir, assets[0]!), 'zip bytes');
    const manifest = releaseManifest({
      version: '0.1.0',
      dir,
      releasedAt: '2026-10-12T00:00:00.000Z',
    });
    writeFileSync(path.join(dir, assets[1]!), JSON.stringify(manifest));
    return manifest;
  }

  it('accepts a release whose manifest describes its ZIP exactly', () => {
    publishable();
    expect(verifyRelease({ dir, version: '0.1.0', repository, assetNames: assets })).toEqual([]);
  });

  it('reports missing assets', () => {
    publishable();
    expect(verifyRelease({ dir, version: '0.1.0', repository, assetNames: [assets[0]] })).toEqual([
      'Missing release asset auram-release.json.',
    ]);
  });

  it('rejects a ZIP that does not match the manifest', () => {
    publishable();
    writeFileSync(path.join(dir, assets[0]!), 'tampered!');
    const problems = verifyRelease({ dir, version: '0.1.0', repository, assetNames: assets });
    expect(problems.some((p: string) => p.includes('SHA-256'))).toBe(true);
  });

  it('rejects a manifest for another version or repository', () => {
    publishable();
    expect(
      verifyRelease({ dir, version: '0.2.0', repository, assetNames: assets }).length,
    ).toBeGreaterThan(0);
    const other = verifyRelease({
      dir,
      version: '0.1.0',
      repository: 'someone/else',
      assetNames: assets,
    });
    expect(other.some((p: string) => p.includes('Artifact URL'))).toBe(true);
  });
});
