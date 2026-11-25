import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { CLOSED_EVENT, CONNECTION_EVENT, CREATED_EVENT, STATE_CHANGE_EVENT, UNLOADED_EVENT } from './api';
import { PLUGIN_STOPPED } from './model';
import { COPIED_MS, createPortsStore, type PortsStore } from './PortsStore';
import { fakePorts, session, settle, type FakePorts } from './testing';

// The store of the Ports tool: what it asks of the host and when, how it reads the answer and the events, what it keeps of its own, and what Stop, Open in browser and Copy address do. Over the fake host of `testing.ts`, whose every
// call is answered by the test in the order the test writes, so that a read an event overtakes is a sequence and not a race. The rows' words and rules are `model.test.ts`'s; the DOM is `PortsBody.test.tsx`'s.

type Rig = { readonly fake: FakePorts; readonly store: PortsStore; readonly stop: () => void };

/** A store over a fake host, with one subscriber unless the test says otherwise. */
function mount(subscribe = true): Rig {
  const fake = fakePorts();
  const store = createPortsStore(fake.deps);
  const stop = subscribe ? store.subscribe(() => undefined) : () => undefined;
  return { fake, store, stop };
}

const ids = (store: PortsStore): string[] => store.getSnapshot().rows.map((row) => row.id);
const words = (store: PortsStore): string[] => store.getSnapshot().rows.map((row) => `${row.id} ${row.stateWord}`);

/** A session of a producer that states where the forward listens (`local_host`), which the SDK's session does not today: the only kind that Open in browser is offered for, and that Copy says an address for. */
const listening = (id: string, patch: Record<string, unknown> = {}) => session(id, { local_host: '127.0.0.1', ...patch });

/** The store listened to, and its first read answered with these sessions. */
async function ready(sessions: readonly unknown[], subscribe = true): Promise<Rig> {
  const rig = mount(subscribe);
  await rig.fake.answer(sessions);
  return rig;
}

let warn: MockInstance<Console['warn']>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('while nobody looks', () => {
  it('asks the host nothing and listens to nothing: a store is made when the window is, and the tool may never be shown', () => {
    const { fake, store } = mount(false);
    expect(fake.listed()).toBe(0);
    expect(fake.on()).toBe(0);
    expect(fake.names.listeners()).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', rows: [], copied: undefined, announcement: undefined });
  });

  it('gives the same snapshot every time it is asked, until something changes: a component that reads it renders for nothing else', () => {
    const { store } = mount(false);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});

describe('the first subscriber', () => {
  it('asks the host for the list once and listens for the two events on forwards, the plugin that stops, the plugin that runs and the connection that changes, and for the names of connections', () => {
    const { fake } = mount();
    expect(fake.listed()).toBe(1);
    expect(fake.on()).toBe(5);
    for (const name of [CREATED_EVENT, CLOSED_EVENT, UNLOADED_EVENT, STATE_CHANGE_EVENT, CONNECTION_EVENT]) {
      expect(fake.handlers(name)).toBe(1);
    }

    expect(fake.names.listeners()).toBe(1);
  });

  it('is told by event names that are the host\'s own', () => {
    expect([CREATED_EVENT, CLOSED_EVENT, UNLOADED_EVENT, STATE_CHANGE_EVENT, CONNECTION_EVENT]).toEqual([
      'core/networker/portforward/created',
      'core/networker/portforward/closed',
      'plugin/unloaded',
      'plugin/state_change',
      'connection/status',
    ]);
  });

  it('is the only one that does: a second adds no call and no handler, and the second to leave takes nothing off', () => {
    const { fake, store, stop } = mount();
    const second = store.subscribe(() => undefined);
    expect(fake.listed()).toBe(1);
    expect(fake.on()).toBe(5);
    stop();
    expect(fake.off()).toBe(0);
    expect(fake.handlers()).toBe(5);
    second();
    expect(fake.off()).toBe(5);
    expect(fake.handlers()).toBe(0);
    expect(fake.names.listeners()).toBe(0);
  });

  it('is the last to leave: each handler is taken off once, and an unsubscribe that is called again takes nothing more', () => {
    const { fake, stop } = mount();
    stop();
    stop();
    expect(fake.off()).toBe(5);
    expect(fake.on()).toBe(5);
  });

  it('starts again from loading when somebody comes back, and asks again: a store that is not looked at holds nothing, and what it held is not known to be true', async () => {
    const { fake, store, stop } = await ready([session('a'), session('b')]);
    expect(ids(store)).toEqual(['a', 'b']);
    stop();
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', rows: [] });
    store.subscribe(() => undefined);
    expect(fake.listed()).toBe(2);
    expect(fake.on()).toBe(10);
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', rows: [] });
    await fake.answer([session('c')]);
    expect(ids(store)).toEqual(['c']);
  });

  it('changes nothing when a read that was on its way lands after the last subscriber left, and nothing of it reaches the next one', async () => {
    const { fake, store, stop } = mount();
    stop();
    store.subscribe(() => undefined);
    expect(fake.pending()).toBe(2);
    await fake.answer([session('old')]);
    expect(store.getSnapshot().status).toBe('loading');
    await fake.answer([session('new')]);
    expect(ids(store)).toEqual(['new']);
  });

  it('is sound where a subscriber comes, goes and comes at once (strict mode runs an effect twice): one set of handlers is on, and the answer that counts is the last one', async () => {
    const { fake, store, stop } = mount();
    stop();
    const stay = store.subscribe(() => undefined);
    expect(fake.handlers()).toBe(5);
    await fake.answer([session('stale')]);
    await fake.answer([session('current')]);
    expect(ids(store)).toEqual(['current']);
    stay();
    expect(fake.handlers()).toBe(0);
  });
});

describe('reading the list', () => {
  it('is loading until the host answers, then the forwards in the order they were made, and a null in the answer is no forward', async () => {
    const { fake, store } = mount();
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', rows: [] });
    await fake.answer([
      session('late', { created_at: '2026-11-24T12:00:00Z' }),
      null,
      session('first', { created_at: '2026-11-24T09:00:00Z' }),
    ]);
    expect(store.getSnapshot().status).toBe('ready');
    expect(ids(store)).toEqual(['first', 'late']);
  });

  it('puts forwards made at the same moment in the order they were first seen, and keeps them there when the host lists them in another order: the host\'s list is in no order, and a row does not move when another changes', async () => {
    const { fake, store } = await ready([session('b'), session('a'), session('c')]);
    expect(ids(store)).toEqual(['b', 'a', 'c']);
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('c'), session('a'), session('b')]);
    expect(ids(store)).toEqual(['b', 'a', 'c']);
  });

  it('makes the row of a forward from what the host states: the resource, the mapping, the state in words', async () => {
    const { store } = await ready([session('a', { state: 'PAUSED', local_port: 9000, remote_port: 80 })]);
    expect(store.getSnapshot().rows[0]).toMatchObject({ id: 'a', resource: 'res-a', mapping: 'port 9000 → :80/TCP', stateWord: 'Paused', reason: undefined });
  });

  it('is ready with no row for a host that holds no forward, and for one that answers nothing', async () => {
    const first = await ready([]);
    expect(first.store.getSnapshot()).toMatchObject({ status: 'ready', rows: [] });
    const second = await ready(null as unknown as readonly unknown[]);
    expect(second.store.getSnapshot()).toMatchObject({ status: 'ready', rows: [] });
  });

  it('says it could not read when the host fails, with nothing to show', async () => {
    const { fake, store } = mount();
    await fake.fail(new Error('down'));
    expect(store.getSnapshot()).toMatchObject({ status: 'failed', rows: [] });
  });

  it('reads again when it is told to try again, and really asks the host again', async () => {
    const { fake, store } = mount();
    await fake.fail(new Error('down'));
    store.retry();
    expect(store.getSnapshot().status).toBe('loading');
    expect(fake.listed()).toBe(2);
    await fake.answer([session('a')]);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready' });
    expect(ids(store)).toEqual(['a']);
  });

  it('is loading again while a second failure is awaited, not failed: a retry that fails ends in failed once', async () => {
    const { fake, store } = mount();
    await fake.fail(new Error('down'));
    store.retry();
    await fake.fail(new Error('down'));
    expect(store.getSnapshot().status).toBe('failed');
  });

  it('keeps what it showed when a later read fails: the events go on keeping the list true, and a table that had rows does not turn into an error for one missed answer', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(CONNECTION_EVENT);
    await fake.fail(new Error('down'));
    expect(store.getSnapshot().status).toBe('ready');
    expect(ids(store)).toEqual(['a']);
  });

  it('takes the host\'s answer for what a row is when the host says it changed: a read after a connection event shows what the connection\'s end did to a forward', async () => {
    const { fake, store } = await ready([session('a')]);
    expect(words(store)).toEqual(['a Running']);
    fake.emit(CONNECTION_EVENT);
    expect(fake.listed()).toBe(2);
    await fake.answer([session('a', { state: 'STOPPED' })]);
    expect(words(store)).toEqual(['a Stopped']);
  });

  it('drops the forwards a read no longer lists, when their plugin did not stop: they are closed', async () => {
    const { fake, store } = await ready([session('a'), session('b')]);
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('b')]);
    expect(ids(store)).toEqual(['b']);
  });
});

