import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addressOf, NO_PARAMS, NO_ROUTE, parseRoute, useHashLink } from './route';

// The window opens with no URL, so every part of a route is optional, and what the hash cannot say is absent, never an error.

describe('parseRoute', () => {
  it('reads a plugin, a page and a connection', () => {
    expect(parseRoute('#/acme/widgets?connection=north')).toEqual({ plugin: 'acme', page: 'widgets', connection: 'north', params: {} });
  });

  it('reads a plugin alone, and nothing at all', () => {
    expect(parseRoute('#/acme')).toEqual({ plugin: 'acme', page: undefined, connection: undefined, params: {} });
    expect(parseRoute('')).toEqual(NO_ROUTE);
    expect(parseRoute('#')).toEqual(NO_ROUTE);
    expect(parseRoute('#/')).toEqual(NO_ROUTE);
  });

  it('decodes what was encoded, and drops what it cannot decode', () => {
    expect(parseRoute('#/acme/two%20words?connection=kind%2Fnorth')).toEqual({ plugin: 'acme', page: 'two words', connection: 'kind/north', params: {} });
    expect(parseRoute('#/%E0%A4%A/widgets')).toEqual({ plugin: undefined, page: 'widgets', connection: undefined, params: {} });
  });

  it('reads the rest of the query as the destination\'s parameters: the identity of an object', () => {
    expect(parseRoute('#/acme/widget?connection=north&name=lathe-4&bay=north%20yard')).toEqual({
      plugin: 'acme',
      page: 'widget',
      connection: 'north',
      params: { name: 'lathe-4', bay: 'north yard' },
    });
  });

  it('keeps the first of a name given twice, leaves out an empty one, and reads a name such as __proto__ as data', () => {
    const route = parseRoute('#/acme/widget?name=a&name=b&bay=');

    expect(route.params).toEqual({ name: 'a' });
    expect(Object.hasOwn(parseRoute('#/acme/widget?__proto__=x').params, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(parseRoute('#/acme/widget?__proto__=x').params)).toBe(Object.prototype);
  });

  it('shares one frozen object for a route with no parameters', () => {
    expect(parseRoute('#/acme/widgets').params).toBe(NO_PARAMS);
    expect(Object.isFrozen(NO_PARAMS)).toBe(true);
  });
});

describe('addressOf: the address a link carries is the one parseRoute reads', () => {
  it('writes the plugin, the page and the parameters in the order given', () => {
    expect(addressOf({ plugin: 'acme', page: 'widget', params: { connection: 'north', name: 'lathe-4' } })).toBe('#/acme/widget?connection=north&name=lathe-4');
  });

  it('is the page alone for no parameters, and leaves out one with no value', () => {
    expect(addressOf({ plugin: 'acme', page: 'widgets' })).toBe('#/acme/widgets');
    expect(addressOf({ plugin: 'acme', page: 'widgets', params: { connection: undefined, name: '' } })).toBe('#/acme/widgets');
  });

  it('round-trips through parseRoute, with characters a hash and a query give a meaning to', () => {
    const params = { name: 'a&b=c d', bay: 'ü/ñ#?' };
    const route = parseRoute(addressOf({ plugin: 'a plug/in', page: 'wid get', params: { connection: 'kind/north', ...params } }));

    expect(route).toEqual({ plugin: 'a plug/in', page: 'wid get', connection: 'kind/north', params });
  });

  it('reads a connection that holds a literal percent escape as it was written: the query is decoded once, by the URL parser, not twice', () => {
    for (const connection of ['north%2Fwest', '100%', 'a%25b']) {
      expect(parseRoute(addressOf({ plugin: 'acme', page: 'widgets', params: { connection } })).connection, connection).toBe(connection);
    }
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
    expect(result.current).toEqual({ plugin: 'acme', page: 'widgets', connection: 'north', params: {} });
  });

  it('is no request for no hash', () => {
    const { result } = renderHook(() => useHashLink());
    expect(result.current).toEqual(NO_ROUTE);
  });

  it('is the same object while the hash is the same text: a request with parameters does not look new on every render', () => {
    window.location.hash = '#/acme/widget?name=lathe-4';
    const { result, rerender } = renderHook(() => useHashLink());
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(result.current.params).toBe(first.params);
  });

  it('follows the hash when it changes', async () => {
    window.location.hash = '#/acme/widgets';
    const { result } = renderHook(() => useHashLink());
    expect(result.current).toEqual({ plugin: 'acme', page: 'widgets', connection: undefined, params: {} });

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
