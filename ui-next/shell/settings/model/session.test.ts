import { describe, expect, it } from 'vitest';
import { committed, deferred, manualClock, SENTINEL, type ManualClock } from '../../core/fields/testing';
import type { FieldState } from '../../core/fields';
import { createSettingsSession, type ScopeSession, type SettingsSession } from './session';
import { category, fakeHost, hostSnapshot, setting, type FakeHost } from './testing';
import { HOST_SCOPE, type HostCommit, type HostSetting, type HostSnapshot, type SettingsClient } from './types';

// The session is the sheet's whole dealing with the host: it reads the snapshot, makes the form from it, sends what the person changes (one setting at a time, as it is changed), asks the host about a typed value,
// and follows what changes elsewhere. These tests run the REAL form model over a host that answers from memory (`testing.ts`); nothing here is a mock of the model.

type Rig = { readonly session: SettingsSession; readonly host: FakeHost; readonly clock: ManualClock };

async function rig(initial: Record<string, unknown> = {}, stored: Record<string, boolean> = {}): Promise<Rig> {
  const host = fakeHost(initial, stored);
  const clock = manualClock();
  const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
  await clock.flush();
  return { session, host, clock };
}

function ready(session: ScopeSession) {
  const state = session.getState();
  if (state.phase !== 'ready') {
    throw new Error(`the session is ${state.phase}`);
  }

  return state;
}

const fieldOf = (session: SettingsSession, id: string): FieldState => {
  const field = ready(session).form.field(id);
  if (field === undefined) {
    throw new Error(`no field ${id}`);
  }

  return field;
};

describe('loading', () => {
  it('starts loading, asks the host once, and is ready with the host\'s values and the pages', async () => {
    const host = fakeHost({ 'editor.fontSize': 14 });
    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    expect(session.getState().phase).toBe('loading');
    await clock.flush();
    const state = ready(session);
    expect(host.calls.snapshot).toBe(1);
    expect(state.model.pages.map((page) => page.id)).toEqual(['appearance', 'general', 'editor', 'terminal', 'telemetry', 'developer']);
    expect(fieldOf(session, 'editor.fontSize').value).toBe(14);
    expect(fieldOf(session, 'editor.folding').value).toBe(true);
    expect(state.form.getSnapshot().mode).toBe('apply-on-change');
  });

  it('fails when the host does not answer, and Retry asks again', async () => {
    const host = fakeHost();
    host.next.snapshot = async () => Promise.reject(new Error('down'));
    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    await clock.flush();
    expect(session.getState().phase).toBe('failed');
    session.load();
    expect(session.getState().phase).toBe('loading');
    await clock.flush();
    expect(session.getState().phase).toBe('ready');
    expect(host.calls.snapshot).toBe(2);
  });

  it('tells the people who watch it, once for each change of phase', async () => {
    const host = fakeHost();
    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    const phases: string[] = [session.getState().phase];
    session.subscribe(() => phases.push(session.getState().phase));
    await clock.flush();
    expect(phases).toEqual(['loading', 'ready']);
  });

  it('refetches when the host says something changed while it was loading, so what it shows is not older than the event', async () => {
    const host = fakeHost();
    const first = deferred<HostSnapshot>();
    host.next.snapshot = async () => first.promise;
    const clock = manualClock();
    createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    host.change('editor.fontSize', 20);
    first.resolve(hostSnapshot());
    await clock.flush();
    expect(host.calls.snapshot).toBe(2);
  });

  it('still retries a failed replacement read of Core without publishing the superseded snapshot', async () => {
    const host = fakeHost();
    const first = deferred<HostSnapshot>();
    host.next.snapshot = async () => first.promise;
    const clock = manualClock();
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    host.change('editor.fontSize', 20);
    host.next.snapshot = async () => {
      throw new Error('Offline');
    };

    first.resolve(hostSnapshot());
    await clock.flush();
    expect(session.getState().phase).toBe('failed');
    await clock.advance(500);
    expect(fieldOf(session, 'editor.fontSize').value).toBe(20);
    expect(host.calls.snapshot).toBe(3);
    session.dispose();
  });
});

