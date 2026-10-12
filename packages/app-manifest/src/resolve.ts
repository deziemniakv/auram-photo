import type { Arch, Artifact, Platform, ReleaseManifest } from './schemas';
import { compareVersions, isPrerelease } from './version';

export function selectArtifact(
  manifest: ReleaseManifest,
  platform: Platform,
  arch: Arch,
): Artifact | undefined {
  return manifest.artifacts.find(
    (artifact) => artifact.platform === platform && artifact.arch === arch,
  );
}

export type UpdateResolution =
  | { kind: 'not-installed-available'; artifact: Artifact }
  | { kind: 'update-available'; artifact: Artifact }
  | { kind: 'up-to-date' }
  | { kind: 'prerelease-skipped' }
  | { kind: 'requires-newer-launcher'; minLauncherVersion: string }
  | { kind: 'no-compatible-artifact' };

export interface ResolveUpdateInput {
  manifest: ReleaseManifest;
  installedVersion: string | null;
  launcherVersion: string;
  platform: Platform;
  arch: Arch;
  includePrerelease: boolean;
}

/**
 * Decides what the launcher may offer for an application based on a validated
 * release manifest. Pure: no I/O, so every branch is unit tested.
 */
export function resolveUpdate(input: ResolveUpdateInput): UpdateResolution {
  const { manifest, installedVersion } = input;

  if (installedVersion !== null && compareVersions(manifest.version, installedVersion) <= 0) {
    return { kind: 'up-to-date' };
  }
  if (
    !input.includePrerelease &&
    (manifest.channel === 'prerelease' || isPrerelease(manifest.version))
  ) {
    return { kind: 'prerelease-skipped' };
  }
  if (compareVersions(input.launcherVersion, manifest.minLauncherVersion) < 0) {
    return { kind: 'requires-newer-launcher', minLauncherVersion: manifest.minLauncherVersion };
  }
  const artifact = selectArtifact(manifest, input.platform, input.arch);
  if (!artifact) return { kind: 'no-compatible-artifact' };

  return installedVersion === null
    ? { kind: 'not-installed-available', artifact }
    : { kind: 'update-available', artifact };
}
