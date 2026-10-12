import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colors, cssVariableMap, layout } from './index';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, 'tokens.css'), 'utf8');
const repoRoot = path.resolve(here, '../../..');

function cssValue(variable: string): string | undefined {
  const match = new RegExp(`${variable}:\\s*([^;]+);`).exec(css);
  return match?.[1]?.trim();
}

function walkCss(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out' || name === 'dist') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walkCss(full));
    else if (name.endsWith('.css')) files.push(full);
  }
  return files;
}

describe('design tokens', () => {
  it('keeps TypeScript tokens in sync with tokens.css', () => {
    const values: Record<string, string | number> = {
      'colors.bg': colors.bg,
      'colors.surface0': colors.surface0,
      'colors.surface1': colors.surface1,
      'colors.border': colors.border,
      'colors.textPrimary': colors.textPrimary,
      'colors.textSecondary': colors.textSecondary,
      'layout.topbarHeight': `${layout.topbarHeight}px`,
      'layout.sidebarWidth': `${layout.sidebarWidth}px`,
    };
    for (const [key, variable] of Object.entries(cssVariableMap)) {
      expect(cssValue(variable), key).toBe(String(values[key]));
    }
  });
});

/*
 * Design-system guard rails: component styles must use tokens for colors and
 * corner radii, so the square, neutral visual language cannot drift.
 */
describe('component styles', () => {
  // Every application's renderer in the workspace, plus the shared components.
  const appRenderers = readdirSync(path.join(repoRoot, 'apps'))
    .map((app) => path.join(repoRoot, 'apps', app, 'src/renderer'))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory());
  const files = [
    walkCss(path.join(repoRoot, 'packages/ui/src')),
    ...appRenderers.map(walkCss),
  ].flat();

  it('finds stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [path.relative(repoRoot, file), file]))(
    '%s uses color tokens only',
    (_name, file) => {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []).toEqual([]);
    },
  );

  it.each(files.map((file) => [path.relative(repoRoot, file), file]))(
    '%s uses radius tokens only',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const radii = [...source.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;]+);/g)].map((match) =>
        match[1]!.trim(),
      );
      expect(radii.filter((value) => !/^var\(--radius-(none|xs)\)$/.test(value))).toEqual([]);
    },
  );
});