describe('plugin snapshot handoff', () => {
  const provider = { id: 'provider', name: 'Provider', description: '', icon: '' };
  const name = setting('name', 'text', 'Name', '', 'original');
  const enabled = setting('enabled', 'toggle', 'Enabled', '', false);
  const scope = { kind: 'plugin', pluginId: provider.id } as const;
  const snapshot = (...fields: HostSetting[]): HostSnapshot => ({ categories: { plugin: category('plugin', 'Plugin', '', '', fields) } });

  async function open(fields: HostSetting[], customize: (client: SettingsClient) => Partial<SettingsClient>) {
    const host = fakeHost();
    host.plugin(provider, fields);
    const clock = manualClock();
    const session = createSettingsSession({ client: { ...host.client, ...customize(host.client) }, scheduler: clock.scheduler });
    await clock.flush();
    const entry = session.plugins.getSnapshot().entries.find((item) => item.pluginId === provider.id);
    if (!entry) {
      throw new Error('Expected the plugin page.');
    }

    return { session, page: entry.session, clock, host };
  }

  it('acknowledges a persisted write without confirming the draft, and retries only the snapshot', async () => {
    const warning = 'Settings were saved, but the provider is reloading. Its current view is unavailable.';
    const readback = deferred<HostSnapshot>();
    const writes: Array<Readonly<Record<string, unknown>>> = [];
    let reads = 0;
    const { session, page, clock } = await open([name], (client) => ({
      commit: async (_scope, values) => {
        writes.push(values);
        // No changed event arrives. The missing readback alone requires another read.
        return { snapshot: { categories: {} }, applied: true, uncertain: false, message: warning };
      },
      snapshot: async (which) => {
        if (which.kind === 'plugin' && ++reads > 1) {
          return reads === 2 ? readback.promise : snapshot({ ...name, value: 'canonical' });
        }

        return client.snapshot(which);
      },
    }));
    const { form } = ready(page);
    const confirmed: unknown[] = [];
    form.subscribe(() => {
      const field = form.field('name')!;
      if (!field.dirty) {
        confirmed.push(field.value);
      }
    });
    form.setValue('name', SENTINEL);
    expect(await form.commit('name')).toEqual({ status: 'applied' });
    expect(confirmed).not.toContain(SENTINEL);
    expect(page.getState()).toEqual({ phase: 'loading', warning });
    expect(reads).toBe(2);
    expect(form.setValue('name', 'stale')).toEqual({ status: 'refused', reason: 'disposed' });
    expect(session.getState().phase).toBe('ready');

    readback.reject(new Error('Provider restarting.'));
    await clock.flush();
    expect(page.getState()).toEqual({ phase: 'failed', warning });
    page.load();
    expect(page.getState()).toEqual({ phase: 'loading', warning });
    await clock.flush();
    expect(ready(page).form.field('name')).toMatchObject({ value: 'canonical', dirty: false });
    expect(writes).toEqual([{ name: SENTINEL }]);
    expect(reads).toBe(3);
    session.dispose();
  });

  it('finishes the accepted save before replacing a reloaded schema, without waiting for another read', async () => {
    const accepted = deferred<HostCommit>();
    const writes: Array<Readonly<Record<string, unknown>>> = [];
    const { session, page, host } = await open([enabled], () => ({
      commit: async (_scope, values) => {
        writes.push(values);
        return accepted.promise;
      },
    }));
    const { form } = ready(page);
    const order: string[] = [];
    form.subscribeTo((state) => state.fields.some((field) => field.busy), (busy) => {
      if (!busy) {
        order.push('settled');
      }
    });
    page.subscribe(() => {
      if (page.getState().phase === 'ready') {
        order.push('replaced');
      }
    });
    const first = committed(form.setValue('enabled', true));
    const queued = committed(form.reset('enabled'));
    accepted.resolve({ snapshot: snapshot({ ...enabled, value: true }, name), applied: true, uncertain: false, message: '' });
    expect(await first).toEqual({ status: 'applied' });
    expect(await queued).toEqual({ status: 'refused', reason: 'disposed' });
    expect(order).toEqual(['settled', 'replaced']);
    expect(form.setValue('enabled', false)).toEqual({ status: 'refused', reason: 'disposed' });
    const next = ready(page);
    expect(next.form.field('enabled')).toMatchObject({ value: true, dirty: false });
    expect(next.form.field('name')?.value).toBe('original');
    expect(writes).toEqual([{ enabled: true }]);
    expect(host.pluginCalls.snapshot).toEqual([provider.id]);
    session.dispose();
  });

  it('never publishes an initial schema superseded by a change, even while its replacement fails and retries', async () => {
    const first = deferred<HostSnapshot>();
    const second = deferred<HostSnapshot>();
    let reads = 0;
    const { session, page, host, clock } = await open([name], (client) => ({
      snapshot: async (which) => {
        if (which.kind === 'plugin') {
          reads += 1;
          if (reads === 1) {
            return first.promise;
          }

          if (reads === 2) {
            return second.promise;
          }
        }

        return client.snapshot(which);
      },
    }));
    const published: string[][] = [];
    page.subscribe(() => {
      const state = page.getState();
      if (state.phase === 'ready') {
        published.push(state.form.getSnapshot().fields.map((field) => field.id));
      }
    });
    await host.client.commit(scope, { name: 'fresh' });
    first.resolve(snapshot(enabled));
    await clock.flush();
    expect(reads).toBe(2);
    expect(page.getState().phase).toBe('loading');
    expect(published).toEqual([]);
    second.reject(new Error('Provider restarting.'));
    await clock.flush();
    expect(page.getState().phase).toBe('failed');
    page.load();
    await clock.flush();
    expect(published).toEqual([['name']]);
    expect(ready(page).form.field('name')?.value).toBe('fresh');
    session.dispose();
  });
});