describe('the events on forwards', () => {
  it('adds the row of a forward that was created, and replaces it for one that is created again', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(CREATED_EVENT, session('b'));
    expect(ids(store)).toEqual(['a', 'b']);
    fake.emit(CREATED_EVENT, session('b', { local_port: 9999 }));
    expect(ids(store)).toEqual(['a', 'b']);
    expect(store.getSnapshot().rows[1]?.local).toBe(9999);
  });

  it('removes the row of a forward that was closed, and does nothing for one it does not hold', async () => {
    const { fake, store } = await ready([session('a'), session('b')]);
    fake.emit(CLOSED_EVENT, session('a', { state: 'STOPPED' }));
    expect(ids(store)).toEqual(['b']);
    fake.emit(CLOSED_EVENT, session('nobody'));
    expect(ids(store)).toEqual(['b']);
  });

  it('is deaf to a payload that is not a session: a null, an object with no id, nothing', async () => {
    const { fake, store } = await ready([session('a')]);
    const before = store.getSnapshot();
    fake.emit(CREATED_EVENT, null);
    fake.emit(CREATED_EVENT, {});
    fake.emit(CREATED_EVENT);
    fake.emit(CLOSED_EVENT, null);
    fake.emit(CLOSED_EVENT);
    expect(store.getSnapshot()).toBe(before);
  });

  it('shows a forward that was created before the first answer landed, and does not take the stale answer for the truth: the answer is asked for again', async () => {
    const { fake, store } = mount();
    fake.emit(CREATED_EVENT, session('b', { created_at: '2026-11-24T11:00:00Z' }));
    await fake.answer([session('a', { created_at: '2026-11-24T09:00:00Z' })]);
    expect(store.getSnapshot().status).toBe('loading');
    expect(fake.listed()).toBe(2);
    await fake.answer([session('a', { created_at: '2026-11-24T09:00:00Z' }), session('b', { created_at: '2026-11-24T11:00:00Z' })]);
    expect(store.getSnapshot().status).toBe('ready');
    expect(ids(store)).toEqual(['a', 'b']);
  });

  it('does not bring back a forward that was closed while the answer was on its way', async () => {
    const { fake, store } = await ready([session('a'), session('b')]);
    fake.emit(CONNECTION_EVENT);
    fake.emit(CLOSED_EVENT, session('a'));
    await fake.answer([session('a'), session('b')]);
    expect(ids(store)).toEqual(['b']);
    expect(fake.listed()).toBe(3);
    await fake.answer([session('b')]);
    expect(ids(store)).toEqual(['b']);
  });

  it('asks once more, not once for each event, however many connection events come while a read is on its way', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(CONNECTION_EVENT);
    for (let event = 0; event < 6; event += 1) {
      fake.emit(CONNECTION_EVENT);
    }

    expect(fake.listed()).toBe(2);
    await fake.answer([session('a')]);
    expect(fake.listed()).toBe(3);
    await fake.answer([session('a')]);
    expect(fake.listed()).toBe(3);
    expect(fake.pending()).toBe(0);
    expect(ids(store)).toEqual(['a']);
  });

  it('never has a timer for it: the tool reads again when it is told and waits for nothing', async () => {
    const { fake } = await ready([session('a')]);
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a')]);
    expect(fake.timers()).toBe(0);
  });
});

describe('what the window renders', () => {
  it('is the same snapshot, and the same rows, when a read says what is already said: nobody is told', async () => {
    const { fake, store } = await ready([session('a'), session('b')]);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a'), session('b')]);
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('is the same row, as an object, for every forward but the one that changed', async () => {
    const { fake, store } = await ready([session('a'), session('b'), session('c')]);
    const [a, b, c] = store.getSnapshot().rows;
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a'), session('b', { state: 'FAILED' }), session('c')]);
    const [a2, b2, c2] = store.getSnapshot().rows;
    expect(a2).toBe(a);
    expect(c2).toBe(c);
    expect(b2).not.toBe(b);
    expect(b2?.stateWord).toBe('Failed');
  });

  it('tells its subscribers once for one change, and not at all while it is quiet', async () => {
    const { fake, store } = await ready([session('a')]);
    const listener = vi.fn();
    store.subscribe(listener);
    await settle();
    expect(listener).not.toHaveBeenCalled();
    fake.emit(CREATED_EVENT, session('b'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fake.timers()).toBe(0);
  });
});

describe('a plugin that stops', () => {
  const stopped = (plugin = 'acme', cause = 'crashed') => ({ pluginID: plugin, cause });

  it('makes its forwards Stopped, with the two facts the window has, at once, and reads the list again', async () => {
    const { fake, store } = await ready([session('a'), session('b')]);
    fake.emit(UNLOADED_EVENT, stopped());
    expect(words(store)).toEqual(['a Stopped', 'b Stopped']);
    expect(store.getSnapshot().rows[0]).toMatchObject({ reason: PLUGIN_STOPPED, pluginStopped: true });
    expect(fake.listed()).toBe(2);
  });

  it('keeps them on the list when the host no longer lists them, which is what it does for a plugin that is gone: the window says what became of them', async () => {
    const { fake, store } = await ready([session('a'), session('b')]);
    fake.emit(UNLOADED_EVENT, stopped());
    await fake.answer([]);
    expect(words(store)).toEqual(['a Stopped', 'b Stopped']);
  });

  it('leaves the forwards of another plugin as they are', async () => {
    const other = { plugin_id: 'beta', connection_id: 'c', resource_id: 'db', resource_key: 'widgets' };
    const { fake, store } = await ready([session('a'), session('b', { connection: other })]);
    fake.emit(UNLOADED_EVENT, stopped('beta'));
    expect(words(store)).toEqual(['a Running', 'b Stopped']);
  });

  it('is not said of a forward that is of no plugin: a static target names none', async () => {
    const { fake, store } = await ready([session('a', { connection_type: 'STATIC', connection: { address: 'db:5432' } })]);
    fake.emit(UNLOADED_EVENT, stopped(''));
    fake.emit(UNLOADED_EVENT, stopped('acme'));
    expect(words(store)).toEqual(['a Running']);
  });

  it('is deaf to an event that is not what the host says of a plugin that stopped: no id, a cause that is not one of the host\'s words', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(UNLOADED_EVENT, { cause: 'crashed' });
    fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'bored' });
    fake.emit(UNLOADED_EVENT, null);
    fake.emit(UNLOADED_EVENT);
    expect(words(store)).toEqual(['a Running']);
    expect(fake.listed()).toBe(1);
  });

  it('says every cause of the host\'s seven the same: the plugin is not there', async () => {
    for (const cause of ['crashed', 'reloaded', 'uninstalled', 'disabled', 'failed', 'timeout']) {
      const { fake, store } = await ready([session('a')]);
      fake.emit(UNLOADED_EVENT, stopped('acme', cause));
      expect(words(store)).toEqual(['a Stopped']);
    }
  });

  it('is not waited for in a Stop that is on its way: the forward is Stopped, and not Stopping for ever', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    expect(words(store)).toEqual(['a Stopping']);
    fake.emit(UNLOADED_EVENT, stopped());
    expect(words(store)).toEqual(['a Stopped']);
    await fake.closeFail(new Error('The plugin is not running.'));
    expect(store.getSnapshot().rows[0]?.reason).toBe(PLUGIN_STOPPED);
  });

  it('is over when the host says the plugin runs again: the forwards it had are not listed by the plugin that runs, and are gone', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(UNLOADED_EVENT, stopped());
    await fake.answer([]);
    expect(words(store)).toEqual(['a Stopped']);
    fake.emit(STATE_CHANGE_EVENT, { pluginID: 'acme', to: 'Running' });
    expect(fake.listed()).toBe(3);
    await fake.answer([]);
    expect(ids(store)).toEqual([]);
  });

  it('is over for a forward the plugin that runs lists, which is Running if it says so', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(UNLOADED_EVENT, stopped());
    await fake.answer([]);
    fake.emit(STATE_CHANGE_EVENT, { pluginID: 'acme', to: 'Running' });
    await fake.answer([session('a')]);
    expect(words(store)).toEqual(['a Running']);
    expect(store.getSnapshot().rows[0]?.reason).toBeUndefined();
  });

  it('ignores a plugin that runs when the window never heard it stop, and a state that is not Running: nothing is read for either', async () => {
    const { fake } = await ready([session('a')]);
    const before = fake.listed();
    fake.emit(STATE_CHANGE_EVENT, { pluginID: 'acme', to: 'Running' });
    expect(fake.listed()).toBe(before);
    fake.emit(UNLOADED_EVENT, stopped());
    await fake.answer([session('a')]);
    const listed = fake.listed();
    fake.emit(STATE_CHANGE_EVENT, { pluginID: 'acme', to: 'Starting' });
    fake.emit(STATE_CHANGE_EVENT, { pluginID: 'acme' });
    fake.emit(STATE_CHANGE_EVENT, null);
    expect(fake.listed()).toBe(listed);
  });

  it('says nothing more of it once nobody looks: the plugin that stopped while the tool was away is not known to have, and the tool asks the host for what it holds', async () => {
    const { fake, store, stop } = await ready([session('a')]);
    fake.emit(UNLOADED_EVENT, stopped());
    stop();
    store.subscribe(() => undefined);
    await fake.answer([session('a')]);
    await fake.answer([session('a')]);
    expect(words(store)).toEqual(['a Running']);
  });
});

