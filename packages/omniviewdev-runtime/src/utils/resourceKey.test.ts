import { describe, it, expect } from 'vitest';
import { parseResourceKey, formatGroup } from './resourceKey';

describe('parseResourceKey', () => {
  it('parses a standard 3-part key', () => {
    expect(parseResourceKey('apps::v1::Deployment')).toEqual({
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
    });
  });

  it('parses core group key', () => {
    expect(parseResourceKey('core::v1::Pod')).toEqual({
      group: 'core',
      version: 'v1',
      kind: 'Pod',
    });
  });

  it('treats empty group as "core"', () => {
    expect(parseResourceKey('::v1::Service')).toEqual({
      group: 'core',
      version: 'v1',
      kind: 'Service',
    });
  });

  it('handles single-part key (kind only)', () => {
    expect(parseResourceKey('Pod')).toEqual({
      group: 'core',
      version: '',
      kind: 'Pod',
    });
  });

  it('handles missing kind (falls back to group)', () => {
    expect(parseResourceKey('apps::v1::')).toEqual({
      group: 'apps',
      version: 'v1',
      kind: 'apps',
    });
  });

  it('handles two-part key', () => {
    expect(parseResourceKey('apps::v1')).toEqual({
      group: 'apps',
      version: 'v1',
      kind: 'apps',
    });
  });
});

describe('formatGroup', () => {
  it('formats "core" as "Core"', () => {
    expect(formatGroup('core')).toBe('Core');
  });

  it('formats empty string as "Core"', () => {
    expect(formatGroup('')).toBe('Core');
  });

  it('capitalizes first letter of group', () => {
    expect(formatGroup('apps')).toBe('Apps');
  });

  it('capitalizes single character', () => {
    expect(formatGroup('a')).toBe('A');
  });

  it('preserves already capitalized group', () => {
    expect(formatGroup('Batch')).toBe('Batch');
  });

  it('handles multi-segment group name', () => {
    expect(formatGroup('networking.k8s.io')).toBe('Networking.k8s.io');
  });
});
