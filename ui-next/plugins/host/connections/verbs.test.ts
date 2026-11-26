import type { AppError } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, it, vi } from 'vitest';
import { unusedVerbs } from '../homeTesting';
import type { ConnectionsApi, StartStatus, StateRecord } from './api';
import { createConnectionsStore } from './store';
import { createConnectionVerbs } from './verbs';

// The verbs of a plugin's page (verbs.ts) over the real store and the real question, with the host's calls as mocks the test settles: what each verb asks of the host, what the list says while it runs, what a second verb is told, and what
// the person is asked. No runtime, no host, no React: the dialog is the question's snapshot, answered by `confirm` and `cancel`.

const record = (id: string, readiness: string): StateRecord => ({ connection: { id, name: id, description: `${id} description` }, readiness });
const envelope = (detail: string): AppError => ({ type: 'omniview:internal', title: 'Operation failed', status: 500, detail });
const wails = (body: AppError): Error => Object.assign(new Error(JSON.stringify(body)), { cause: body });

async function build(reach = { tabs: 0, sessions: 0 }) {
  let listed: StateRecord[] = [record('north', 'CONNECTED'), record('south', 'DISCONNECTED')];
  const api = {
    ...unusedVerbs,
    states: vi.fn(async () => Promise.resolve({ acme: listed })),
    start: vi.fn<ConnectionsApi['start']>(async () => Promise.resolve({ status: 'CONNECTED' })),
    check: vi.fn<ConnectionsApi['check']>(),
    stop: vi.fn<ConnectionsApi['stop']>(),
    remove: vi.fn<ConnectionsApi['remove']>(),
    onStatus: () => () => undefined,
    onSync: () => () => undefined,
  } satisfies ConnectionsApi;
  const store = createConnectionsStore(api);
  await store.refresh();
  const verbs = createConnectionVerbs({ store, api, reach: () => reach });
  return {
    api,
    store,
    verbs,
    /** What the host lists from now on. */
    list: (...next: StateRecord[]) => {
      listed = next;
    },
    busyOf: (key: string) => store.getSnapshot().connections.find((entry) => entry.key === key)?.busy,
  };
}

const BUSY_CHECKING = 'north is being checked. Try again when it has finished.';
const CONNECTING = 'south is connecting. Try again when it has finished.';

describe('check', () => {
  it('asks the plugin while the connection is marked busy, reads the list again, and answers ok for a healthy connection and the sentence for one that is not', async () => {
    const { api, store, verbs, busyOf } = await build();
    const answer = Promise.withResolvers<StartStatus>();
    api.check.mockReturnValueOnce(answer.promise);
    const reads = api.states.mock.calls.length;

    const checked = verbs.check('acme', 'north');

    expect(api.check).toHaveBeenCalledExactlyOnceWith('acme', 'north');
    expect(busyOf('north')).toBe('checking');
    answer.resolve({ status: 'CONNECTED' });
    await expect(checked).resolves.toEqual({ ok: true });
    expect(api.states.mock.calls.length).toBe(reads + 1);
    expect(busyOf('north')).toBeUndefined();
    expect(store.getSnapshot().connections[0]).toMatchObject({ key: 'north', state: 'connected' });

    api.check.mockResolvedValueOnce({ status: 'UNAUTHORIZED' });
    await expect(verbs.check('acme', 'north')).resolves.toEqual({ ok: false, reason: 'The connection needs you to sign in.' });
  });

  it('says the host\'s line when the check threw, and lets the connection go all the same', async () => {
    const { api, verbs, busyOf } = await build();
    api.check.mockRejectedValueOnce(wails(envelope('The plugin did not answer.')));

    await expect(verbs.check('acme', 'north')).resolves.toEqual({ ok: false, reason: 'The plugin did not answer.' });

    expect(busyOf('north')).toBeUndefined();
  });
});

describe('a second verb', () => {
  it('is refused in a sentence while one runs on the connection, with no question asked and no call made; the other connections are free', async () => {
    const { api, verbs, busyOf } = await build();
    const answer = Promise.withResolvers<StartStatus>();
    api.check.mockReturnValueOnce(answer.promise);
    const first = verbs.check('acme', 'north');

    for (const verb of ['connect', 'check', 'disconnect', 'remove'] as const) {
      await expect(verbs[verb]('acme', 'north'), verb).resolves.toEqual({ ok: false, reason: BUSY_CHECKING });
    }

    expect(verbs.questions.getSnapshot()).toBeNull();
    expect(api.check).toHaveBeenCalledTimes(1);
    for (const call of [api.start, api.stop, api.remove]) {
      expect(call).not.toHaveBeenCalled();
    }

    api.check.mockResolvedValueOnce({ status: 'DISCONNECTED' });
    await expect(verbs.check('acme', 'south')).resolves.toEqual({ ok: false, reason: 'The connection is not connected.' });
    answer.resolve({ status: 'CONNECTED' });
    await expect(first).resolves.toEqual({ ok: true });
    expect(busyOf('north')).toBeUndefined();
  });

  it('is refused for a disconnect while the connection is connecting, whether this window started it or the host says it is running: nothing is asked, and the host\'s stop is not left waiting behind the start', async () => {
    const { api, verbs, store, list } = await build();
    const start = Promise.withResolvers<StartStatus>();
    api.start.mockReturnValueOnce(start.promise);
    const connecting = verbs.connect('acme', 'south');

    await expect(verbs.disconnect('acme', 'south')).resolves.toEqual({ ok: false, reason: CONNECTING });

    start.resolve({ status: 'CONNECTED' });
    await connecting;
    list(record('north', 'PENDING'), record('south', 'CONNECTED'));
    await store.refresh();
    await expect(verbs.disconnect('acme', 'north')).resolves.toEqual({ ok: false, reason: 'north is connecting. Try again when it has finished.' });
    expect(verbs.questions.getSnapshot()).toBeNull();
    expect(api.stop).not.toHaveBeenCalled();
  });
});