describe('Stop', () => {
  it('shows Stopping at once and asks the host to close the forward', async () => {
    const { fake, store } = await ready([session('a'), session('b')]);
    store.stop('a');
    expect(words(store)).toEqual(['a Stopping', 'b Running']);
    expect(fake.closed()).toEqual(['a']);
  });

  it('removes the row when the host says it is closed, and says so once', async () => {
    const { fake, store } = await ready([session('a'), session('b')]);
    store.stop('a');
    fake.emit(CLOSED_EVENT, session('a', { state: 'STOPPED' }));
    expect(ids(store)).toEqual(['b']);
    expect(store.getSnapshot().announcement).toMatchObject({ text: 'Stopped port 8081 → :8080/TCP' });
    await fake.closeAnswer();
    expect(store.getSnapshot().announcement?.id).toBe(1);
  });

  it('removes the row when the host answers the call, if no event comes: the answer is the host saying that it closed it', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    await fake.closeAnswer();
    expect(ids(store)).toEqual([]);
    expect(store.getSnapshot().announcement).toMatchObject({ id: 1, text: 'Stopped port 8081 → :8080/TCP' });
    fake.emit(CLOSED_EVENT, session('a'));
    expect(store.getSnapshot().announcement?.id).toBe(1);
  });

  it('puts the row back as it was, with why it could not end, when the host refuses; and says so aloud', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    await fake.closeFail(new Error('The plugin is busy.'));
    expect(words(store)).toEqual(['a Running']);
    expect(store.getSnapshot().rows[0]?.reason).toBe('Couldn\'t stop it. The plugin is busy.');
    expect(store.getSnapshot().announcement).toMatchObject({ text: 'Couldn\'t stop port 8081 → :8080/TCP' });
  });

  it('says it could not stop with no more words when the host gives none', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    await fake.closeFail(new Error(''));
    expect(store.getSnapshot().rows[0]?.reason).toBe('Couldn\'t stop it.');
  });

  it('tries again when Stop is pressed again, and the reason is gone while it does', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    await fake.closeFail(new Error('The plugin is busy.'));
    store.stop('a');
    expect(words(store)).toEqual(['a Stopping']);
    expect(store.getSnapshot().rows[0]?.reason).toBeUndefined();
    expect(fake.closed()).toEqual(['a', 'a']);
    await fake.closeAnswer(1);
    expect(ids(store)).toEqual([]);
  });

  it('takes a forward the host does not have for a forward that is closed: there is nothing to refuse, and the row goes', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    await fake.closeFail(new Error('gone'));
    expect(ids(store)).toEqual([]);
  });

  it('asks once for a forward that is already Stopping, and for none that it does not hold', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    store.stop('a');
    store.stop('nobody');
    expect(fake.closed()).toEqual(['a']);
  });

  it('stops a forward that has ended, which the host removes from its list: it is the only way off it', async () => {
    const { fake, store } = await ready([session('a', { state: 'FAILED' }), session('b', { state: 'STOPPED' })]);
    store.stop('a');
    store.stop('b');
    expect(fake.closed()).toEqual(['a', 'b']);
  });

  it('does not ask for a forward whose plugin stopped: the host would answer that the plugin is not there, and the row says so', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'crashed' });
    store.stop('a');
    expect(fake.closed()).toEqual([]);
  });

  it('changes nothing of a row that is gone by the time the answer comes: the window moved on', async () => {
    const { fake, store, stop } = await ready([session('a')]);
    store.stop('a');
    stop();
    await fake.closeAnswer();
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', announcement: undefined });
  });

  it('is not asked of a store nobody looks at', () => {
    const { fake, store } = mount(false);
    store.stop('a');
    expect(fake.closed()).toEqual([]);
  });
});

