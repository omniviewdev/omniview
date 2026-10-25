import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  admitSearchContribution,
  admitSearchEntry,
  admitProviderResponse,
  getNavigationHref,
  isSearchQueryAllowed,
} from './admission';

const navigation = () => ({
  schemaVersion: 1,
  kind: 'navigation',
  target: { kind: 'core', path: '/plugins' },
});
const item = (id: string) => ({ id, label: id, value: navigation() });
const contribution = () => ({ id: 'probe/nav', plugin: 'probe', label: 'Tasks', value: navigation() });

afterEach(() => vi.restoreAllMocks());

describe('global search v1 admission', () => {
  it.each([
    null,
    { ...navigation(), schemaVersion: 2 },
    { schemaVersion: 1, kind: 'run', run: () => undefined },
    { schemaVersion: 1, kind: 'command', command: { kind: 'execute', pluginId: 'probe' } },
    { schemaVersion: 1, kind: 'command', command: { kind: 'reload-connections', pluginId: '' } },
    { schemaVersion: 1, kind: 'setting', target: { section: 'core', categoryId: '' } },
    { schemaVersion: 1, kind: 'setting', target: { section: 'plugins', pluginId: '' } },
    { ...navigation(), availability: { state: 'disabled', reason: '' } },
  ])('rejects malformed or unknown executable shapes: %j', (value) => {
    expect(admitSearchEntry(value)).toBeUndefined();
  });

  it('preserves typed kinds and strips unknown executable/authority fields', () => {
    const run = vi.fn();
    const admitted = admitSearchEntry({ ...navigation(), run, principal: 'core', pluginId: 'core' });
    expect(admitted).toEqual(navigation());
    expect(run).not.toHaveBeenCalled();
    expect(admitSearchEntry({ schemaVersion: 1, kind: 'setting', target: { section: 'extensions' } })).toEqual({
      schemaVersion: 1,
      kind: 'setting',
      target: { section: 'extensions' },
    });
  });

  it.each(['id', 'plugin', 'label'] as const)('rejects empty/oversized outer %s before reading value', (field) => {
    for (const text of ['', 'x'.repeat(257)]) {
      const entry = { ...contribution(), [field]: text };
      Object.defineProperty(entry, 'value', {
        get: () => {
          throw new Error('value must not be scanned');
        },
      });
      expect(admitSearchContribution(entry)).toBeUndefined();
    }
  });

  it('accepts exact UTF-16 field ceilings and rejects the first excess unit', () => {
    const value = {
      ...navigation(),
      description: 'd'.repeat(1024),
      keywords: Array.from({ length: 16 }, () => 'k'.repeat(128)),
      availability: { state: 'disabled', reason: 'r'.repeat(1024) },
    };
    expect(
      admitSearchContribution({ ...contribution(), id: 'i'.repeat(256), label: '😀'.repeat(128), value }),
    ).toBeDefined();
    for (const invalid of [
      { ...value, description: 'd'.repeat(1025) },
      { ...value, keywords: Array(17).fill('k') },
      { ...value, keywords: ['k'.repeat(129)] },
      { ...value, availability: { state: 'disabled', reason: 'r'.repeat(1025) } },
    ]) {
      expect(admitSearchEntry(invalid)).toBeUndefined();
    }
  });

  it('does not inspect elements of an oversized keyword array', () => {
    const keywords = Array(17);
    Object.defineProperty(keywords, 0, {
      get: () => {
        throw new Error('oversized array must not be scanned');
      },
    });
    expect(admitSearchEntry({ ...navigation(), keywords })).toBeUndefined();
  });

  it('rejects nonfunction providers and retains a valid provider function without invoking it', () => {
    expect(
      admitSearchContribution({ ...contribution(), value: { schemaVersion: 1, kind: 'provider', search: 'run' } }),
    ).toBeUndefined();
    const search = vi.fn();
    expect(
      admitSearchContribution({ ...contribution(), value: { schemaVersion: 1, kind: 'provider', search } }),
    ).toEqual({ schemaVersion: 1, kind: 'provider', search });
    expect(search).not.toHaveBeenCalled();
  });
});