describe('a setting that applies when it is chosen', () => {
  it('is sent to the host as the one id and its value, and is the field\'s applied value afterwards', async () => {
    const { session, host, clock } = await rig();
    const result = ready(session).form.setValue('editor.folding', false);
    expect(result.status).toBe('set');
    await clock.flush();
    expect(host.calls.commit).toEqual([{ 'editor.folding': false }]);
    expect(host.values.get('editor.folding')).toBe(false);
    expect(fieldOf(session, 'editor.folding')).toMatchObject({ value: false, dirty: false });
    expect(fieldOf(session, 'editor.folding').message).toBeUndefined();
    expect(fieldOf(session, 'editor.folding').modified).toBe(true);
  });

  it('is asked of the host only when it is typed: a choice is never validated', async () => {
    const { session, host, clock } = await rig();
    ready(session).form.setValue('general.language', 'es');
    await clock.flush();
    expect(host.calls.validate).toEqual([]);
    expect(host.calls.commit).toEqual([{ 'general.language': 'es' }]);
  });
});

describe('material reset', () => {
  it('serializes one group transaction, without locking unrelated settings or sending a second reset', async () => {
    const host = fakeHost({ 'appearance.windowMaterial': 'glass', 'appearance.menuOpacity': 55 });
    const clock = manualClock();
    const release = deferred<void>();
    const client: SettingsClient = {
      ...host.client,
      commit: async (scope, values) => {
        if (Object.keys(values).length > 1) {
          await release.promise;
        }

        return host.client.commit(scope, values);
      },
    };
    const session = createSettingsSession({ client, scheduler: clock.scheduler });
    await clock.flush();
    const { form } = ready(session);
    const reset = session.resetMaterial();
    expect(form.setValue('appearance.menuOpacity', 61)).toEqual({ status: 'refused', reason: 'locked' });
    expect(await session.resetMaterial()).toBe(false);
    form.setValue('appearance.density', 'compact');
    await clock.flush();
    release.resolve();
    expect(await reset).toBe(true);
    await clock.flush();
    expect(host.calls.commit).toEqual([
      { 'appearance.density': 'compact' },
      { 'appearance.windowMaterial': 'opaque', 'appearance.glassStyle': 'regular', 'appearance.chromeOpacity': 62, 'appearance.contentOpacity': 94, 'appearance.menuOpacity': 90, 'appearance.sheetOpacity': 96 },
    ]);
    expect(fieldOf(session, 'appearance.density').value).toBe('compact');
    expect(fieldOf(session, 'appearance.windowMaterial').value).toBe('opaque');
    expect(await session.resetMaterial()).toBe(false);
    expect(host.calls.commit).toHaveLength(2);
    session.dispose();
  });

  it('leaves the applied values intact after a refusal, and restores the controls for another attempt', async () => {
    const { session, host } = await rig({ 'appearance.windowMaterial': 'translucent', 'appearance.contentOpacity': 32 });
    host.next.commit = async () => {
      throw new Error('unreachable');
    };

    expect(await session.resetMaterial()).toBe(false);
    expect(fieldOf(session, 'appearance.contentOpacity')).toMatchObject({ value: 32, enabled: true, dirty: false });
    expect(await session.resetMaterial()).toBe(true);
    expect(fieldOf(session, 'appearance.contentOpacity')).toMatchObject({ value: 94, enabled: false });
    session.dispose();
  });
});