describe('Open in browser', () => {
  it('opens the forward\'s own end on this computer, over http, for a forward that runs over TCP', async () => {
    const { fake, store } = await ready([listening('a', { local_port: 3000 })]);
    fake.serve([listening('a', { local_port: 3000 })]);
    store.open('a');
    await settle();
    expect(fake.opened).toEqual(['http://127.0.0.1:3000']);
  });

  it('opens nothing for UDP, for a forward that does not run, or for one it does not hold', async () => {
    const { fake, store } = await ready([session('udp', { protocol: 'UDP' }), session('paused', { state: 'PAUSED' }), session('failed', { state: 'FAILED' })]);
    store.open('udp');
    store.open('paused');
    store.open('failed');
    store.open('nobody');
    await settle();
    expect(fake.opened).toEqual([]);
  });

  it('opens nothing for a forward whose plugin stopped, or that is being stopped: neither runs', async () => {
    const { fake, store } = await ready([session('a'), session('b', { connection: { plugin_id: 'beta', connection_id: 'c', resource_id: 'x', resource_key: 'widgets' } })]);
    store.stop('a');
    fake.emit(UNLOADED_EVENT, { pluginID: 'beta', cause: 'crashed' });
    store.open('a');
    store.open('b');
    await settle();
    expect(fake.opened).toEqual([]);
  });

  it('says so when the system does not open it, and does not throw', async () => {
    const { fake, store } = await ready([listening('a')]);
    fake.serve([listening('a')]);
    fake.browser.reject = true;
    store.open('a');
    await settle();
    expect(store.getSnapshot().announcement).toMatchObject({ text: 'Couldn\'t open 127.0.0.1:8081 in the browser' });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('Copy', () => {
  it('puts the forward\'s port on the clipboard, marks the row, says so aloud, and starts the one timer that takes the mark away', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.serve([session('a')]);
    store.copy('a');
    await settle();
    expect(fake.copied).toEqual(['8081']);
    expect(store.getSnapshot()).toMatchObject({ copied: 'a', announcement: { id: 1, text: 'Port copied' } });
    expect(fake.timers()).toBe(1);
    fake.fire();
    expect(store.getSnapshot().copied).toBeUndefined();
    expect(fake.timers()).toBe(0);
  });

  it('waits two seconds', () => {
    expect(COPIED_MS).toBe(2000);
  });

  it('moves the mark to the row copied last and keeps one timer: the first is cancelled', async () => {
    const { fake, store } = await ready([session('a'), session('b', { local_port: 9000 })]);
    fake.serve([session('a'), session('b', { local_port: 9000 })]);
    store.copy('a');
    await settle();
    store.copy('b');
    await settle();
    expect(store.getSnapshot().copied).toBe('b');
    expect(fake.timers()).toBe(1);
    expect(fake.copied).toEqual(['8081', '9000']);
    expect(store.getSnapshot().announcement?.id).toBe(2);
  });

  it('says it could not when the clipboard refuses, marks nothing and starts no timer', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.serve([session('a')]);
    fake.clipboard.works = false;
    store.copy('a');
    await settle();
    expect(store.getSnapshot()).toMatchObject({ copied: undefined, announcement: { text: 'Couldn\'t copy the port' } });
    expect(fake.timers()).toBe(0);
  });

  it('copies nothing for a forward that does not run, or that has no address, or that it does not hold', async () => {
    const { fake, store } = await ready([session('paused', { state: 'PAUSED' }), session('auto', { local_port: 0 })]);
    store.copy('paused');
    store.copy('auto');
    store.copy('nobody');
    await settle();
    expect(fake.copied).toEqual([]);
    expect(fake.timers()).toBe(0);
  });

  it('copies the port of a UDP forward: it is a port all the same', async () => {
    const { fake, store } = await ready([session('a', { protocol: 'UDP' })]);
    fake.serve([session('a', { protocol: 'UDP' })]);
    store.copy('a');
    await settle();
    expect(fake.copied).toEqual(['8081']);
  });

  it('has no timer at rest: reading, events and a stop start none, and one that is waiting goes with the last subscriber', async () => {
    const { fake, store, stop } = await ready([session('a')]);
    fake.emit(CREATED_EVENT, session('b'));
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a'), session('b')]);
    store.stop('b');
    expect(fake.timers()).toBe(0);
    fake.serve([session('a'), session('b')]);
    store.copy('a');
    await settle();
    expect(fake.timers()).toBe(1);
    stop();
    expect(fake.timers()).toBe(0);
  });

  it('tells nobody that the mark went when the store is not looked at any more', async () => {
    const { fake, store, stop } = await ready([session('a')]);
    fake.serve([session('a')]);
    const listener = vi.fn();
    const leave = store.subscribe(listener);
    store.copy('a');
    await settle();
    expect(store.getSnapshot().copied).toBe('a');
    expect(fake.timers()).toBe(1);
    stop();
    leave();
    expect(fake.timers()).toBe(0);
    listener.mockClear();
    fake.fire();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot().copied).toBeUndefined();
  });

  it('announces each time, even for the same words: the id says it is new', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.serve([session('a')]);
    store.copy('a');
    await settle();
    const first = store.getSnapshot().announcement;
    store.copy('a');
    await settle();
    expect(store.getSnapshot().announcement).toMatchObject({ text: first?.text });
    expect(store.getSnapshot().announcement?.id).toBe((first?.id ?? 0) + 1);
  });
});

describe('the connection\'s name', () => {
  const named = { plugin_id: 'acme', connection_id: 'conn-1', resource_id: 'web', resource_key: 'widgets' };

  it('is what the window knows for the connection, and a dash\'s worth of nothing when it knows none: never the id', async () => {
    const { fake, store } = await ready([session('a', { connection: named })]);
    expect(store.getSnapshot().rows[0]?.connection).toBe('');
    fake.names.set('acme', 'conn-1', 'Staging');
    expect(store.getSnapshot().rows[0]?.connection).toBe('Staging');
    fake.names.set('acme', 'conn-1', undefined);
    expect(store.getSnapshot().rows[0]?.connection).toBe('');
  });

  it('is what was known when the list came, too', async () => {
    const fake = fakePorts();
    fake.names.set('acme', 'conn-1', 'Staging');
    const store = createPortsStore(fake.deps);
    store.subscribe(() => undefined);
    await fake.answer([session('a', { connection: named })]);
    expect(store.getSnapshot().rows[0]?.connection).toBe('Staging');
  });

  it('tells the subscribers when a name arrives, and changes only the rows of that connection', async () => {
    const other = { plugin_id: 'acme', connection_id: 'conn-2', resource_id: 'web', resource_key: 'widgets' };
    const { fake, store } = await ready([session('a', { connection: named }), session('b', { connection: other })]);
    const [a, b] = store.getSnapshot().rows;
    fake.names.set('acme', 'conn-1', 'Staging');
    const [a2, b2] = store.getSnapshot().rows;
    expect(a2).not.toBe(a);
    expect(b2).toBe(b);
  });

  it('has no name for a static target, whatever the window knows', async () => {
    const { fake, store } = await ready([session('a', { connection_type: 'STATIC', connection: { address: 'db:5432' } })]);
    fake.names.set('', '', 'Nothing');
    expect(store.getSnapshot().rows[0]).toMatchObject({ connection: '', resource: 'db:5432' });
  });

  it('is not asked of a window that has no names: a forward\'s connection is a dash', async () => {
    const fake = fakePorts();
    const store = createPortsStore({ ...fake.deps, names: undefined });
    store.subscribe(() => undefined);
    await fake.answer([session('a', { connection: named })]);
    expect(store.getSnapshot().rows[0]?.connection).toBe('');
    expect(fake.names.listeners()).toBe(0);
  });
});

