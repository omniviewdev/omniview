import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatRoute, NO_ROUTE, parseRoute, useHashRoute } from './route';

// The window opens with no URL, so every part of a route is optional, and what the hash cannot say is absent, never an error.

describe('parseRoute', () => {
  it('reads a plugin, a page and a connection', () => {
    expect(parseRoute('#/acme/widgets?connection=north')).toEqual({ plugin: 'acme', page: 'widgets', connection: 'north' });
  });

  it('reads a plugin alone, and nothing at all', () => {
    expect(parseRoute('#/acme')).toEqual({ plugin: 'acme', page: undefined, connection: undefined });
    expect(parseRoute('')).toEqual(NO_ROUTE);
    expect(parseRoute('#')).toEqual(NO_ROUTE);
    expect(parseRoute('#/')).toEqual(NO_ROUTE);
  });

  it('decodes what was encoded, and drops what it cannot decode', () => {
    expect(parseRoute('#/acme/two%20words?connection=kind%2Fnorth')).toEqual({ plugin: 'acme', page: 'two words', connection: 'kind/north' });
    expect(parseRoute('#/%E0%A4%A/widgets')).toEqual({ plugin: undefined, page: 'widgets', connection: undefined });
  });
});

describe('formatRoute', () => {
  it('writes what parseRoute reads', () => {
    for (const route of [
      { plugin: 'acme', page: 'widgets', connection: 'north' },
      { plugin: 'acme', page: undefined, connection: undefined },
      { plugin: 'acme', page: 'two words', connection: 'kind/north' },
    ]) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
  });

  it('writes no hash for no plugin', () => {
    expect(formatRoute(NO_ROUTE)).toBe('');
  });
});

describe('useHashRoute', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    window.location.hash = '';
  });

  it('reads the hash and follows it', async () => {
    window.location.hash = '#/acme/widgets';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toEqual({ plugin: 'acme', page: 'widgets', connection: undefined });

    await act(async () => {
      window.location.hash = '#/acme/gadgets';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await Promise.resolve();
    });

    expect(result.current[0].page).toBe('gadgets');
  });

  it('navigates by writing the hash', async () => {
    const { result } = renderHook(() => useHashRoute());

    await act(async () => {
      result.current[1]({ plugin: 'acme', page: 'gadgets', connection: undefined });
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await Promise.resolve();
    });

    expect(window.location.hash).toBe('#/acme/gadgets');
    expect(result.current[0]).toEqual({ plugin: 'acme', page: 'gadgets', connection: undefined });
  });
});
