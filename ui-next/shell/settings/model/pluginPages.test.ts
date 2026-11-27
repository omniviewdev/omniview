import { describe, expect, it } from 'vitest';
import { deferred, manualClock, SENTINEL } from '../../core/fields/testing';
import { createSettingsSession, type ScopeSession, type SettingsSession } from './session';
import { fakeHost, setting } from './testing';
import type { HostSnapshot, SettingsClient, SettingsPlugin } from './types';

const metadata = (id: string, name = id): SettingsPlugin => ({ id, name, description: `About ${name}`, icon: 'LuBox' });
const field = (key: string, value = '') => setting(key, 'text', `Label ${key}`, '', value);
const scope = (pluginId: string) => ({ kind: 'plugin', pluginId } as const);

function plugin(session: SettingsSession, id: string): ScopeSession {
  const page = session.plugins.getSnapshot().entries.find((entry) => entry.pluginId === id);
  if (!page) {
    throw new Error(`Missing plugin ${id}`);
  }

  return page.session;
}

function ready(session: ScopeSession) {
  const state = session.getState();
  if (state.phase !== 'ready') {
    throw new Error(`Unexpected phase: ${state.phase}`);
  }

  return state;
}

describe('installed settings providers', () => {
  it('discovers each installed schema without blocking Core, and publishes no settings for an empty or redacted provider', async () => {
    const host = fakeHost();
    host.plugin(metadata('one', 'Zeta'), [field('limits.cpu'), setting('api.token', 'password', 'API token', '', '')]);
    host.plugin(metadata('two', 'Alpha'), []);
    const pending = deferred<readonly SettingsPlugin[]>();
    const clock = manualClock();
    const session = createSettingsSession({ client: { ...host.client, inventory: async () => pending.promise }, scheduler: clock.scheduler });
    await clock.flush();
    expect(ready(session).model.pages.length).toBeGreaterThan(0);
    expect(session.plugins.getSnapshot()).toEqual({ phase: 'loading', entries: [] });
    const published: number[] = [];
    session.plugins.subscribe(() => published.push(session.plugins.getSnapshot().entries.filter((entry) => entry.session.getState().phase === 'ready').length));
    pending.resolve(await host.client.inventory());
    await clock.flush();
    expect(session.plugins.getSnapshot().entries.map(({ id, title }) => [id, title])).toEqual([['plugin/two', 'Alpha'], ['plugin/one', 'Zeta']]);
    expect(host.pluginCalls.snapshot).toEqual(['one', 'two']);
    expect(ready(plugin(session, 'one')).model.pages[0]?.fields).toEqual(['limits.cpu']);
    expect(ready(plugin(session, 'two')).model.pages).toEqual([]);
    expect(published.at(-1)).toBe(2);
    expect(host.listeners()).toBe(1);
    expect(host.inventoryListeners()).toBe(1);
    session.dispose();
    expect(host.listeners()).toBe(0);
    expect(host.inventoryListeners()).toBe(0);
    expect(host.reconnectListeners()).toBe(0);
  });

  it('validates and persists a changed dotted key in exactly one plugin, even when host and sibling use the same key', async () => {
    const host = fakeHost();
    const key = 'appearance.theme';
    host.plugin(metadata('appearance'), [{ ...field(key, 'blue'), requiresRestart: true }]);
    host.plugin(metadata('sibling'), [field(key, 'green')]);
    const clock = manualClock();
    const open = () => createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    const session = open();
    await clock.flush();
    const form = ready(plugin(session, 'appearance')).form;
    expect(await plugin(session, 'appearance').resetMaterial()).toBe(false);
    form.setValue(key, 'violet');
    expect((await form.commit(key)).status).toBe('applied');
    await clock.flush();
    expect(host.pluginCalls.validate).toEqual([['appearance', key, 'violet']]);
    expect(host.pluginCalls.commit).toEqual([['appearance', { [key]: 'violet' }]]);
    expect(form.field(key)).toMatchObject({ value: 'violet', dirty: false, pendingRestart: true });
    expect(ready(plugin(session, 'sibling')).form.field(key)?.value).toBe('green');
    expect(ready(session).form.field(key)?.value).toBe('void');
    expect(host.calls).toEqual({ snapshot: 1, validate: [], commit: [] });
    session.dispose();
    const reopened = open();
    await clock.flush();
    expect(ready(plugin(reopened, 'appearance')).form.field(key)?.value).toBe('violet');
    reopened.dispose();
  });

  it('validates and saves a multi-file setting as an array and rejects scalar writes', async () => {
    const host = fakeHost();
    const fileSelection = { enabled: true, multiple: true, allowFolders: false, relative: false };
    host.plugin(metadata('cluster'), [setting('config.files', 'text', 'Config files', '', ['~/.config/one'], { fileSelection })]);
    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    await clock.flush();
    const form = ready(plugin(session, 'cluster')).form;
    expect(form.field('config.files')?.value).toEqual(['~/.config/one']);
    expect(form.setValue('config.files', '/not-a-list')).toEqual({ status: 'refused', reason: 'type' });
    const paths = ['~/path with spaces/one', '/srv/two'];
    const edit = form.setValue('config.files', paths);
    expect(edit.status === 'set' && (await edit.commit)?.status).toBe('applied');
    await clock.flush();
    expect(host.pluginCalls.validate).toEqual([['cluster', 'config.files', paths]]);
    expect(host.pluginCalls.commit).toEqual([['cluster', { 'config.files': paths }]]);
    expect((await host.client.snapshot(scope('cluster'))).categories.plugin?.settings['config.files']?.value).toEqual(paths);
    session.dispose();
  });

  it('keeps provider keys opaque even when a key is an object member or cannot be a form id', async () => {
    const host = fakeHost();
    const keys = ['__proto__', 'constructor', 'toString', '~1', 'one\ntwo', 'x'.repeat(300)];
    host.plugin(metadata('opaque'), keys.map((id, index) => ({ ...field(id), label: `Field ${index}` })));
    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    await clock.flush();
    const { form } = ready(plugin(session, 'opaque'));
    for (const [index, key] of keys.entries()) {
      const id = form.getSnapshot().fields.find((one) => one.label === `Field ${index}`)!.id;
      form.setValue(id, 'nondefault');
      await form.commit(id);
      await clock.flush();
      expect(host.pluginCalls.validate.at(-1)).toEqual(['opaque', key, 'nondefault']);
      expect(Object.entries(host.pluginCalls.commit.at(-1)![1])).toEqual([[key, 'nondefault']]);
      expect(form.field(id)?.dirty).toBe(false);
    }

    session.dispose();
  });

  it('follows a provider-ready event that arrives while an older initial read is still failing', async () => {
    const host = fakeHost();
    host.plugin(metadata('starting'), [field('ready')]);
    const stale = deferred<HostSnapshot>();
    let failFirst = true;
    const client: SettingsClient = {
      ...host.client,
      snapshot: async (which) => {
        if (which.kind === 'plugin' && failFirst) {
          failFirst = false;
          return stale.promise;
        }

        return host.client.snapshot(which);
      },
    };
    const clock = manualClock();
    const session = createSettingsSession({ client, scheduler: clock.scheduler });
    await clock.flush();
    const child = plugin(session, 'starting');
    await host.client.commit(scope('starting'), { ready: 'online' });
    stale.reject(new Error('Provider was not ready.'));
    await clock.flush();
    expect(ready(child).form.field('ready')?.value).toBe('online');
    session.dispose();
  });

  it('keeps the search index stable on a refresh with no metadata, phase or schema changes', async () => {
    const host = fakeHost();
    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    await clock.flush();
    const empty = session.plugins.getSnapshot();
    session.refresh();
    await clock.flush();
    expect(session.plugins.getSnapshot()).toBe(empty);
    host.plugin(metadata('unchanged'), [field('x')]);
    await clock.flush();
    const populated = session.plugins.getSnapshot();
    session.refresh();
    await clock.flush();
    expect(session.plugins.getSnapshot()).toBe(populated);
    session.dispose();
  });

  it('refreshes only the scope named by a change, preserves its draft, and follows all installed scopes on reconnect', async () => {
    const host = fakeHost();
    for (const id of ['a', 'b']) {
      host.plugin(metadata(id), [field('raw.key', 'old')]);
    }

    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    await clock.flush();
    const a = plugin(session, 'a');
    const original = ready(a).form;
    original.setValue('raw.key', 'draft');
    host.pluginCalls.snapshot.length = 0;
    await host.client.commit(scope('a'), { 'raw.key': 'elsewhere' });
    await clock.flush();
    expect(host.pluginCalls.snapshot).toEqual(['a']);
    expect(host.calls.snapshot).toBe(1);
    expect(ready(a).form).toBe(original);
    expect(original.field('raw.key')).toMatchObject({ value: 'draft', dirty: true });
    expect(a.elsewhere.getSnapshot()).toEqual({ 'raw.key': 'elsewhere' });
    expect(ready(plugin(session, 'b')).form.field('raw.key')?.value).toBe('old');
    host.change('general.language', 'es');
    await clock.flush();
    expect(host.pluginCalls.snapshot).toEqual(['a']);
    host.reconnect();
    await clock.flush();
    expect(host.calls.snapshot).toBe(3);
    expect(host.pluginCalls.inventory).toBe(2);
    expect(host.pluginCalls.snapshot).toEqual(['a', 'a', 'b']);
    session.dispose();
  });

  it('replaces a reclassified schema and disposes removed forms, without reusing drafts or displaying old public values', async () => {
    const host = fakeHost();
    const one = metadata('provider', 'Name');
    host.plugin(one, [field('credential')]);
    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    await clock.flush();
    const child = plugin(session, 'provider');
    const first = ready(child).form;
    await host.client.commit(scope('provider'), { credential: SENTINEL });
    await clock.flush();
    expect(first.field('credential')?.value).toBe(SENTINEL);
    host.plugin({ ...one, name: 'Renamed' }, [setting('credential', 'text', 'Credential', '', '', { sensitive: true }), field('new.key')]);
    await clock.flush();
    expect(plugin(session, 'provider')).toBe(child);
    const next = ready(child);
    expect(next.model.pages[0]?.fields).toEqual(['new.key']);
    expect(JSON.stringify(next.model)).not.toContain(SENTINEL);
    expect(JSON.stringify(next.form.getSnapshot())).not.toContain(SENTINEL);
    expect(first.setValue('credential', 'stale')).toMatchObject({ status: 'refused', reason: 'disposed' });
    expect(session.plugins.getSnapshot().entries[0]?.title).toBe('Renamed');
    host.removePlugin('provider');
    await clock.flush();
    expect(session.plugins.getSnapshot().entries).toEqual([]);
    expect(next.form.setValue('new.key', 'stale')).toMatchObject({ status: 'refused', reason: 'disposed' });
    session.dispose();
  });

  it('ignores an overtaken inventory read and a late settings answer from a removed provider', async () => {
    const host = fakeHost();
    const one = metadata('installed');
    const old = deferred<readonly SettingsPlugin[]>();
    const late = deferred<HostSnapshot>();
    let reads = 0;
    const client: SettingsClient = {
      ...host.client,
      inventory: async () => ++reads === 1 ? old.promise : host.client.inventory(),
      snapshot: async (which) => which.kind === 'plugin' ? late.promise : host.client.snapshot(which),
    };
    const clock = manualClock();
    const session = createSettingsSession({ client, scheduler: clock.scheduler });
    host.plugin(one, [field('value')]);
    await clock.flush();
    const child = plugin(session, 'installed');
    expect(child.getState().phase).toBe('loading');
    host.removePlugin('installed');
    await clock.flush();
    late.resolve({ categories: {} });
    old.resolve([one]);
    await clock.flush();
    expect(session.plugins.getSnapshot().entries).toEqual([]);
    expect(child.getState().phase).toBe('loading');
    session.dispose();
    expect(clock.pending()).toBe(0);
  });

  it('recovers independently from inventory and provider failures without guessing a schema', async () => {
    const host = fakeHost();
    host.plugin(metadata('sometimes'), [field('real')]);
    let inventoryDown = true;
    let pluginDown = true;
    const clock = manualClock();
    const client: SettingsClient = {
      ...host.client,
      inventory: async () => {
        if (inventoryDown) {
          throw new Error('Offline');
        }

        return host.client.inventory();
      },
      snapshot: async (which) => {
        if (pluginDown && which.kind === 'plugin') {
          throw new Error('Unavailable');
        }

        return host.client.snapshot(which);
      },
    };
    const session = createSettingsSession({ client, scheduler: clock.scheduler });
    await clock.flush();
    expect(session.getState().phase).toBe('ready');
    expect(session.plugins.getSnapshot()).toEqual({ phase: 'failed', entries: [] });
    inventoryDown = false;
    session.plugins.refresh();
    await clock.flush();
    const child = plugin(session, 'sometimes');
    expect(child.getState().phase).toBe('failed');
    pluginDown = false;
    child.load();
    await clock.flush();
    expect(ready(child).model.pages[0]?.fields).toEqual(['real']);
    pluginDown = true;
    child.refresh();
    await clock.flush();
    expect(child.getState().phase).toBe('failed');
    session.dispose();
  });
});
