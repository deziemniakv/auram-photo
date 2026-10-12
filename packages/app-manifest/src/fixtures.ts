import type { ReleaseManifest } from './schemas';

/** A valid release manifest for tests. */
export function sampleManifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    schemaVersion: 1,
    id: 'auram.photo',
    name: 'Auram Photo',
    version: '1.2.0',
    channel: 'stable',
    releasedAt: '2026-09-01T12:00:00Z',
    minLauncherVersion: '0.1.0',
    releaseNotes: { summary: 'Improvements', body: 'Line one\nLine two' },
    artifacts: [
      {
        platform: 'win32',
        arch: 'x64',
        format: 'zip',
        url: 'https://github.com/deziemniakv/auram-photo/releases/download/v1.2.0/auram-photo-win-x64.zip',
        sha256: 'a'.repeat(64),
        size: 1000,
      },
    ],
    dependencies: [],
    ...overrides,
  };
}