describe('disconnect', () => {
  it('asks first, in the host\'s dialog, naming the connection and what it reaches: a no stops nothing and is answered cancelled, a yes stops it with the connection marked busy while it runs', async () => {
    const { api, verbs, busyOf } = await build({ tabs: 2, sessions: 1 });
    const stopped = Promise.withResolvers<unknown>();
    api.stop.mockReturnValueOnce(stopped.promise);

    const no = verbs.disconnect('acme', 'north');
    expect(verbs.questions.getSnapshot()).toMatchObject({
      title: 'Disconnect',
      confirmLabel: 'Disconnect',
      tone: 'danger',
      subject: { name: 'north', kind: 'Connection', meta: 'north description', status: { label: 'Connected' } },
      message: '2 open tabs and 1 session of north will lose the connection. You can connect again at any time.',
      busy: false,
    });
    verbs.questions.cancel();

    await expect(no).resolves.toEqual({ ok: false, reason: 'Cancelled.', cancelled: true });
    expect(api.stop).not.toHaveBeenCalled();
    expect(verbs.questions.getSnapshot()).toBeNull();

    const yes = verbs.disconnect('acme', 'north');
    verbs.questions.confirm();
    expect(api.stop).toHaveBeenCalledExactlyOnceWith('acme', 'north');
    expect(verbs.questions.getSnapshot()?.busy).toBe(true);
    expect(busyOf('north')).toBe('disconnecting');
    stopped.resolve(undefined);

    await expect(yes).resolves.toEqual({ ok: true });
    expect(verbs.questions.getSnapshot()).toBeNull();
    expect(busyOf('north')).toBeUndefined();
  });

  it('keeps the dialog open with the host\'s line when the stop fails: the person tries again and it works, or leaves and the plugin is told what failed, not that they said no', async () => {
    const { api, verbs } = await build();
    const failed = { busy: false, error: 'The server did not stop in time.' };
    api.stop.mockRejectedValueOnce(wails(envelope('The server did not stop in time.'))).mockResolvedValueOnce(undefined).mockRejectedValueOnce(wails(envelope('The server did not stop in time.')));

    const retried = verbs.disconnect('acme', 'north');
    expect(verbs.questions.getSnapshot()?.message).toBe('Stops browsing north. You can connect again at any time.');
    verbs.questions.confirm();
    await vi.waitFor(() => {
      expect(verbs.questions.getSnapshot()).toMatchObject(failed);
    });
    verbs.questions.confirm();
    await expect(retried).resolves.toEqual({ ok: true });
    expect(api.stop).toHaveBeenCalledTimes(2);

    const left = verbs.disconnect('acme', 'north');
    verbs.questions.confirm();
    await vi.waitFor(() => {
      expect(verbs.questions.getSnapshot()).toMatchObject(failed);
    });
    verbs.questions.cancel();
    await expect(left).resolves.toEqual({ ok: false, reason: 'The server did not stop in time.' });
  });

  it('leaves the stop running when the person leaves the dialog while it does, and answers what the stop comes to', async () => {
    const { api, verbs, busyOf } = await build();
    const stopped = Promise.withResolvers<unknown>();
    api.stop.mockReturnValueOnce(stopped.promise);
    const asked = verbs.disconnect('acme', 'north');
    verbs.questions.confirm();

    verbs.questions.cancel();

    expect(verbs.questions.getSnapshot()).toBeNull();
    expect(busyOf('north')).toBe('disconnecting');
    stopped.resolve(undefined);
    await expect(asked).resolves.toEqual({ ok: true });
    expect(busyOf('north')).toBeUndefined();
  });
});

describe('remove', () => {
  it('asks first, in the danger tone, and removes the connection from the plugin\'s list once the person says yes: the list is read again and no longer has it', async () => {
    const { api, store, verbs, list } = await build();
    api.remove.mockImplementationOnce(async () => {
      list(record('south', 'DISCONNECTED'));
      return Promise.resolve();
    });

    const asked = verbs.remove('acme', 'north');
    expect(verbs.questions.getSnapshot()).toMatchObject({ title: 'Remove connection', confirmLabel: 'Remove', tone: 'danger', message: 'Removes north from your connection list. Nothing it points to is changed.' });
    verbs.questions.confirm();

    await expect(asked).resolves.toEqual({ ok: true });
    expect(api.remove).toHaveBeenCalledExactlyOnceWith('acme', 'north');
    expect(store.getSnapshot().connections.map((entry) => entry.key)).toEqual(['south']);
  });
});

describe('the question', () => {
  it('is one at a time: a verb that needs an answer while the dialog is open is refused', async () => {
    const { verbs } = await build();
    const first = verbs.disconnect('acme', 'north');

    await expect(verbs.remove('acme', 'south')).resolves.toEqual({ ok: false, reason: 'Another question is waiting for an answer.' });

    verbs.questions.cancel();
    await first;
  });
});

describe('connect', () => {
  it('starts the connection and opens nothing: ok when it is connected, and the host\'s line when the start failed', async () => {
    const { api, verbs } = await build();

    await expect(verbs.connect('acme', 'south')).resolves.toEqual({ ok: true });
    expect(api.start).toHaveBeenCalledExactlyOnceWith('acme', 'south');

    api.start.mockRejectedValueOnce(wails(envelope('The server refused the connection.')));
    await expect(verbs.connect('acme', 'south')).resolves.toEqual({ ok: false, reason: 'The server refused the connection.' });
  });
});