describe('bounded provider response admission', () => {
  it('inspects only the first20 items and marks a surplus response truncated even if it claimed complete', () => {
    const items = Array.from({ length: 20 }, (_, index) => item(String(index)));
    Object.defineProperty(items, 20, {
      get: () => {
        throw new Error('surplus must not be inspected');
      },
    });
    items.length = 100_000;
    const result = admitProviderResponse({ items, completion: 'complete' });
    expect(result?.items).toHaveLength(20);
    expect(result?.completion).toBe('truncated');
  });

  it('retains provider order, explicit truncation and duplicate checking only within the accepted prefix', () => {
    expect(admitProviderResponse({ items: [item('z'), item('a')], completion: 'truncated' })).toEqual({
      items: [item('z'), item('a')],
      completion: 'truncated',
    });
    expect(admitProviderResponse({ items: [item('same'), item('same')], completion: 'complete' })).toBeUndefined();
    const items = Array.from({ length: 20 }, (_, index) => item(String(index)));
    items.push(item('0'));
    expect(admitProviderResponse({ items, completion: 'complete' })?.items).toHaveLength(20);
  });

  it.each([
    { items: {}, completion: 'complete' },
    { items: [], completion: 'unknown' },
    { items: [{ ...item('a'), label: 'x'.repeat(257) }], completion: 'complete' },
    { items: [{ ...item('a'), id: '' }], completion: 'complete' },
    { items: [{ ...item('a'), value: { schemaVersion: 7 } }], completion: 'complete' },
  ])('rejects a malformed response/prefix item without admitting partial executable rows', (response) => {
    expect(admitProviderResponse(response)).toBeUndefined();
  });
});

describe('query and plugin-relative navigation bounds', () => {
  it('counts Unicode code points only after the cheap512-unit guard', () => {
    expect(isSearchQueryAllowed('😀'.repeat(256))).toBe(true);
    expect(isSearchQueryAllowed('a'.repeat(257))).toBe(false);
    const iterator = vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(() => {
      throw new Error('oversized query must not be iterated');
    });
    const codePoint = vi.spyOn(String.prototype, 'codePointAt').mockImplementation(() => {
      throw new Error('oversized query must not be counted');
    });
    const allowed = isSearchQueryAllowed('a'.repeat(513));
    iterator.mockRestore();
    codePoint.mockRestore();
    expect(allowed).toBe(false);
  });

  it.each([
    'https://outside.test/',
    '//outside.test/',
    '/../secret',
    '/%2e%2e/secret',
    '/a/../../secret',
    '/\\outside',
    '/%2f%2foutside',
    '/%3f/../../../outside',
    '/%23/../../../outside',
    '%2fcapabilities',
  ])('rejects unsafe plugin-relative path %s', (path) => {
    expect(getNavigationHref({ kind: 'plugin', pluginId: 'probe', path })).toBeUndefined();
  });

  it('preserves a safe opaque encoded route segment instead of decoding it into another destination', () => {
    expect(getNavigationHref({ kind: 'plugin', pluginId: 'probe', path: '/tasks/opaque:%252F' })).toBe(
      '/_plugin/probe/tasks/opaque:%252F',
    );
  });

  it('checks the2048-unit path ceiling before decoding and never truncates a destination', () => {
    expect(getNavigationHref({ kind: 'plugin', pluginId: 'probe', path: '/capabilities' })).toBe(
      '/_plugin/probe/capabilities',
    );
    expect(getNavigationHref({ kind: 'plugin', pluginId: 'probe', path: `/${'x'.repeat(2047)}` })).toBeDefined();
    const decode = vi.spyOn(globalThis, 'decodeURIComponent').mockImplementation(() => {
      throw new Error('oversized path must not be decoded');
    });
    const href = getNavigationHref({ kind: 'plugin', pluginId: 'probe', path: `/${'x'.repeat(2048)}` });
    decode.mockRestore();
    expect(href).toBeUndefined();
  });
});