describe('a setting that is typed', () => {
  it('is asked of the host when it is committed, and then sent', async () => {
    const { session, host, clock } = await rig();
    const { form } = ready(session);
    form.setValue('developer.marketplace_url', 'https://mkt.example.com');
    expect(host.calls.commit).toEqual([]);
    await form.commit('developer.marketplace_url');
    await clock.flush();
    expect(host.calls.validate).toEqual([['developer.marketplace_url', 'https://mkt.example.com']]);
    expect(host.calls.commit).toEqual([{ 'developer.marketplace_url': 'https://mkt.example.com' }]);
    expect(fieldOf(session, 'developer.marketplace_url')).toMatchObject({ dirty: false, validation: 'valid' });
  });

  it('says the host\'s own words when it refuses the value, keeps what was typed, and sends nothing', async () => {
    const { session, host, clock } = await rig();
    host.next.validate = () => ({ valid: false, code: 'port_range', message: 'Enter a whole-number port from 0 to 65535.' });
    const { form } = ready(session);
    form.setValue('developer.pprof_port', '70000');
    await form.commit('developer.pprof_port');
    await clock.flush();
    const field = fieldOf(session, 'developer.pprof_port');
    expect(field.message).toMatchObject({ kind: 'error', text: 'Enter a whole-number port from 0 to 65535.' });
    expect(field.value).toBe(70_000);
    expect(field.dirty).toBe(true);
    expect(host.calls.commit).toEqual([]);
    expect(host.values.has('developer.pprof_port')).toBe(false);
  });

  it('says "Couldn\'t check" with Retry when the host cannot be asked, and applies nothing', async () => {
    const { session, host, clock } = await rig();
    host.next.validate = async () => Promise.reject(new Error('unreachable'));
    const { form } = ready(session);
    form.setValue('developer.gopath', '/usr/local/go/bin/go');
    await form.commit('developer.gopath');
    await clock.flush();
    expect(fieldOf(session, 'developer.gopath').message).toMatchObject({ kind: 'retry', retry: true });
    expect(host.calls.commit).toEqual([]);
  });

  it('keeps the typed text and offers Retry when the host cannot save it, in words that are never the host\'s raw text', async () => {
    const { session, host, clock } = await rig();
    host.next.commit = async () => Promise.reject(new Error('Settings could not be saved. Check the values and try again.'));
    const { form } = ready(session);
    form.setValue('terminal.defaultShell', '/bin/fish');
    await form.commit('terminal.defaultShell');
    await clock.flush();
    const field = fieldOf(session, 'terminal.defaultShell');
    expect(field.value).toBe('/bin/fish');
    expect(field.message).toMatchObject({ kind: 'error', retry: true });
    expect(field.message?.text).not.toContain('Check the values');
    // Retry asks again and succeeds.
    await form.retry('terminal.defaultShell');
    await clock.flush();
    expect(host.values.get('terminal.defaultShell')).toBe('/bin/fish');
    expect(fieldOf(session, 'terminal.defaultShell').dirty).toBe(false);
  });

  it('takes the value the host says it stored when that is not what was sent', async () => {
    const { session, host, clock } = await rig();
    host.next.commit = async () => ({ snapshot: hostSnapshot({ 'developer.marketplace_url': 'https://canonical.example.com' }), applied: true, uncertain: false, message: '' });
    const { form } = ready(session);
    form.setValue('developer.marketplace_url', ' https://canonical.example.com ');
    await form.commit('developer.marketplace_url');
    await clock.flush();
    expect(fieldOf(session, 'developer.marketplace_url')).toMatchObject({ value: 'https://canonical.example.com', dirty: false });
  });
});

describe('refresh', () => {
  it('asks the host again and gives the form what it holds now, as when a hidden window is shown', async () => {
    const { session, host, clock } = await rig();
    host.values.set('editor.fontSize', 19);
    session.refresh();
    await clock.flush();
    expect(host.calls.snapshot).toBe(2);
    expect(fieldOf(session, 'editor.fontSize').value).toBe(19);
  });

  it('does nothing before the first load has finished', async () => {
    const host = fakeHost();
    const clock = manualClock();
    const first = deferred<HostSnapshot>();
    host.next.snapshot = async () => first.promise;
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    session.refresh();
    expect(host.calls.snapshot).toBe(1);
  });
});

