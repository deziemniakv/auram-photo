import { describe, expect, it } from 'vitest';
import { compareVersions, isPrerelease, isValidVersion, parseVersion } from './version';

describe('parseVersion', () => {
  it('parses release and prerelease versions', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion('1.0.0-beta.2')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['beta', 2],
    });
    expect(parseVersion('1.0.0+build.5')?.prerelease).toEqual([]);
  });

  it('rejects malformed versions', () => {
    for (const value of ['1.2', 'v1.2.3', '01.2.3', '1.2.3-', '1.2.3.4', '', 'latest']) {
      expect(isValidVersion(value), value).toBe(false);
    }
  });
});

describe('compareVersions', () => {
  it('orders versions according to SemVer precedence', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
      '10.0.0',
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(
        compareVersions(ordered[i]!, ordered[i + 1]!),
        `${ordered[i]} < ${ordered[i + 1]}`,
      ).toBeLessThan(0);
      expect(compareVersions(ordered[i + 1]!, ordered[i]!)).toBeGreaterThan(0);
    }
  });

  it('ignores build metadata', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
  });

  it('throws on invalid input instead of guessing', () => {
    expect(() => compareVersions('1.0', '1.0.0')).toThrow();
  });

  it('detects prereleases', () => {
    expect(isPrerelease('2.0.0-rc.1')).toBe(true);
    expect(isPrerelease('2.0.0')).toBe(false);
  });
});