describe('a session that takes the id of another', () => {
  const later = '2026-11-24T12:00:00Z';

  /** The forward `a` is being stopped (the first call the host was given), its plugin restarts, and a session made later is listed under the same id: the store holds that one now. */
  async function replaced(): Promise<Rig> {
    const rig = await ready([session('a')]);
    rig.store.stop('a');
    rig.fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'crashed' });
    await rig.fake.answer([]);
    rig.fake.emit(STATE_CHANGE_EVENT, { pluginID: 'acme', to: 'Running' });
    await rig.fake.answer([session('a', { created_at: later })]);
    return rig;
  }

  it('is a row of its own: the answer of the Stop that was on its way for the first session removes nothing of it, and says nothing aloud', async () => {
    const { fake, store } = await replaced();
    expect(words(store)).toEqual(['a Running']);
    await fake.closeAnswer(0);
    expect(words(store)).toEqual(['a Running']);
    expect(store.getSnapshot().announcement).toBeUndefined();
  });

  it('is not removed by the host\'s answer that it does not have the first session: that is a word about the first', async () => {
    const { fake, store } = await replaced();
    await fake.closeFail(new Error('gone'), 0);
    expect(words(store)).toEqual(['a Running']);
  });

  it('has its own Stop: the refusal of the first one neither ends its waiting nor says why on the new row', async () => {
    const { fake, store } = await replaced();
    store.stop('a');
    expect(fake.closed()).toEqual(['a', 'a']);
    await fake.closeFail(new Error('The plugin is busy.'), 0);
    expect(words(store)).toEqual(['a Stopping']);
    expect(store.getSnapshot().rows[0]?.reason).toBeUndefined();
    await fake.closeAnswer(1);
    expect(ids(store)).toEqual([]);
  });

  it('is not closed by the host\'s word that the first session was closed', async () => {
    const { fake, store } = await replaced();
    fake.emit(CLOSED_EVENT, session('a'));
    expect(words(store)).toEqual(['a Running']);
  });

  it('is the row, with nothing said of the first, when its creation is announced while the first is held: a Stop that waited for the first does not wait for it', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    fake.emit(CREATED_EVENT, session('a', { created_at: later }));
    expect(words(store)).toEqual(['a Running']);
    await fake.closeAnswer(0);
    expect(words(store)).toEqual(['a Running']);
  });

  it('is not another session when the host announces the same one again: its Stop is still the Stop of the row', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    fake.emit(CREATED_EVENT, session('a'));
    expect(words(store)).toEqual(['a Stopping']);
    await fake.closeAnswer(0);
    expect(ids(store)).toEqual([]);
  });
});

describe('the same listener', () => {
  it('subscribed twice is two subscriptions: one set of handlers, both told, and the store stays on until the second has gone', async () => {
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    const listener = vi.fn();
    const first = store.subscribe(listener);
    const second = store.subscribe(listener);
    expect(fake.on()).toBe(5);
    expect(fake.listed()).toBe(1);
    await fake.answer([session('a')]);
    expect(listener).toHaveBeenCalledTimes(2);
    first();
    expect(fake.handlers()).toBe(5);
    second();
    expect(fake.handlers()).toBe(0);
    expect(fake.off()).toBe(5);
  });
});

describe('a burst of events, each handed over in a task of its own', () => {
  const COUNT = 500;
  const names = Array.from({ length: COUNT }, (_, index) => `f-${String(index)}`);
  const all = names.map((id, index) => session(id, { local_port: 10_000 + index }));

  type Watched = Rig & { readonly listener: MockInstance<() => void> };

  /** The store listened to by a listener that counts, after its first read: what it was told until then is not counted. */
  async function watched(sessions: readonly unknown[]): Promise<Watched> {
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    const listener = vi.fn<() => void>();
    const stop = store.subscribe(listener);
    await fake.answer(sessions);
    listener.mockClear();
    return { fake, store, stop, listener };
  }

  it('makes one snapshot and one notification in the next frame: a store that told its listener for each event would make a commit for each', async () => {
    const { fake, store, listener } = await watched([]);
    const shown = store.getSnapshot();
    for (const forward of all) {
      fake.deliver(CREATED_EVENT, forward);
    }

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(shown);
    expect(fake.frames.requested()).toBe(1);
    fake.frames.tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(store)).toEqual(names);
    expect(fake.frames.pending()).toBe(0);
  });

  it('is the same for forwards that are closed: five hundred gone in the next frame are one snapshot and one notification', async () => {
    const { fake, store, listener } = await watched(all);
    const shown = store.getSnapshot();
    expect(shown.rows).toHaveLength(COUNT);
    for (const forward of all) {
      fake.deliver(CLOSED_EVENT, forward);
    }

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(shown);
    expect(fake.frames.requested()).toBe(1);
    fake.frames.tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(store)).toEqual([]);
  });

  it('ends exact when a forward is made, closed and made again within a frame: what is held is what the last of the events says', async () => {
    const { fake, store, listener } = await watched([]);
    fake.deliver(CREATED_EVENT, session('a'));
    fake.deliver(CLOSED_EVENT, session('a'));
    fake.deliver(CREATED_EVENT, session('a', { local_port: 9000 }));
    fake.deliver(CLOSED_EVENT, session('a', { local_port: 9000 }));
    fake.deliver(CREATED_EVENT, session('a', { local_port: 9001 }));
    fake.frames.tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().rows.map((row) => `${row.id} ${String(row.local)}`)).toEqual(['a 9001']);
  });

  it('tells nobody when what a frame comes to is what was shown: a forward made and closed within it', async () => {
    const { fake, store, listener } = await watched([]);
    const shown = store.getSnapshot();
    fake.deliver(CREATED_EVENT, session('a'));
    fake.deliver(CLOSED_EVENT, session('a'));
    fake.frames.tick();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(shown);
  });

  it('is dropped with the last subscriber: the frame is cancelled and nobody is told', async () => {
    const { fake, store, listener, stop } = await watched([]);
    fake.deliver(CREATED_EVENT, session('a'));
    expect(fake.frames.pending()).toBe(1);
    stop();
    expect(fake.frames.cancelled()).toBe(1);
    expect(fake.frames.pending()).toBe(0);
    fake.frames.tick();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', rows: [] });
  });

  it('asks for no frame while the host says nothing: the first read, a read that answers the same, and a store nobody looks at', async () => {
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    const stop = store.subscribe(() => undefined);
    await fake.answer([session('a')]);
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a')]);
    stop();
    expect(fake.frames.requested()).toBe(0);
    expect(fake.timers()).toBe(0);
  });

  it('is known to what a press does before it is shown: Stop of a forward made in this frame calls the host, and of one closed in it does not', async () => {
    const { fake, store } = await watched([session('b')]);
    fake.deliver(CREATED_EVENT, session('a'));
    store.stop('a');
    expect(fake.closed()).toEqual(['a']);
    fake.deliver(CLOSED_EVENT, session('b'));
    store.stop('b');
    expect(fake.closed()).toEqual(['a']);
  });

  it('is taken by the answer of a read that comes first: one snapshot of what the events said and the host answered, and the frame is not wanted', async () => {
    const { fake, store, listener } = await watched([session('a')]);
    fake.deliver(CREATED_EVENT, session('b'));
    fake.deliver(CONNECTION_EVENT);
    await fake.answer([session('a'), session('b'), session('c')]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(store)).toEqual(['a', 'b', 'c']);
    expect(fake.frames.pending()).toBe(0);
    fake.frames.tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is correct across a subscriber that goes and one that comes at once (strict mode): the first look keeps nothing, and the second sees its own events', async () => {
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    const first = vi.fn<() => void>();
    const stopFirst = store.subscribe(first);
    await fake.answer([]);
    fake.deliver(CREATED_EVENT, session('a'));
    stopFirst();
    const told = first.mock.calls.length;
    const second = vi.fn<() => void>();
    store.subscribe(second);
    await fake.answer([session('b')]);
    second.mockClear();
    fake.deliver(CREATED_EVENT, session('c'));
    fake.frames.tick();
    expect(first).toHaveBeenCalledTimes(told);
    expect(second).toHaveBeenCalledTimes(1);
    expect(ids(store)).toEqual(['b', 'c']);
    expect(fake.handlers()).toBe(5);
    expect(fake.frames.cancelled()).toBe(1);
  });
});

