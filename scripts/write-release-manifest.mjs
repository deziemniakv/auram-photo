#!/usr/bin/env node
/**
 * Writes auram-release.json for a packaged version. The manifest lists every
 * ZIP artifact with its exact size and SHA-256 so Auram Launcher can verify
 * downloads. Upload it to the GitHub release together with the artifacts.
 *
 * Usage: node scripts/write-release-manifest.mjs [--summary "text"] [--notes-file path]
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'apps/photo');
const REPOSITORY = 'deziemniakv/auram-photo';
export const MIN_LAUNCHER_VERSION = '0.1.0';

const ARTIFACT_PATTERN = /^auram-photo-(.+)-(win32|darwin|linux)-(x64|arm64)\.zip$/;

/** Builds the manifest object for artifacts found in `dir`. Pure apart from reading files. */
export function releaseManifest({ version, dir, releasedAt, summary, body }) {
  const artifacts = readdirSync(dir)
    .map((name) => ({ name, match: ARTIFACT_PATTERN.exec(name) }))
    .filter(({ match }) => match && match[1] === version)
    .map(({ name, match }) => {
      const file = path.join(dir, name);
      return {
        platform: match[2],
        arch: match[3],
        format: 'zip',
        url: `https://github.com/${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(name)}`,
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
        size: statSync(file).size,
      };
    });
  if (artifacts.length === 0) throw new Error(`No artifacts for ${version} in ${dir}`);
  return {
    schemaVersion: 1,
    id: 'auram.photo',
    name: 'Auram Photo',
    version,
    channel: version.includes('-') ? 'prerelease' : 'stable',
    releasedAt,
    minLauncherVersion: MIN_LAUNCHER_VERSION,
    releaseNotes: {
      ...(summary ? { summary } : {}),
      ...(body ? { body } : {}),
      url: `https://github.com/${REPOSITORY}/releases/tag/v${version}`,
    },
    artifacts,
    dependencies: [],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const { version } = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const dir = path.join(appDir, 'release', version);
  const notesFile = option('--notes-file');
  const manifest = releaseManifest({
    version,
    dir,
    releasedAt: new Date().toISOString(),
    summary: option('--summary'),
    body: notesFile ? readFileSync(notesFile, 'utf8').slice(0, 20_000) : undefined,
  });
  const target = path.join(dir, 'auram-release.json');
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, target)} with ${manifest.artifacts.length} artifact(s)`);
}
