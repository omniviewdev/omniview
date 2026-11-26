import { describe, expect, it } from 'vitest';
import { currentOf, dressed, dressProblems, readTarget } from './sidebarTargets';
import type { SidebarNodeV1 } from './v1';

// What a sidebar leaf opens, which leaf is the page on screen, and what of its row the shell draws (KL5). The names are invented (Acme, widgets); the host knows no plugin.

const leaf = (id: string, over: Partial<SidebarNodeV1> = {}): SidebarNodeV1 => ({ id, label: id, icon: 'box', ...over });

describe('what a leaf opens', () => {
  it('is the page its id names when it names no other, the page and the parameters it names (an empty parameter names nothing), or a connection', () => {
    expect(readTarget(leaf('widgets'))).toEqual({ target: { kind: 'page', page: 'widgets', params: {} } });
    expect(readTarget(leaf('recent', { page: 'landing', params: { filter: 'recent', sort: '' } }))).toEqual({ target: { kind: 'page', page: 'landing', params: { filter: 'recent' } } });
    expect(readTarget(leaf('north', { connection: 'north-1' }))).toEqual({ target: { kind: 'connection', key: 'north-1' } });
  });

  it.each([
    ['a page that is not text', leaf('a', { page: 7 as unknown as string }), 'page is not a non-empty string'],
    ['parameters that are not an object of text', leaf('a', { params: { filter: 3 } as unknown as Readonly<Record<string, string>> }), 'params is not an object of text values'],
    ['a parameter called connection', leaf('a', { params: { connection: 'north-1' } }), 'params holds "connection", which is not a parameter: a leaf opens a connection with its connection member'],
    ['a connection that is not text', leaf('a', { connection: '' }), 'connection is not a non-empty string'],
    ['a connection together with a page', leaf('a', { connection: 'north-1', page: 'landing' }), 'connection is given with page or params: a leaf opens a page or a connection, not both'],
  ])('refuses %s, in the sentence that names the member', (_name, node, problem) => {
    expect(readTarget(node)).toEqual({ problem });
  });
});

describe('how a row is dressed', () => {
  it('is left as it is when its badge and colour can be drawn, and is without a badge or a colour that cannot, which cost the row nothing else', () => {
    const fine = leaf('a', { status: { role: 'attention', label: 'Needs sign-in' }, tone: 'amber' });
    expect(dressProblems(fine)).toEqual([]);
    expect(dressed(fine)).toBe(fine);

    const bad = leaf('b', { count: 3, status: { role: 'bogus', label: '' } as unknown as SidebarNodeV1['status'], tone: 'magenta' as unknown as SidebarNodeV1['tone'] });
    expect(dressProblems(bad)).toEqual([
      'status is not { role, label }: a role of the kit\'s Status and a label',
      'tone is not a colour of the kit\'s data palette: blue, green, amber, red, purple, cyan, gray',
    ]);
    expect(dressed(bad)).toEqual({ id: 'b', label: 'b', icon: 'box', count: 3 });
  });
});

describe('the leaf that is the page on screen', () => {
  const nodes: readonly SidebarNodeV1[] = [
    leaf('landing'),
    leaf('attention', { page: 'landing', params: { filter: 'attention' } }),
    { id: 'connections', label: 'Connections', icon: 'server', children: [leaf('north', { connection: 'north-1' }), leaf('widgets')] },
  ];

  it('opens that page with those very parameters; else it is the page\'s leaf that names none; else there is none, and a connection\'s leaf is never it', () => {
    expect(currentOf(nodes, 'landing', {})).toBe('landing');
    expect(currentOf(nodes, 'landing', { filter: 'attention' })).toBe('attention');
    expect(currentOf(nodes, 'landing', { filter: 'unlisted' })).toBe('landing');
    expect(currentOf(nodes, 'widgets', {})).toBe('widgets');
    expect(currentOf(nodes, 'gadgets', {})).toBeUndefined();
    expect(currentOf(nodes.slice(1, 2), 'landing', {})).toBeUndefined();
  });
});
