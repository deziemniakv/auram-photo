#!/usr/bin/env node
/**
 * Writes apps/photo/build/auram-app.json, the descriptor Auram Launcher reads
 * from the root of an installed package. electron-builder copies it next to
 * the executable (see electron-builder.yml → extraFiles).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'apps/photo');

export function appDescriptor(version) {
  return {
    schemaVersion: 1,
    id: 'auram.photo',
    name: 'Auram Photo',
    version,
    executable: {
      win32: 'Auram Photo.exe',
      linux: 'auram-photo',
      darwin: 'Auram Photo.app/Contents/MacOS/Auram Photo',
    },
    openProjectArgument: 'positional',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { version } = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const target = path.join(appDir, 'build/auram-app.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(appDescriptor(version), null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, target)} for ${version}`);
}
