#!/usr/bin/env node
/**
 * Generates the list of third-party packages shipped inside Auram Photo,
 * bundled with the application.
 *
 * Starts from the packages that end up in the packaged app (bundled into the
 * renderer/main code or copied into app.asar) and follows their runtime
 * dependencies. Build tooling is not included because it is not distributed.
 *
 * Usage: node scripts/generate-licenses.mjs
 */
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcherDir = path.join(root, 'apps/photo');
const output = path.join(launcherDir, 'src/renderer/src/generated/licenses.json');

/** Runtime packages of the launcher. Electron's own npm dependencies are install-time only. */
const ROOTS = ['electron', 'react', 'react-dom', 'zustand', 'zod', 'lucide-react', 'fast-png'];
const NO_RECURSE = new Set(['electron']);

function findPackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function repositoryOf(pkg) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!repo) return null;
  return repo
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/');
}

const seen = new Map();
const queue = ROOTS.map((name) => ({ name, from: launcherDir }));
while (queue.length > 0) {
  const { name, from } = queue.shift();
  const dir = findPackageDir(name, from);
  if (!dir) {
    console.error(`Cannot resolve ${name} from ${from}`);
    process.exitCode = 1;
    continue;
  }
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: licenseOf(pkg),
    repository: repositoryOf(pkg),
  });
  if (NO_RECURSE.has(pkg.name)) continue;
  for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, from: dir });
}

const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(packages, null, 2)}\n`);
console.log(`Wrote ${packages.length} packages to ${path.relative(root, output)}`);
