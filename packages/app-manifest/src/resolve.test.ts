import { describe, expect, it } from 'vitest';
import { sampleManifest } from './fixtures';
import { pickRelease, type GitHubRelease } from './github';
import { resolveUpdate, type ResolveUpdateInput } from './resolve';

const base: Omit<ResolveUpdateInput, 'manifest'> = {
  installedVersion: null,
  launcherVersion: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  includePrerelease: false,
};

describe('resolveUpdate', () => {
  it('offers installation when nothing is installed', () => {
    expect(resolveUpdate({ ...base, manifest: sampleManifest() }).kind).toBe(
      'not-installed-available',
    );
  });

  it('offers an update only for strictly newer versions', () => {
    expect(
      resolveUpdate({ ...base, installedVersion: '1.1.9', manifest: sampleManifest() }).kind,
    ).toBe('update-available');
    expect(
      resolveUpdate({ ...base, installedVersion: '1.2.0', manifest: sampleManifest() }).kind,
    ).toBe('up-to-date');
    expect(
      resolveUpdate({ ...base, installedVersion: '2.0.0', manifest: sampleManifest() }).kind,
    ).toBe('up-to-date');
  });

  it('skips prereleases unless enabled', () => {
    const manifest = sampleManifest({ version: '1.3.0-beta.1', channel: 'prerelease' });
    expect(resolveUpdate({ ...base, installedVersion: '1.2.0', manifest }).kind).toBe(
      'prerelease-skipped',
    );
    expect(
      resolveUpdate({ ...base, installedVersion: '1.2.0', manifest, includePrerelease: true }).kind,
    ).toBe('update-available');
  });

  it('requires a compatible launcher', () => {
    const result = resolveUpdate({
      ...base,
      manifest: sampleManifest({ minLauncherVersion: '0.2.0' }),
    });
    expect(result).toEqual({ kind: 'requires-newer-launcher', minLauncherVersion: '0.2.0' });
  });

  it('requires an artifact for the current platform and architecture', () => {
    expect(resolveUpdate({ ...base, arch: 'arm64', manifest: sampleManifest() }).kind).toBe(
      'no-compatible-artifact',
    );
    expect(resolveUpdate({ ...base, platform: 'linux', manifest: sampleManifest() }).kind).toBe(
      'no-compatible-artifact',
    );
  });
});

describe('pickRelease', () => {
  const release = (overrides: Partial<GitHubRelease>): GitHubRelease => ({
    tag_name: 'v1.0.0',
    html_url: 'https://github.com/o/r/releases/tag/v1.0.0',
    draft: false,
    prerelease: false,
    published_at: '2026-01-01T00:00:00Z',
    assets: [
      {
        name: 'auram-release.json',
        browser_download_url: 'https://github.com/o/r/m.json',
        size: 10,
      },
    ],
    ...overrides,
  });

  it('skips drafts, unwanted prereleases and releases without a manifest', () => {
    const releases = [
      release({ tag_name: 'v3', draft: true }),
      release({ tag_name: 'v2', prerelease: true }),
      release({ tag_name: 'v1.5', assets: [] }),
      release({ tag_name: 'v1' }),
    ];
    expect(pickRelease(releases, 'auram-release.json', false)?.release.tag_name).toBe('v1');
    expect(pickRelease(releases, 'auram-release.json', true)?.release.tag_name).toBe('v2');
    expect(pickRelease([], 'auram-release.json', true)).toBeNull();
  });
});