describe('a press is for the session its button was drawn for', () => {
  const later = '2026-11-24T12:00:00Z';

  /** `a` is shown; then the host says that another session took its id, and the frame that draws that one has not come: the button on the screen is the first session's. `seen` is which session that is. */
  async function replaced(patch: Record<string, unknown> = {}): Promise<Rig & { readonly seen: number }> {
    const rig = await ready([session('a')]);
    const seen = rig.store.getSnapshot().rows[0].session;
    rig.fake.deliver(CREATED_EVENT, session('a', { created_at: later, ...patch }));
    return { ...rig, seen };
  }

  it('does not stop the session that took the id: the host is not called for the press of the old button, and is called for the press of the button drawn for the new session', async () => {
    const { fake, store, seen } = await replaced();
    store.stop('a', seen);
    expect(fake.closed()).toEqual([]);
    fake.frames.tick();
    const now = store.getSnapshot().rows[0].session;
    expect(now).not.toBe(seen);
    store.stop('a', seen);
    expect(fake.closed()).toEqual([]);
    store.stop('a', now);
    expect(fake.closed()).toEqual(['a']);
  });

  it('does not open or copy the address of the session that took the id: the press carries the session it was drawn for', async () => {
    const { fake, store, seen } = await replaced({ local_port: 9000, local_host: '127.0.0.1' });
    store.open('a', seen);
    store.copy('a', seen);
    await settle();
    expect(fake.opened).toEqual([]);
    expect(fake.copied).toEqual([]);
    fake.frames.tick();
    const now = store.getSnapshot().rows[0].session;
    fake.serve([listening('a', { created_at: later, local_port: 9000 })]);
    store.open('a', now);
    store.copy('a', now);
    await settle();
    expect(fake.opened).toEqual(['http://127.0.0.1:9000']);
    expect(fake.copied).toEqual(['127.0.0.1:9000']);
  });

  it('is for the same session when only its local port changed: the button that was drawn still acts, at the address the row has now', async () => {
    const { fake, store } = await ready([listening('a')]);
    const seen = store.getSnapshot().rows[0].session;
    fake.deliver(CREATED_EVENT, listening('a', { local_port: 9000 }));
    fake.serve([listening('a', { local_port: 9000 })]);
    store.open('a', seen);
    await settle();
    expect(fake.opened).toEqual(['http://127.0.0.1:9000']);
    fake.frames.tick();
    expect(store.getSnapshot().rows[0].session).toBe(seen);
  });
});

describe('the check mark of Copy address', () => {
  const later = '2026-11-24T12:00:00Z';

  it('is not on a row for a session that took the id before the host answered: the address was written at the press, the mark is not shown, and the words say that the forward is not running', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.serve([session('a', { created_at: later })]);
    store.copy('a');
    fake.emit(CREATED_EVENT, session('a', { created_at: later }));
    await settle();
    expect(fake.copied).toEqual(['8081']);
    expect(store.getSnapshot().copied).toBeUndefined();
    expect(fake.timers()).toBe(0);
    expect(store.getSnapshot().announcement?.text).toBe('Copied, but the forward is not running.');
  });

  it('is not on a row whose address changed while the host was asked: the first write is kept, and nothing more is said or written', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.serve([session('a', { local_port: 9000 })]);
    store.copy('a');
    fake.emit(CREATED_EVENT, session('a', { local_port: 9000 }));
    await settle();
    expect(fake.copied).toEqual(['8081']);
    expect(store.getSnapshot().copied).toBeUndefined();
    expect(fake.timers()).toBe(0);
    expect(store.getSnapshot().announcement?.text).toBe('Port copied');
  });

  it('is for the address that was copied, for two seconds: it goes when the row changes within them, and the timer with it', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.serve([session('a')]);
    store.copy('a');
    await settle();
    expect(store.getSnapshot().copied).toBe('a');
    expect(fake.timers()).toBe(1);
    fake.emit(CREATED_EVENT, session('a', { local_port: 9000 }));
    expect(store.getSnapshot().copied).toBeUndefined();
    expect(fake.timers()).toBe(0);
  });

  it('asks for a timer of two seconds, and not for another time', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.serve([session('a')]);
    store.copy('a');
    await settle();
    expect(fake.delays()).toEqual([2_000]);
    fake.fire();
    expect(store.getSnapshot().copied).toBeUndefined();
  });
});

describe('a plugin that stops while the list is being read', () => {
  it('makes the answer of the read that began before it older than the event: it is not taken, and a row the plugin did not hold when it stopped is not kept for it', async () => {
    const { fake, store } = await ready([]);
    fake.emit(CONNECTION_EVENT);
    fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'crashed' });
    await fake.answer([session('a')]);
    expect(ids(store)).toEqual([]);
    await fake.answer([]);
    expect(ids(store)).toEqual([]);
  });
});

describe('a store that was left while it was reading', () => {
  it('asks the host nothing when the last listener leaves while the answer that queued another read is taken', async () => {
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    let leave: () => void = () => undefined;
    leave = store.subscribe(() => {
      leave();
    });
    store.retry();
    await fake.answer([session('a')]);
    expect(fake.listed()).toBe(1);
  });

  it('asks the host nothing when the last listener leaves while it is told that Try again is reading', async () => {
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    let leaving = false;
    let leave: () => void = () => undefined;
    leave = store.subscribe(() => {
      if (leaving) {
        leave();
      }
    });
    await fake.fail(new Error('down'));
    leaving = true;
    store.retry();
    expect(fake.listed()).toBe(1);
  });
});

describe('what is said aloud when forwards close in one frame', () => {
  it('says each of them, in the order they closed: the words are queued, and the rows are still one snapshot', async () => {
    const { fake, store } = await ready([session('a'), session('b', { local_port: 8082 })]);
    store.stop('a');
    store.stop('b');
    const shown = store.getSnapshot();
    fake.deliver(CLOSED_EVENT, session('a'));
    fake.deliver(CLOSED_EVENT, session('b', { local_port: 8082 }));
    expect(store.getSnapshot()).toBe(shown);
    fake.frames.tick();
    expect(store.getSnapshot().announcement?.text).toBe('Stopped port 8081 → :8080/TCP. Stopped port 8082 → :8080/TCP');
    expect(ids(store)).toEqual([]);
  });
});

describe('a list that says nothing of when a forward was made', () => {
  const later = '2026-11-24T12:00:00Z';

  it('does not undo the time that is known: a row is not moved by a read that gives no time for it, and the rows stay in the order of the times', async () => {
    const { fake, store } = await ready([session('a', { created_at: later }), session('b', { created_at: '2026-11-24T11:00:00Z' })]);
    expect(ids(store)).toEqual(['b', 'a']);
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a', { created_at: undefined }), session('b', { created_at: '2026-11-24T11:00:00Z' })]);
    expect(ids(store)).toEqual(['b', 'a']);
  });

  it('keeps a Stop that was on its way for the session it was pressed for: the later session that took the id does not lose its row to the answer', async () => {
    const { fake, store } = await ready([session('a')]);
    store.stop('a');
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a', { created_at: undefined })]);
    fake.emit(CREATED_EVENT, session('a', { created_at: later }));
    await fake.closeAnswer(0);
    expect(words(store)).toEqual(['a Running']);
  });

  it('keeps a press bound to the session it was drawn for: a button drawn for the first acts on nothing once another took the id', async () => {
    const { fake, store } = await ready([session('a')]);
    const seen = store.getSnapshot().rows[0].session;
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a', { created_at: undefined })]);
    fake.deliver(CREATED_EVENT, session('a', { created_at: later, local_port: 9000 }));
    store.open('a', seen);
    store.copy('a', seen);
    await settle();
    expect(fake.opened).toEqual([]);
    expect(fake.copied).toEqual([]);
  });
});

describe('a connection that changes while the list is being read', () => {
  it('makes the answer of the read that began before it older than the event: a forward it says runs may be one the connection ended, and a read that then fails leaves nothing of it', async () => {
    const { fake, store } = await ready([]);
    fake.emit(CONNECTION_EVENT);
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a')]);
    expect(ids(store)).toEqual([]);
    await fake.fail(new Error('down'));
    expect(ids(store)).toEqual([]);
  });

  it('takes the answer of the read that began after the last event: it is the truth', async () => {
    const { fake, store } = await ready([]);
    fake.emit(CONNECTION_EVENT);
    await fake.answer([session('a')]);
    expect(ids(store)).toEqual(['a']);
  });
});