describe('what a screen reader is told', () => {
  it('is a new error raised on commit, once, as "Field: message" (S127), in the session\'s own live message', async () => {
    const { session, host, clock } = await rig();
    expect(session.announcements.getSnapshot()).toEqual({ text: '', serial: 0 });
    const heard: string[] = [];
    session.announcements.subscribe(() => heard.push(session.announcements.getSnapshot().text));
    host.next.validate = () => ({ valid: false, message: 'Enter a whole-number port from 0 to 65535.' });
    const { form } = ready(session);
    form.setValue('developer.pprof_port', '70000');
    await form.commit('developer.pprof_port');
    await clock.flush();
    expect(heard).toEqual(['Host profiling port: Enter a whole-number port from 0 to 65535.']);
    expect(session.announcements.getSnapshot().serial).toBe(1);
  });
});

describe('a change the host saved but could not apply', () => {
  const unapplied = (uncertain: boolean): (() => Promise<HostCommit>) => async () => ({ snapshot: hostSnapshot({ 'terminal.fontSize': 16 }), applied: uncertain, uncertain, message: 'Settings were saved but could not be applied.' });

  it('waits for a restart: the lane says so and the value stays', async () => {
    const { session, host, clock } = await rig();
    host.next.commit = unapplied(false);
    const { form } = ready(session);
    form.setValue('terminal.fontSize', '16');
    await form.commit('terminal.fontSize');
    await clock.flush();
    const field = fieldOf(session, 'terminal.fontSize');
    expect(field.value).toBe(16);
    expect(field.pendingRestart).toBe(true);
    // "Saved." says what happened for two seconds, and then the standing note says what is left to do.
    expect(field.message).toMatchObject({ kind: 'saved' });
    await clock.advance(2_000);
    expect(fieldOf(session, 'terminal.fontSize').message).toMatchObject({ kind: 'restart', text: 'Restart required to apply.' });
  });

  it('is the same when the host is not sure it applied it', async () => {
    const { session, host, clock } = await rig();
    host.next.commit = unapplied(true);
    const { form } = ready(session);
    form.setValue('terminal.fontSize', '17');
    await form.commit('terminal.fontSize');
    await clock.flush();
    expect(fieldOf(session, 'terminal.fontSize').pendingRestart).toBe(true);
  });

  it('is what the host says of a setting that declares a restart: the pending flag of its snapshot', async () => {
    const { session, host, clock } = await rig();
    const { form } = ready(session);
    form.setValue('developer.pprof_enabled', true);
    await clock.flush();
    expect(host.pendingRestart.has('developer.pprof_enabled')).toBe(true);
    expect(fieldOf(session, 'developer.pprof_enabled')).toMatchObject({ pendingRestart: true, message: { kind: 'restart' } });
    // Put back to what it was at start, nothing waits.
    ready(session).form.setValue('developer.pprof_enabled', false);
    host.pendingRestart.delete('developer.pprof_enabled');
    await clock.flush();
    expect(fieldOf(session, 'developer.pprof_enabled').pendingRestart).toBe(false);
  });
});

