#!/usr/bin/env node
/**
 * Verifies the files of a GitHub release before it is published: the Windows
 * ZIP and auram-release.json must both be attached, and the manifest must
 * describe exactly that ZIP (download URL, size, SHA-256) for the expected
 * version. Auram Launcher refuses anything else, so publishing a release that
 * fails these checks would only produce a broken update.
 *
 * Usage:
 *   node scripts/verify-release.mjs --dir <downloaded assets> --version 0.1.0 \
 *     --repository owner/repo --assets "name1,name2"
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_ASSET = 'auram-release.json';
export const zipAssetName = (version) => `auram-photo-${version}-win32-x64.zip`;

/** Returns a list of problems; an empty list means the release can be published. */
export function verifyRelease({ dir, version, repository, assetNames }) {
  const problems = [];
  const zipName = zipAssetName(version);
  for (const required of [zipName, MANIFEST_ASSET]) {
    if (!assetNames.includes(required)) problems.push(`Missing release asset ${required}.`);
  }
  const manifestPath = path.join(dir, MANIFEST_ASSET);
  const zipPath = path.join(dir, zipName);
  if (!existsSync(manifestPath) || !existsSync(zipPath)) {
    if (problems.length === 0) problems.push('Release assets could not be downloaded.');
    return problems;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [...problems, `${MANIFEST_ASSET} is not valid JSON.`];
  }
  if (manifest.schemaVersion !== 1) problems.push('Manifest schemaVersion must be 1.');
  if (manifest.id !== 'auram.photo')
    problems.push(`Manifest id is ${manifest.id}, expected auram.photo.`);
  if (manifest.version !== version)
    problems.push(`Manifest version is ${manifest.version}, expected ${version}.`);

  const artifact = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.find((entry) => entry.platform === 'win32' && entry.arch === 'x64')
    : undefined;
  if (!artifact) return [...problems, 'Manifest has no win32/x64 artifact.'];

  const expectedUrl = `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(zipName)}`;
  if (artifact.url !== expectedUrl)
    problems.push(`Artifact URL is ${artifact.url}, expected ${expectedUrl}.`);
  if (artifact.format !== 'zip') problems.push('Artifact format must be zip.');
  const size = statSync(zipPath).size;
  if (artifact.size !== size)
    problems.push(`Artifact size is ${artifact.size}, but the ZIP has ${size} bytes.`);
  const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  if (artifact.sha256 !== sha256)
    problems.push(`Artifact SHA-256 ${artifact.sha256} does not match the ZIP (${sha256}).`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
    return args[index + 1];
  };
  const problems = verifyRelease({
    dir: option('--dir'),
    version: option('--version'),
    repository: option('--repository'),
    assetNames: option('--assets').split(',').filter(Boolean),
  });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exit(1);
  }
  console.log('✓ Release assets verified.');
}
