import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_ROUTE, parseRoute, useHashLink } from './route';

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

describe('useHashLink', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    window.location.hash = '';
  });

  it('reads the hash as a request', () => {
    window.location.hash = '#/acme/widgets?connection=north';
    const { result } = renderHook(() => useHashLink());
    expect(result.current).toEqual({ plugin: 'acme', page: 'widgets', connection: 'north' });
  });

  it('is no request for no hash', () => {
    const { result } = renderHook(() => useHashLink());
    expect(result.current).toEqual(NO_ROUTE);
  });

  it('follows the hash when it changes', async () => {
    window.location.hash = '#/acme/widgets';
    const { result } = renderHook(() => useHashLink());
    expect(result.current).toEqual({ plugin: 'acme', page: 'widgets', connection: undefined });

    await act(async () => {
      window.location.hash = '#/acme/gadgets';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await Promise.resolve();
    });

    expect(result.current.page).toBe('gadgets');
  });

  it('never writes the hash: it is a request from outside, not where the window is', () => {
    window.location.hash = '#/acme/widgets';
    renderHook(() => useHashLink());
    expect(window.location.hash).toBe('#/acme/widgets');
  });

  it('stops listening when it unmounts', async () => {
    const { result, unmount } = renderHook(() => useHashLink());
    unmount();
    window.location.hash = '#/acme/gadgets';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(result.current).toEqual(NO_ROUTE);
  });
});
