import { describe, expect, it } from 'vitest';
import { wordsOf } from './match';
import { AVAILABLE, candidateOf, chipOf, nameOf, rowFor, type Owner } from './results';
import type { Availability, Candidate } from './types';

// A provider's candidate becomes a row only through here, and a row is DATA (ch16 S63, S68): label parts with the ranges that matched, a tile, a route or a command, what the row says of
// itself. What a plugin hands over is not trusted: a candidate that is not valid data is dropped and counted, and what is kept is a copy the plugin can no longer change.

const owner: Owner = { provider: 'cloud:pages', plugin: 'cloud', pluginName: 'Cloud', pluginIcon: 'server', section: 'goto' };
const base: Candidate = { id: 'instances', kind: 'page', title: 'Instances', route: { plugin: 'cloud', contribution: 'instances' } };
const checkAvailable = (): Availability => AVAILABLE;

describe('candidateOf', () => {
  it('keeps what a valid candidate says and fills in the rest', () => {
    const made = candidateOf(base, owner);
    expect(made).toMatchObject({ key: 'cloud:pages|instances', id: 'instances', provider: 'cloud:pages', plugin: 'cloud', section: 'goto', kind: 'page', title: 'Instances', context: '', keywords: '', noun: 'Page' });
    expect(made?.route).toEqual({ plugin: 'cloud', contribution: 'instances', params: {} });
    expect(made?.icon).toBe('server');
    expect(made?.tone).toBe('neutral');
  });

  it('gives a route in its canonical form, frozen, whatever order it was written in', () => {
    const made = candidateOf({ ...base, route: { plugin: ' cloud ', contribution: 'item', params: { b: '2', a: '1', gone: '' } } }, owner);
    expect(made?.route).toEqual({ plugin: 'cloud', contribution: 'item', params: { a: '1', b: '2' } });
    expect(Object.isFrozen(made?.route)).toBe(true);
  });

  it('drops a candidate that is not valid data, and says nothing else of it', () => {
    const bad: unknown[] = [
      null,
      'text',
      { ...base, id: '' },
      { ...base, id: 3 },
      { ...base, title: '' },
      { ...base, title: '   ' },
      { ...base, kind: 'planet' },
      { id: 'x', kind: 'page', title: 'No route' },
      { ...base, route: { plugin: 'cloud' } },
      { ...base, route: { plugin: 'cloud', contribution: 'x', params: { fn: () => 1 } } },
      { id: 'c', kind: 'command', title: 'No command' },
      { id: 'c', kind: 'command', title: 'Empty id', command: { id: '' } },
      { id: 'c', kind: 'command', title: 'Code', command: { id: 'a.b', arg: () => 1 } },
      { id: 't', kind: 'tab', title: 'No tab id' },
      { ...base, reveal: { fn: () => 1 } },
    ];
    for (const raw of bad) {
      expect(candidateOf(raw, owner)).toBeUndefined();
    }
  });

  it('runs a command by registry id only: its argument and target are copies, frozen, and cannot be changed afterwards', () => {
    const arg = { depth: { n: 1 } };
    const made = candidateOf({ id: 'c', kind: 'command', title: 'Run', command: { id: 'a.b', arg, target: ['x'], keepOpen: true } }, owner);
    arg.depth.n = 2;
    expect(made?.command).toEqual({ id: 'a.b', arg: { depth: { n: 1 } }, target: ['x'], keepOpen: true });
    expect(Object.isFrozen(made?.command)).toBe(true);
    expect(Object.isFrozen(made?.command?.arg)).toBe(true);
  });

  it('takes a tab by its id, with a route when it has one', () => {
    expect(candidateOf({ id: 't1', kind: 'tab', title: 'Instances', tab: 't9' }, owner)?.tab).toBe('t9');
    expect(candidateOf({ id: 't1', kind: 'tab', title: 'Instances', tab: 't9', route: base.route }, owner)?.route?.contribution).toBe('instances');
  });

  it('ignores what it can ignore: an unknown tone, an into that is not a step inward, an unavailable that is not a reason', () => {
    const made = candidateOf({ ...base, tone: 'plaid', into: { kind: 'galaxy', id: 'x', label: 'x' }, unavailable: 4 }, owner);
    expect(made?.tone).toBe('neutral');
    expect(made?.into).toBeUndefined();
    expect(made?.unavailable).toBeUndefined();
  });

  it('reads `unavailable` as a reason, or as the plain word when it is `true`', () => {
    expect(candidateOf({ ...base, unavailable: 'The window is not split' }, owner)?.unavailable).toBe('The window is not split');
    expect(candidateOf({ ...base, unavailable: true }, owner)?.unavailable).toBe('Unavailable');
  });

  it('names the kind in words, or as the provider does', () => {
    expect(candidateOf({ ...base, kind: 'resource' }, owner)?.noun).toBe('Resource');
    expect(candidateOf({ ...base, kind: 'resource', noun: 'Workload' }, owner)?.noun).toBe('Workload');
  });
});

