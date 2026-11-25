import { describe, expect, it } from 'vitest';
import { sameSession, type Forward } from './model';

// Whether two forwards are one session of the host, or a later session that took the id of the first (a plugin that restarts may hand an id out again): what was said of the first, that its Stop is on its way or that it was closed, is not
// said of the second. Pure, so that every field that tells two sessions apart is read.

const forward = (patch: Partial<Forward> = {}): Forward => ({
  id: 'forward-1',
  plugin: 'acme',
  connection: 'conn-1',
  kind: 'resource',
  resource: 'web-1',
  local: 8081,
  remote: 8080,
  protocol: 'TCP',
  state: 'running',
  created: Date.parse('2026-11-24T10:00:00Z'),
  ...patch,
});

describe('whether two forwards are the same session', () => {
  const base = forward();

  it('is true for a session whose state and local port moved: they change over its life', () => {
    expect(sameSession(base, forward({ state: 'failed', local: 9000 }))).toBe(true);
    expect(sameSession(base, forward({ local: 0 }))).toBe(true);
  });

  it.each<[string, Partial<Forward>]>([
    ['id', { id: 'other' }],
    ['creation time', { created: base.created + 1000 }],
    ['plugin', { plugin: 'other' }],
    ['connection', { connection: 'other' }],
    ['kind', { kind: 'static' }],
    ['resource', { resource: 'other' }],
    ['remote port', { remote: 1 }],
    ['protocol', { protocol: 'UDP' }],
  ])('is false when only the %s differs: a later session that took the id', (_name, patch) => {
    expect(sameSession(base, forward(patch))).toBe(false);
  });

  it('does not tell two sessions apart by a creation time that one of them does not give', () => {
    expect(sameSession(forward({ created: 0 }), base)).toBe(true);
    expect(sameSession(base, forward({ created: 0 }))).toBe(true);
  });
});
