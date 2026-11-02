import { describe, expect, it } from 'vitest';
import { compareVersions, orderedVersions } from './versionPolicy';

describe('installer release precedence', () => {
  it('sorts latest-first numerically, deduplicates versions, and leaves input untouched', () => {
    const versions = ['1.2.0', '1.10.0-beta.2', '1.10.0-beta.11', '1.10.0', '1.2.0'].map(version => ({ version }));
    expect(orderedVersions(versions).map(v => v.version)).toEqual(['1.10.0', '1.10.0-beta.11', '1.10.0-beta.2', '1.2.0']);
    expect(versions).toHaveLength(5);
  });
  it('ignores build metadata and orders stable above prerelease', () => {
    expect(compareVersions('v1.2.3+build.4', '1.2.3+build.99')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3-alpha.1', '1.2.3-alpha.beta')).toBeLessThan(0);
  });
});
