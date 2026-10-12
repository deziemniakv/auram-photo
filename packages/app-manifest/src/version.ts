/**
 * Minimal Semantic Versioning 2.0.0 support.
 *
 * Only what the launcher needs: parsing, comparison and prerelease detection.
 * Build metadata is accepted and ignored for precedence, as required by the spec.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: ReadonlyArray<string | number>;
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseVersion(input: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(input.trim());
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease
      ? prerelease.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      : [],
  };
}

export function isValidVersion(input: string): boolean {
  return parseVersion(input) !== null;
}

export function isPrerelease(input: string): boolean {
  const parsed = parseVersion(input);
  return parsed !== null && parsed.prerelease.length > 0;
}

/**
 * Compares two versions. Returns a negative number when `a < b`, zero when equal
 * and a positive number when `a > b`. Throws on invalid input so that callers never
 * silently treat malformed metadata as a valid update.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left) throw new Error(`Invalid version: ${a}`);
  if (!right) throw new Error(`Invalid version: ${b}`);

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }

  // A version without prerelease identifiers has higher precedence.
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    if (typeof l === 'number' && typeof r === 'number') return l - r;
    if (typeof l === 'number') return -1;
    if (typeof r === 'number') return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}