describe('a change made elsewhere while the sheet is open', () => {
  it('moves a field that has no draft: the host says it changed, the session asks, the field follows', async () => {
    const { session, host, clock } = await rig();
    host.change('editor.fontSize', 16);
    await clock.flush();
    expect(host.calls.snapshot).toBe(2);
    expect(fieldOf(session, 'editor.fontSize')).toMatchObject({ value: 16, dirty: false });
    expect(session.elsewhere.getSnapshot()).toEqual({});
  });

  it('leaves a field that has a draft as the person typed it, and says it changed', async () => {
    const { session, host, clock } = await rig();
    const { form } = ready(session);
    form.setValue('editor.fontSize', '18');
    host.change('editor.fontSize', 16);
    await clock.flush();
    const field = fieldOf(session, 'editor.fontSize');
    expect(field.value).toBe(18);
    expect(field.dirty).toBe(true);
    expect(session.elsewhere.getSnapshot()).toEqual({ 'editor.fontSize': 16 });
    // Escape puts back what the host holds now, which is the other change, and the note goes with the draft.
    form.revert('editor.fontSize');
    expect(fieldOf(session, 'editor.fontSize')).toMatchObject({ value: 16, dirty: false });
    expect(session.elsewhere.getSnapshot()).toEqual({});
  });

  it('does not say it for a change the person made themselves: their own commit makes the host say it changed', async () => {
    const { session, host, clock } = await rig();
    const { form } = ready(session);
    form.setValue('terminal.fontSize', '15');
    await form.commit('terminal.fontSize');
    await clock.flush();
    expect(host.calls.snapshot).toBeGreaterThanOrEqual(2);
    expect(fieldOf(session, 'terminal.fontSize')).toMatchObject({ value: 15, dirty: false });
    expect(session.elsewhere.getSnapshot()).toEqual({});
  });

  it('never puts back an older value: two questions asked for two changes and answered in the other order leave the form on the newer answer', async () => {
    const { session, host, clock } = await rig();
    const older = deferred<HostSnapshot>();
    host.next.snapshot = async () => older.promise;
    // The first change asks and its answer is held; the second asks and the host answers it at once with what it holds now.
    host.change('editor.fontSize', 12);
    host.change('editor.fontSize', 16);
    await clock.flush();
    expect(fieldOf(session, 'editor.fontSize').value).toBe(16);
    // The older answer lands last: it is not what the host holds, and the form is not given it.
    older.resolve(hostSnapshot({ 'editor.fontSize': 12 }));
    await clock.flush();
    expect(fieldOf(session, 'editor.fontSize').value).toBe(16);
  });

  it('never puts back an older value: an answer to a question asked before the person\'s own change reached the host is dropped, and asked again', async () => {
    const { session, host, clock } = await rig();
    const { form } = ready(session);
    const stale = deferred<HostSnapshot>();
    host.next.snapshot = async () => stale.promise;
    host.change('editor.fontSize', 12);
    // The person commits another value while the host's answer is on its way.
    form.setValue('developer.marketplace_url', 'https://mkt.example.com');
    await form.commit('developer.marketplace_url');
    await clock.flush();
    stale.resolve(hostSnapshot({ 'editor.fontSize': 12 }));
    await clock.flush();
    expect(fieldOf(session, 'developer.marketplace_url').value).toBe('https://mkt.example.com');
    expect(host.values.get('developer.marketplace_url')).toBe('https://mkt.example.com');
    expect(fieldOf(session, 'editor.fontSize').value).toBe(12);
  });
});

describe('secrets', () => {
  it('start from the host\'s fact that one is saved, and a snapshot never carries what it is', async () => {
    const { session } = await rig({}, { 'telemetry.auth_value': true });
    expect(fieldOf(session, 'telemetry.auth_value').secret).toEqual({ presence: 'set', changed: false });
    expect(fieldOf(session, 'telemetry.loki_auth_value').secret).toEqual({ presence: 'unset', changed: false });
  });

  it('are sent once, as typed, and the host\'s fact then says one is saved; the form holds no copy of it', async () => {
    const { session, host, clock } = await rig();
    const { form } = ready(session);
    form.setValue('telemetry.auth_value', SENTINEL);
    await form.commit('telemetry.auth_value');
    await clock.flush();
    expect(host.calls.commit).toEqual([{ 'telemetry.auth_value': SENTINEL }]);
    expect(fieldOf(session, 'telemetry.auth_value').secret).toEqual({ presence: 'set', changed: false });
    expect(JSON.stringify(form.getSnapshot())).not.toContain(SENTINEL);
    expect(JSON.stringify(form.serialise())).not.toContain(SENTINEL);
    expect(form.stats().secrets).toBe(0);
  });

  it('are cleared by saving nothing, and then the host says none is saved', async () => {
    const { session, host, clock } = await rig({}, { 'telemetry.auth_value': true });
    const { form } = ready(session);
    form.setValue('telemetry.auth_value', '');
    await form.commit('telemetry.auth_value');
    await clock.flush();
    expect(host.calls.commit).toEqual([{ 'telemetry.auth_value': '' }]);
    expect(fieldOf(session, 'telemetry.auth_value').secret).toEqual({ presence: 'unset', changed: false });
  });

  it('follow the host when another window sets or clears one', async () => {
    const { session, host, clock } = await rig();
    await host.client.commit(HOST_SCOPE, { 'telemetry.loki_auth_value': 'x' });
    await clock.flush();
    expect(fieldOf(session, 'telemetry.loki_auth_value').secret?.presence).toBe('set');
  });
});

describe('disposing', () => {
  it('stops listening, drops a late answer and disposes the form', async () => {
    const host = fakeHost();
    const clock = manualClock();
    const late = deferred<HostSnapshot>();
    host.next.snapshot = async () => late.promise;
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    expect(host.listeners()).toBe(1);
    session.dispose();
    expect(host.listeners()).toBe(0);
    late.resolve(hostSnapshot());
    await clock.flush();
    expect(session.getState().phase).toBe('loading');
  });

  it('leaves no timer behind once the form it made is disposed', async () => {
    const { session, clock } = await rig();
    ready(session).form.setValue('editor.folding', false);
    await clock.flush();
    session.dispose();
    await clock.advance(10_000);
    expect(clock.pending()).toBe(0);
    expect(session.getState().phase).toBe('ready');
  });
});

