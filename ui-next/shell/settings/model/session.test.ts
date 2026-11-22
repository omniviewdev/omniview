import { describe, expect, it } from 'vitest';
import { deferred, manualClock, SENTINEL, type ManualClock } from '../../core/fields/testing';
import type { FieldState } from '../../core/fields';
import { createSettingsSession, type SettingsSession } from './session';
import { fakeHost, hostSnapshot, type FakeHost } from './testing';
import type { HostCommit, HostSnapshot } from './types';

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

function ready(session: SettingsSession) {
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
    await host.client.commit({ 'telemetry.loki_auth_value': 'x' });
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