describe('rowFor', () => {
  const made = candidateOf({ id: 'cart', kind: 'resource', title: 'cart-api', context: 'Deployment · prod-eu · payments', icon: 'box', tone: 'blue', route: { plugin: 'stack', contribution: 'service' }, reveal: { row: 3 }, into: { kind: 'resource', id: 'cart-api', label: 'cart-api' } }, owner);

  it('is data: the label cut at what matched, the tile, the route to open and what Enter does', () => {
    const row = rowFor(made ?? fail('valid'), { section: 'stack:resources', words: wordsOf('cart prod'), availability: checkAvailable, inert: false, score: 99 });
    expect(row.id).toBe('stack:resources|cloud:pages|cart');
    expect(row.key).toBe('cloud:pages|cart');
    expect(row.title).toEqual({ text: 'cart-api', ranges: [[0, 4]], parts: [{ text: 'cart', match: true }, { text: '-api', match: false }] });
    expect(row.context.ranges).toEqual([[13, 17]]);
    expect(row.tile).toEqual({ icon: 'box', tone: 'blue' });
    expect(row.route).toEqual({ plugin: 'stack', contribution: 'service', params: {} });
    expect(row.action).toEqual({ type: 'open', destination: { route: { plugin: 'stack', contribution: 'service', params: {} }, reveal: { row: 3 } } });
    expect(row.into).toEqual({ kind: 'resource', id: 'cart-api', label: 'cart-api' });
    expect(row.score).toBe(99);
    expect(row.inert).toBe(false);
    expect(row.name).toBe('Resource: cart-api, Deployment · prod-eu · payments');
  });

  it('has no ranges for no words', () => {
    const row = rowFor(made ?? fail('valid'), { section: 's', words: [], availability: checkAvailable, inert: false, score: 0 });
    expect(row.title.ranges).toEqual([]);
    expect(row.title.parts).toEqual([{ text: 'cart-api', match: false }]);
  });

  it('is frozen, with nothing in it a view could call', () => {
    const row = rowFor(made ?? fail('valid'), { section: 's', words: [], availability: checkAvailable, inert: false, score: 0 });
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row.title)).toBe(true);
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it('runs a command on Enter, and says no state of it (A16: a command carries none)', () => {
    const command = candidateOf({ id: 'c', kind: 'command', title: 'Reopen closed tab', command: { id: 'tabs.reopen' }, shortcut: '⌘⇧T' }, owner);
    const row = rowFor(command ?? fail('valid'), { section: 'commands', words: [], availability: checkAvailable, inert: false, score: 0 });
    expect(row.action).toEqual({ type: 'run', command: { id: 'tabs.reopen' } });
    expect(row.shortcut).toBe('⌘⇧T');
    expect(row.route).toBeUndefined();
    expect(row.into).toBeUndefined();
  });

  it('activates a tab by its id, and keeps the route for the other dispositions', () => {
    const tab = candidateOf({ id: 't', kind: 'tab', title: 'Instances', tab: 't9', route: base.route }, owner);
    const row = rowFor(tab ?? fail('valid'), { section: 'tabs', words: [], availability: checkAvailable, inert: false, score: 0 });
    expect(row.action).toEqual({ type: 'activate', tab: 't9', destination: { route: { plugin: 'cloud', contribution: 'instances', params: {} } } });
  });

  it('says a route that cannot open: unavailable with its reason, and no way to search inside it (S65)', () => {
    const row = rowFor(made ?? fail('valid'), { section: 's', words: [], availability: () => ({ state: 'unavailable', reason: 'Stack is disabled in Plugins' }), inert: false, score: 0 });
    expect(row.availability).toEqual({ state: 'unavailable', reason: 'Stack is disabled in Plugins' });
    expect(row.word).toBe('Unavailable');
    expect(row.into).toBeUndefined();
    expect(row.name).toBe('Resource: cart-api, Deployment · prod-eu · payments, Unavailable. Stack is disabled in Plugins');
  });

  it('says a degraded route opens, to its recovery page, and has no way inward: a plugin that is failing or starting answers nothing inside it', () => {
    const row = rowFor(made ?? fail('valid'), { section: 's', words: [], availability: () => ({ state: 'degraded', reason: 'The backend crashed' }), inert: false, score: 0 });
    expect(row.availability).toEqual({ state: 'degraded', reason: 'The backend crashed' });
    expect(row.word).toBe('Degraded');
    expect(row.into).toBeUndefined();
    expect(row.name).toBe('Resource: cart-api, Deployment · prod-eu · payments, Degraded');
  });

  it('is unavailable when the provider says so, without asking the host', () => {
    const off = candidateOf({ ...base, unavailable: 'No cluster is selected' }, owner);
    const row = rowFor(off ?? fail('valid'), { section: 's', words: [], availability: () => fail('the host was asked'), inert: false, score: 0 });
    expect(row.availability).toEqual({ state: 'unavailable', reason: 'No cluster is selected' });
  });

  it('asks the host about a route once, and about no route at all for a command', () => {
    let asked = 0;
    const counting = (): Availability => {
      asked += 1;
      return AVAILABLE;
    };

    rowFor(made ?? fail('valid'), { section: 's', words: [], availability: counting, inert: false, score: 0 });
    const command = candidateOf({ id: 'c', kind: 'command', title: 'Run', command: { id: 'a.b' } }, owner);
    rowFor(command ?? fail('valid'), { section: 's', words: [], availability: counting, inert: false, score: 0 });
    expect(asked).toBe(1);
  });

  it('a row with no glyph of its own draws the plugin\'s; one with neither has no tile', () => {
    const plain = candidateOf({ id: 'p', kind: 'page', title: 'Plain', route: base.route }, owner);
    expect(rowFor(plain ?? fail('valid'), { section: 's', words: [], availability: checkAvailable, inert: false, score: 0 }).tile).toEqual({ icon: 'server', tone: 'neutral' });
    const bare = candidateOf({ id: 'p', kind: 'page', title: 'Plain', route: base.route }, { ...owner, pluginIcon: undefined });
    expect(rowFor(bare ?? fail('valid'), { section: 's', words: [], availability: checkAvailable, inert: false, score: 0 }).tile).toBeUndefined();
  });
});

describe('nameOf', () => {
  it('is `<kind>: <title>`, then the context, then what the state says, and leaves out what is empty', () => {
    expect(nameOf('Page', 'Instances', '', { state: 'available' })).toBe('Page: Instances');
    expect(nameOf('Page', 'Instances', 'Cloud', { state: 'available' })).toBe('Page: Instances, Cloud');
  });
});

describe('chipOf', () => {
  it('makes the chip a step inward adds, its label cut at 24 characters', () => {
    expect(chipOf({ kind: 'scope', id: 'prod-eu', label: 'a-very-long-connection-name-here' }, 'stack')).toEqual({ kind: 'scope', id: 'prod-eu', label: 'a-very-long-connection-…', plugin: 'stack', noun: 'scope', icon: '' });
    expect(chipOf({ kind: 'type', id: 't', label: 'Deployments', noun: 'workload type', icon: 'boxes' }, 'stack')).toEqual({ kind: 'type', id: 't', label: 'Deployments', plugin: 'stack', noun: 'workload type', icon: 'boxes' });
    expect(chipOf({ kind: 'type', id: 't', label: 'Deployments' }, 'stack').noun).toBe('resource type');
  });
});

function fail(what: string): never {
  throw new Error(what);
}