describe('an events connection that comes back after a gap', () => {
  it('reads the list again, so that a forward made and one stopped while it was down show and go, which no event said', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.reconnected.fire();
    expect(fake.listed()).toBe(2);
    await fake.answer([session('b', { local_port: 9000 })]);
    expect(ids(store)).toEqual(['b']);
  });

  it('makes an answer that began before it older than it: the read that follows is the truth', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(CONNECTION_EVENT);
    fake.reconnected.fire();
    await fake.answer([session('a')]);
    expect(ids(store)).toEqual(['a']);
    await fake.answer([session('b')]);
    expect(ids(store)).toEqual(['b']);
  });

  it('is listened to while the tool is looked at and not otherwise: one listener, and none after the last subscriber leaves', () => {
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    expect(fake.reconnected.listeners()).toBe(0);
    const stop = store.subscribe(() => undefined);
    expect(fake.reconnected.listeners()).toBe(1);
    stop();
    expect(fake.reconnected.listeners()).toBe(0);
  });
});

describe('a window that comes back to a person', () => {
  it('reads the list again, for what no event says: a tunnel that ended on its own is Failed when somebody looks', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.woken.fire();
    expect(fake.listed()).toBe(2);
    await fake.answer([session('a', { state: 'FAILED' })]);
    expect(words(store)).toEqual(['a Failed']);
  });

  it('asks once for a burst of focus and visibility: a question while a read is on its way is one more read, not one for each', async () => {
    const { fake } = await ready([session('a')]);
    fake.woken.fire();
    fake.woken.fire();
    fake.woken.fire();
    expect(fake.listed()).toBe(2);
    await fake.answer([session('a')]);
    expect(fake.listed()).toBe(3);
    await fake.answer([session('a')]);
    expect(fake.listed()).toBe(3);
  });

  it('is listened to only while the tool is looked at, and starts no timer and asks for no frame', async () => {
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    expect(fake.woken.listeners()).toBe(0);
    const stop = store.subscribe(() => undefined);
    await fake.answer([session('a')]);
    fake.woken.fire();
    await fake.answer([session('a')]);
    expect(fake.woken.listeners()).toBe(1);
    expect(fake.timers()).toBe(0);
    expect(fake.frames.requested()).toBe(0);
    stop();
    expect(fake.woken.listeners()).toBe(0);
  });
});

describe('before Open in browser or Copy acts', () => {
  // Open in browser asks the host first and acts after: the runtime's call needs no user gesture. Copy writes what it copies inside the press (the producer states a host here, so it is an address), because a window that is WebKit lets a page write to the clipboard only while
  // the gesture of the press lasts, and asks the host meanwhile: what the host says is what is told, and the check mark waits for it. `early` is how many times the action has been made at the press, before the host answers.
  const ACTIONS = [
    {
      name: 'Open in browser',
      press: (store: PortsStore, session?: number) => {
        store.open('a', session);
      },
      done: (fake: FakePorts) => fake.opened,
      said: 'Not opened: the forward is not running.',
      at: 'http://127.0.0.1:9000',
      early: 0,
    },
    {
      name: 'Copy',
      press: (store: PortsStore, session?: number) => {
        store.copy('a', session);
      },
      done: (fake: FakePorts) => fake.copied,
      said: 'Copied, but the forward is not running.',
      at: '127.0.0.1:9000',
      early: 1,
    },
  ] as const;

  describe.each(ACTIONS)('$name', ({ press, done, said, at, early }) => {
    it('asks the host for the list once more: the press is the moment the person trusts the row', async () => {
      const { fake, store } = await ready([listening('a', { local_port: 9000 })]);
      press(store);
      await settle();
      expect(fake.listed()).toBe(2);
      expect(done(fake)).toHaveLength(early);
      await fake.answer([listening('a', { local_port: 9000 })]);
      expect(done(fake)).toEqual([at]);
    });

    it('tells that the forward is not running when the host says it failed: the row shows what the host said, and an announcement says so', async () => {
      const { fake, store } = await ready([listening('a')]);
      press(store);
      await fake.answer([listening('a', { state: 'FAILED' })]);
      expect(done(fake)).toHaveLength(early);
      expect(words(store)).toEqual(['a Failed']);
      expect(store.getSnapshot().announcement?.text).toBe(said);
      expect(store.getSnapshot().copied).toBeUndefined();
    });

    it('tells that the forward is not running when the host no longer lists it: the row goes, and an announcement says so', async () => {
      const { fake, store } = await ready([listening('a')]);
      press(store);
      await fake.answer([]);
      expect(done(fake)).toHaveLength(early);
      expect(ids(store)).toEqual([]);
      expect(store.getSnapshot().announcement?.text).toBe(said);
    });

    it('tells that the forward is not running when another session took the id: the press was for the first', async () => {
      const { fake, store } = await ready([listening('a')]);
      press(store);
      await fake.answer([listening('a', { created_at: '2026-11-24T12:00:00Z', local_port: 9000 })]);
      expect(done(fake)).toHaveLength(early);
      expect(words(store)).toEqual(['a Running']);
      expect(store.getSnapshot().announcement?.text).toBe(said);
    });

    it('does not ask the host, and does nothing, for a press that is not for the session shown: a button drawn for the first session acts on nothing', async () => {
      const { fake, store } = await ready([listening('a')]);
      const seen = store.getSnapshot().rows[0].session;
      fake.deliver(CREATED_EVENT, listening('a', { created_at: '2026-11-24T12:00:00Z' }));
      press(store, seen);
      await settle();
      expect(fake.listed()).toBe(1);
      expect(done(fake)).toEqual([]);
    });

    it('goes on with the row that was pressed when the host cannot be asked: there is nothing better to go on, and nothing is said of it', async () => {
      const { fake, store } = await ready([listening('a', { local_port: 9000 })]);
      press(store);
      await fake.fail(new Error('down'));
      expect(done(fake)).toEqual([at]);
      expect(store.getSnapshot().announcement?.text).not.toBe(said);
    });

    it('says nothing when the tool is left before the host answers', async () => {
      const { fake, store, stop } = await ready([listening('a')]);
      press(store);
      stop();
      await fake.answer([listening('a')]);
      expect(done(fake)).toHaveLength(early);
      expect(store.getSnapshot().announcement).toBeUndefined();
    });

    it('tells that the forward is not running when it was closed while the read failed: the events say what the host cannot, and a press is not for a row that is gone', async () => {
      const { fake, store } = await ready([listening('a')]);
      press(store);
      fake.emit(CLOSED_EVENT, listening('a'));
      await fake.fail(new Error('down'));
      expect(done(fake)).toHaveLength(early);
      expect(store.getSnapshot().announcement?.text).toBe(said);
    });

    it('does not take an older answer over a newer read that has landed: the press asks again, and follows the later answer', async () => {
      const { fake, store } = await ready([listening('a')]);
      press(store);
      fake.woken.fire();
      await fake.answer([listening('a', { state: 'FAILED' })], 1);
      expect(words(store)).toEqual(['a Failed']);
      await fake.answer([listening('a')], 0);
      expect(words(store)).toEqual(['a Failed']);
      await fake.answer([listening('a', { state: 'FAILED' })]);
      expect(done(fake)).toHaveLength(early);
      expect(store.getSnapshot().announcement?.text).toBe(said);
    });

    it('does not trust the row the events held when one came while the host was being asked: the connection that changed may have ended it, and the host is asked again', async () => {
      const { fake, store } = await ready([listening('a')]);
      fake.serve([listening('a', { state: 'FAILED' })]);
      press(store);
      fake.emit(CONNECTION_EVENT);
      await settle();
      expect(done(fake)).toHaveLength(early);
      expect(words(store)).toEqual(['a Failed']);
      expect(store.getSnapshot().announcement?.text).toBe(said);
    });

    it('still goes on when an event that does not touch the forward came while the host was being asked: the host is asked again, and says it runs', async () => {
      const { fake, store } = await ready([listening('a', { local_port: 9000 })]);
      fake.serve([listening('a', { local_port: 9000 }), session('b')]);
      press(store);
      fake.emit(CREATED_EVENT, session('b'));
      await settle();
      expect(done(fake)).toEqual([at]);
    });
  });

  describe('Open in browser', () => {
    it('acts on the address the host says now, for the same session: a local port that was assigned meanwhile is the one', async () => {
      const { fake, store } = await ready([listening('a', { local_port: 8081 })]);
      store.open('a');
      await fake.answer([listening('a', { local_port: 9000 })]);
      expect(fake.opened).toEqual(['http://127.0.0.1:9000']);
    });
  });

  describe('Copy', () => {
    it('writes what it knows inside the press, before the host answers: the write needs the gesture of the press, which the host\'s answer would outlast', async () => {
      const { fake, store } = await ready([listening('a')]);
      store.copy('a');
      expect(fake.copied).toEqual(['127.0.0.1:8081']);
      expect(fake.listed()).toBe(2);
      expect(store.getSnapshot().copied).toBeUndefined();
    });

    it('marks the row and says that it was copied once the host says that the forward runs, and not before: the mark waits for the host', async () => {
      const { fake, store } = await ready([listening('a')]);
      store.copy('a');
      await settle();
      expect(store.getSnapshot().copied).toBeUndefined();
      expect(store.getSnapshot().announcement).toBeUndefined();
      await fake.answer([listening('a')]);
      expect(store.getSnapshot()).toMatchObject({ copied: 'a', announcement: { text: 'Address copied' } });
      expect(fake.timers()).toBe(1);
    });

    it('keeps the first write when the forward runs at another address and says nothing more: no mark, and no second write', async () => {
      const { fake, store } = await ready([listening('a', { local_port: 8081 })]);
      store.copy('a');
      await fake.answer([listening('a', { local_port: 9000 })]);
      expect(fake.copied).toEqual(['127.0.0.1:8081']);
      expect(store.getSnapshot().copied).toBeUndefined();
      expect(fake.timers()).toBe(0);
      expect(store.getSnapshot().announcement?.text).toBe('Address copied');
    });

    it('says only that the clipboard refused when it did, whatever the host says: a write that failed is the one thing to tell', async () => {
      const { fake, store } = await ready([listening('a')]);
      fake.clipboard.works = false;
      store.copy('a');
      await fake.answer([listening('a', { state: 'FAILED' })]);
      expect(store.getSnapshot().announcement?.text).toBe('Couldn\'t copy the address');
      expect(store.getSnapshot().copied).toBeUndefined();
    });
  });
});