describe('a secret typed while the other window changes it', () => {
  // The other window sets or clears the secret: only the host's fact about it moves (`stored`), there is no value to compare. What is typed stays, and the field says so without saying any text.
  const otherWindowClears = async (host: FakeHost, id: string): Promise<void> => {
    await host.client.commit(HOST_SCOPE, { [id]: '' });
    host.change(id, '');
  };

  it('keeps what was typed and says so, with no text in the note, until the draft goes', async () => {
    const { session, host, clock } = await rig({}, { 'telemetry.auth_value': true });
    const { form } = ready(session);
    form.setValue('telemetry.auth_value', SENTINEL);
    expect(fieldOf(session, 'telemetry.auth_value').secret).toEqual({ presence: 'set', changed: true });
    await otherWindowClears(host, 'telemetry.auth_value');
    await clock.flush();
    const notes = session.elsewhere.getSnapshot();
    expect(Object.hasOwn(notes, 'telemetry.auth_value')).toBe(true);
    expect(JSON.stringify(notes)).not.toContain(SENTINEL);
    expect(fieldOf(session, 'telemetry.auth_value').secret).toEqual({ presence: 'unset', changed: true });
    form.revert('telemetry.auth_value');
    await clock.flush();
    expect(session.elsewhere.getSnapshot()).toEqual({});
    expect(form.stats().secrets).toBe(0);
  });

  it('says nothing when the host\'s fact about the secret did not change', async () => {
    const { session, host, clock } = await rig({}, { 'telemetry.auth_value': true });
    ready(session).form.setValue('telemetry.auth_value', SENTINEL);
    host.change('editor.fontSize', 18);
    await clock.flush();
    expect(session.elsewhere.getSnapshot()).toEqual({});
  });
});

