import { parseResourceKey, formatGroup, toResourceKey } from './resourceKey';

describe('parseResourceKey', () => {
  it('parses a standard 3-part key', () => {
    expect(parseResourceKey('core::v1::Pod')).toEqual({
      group: 'core',
      version: 'v1',
      kind: 'Pod',
    });
  });

  it('parses an apps group key', () => {
    expect(parseResourceKey('apps::v1::Deployment')).toEqual({
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
    });
  });

  it('parses a single-part key as kind with core group', () => {
    // BUG TEST: "Pod" should return group="core", NOT group="Pod"
    const result = parseResourceKey('Pod');
    expect(result.group).toBe('core');
    expect(result.kind).toBe('Pod');
  });

  it('handles empty group as core', () => {
    expect(parseResourceKey('::v1::Pod')).toEqual({
      group: 'core',
      version: 'v1',
      kind: 'Pod',
    });
  });

  it('handles CRD-style groups', () => {
    expect(parseResourceKey('argoproj.io::v1alpha1::Application')).toEqual({
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
    });
  });

  it('handles 2-part key (version::kind)', () => {
    const result = parseResourceKey('v1::Pod');
    // With only 2 parts: parts[0]="v1", parts[1]="Pod", parts[2]=undefined
    expect(result.group).toBe('v1');
    expect(result.version).toBe('Pod');
    expect(result.kind).toBe('v1'); // fallback to parts[0]
  });
});

describe('formatGroup', () => {
  it('formats "core" as "Core"', () => {
    expect(formatGroup('core')).toBe('Core');
  });

  it('formats empty string as "Core"', () => {
    expect(formatGroup('')).toBe('Core');
  });

  it('capitalizes first letter of group name', () => {
    expect(formatGroup('apps')).toBe('Apps');
    expect(formatGroup('batch')).toBe('Batch');
  });

  it('handles already-capitalized groups', () => {
    expect(formatGroup('Apps')).toBe('Apps');
  });

  it('preserves rest of complex group names', () => {
    expect(formatGroup('argoproj.io')).toBe('Argoproj.io');
  });
});

describe('toResourceKey', () => {
  it('converts standard nav ID to resource key', () => {
    expect(toResourceKey('core_v1_Pod')).toBe('core::v1::Pod');
  });

  it('converts apps group nav ID', () => {
    expect(toResourceKey('apps_v1_Deployment')).toBe('apps::v1::Deployment');
  });

  it('handles events group', () => {
    expect(toResourceKey('events_v1_Event')).toBe('events::v1::Event');
  });

  it('returns input unchanged for non-standard IDs with fewer than 3 parts', () => {
    expect(toResourceKey('someId')).toBe('someId');
    expect(toResourceKey('two_parts')).toBe('two_parts');
  });

  it('handles nav IDs with more than 3 underscore segments', () => {
    // e.g. "admissionregistration.k8s.io_v1_ValidatingWebhookConfiguration"
    // This has exactly 3 underscores, so it works fine
    expect(toResourceKey('admissionregistration.k8s.io_v1_ValidatingWebhookConfiguration'))
      .toBe('admissionregistration.k8s.io::v1::ValidatingWebhookConfiguration');
  });
});