describe('a store that cannot listen to the host', () => {
  /** A host whose second registration of an event throws: the first has been made, and taking it back is what is owed. */
  function failing(): { readonly fake: FakePorts; readonly store: PortsStore } {
    const fake = fakePorts();
    let calls = 0;
    const store = createPortsStore({
      ...fake.deps,
      events: {
        On: (name, listener) => {
          calls += 1;
          if (calls === 2) {
            throw new Error('the events are not there');
          }

          return fake.deps.events.On(name, listener);
        },
      },
    });
    return { fake, store };
  }

  it('takes back what it had registered: the first registration is removed when the second throws, and nothing is left listening', () => {
    const { fake, store } = failing();
    expect(() => store.subscribe(() => undefined)).toThrow('the events are not there');
    expect(fake.on()).toBe(1);
    expect(fake.off()).toBe(1);
    expect(fake.handlers()).toBe(0);
    expect(store.getSnapshot().status).toBe('loading');
  });

  it('is not left with a subscriber that cannot be taken off: the next subscriber starts it again', () => {
    const { fake, store } = failing();
    expect(() => store.subscribe(() => undefined)).toThrow('the events are not there');
    const stop = store.subscribe(() => undefined);
    expect(fake.handlers()).toBe(5);
    expect(fake.listed()).toBe(1);
    stop();
    expect(fake.handlers()).toBe(0);
  });
});

describe('a plugin that runs again while the events connection is down', () => {
  it('is not left stopped by the window: the list that the reconnect reads names forwards of it, so it serves, and its rows are Running with their actions', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'crashed' });
    await fake.answer([]);
    expect(words(store)).toEqual(['a Stopped']);
    fake.reconnected.fire();
    await fake.answer([session('b', { local_port: 9000 })]);
    expect(words(store)).toEqual(['b Running']);
    expect(store.getSnapshot().rows[0].reason).toBeUndefined();
  });

  it('keeps the rows of a plugin that is still stopped when the connection comes back: the list says nothing of it', async () => {
    const { fake, store } = await ready([session('a')]);
    fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'crashed' });
    await fake.answer([]);
    fake.reconnected.fire();
    await fake.answer([]);
    expect(words(store)).toEqual(['a Stopped']);
  });
});

describe('where a forward listens, as the producer states it', () => {
  const hosted = (patch: Record<string, unknown> = {}): Record<string, unknown> => session('a', { local_port: 3000, local_host: '127.0.0.1', ...patch });
  const plain = (): Record<string, unknown> => session('a', { local_port: 3000 });

  it('never opens a forward whose host is not stated: Open in browser is unavailable, the host is not asked and nothing is opened', async () => {
    const { fake, store } = await ready([plain()]);
    store.open('a');
    await settle();
    expect(fake.listed()).toBe(1);
    expect(fake.opened).toEqual([]);
  });

  it('opens a forward that states a loopback host at that host and port, once the host has said that it still runs', async () => {
    const { fake, store } = await ready([hosted()]);
    fake.serve([hosted()]);
    store.open('a');
    await settle();
    expect(fake.opened).toEqual(['http://127.0.0.1:3000']);
  });

  it('brackets an IPv6 host when it opens', async () => {
    const { fake, store } = await ready([hosted({ local_host: '::1' })]);
    fake.serve([hosted({ local_host: '::1' })]);
    store.open('a');
    await settle();
    expect(fake.opened).toEqual(['http://[::1]:3000']);
  });

  it('does not open a forward that listens beyond this computer', async () => {
    const { fake, store } = await ready([hosted({ local_host: '0.0.0.0' })]);
    store.open('a');
    await settle();
    expect(fake.listed()).toBe(1);
    expect(fake.opened).toEqual([]);
  });

  it('copies the port alone for a forward whose host is not stated, and says Port copied', async () => {
    const { fake, store } = await ready([plain()]);
    fake.serve([plain()]);
    store.copy('a');
    expect(fake.copied).toEqual(['3000']);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ copied: 'a', announcement: { text: 'Port copied' } });
  });

  it('copies host and port for a forward that states a host, and says Address copied', async () => {
    const { fake, store } = await ready([hosted()]);
    fake.serve([hosted()]);
    store.copy('a');
    expect(fake.copied).toEqual(['127.0.0.1:3000']);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ copied: 'a', announcement: { text: 'Address copied' } });
  });

  it('says that it could not copy the port, or the address, by what it copied', async () => {
    const bare = await ready([plain()]);
    bare.fake.serve([plain()]);
    bare.fake.clipboard.works = false;
    bare.store.copy('a');
    await settle();
    expect(bare.store.getSnapshot().announcement?.text).toBe('Couldn\'t copy the port');
    const stated = await ready([hosted()]);
    stated.fake.serve([hosted()]);
    stated.fake.clipboard.works = false;
    stated.store.copy('a');
    await settle();
    expect(stated.store.getSnapshot().announcement?.text).toBe('Couldn\'t copy the address');
  });

  it('names a forward by its port when it says that one was stopped: no host is invented', async () => {
    const { fake, store } = await ready([plain()]);
    store.stop('a');
    await fake.closeAnswer(0);
    expect(store.getSnapshot().announcement?.text).toBe('Stopped port 3000 → :8080/TCP');
  });
});