describe('a question the host did not answer', () => {
  // The host is a client's `snapshot` that can be told to fail; `asks` counts every question the session put to it (the first load is the first).
  async function rigDown() {
    const host = fakeHost({ 'editor.fontSize': 14 });
    const clock = manualClock();
    const down = { value: false, hang: false };
    let asks = 0;
    const client: SettingsClient = {
      ...host.client,
      snapshot: async (scope) => {
        asks += 1;
        if (down.hang) {
          return new Promise<HostSnapshot>(() => undefined);
        }

        if (down.value) {
          throw new Error('the host did not answer');
        }

        return host.client.snapshot(scope);
      },
    };
    const session = createSettingsSession({ client, scheduler: clock.scheduler });
    await clock.flush();
    return { session, host, clock, down, asks: () => asks };
  }

  it('asks again after the wait, when the newest question failed, and follows what it finds', async () => {
    const { session, host, clock, down, asks } = await rigDown();
    expect(asks()).toBe(1);
    down.value = true;
    host.change('editor.fontSize', 18);
    await clock.flush();
    expect(asks()).toBe(2);
    down.value = false;
    await clock.advance(499);
    expect(asks()).toBe(2);
    await clock.advance(1);
    await clock.flush();
    expect(asks()).toBe(3);
    expect(fieldOf(session, 'editor.fontSize').value).toBe(18);
  });

  it('waits 0.5, 1, 2, 4 and 8 seconds, five questions and 15.5 s in all, and then asks no more until it is told something', async () => {
    const { host, clock, down, asks } = await rigDown();
    down.value = true;
    host.change('editor.fontSize', 18);
    await clock.flush();
    expect(asks()).toBe(2);
    for (const [wait, total] of [[500, 3], [1000, 4], [2000, 5], [4000, 6], [8000, 7]] as const) {
      await clock.advance(wait - 1);
      expect(asks()).toBe(total - 1);
      await clock.advance(1);
      await clock.flush();
      expect(asks()).toBe(total);
    }

    await clock.advance(300_000);
    await clock.flush();
    expect(asks()).toBe(7);
    // What the host tells next asks again, and with a new budget of waits.
    host.change('editor.fontSize', 20);
    await clock.flush();
    expect(asks()).toBe(8);
    await clock.advance(500);
    await clock.flush();
    expect(asks()).toBe(9);
  });

  it('never applies an answer older than the newest question, also when the newest one failed: the older answer after the newest failure', async () => {
    const { session, host, clock, down } = await rigDown();
    const older = deferred<HostSnapshot>();
    host.next.snapshot = async () => older.promise;
    host.change('editor.fontSize', 16);
    await clock.flush();
    down.value = true;
    host.change('editor.fontSize', 18);
    await clock.flush();
    older.resolve(hostSnapshot({ 'editor.fontSize': 16 }));
    await clock.flush();
    // The older answer is what the host held before the change that the failed question was asked for.
    expect(fieldOf(session, 'editor.fontSize').value).toBe(14);
    down.value = false;
    await clock.advance(500);
    await clock.flush();
    expect(fieldOf(session, 'editor.fontSize').value).toBe(18);
  });

  it('counts a question the host does not answer within ten seconds as lost, and asks again after the first wait', async () => {
    const { session, host, clock, down, asks } = await rigDown();
    down.hang = true;
    host.change('editor.fontSize', 18);
    await clock.flush();
    expect(asks()).toBe(2);
    await clock.advance(9_999);
    expect(asks()).toBe(2);
    down.hang = false;
    await clock.advance(1);
    await clock.flush();
    expect(asks()).toBe(2);
    await clock.advance(499);
    expect(asks()).toBe(2);
    await clock.advance(1);
    await clock.flush();
    expect(asks()).toBe(3);
    expect(fieldOf(session, 'editor.fontSize').value).toBe(18);
  });

  it('starts no wait for a question that was overtaken, when its own deadline comes', async () => {
    const { host, clock, down, asks } = await rigDown();
    down.hang = true;
    host.change('editor.fontSize', 18);
    await clock.flush();
    down.hang = false;
    host.change('editor.fontSize', 20);
    await clock.flush();
    expect(asks()).toBe(3);
    await clock.advance(60_000);
    await clock.flush();
    expect(asks()).toBe(3);
  });

  it('leaves no deadline running when the session is disposed', async () => {
    const { session, host, clock, down, asks } = await rigDown();
    down.hang = true;
    host.change('editor.fontSize', 18);
    await clock.flush();
    session.dispose();
    down.hang = false;
    await clock.advance(60_000);
    await clock.flush();
    expect(asks()).toBe(2);
  });

  it('stops waiting when the session is disposed', async () => {
    const { session, host, clock, down, asks } = await rigDown();
    down.value = true;
    host.change('editor.fontSize', 18);
    await clock.flush();
    expect(asks()).toBe(2);
    session.dispose();
    await clock.advance(60_000);
    await clock.flush();
    expect(asks()).toBe(2);
  });

  it('is taken over by what the host tells while it waits: one question, and no second one when the wait is up', async () => {
    const { session, host, clock, down, asks } = await rigDown();
    down.value = true;
    host.change('editor.fontSize', 18);
    await clock.flush();
    down.value = false;
    host.change('editor.fontSize', 20);
    await clock.flush();
    expect(asks()).toBe(3);
    expect(fieldOf(session, 'editor.fontSize').value).toBe(20);
    await clock.advance(60_000);
    await clock.flush();
    expect(asks()).toBe(3);
  });
});

describe('the events connection of the page', () => {
  it('asks the host again when it comes back, and follows what was told while it was down', async () => {
    const { session, host, clock } = await rig({ 'editor.fontSize': 14 });
    // Told while the connection was down: the page heard no event.
    host.values.set('editor.fontSize', 18);
    host.reconnect();
    await clock.flush();
    expect(host.calls.snapshot).toBe(2);
    expect(fieldOf(session, 'editor.fontSize').value).toBe(18);
  });

  it('is listened to for as long as the session lives', async () => {
    const { session, host } = await rig();
    expect(host.reconnectListeners()).toBe(1);
    session.dispose();
    expect(host.reconnectListeners()).toBe(0);
  });

  it('asks once more after the first load when the connection came back while it was on its way', async () => {
    const host = fakeHost({ 'editor.fontSize': 14 });
    const clock = manualClock();
    const first = deferred<HostSnapshot>();
    host.next.snapshot = async () => first.promise;
    const session = createSettingsSession({ client: host.client, scheduler: clock.scheduler });
    host.reconnect();
    host.values.set('editor.fontSize', 18);
    first.resolve(hostSnapshot({ 'editor.fontSize': 14 }));
    await clock.flush();
    expect(host.calls.snapshot).toBe(2);
    expect(fieldOf(session, 'editor.fontSize').value).toBe(18);
  });
});
