import { compileSchema, createFormStore, sameValue, type FormStore, type Json, type RemoteValidator, type Scheduler, type SubmitOutcome, type SubmitPayload } from '../../core/fields';
import { modelOf, type SettingsModel } from './adapter';
import { MATERIAL_FIELDS, materialResetBlock, RESETTING_MATERIAL } from './material';
import { createPluginPages, type SettingsPlugins } from './pluginPages';
import { HOST_SCOPE, type HostSnapshot, type SettingsClient, type SettingsScope } from './types';

export type { PluginPage, PluginInventory } from './pluginPages';

// The session is Settings' whole dealing with the host: it reads the snapshot, makes the form from it (the model of ../../core/fields, in the mode of a setting: a value applies the moment it is chosen or committed),
// sends what the person changes one setting at a time, asks the host about a typed value, and follows what changes elsewhere. Plain TypeScript over the `SettingsClient` seam: no React, no DOM; its only timers are the form's own,
// on the scheduler it is given. One session lives from the opening of Settings (the sheet's, or the window's load) to its closing, and `dispose` leaves nothing behind.

type Loading = { readonly phase: 'loading'; readonly warning?: string };
type Replacement = { readonly model: SettingsModel; readonly key: string } | Loading;

export type SessionState =
  | Loading
  | { readonly phase: 'failed'; readonly warning?: string }
  | { readonly phase: 'ready'; readonly model: SettingsModel; readonly form: FormStore };

/** The settings that were changed elsewhere while the person has a draft of them: the id and the value the host holds now. Gone with the draft. */
export type Elsewhere = {
  readonly getSnapshot: () => Readonly<Record<string, Json>>;
  readonly subscribe: (listener: () => void) => () => void;
};

/** What a polite live region says: the text, and a serial that moves with every announcement, so the same words told twice are two announcements. */
export type Announcement = { readonly text: string; readonly serial: number };

export type Announcements = {
  readonly getSnapshot: () => Announcement;
  readonly subscribe: (listener: () => void) => () => void;
};

export type ScopeSession = {
  readonly getState: () => SessionState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Asks the host again after a failed load. */
  readonly load: () => void;
  /** Asks the host what it holds now and gives it to the form: a window that was hidden and is shown again. A no-op until the first load has finished. */
  readonly refresh: () => void;
  /** Restores only the material fields to their declared defaults, in one host transaction. */
  readonly resetMaterial: () => Promise<boolean>;
  readonly elsewhere: Elsewhere;
  /** What the form says to a screen reader (a new error or warning raised on commit, S127): Settings draws it in a polite live region of its own, because the window's are behind the sheet's modal. */
  readonly announcements: Announcements;
  /** Stops listening to the host, abandons what is in flight and disposes the form. */
  readonly dispose: () => void;
};

export type SettingsSession = ScopeSession & { readonly plugins: SettingsPlugins };

export type SessionOptions = {
  readonly client: SettingsClient;
  /** The clock the session and its form run on: the page's in a page (`clock.ts`), a manual one in a test. The session waits before it asks the host again when a question was lost, and the form debounces and times its checks. */
  readonly scheduler: Scheduler;
};

const LOADING: Loading = Object.freeze({ phase: 'loading' });
const FAILED: SessionState = Object.freeze({ phase: 'failed' });
const NONE: Readonly<Record<string, Json>> = Object.freeze({});

/** How many times an answer that may be older than the host's value is asked for again before the session gives the screen what it has. */
const ASKS = 3;

/** How long the host has to answer a question for the snapshot: it reads a local store and answers in milliseconds, so a question that is not answered in ten seconds is lost, and the newest one is asked again (the waits that follow are RETRY_WAITS). */
const ASK_DEADLINE = 10_000;

/** How long the session waits before it asks again when its newest question was lost: five waits, 15.5 s in all. After the last it asks no more until it is told something (an event, the page looked at again, the events connection back). */
const RETRY_WAITS = [500, 1000, 2000, 4000, 8000] as const;


function createScopeSession({ client, scheduler }: SessionOptions, scope: SettingsScope): ScopeSession & { changed: () => void } {
  let state: SessionState = LOADING;
  // A stale form can be hidden before its in-flight writes have finished. Keep ownership until their results settle.
  let ownedForm: FormStore | undefined;
  let disposed = false;
  let generation = 0;
  let wantsRefresh = false;
  // A change that is on its way to the host, and a counter that moves when one starts and when one ends: a snapshot asked for before or during a change may not hold it, so it is never given to the form.
  let inflight = 0;
  let epoch = 0;
  // The questions the page has put to the host for a snapshot, numbered in the order they were asked: only the answer to the NEWEST is given to the form. An older answer that lands after a newer question was asked may hold
  // less than the host does (it was taken before the change that the newer question was asked for), whether the newer one has answered, is still on its way or was lost.
  let asked = 0;
  // The waits that have been spent since the newest question was lost, and the one that is running now.
  let retries = 0;
  let retryTimer: unknown;
  // The host's values the form was last given, so that a change under a draft can be told from the person's own.
  let applied: Record<string, Json> = {};
  // Settings the host saved and could not apply, and the ones it says wait for a restart.
  const unapplied = new Set<string>();
  let hostWaiting: readonly string[] = [];
  let schemaKey = '';
  let replacement: Replacement | undefined;
  let notes: Readonly<Record<string, Json>> = NONE;
  let said: Announcement = Object.freeze({ text: '', serial: 0 });
  const listeners = new Set<() => void>();
  const noteListeners = new Set<() => void>();
  const sayListeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) {
        listener();
      }
    }
  };

  const setState = (next: SessionState): void => {
    state = next;
    emit();
  };

  const setNotes = (next: Readonly<Record<string, Json>>): void => {
    const same = Object.keys(next).length === Object.keys(notes).length && Object.entries(next).every(([id, value]) => sameValue(notes[id], value));
    if (same) {
      return;
    }

    notes = Object.keys(next).length === 0 ? NONE : Object.freeze({ ...next });
    for (const listener of [...noteListeners]) {
      if (noteListeners.has(listener)) {
        listener();
      }
    }
  };

  const announce = (text: string): void => {
    if (text === '') {
      return;
    }

    said = Object.freeze({ text, serial: said.serial + 1 });
    for (const listener of [...sayListeners]) {
      if (sayListeners.has(listener)) {
        listener();
      }
    }
  };

  const waiting = (): readonly string[] => [...new Set([...hostWaiting, ...unapplied])];

  const check: RemoteValidator = async ({ id, value }) => {
    if (disposed || state.phase !== 'ready') {
      throw new Error('Settings unavailable.');
    }

    const answer = await client.validate(scope, state.model.wireKeys[id] ?? id, value);
    return { valid: answer.valid, ...(answer.message === undefined || answer.message === '' ? {} : { message: answer.message }), ...(answer.code === undefined || answer.code === '' ? {} : { code: answer.code }) };
  };

  const schemaKeyOf = (model: SettingsModel): string => scope.kind === 'plugin' ? JSON.stringify([model.schema, model.wireKeys]) : '';

  const replaceAfterSave = (form: FormStore, next: Replacement): void => {
    replacement = next;
    const loading = 'model' in next ? LOADING : next;
    form.setFormLock({ source: 'store', readonly: false, reason: loading.warning ?? 'The plugin settings have changed.' });
    if (!disposed) {
      setState(loading);
    }
  };

  const commitPatch = async (values: Readonly<Record<string, Json>>): Promise<Record<string, Json> | null> => {
    inflight += 1;
    epoch += 1;
    if (disposed || state.phase !== 'ready') {
      throw new Error('Settings unavailable.');
    }

    const before = state;
    const keys = before.model.wireKeys;
    const patch = Object.keys(values).some((id) => Object.hasOwn(keys, id))
      ? Object.fromEntries(Object.entries(values).map(([id, value]) => [keys[id] ?? id, value]))
      : values;
    // A refusal is a throw. A successful write need not come with a usable readback.
    const result = await client.commit(scope, patch);
    if (disposed || ownedForm !== before.form) {
      return null;
    }

    if (scope.kind === 'plugin' && !result.snapshot.categories.plugin) {
      const warning = result.message || 'Settings were saved, but the current settings view is unavailable.';
      replaceAfterSave(before.form, { phase: 'loading', warning });
      return null;
    }

    // A previously lost readback still needs a fresh read after all writes settle.
    if (replacement && !('model' in replacement)) {
      return null;
    }

    const after = modelOf(result.snapshot, scope);
    if (scope.kind === 'plugin') {
      const key = schemaKeyOf(after);
      if (key !== schemaKey) {
        // Do not interpret the new field IDs in the old form. Overlapping writes can also make this snapshot stale.
        replaceAfterSave(before.form, inflight === 1 ? { model: after, key } : LOADING);
        return null;
      }
    }

    const canonical: Record<string, Json> = {};
    for (const id of Object.keys(values)) {
      const value = after.initial[id];
      if (value !== undefined) {
        canonical[id] = value;
        applied[id] = value;
      }

      // The host saved it and could not take it into effect: it waits for a restart, as one that declares so does.
      if (result.applied && !result.uncertain) {
        unapplied.delete(id);
      } else {
        unapplied.add(id);
      }
    }

    hostWaiting = after.pendingRestart;
    before.form.rebase({}, { pendingRestart: waiting() });
    return canonical;
  };

  const finishPatch = (): void => {
    inflight -= 1;
    epoch += 1;
    if (disposed || inflight !== 0) {
      return;
    }

    // Every submitting field has consumed its result. Replacing its form or starting a queued read is now safe.
    const next = replacement;
    replacement = undefined;
    if (next && !('model' in next)) {
      discardForm();
      startLoad(next.warning);
      return;
    }

    if (next) {
      installIfChanged(next.model, next.key);
    }

    if (wantsRefresh) {
      wantsRefresh = false;
      void refresh(0);
    }
  };

  const submit = async ({ values }: SubmitPayload): Promise<SubmitOutcome> => ({ ok: true, values: await commitPatch(values) });

  const resetMaterial = async (): Promise<boolean> => {
    if (scope.kind !== 'host' || disposed || state.phase !== 'ready' || materialResetBlock(state.form) !== undefined) {
      return false;
    }

    const { form } = state;
    const defaults = Object.fromEntries(MATERIAL_FIELDS.map((id) => [id, form.field(id)!.default!]));
    form.setContext({ [RESETTING_MATERIAL]: true });
    try {
      const values = await commitPatch(defaults);
      if (!disposed && values !== null) {
        form.rebase(values);
        for (const id of MATERIAL_FIELDS) {
          if (form.field(id)?.dirty) {
            form.revert(id);
          }
        }
      }

      return true;
    } catch {
      return false;
    } finally {
      form.setContext({ [RESETTING_MATERIAL]: false });
      finishPatch();
    }
  };

  /** Gives the form what the host holds now: a field with no draft follows, one with a draft keeps it, and says it was changed under it. */
  const follow = (form: FormStore, model: SettingsModel): void => {
    const next: Record<string, Json> = {};
    for (const [id, value] of Object.entries(model.initial)) {
      const dirty = form.field(id)?.dirty === true;
      if (dirty && (!sameValue(applied[id], value) || Object.hasOwn(notes, id))) {
        next[id] = !sameValue(applied[id], value) ? value : (notes[id] ?? value);
      }
    }

    // A secret has no value to compare: what another window changes is whether the host holds one. A secret that is being typed keeps its text and says so, in words that carry none (the note's value is null: there is nothing to say).
    for (const [id, held] of Object.entries(model.presence)) {
      const secret = form.field(id)?.secret;
      if (secret?.changed === true && ((secret.presence === 'set') !== held || Object.hasOwn(notes, id))) {
        next[id] = null;
      }
    }

    applied = { ...model.initial };
    hostWaiting = model.pendingRestart;
    form.rebase(model.initial, { presence: model.presence, pendingRestart: waiting() });
    setNotes(next);
  };

  // The deadlines of the questions that are on their way: cleared when a question is answered, and when the session is disposed.
  const deadlines = new Set<unknown>();
  const answered = async (answer: Promise<HostSnapshot>): Promise<HostSnapshot> => {
    let timer: unknown;
    const lost = new Promise<never>((_resolve, reject) => {
      timer = scheduler.setTimeout(() => {
        deadlines.delete(timer);
        reject(new Error('the host did not answer in time'));
      }, ASK_DEADLINE);
      deadlines.add(timer);
    });
    try {
      return await Promise.race([answer, lost]);
    } finally {
      scheduler.clearTimeout(timer);
      deadlines.delete(timer);
    }
  };

  const readSnapshot = async (withDeadline: boolean): Promise<HostSnapshot> => {
    const read = client.snapshot(scope);
    const snapshot = await (withDeadline ? answered(read) : read);
    if (scope.kind === 'plugin' && !snapshot.categories.plugin) {
      throw new Error('Plugin settings unavailable.');
    }

    return snapshot;
  };

  const cancelRetry = (): void => {
    if (retryTimer !== undefined) {
      scheduler.clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  };

  const retryLater = (retry: () => void): void => {
    const wait = RETRY_WAITS[retries];
    if (disposed || retryTimer !== undefined || wait === undefined) {
      return;
    }

    retries += 1;
    retryTimer = scheduler.setTimeout(() => {
      retryTimer = undefined;
      retry();
    }, wait);
  };

  async function refresh(attempt: number): Promise<void> {
    if (disposed || state.phase !== 'ready') {
      return;
    }

    if (inflight > 0) {
      // The change that is on its way carries its own snapshot; ask again when it is over.
      wantsRefresh = true;
      return;
    }

    // A question asked now takes over from a wait that is running: it is the newest.
    cancelRetry();
    const { form } = state;
    const started = epoch;
    asked += 1;
    const mine = asked;
    let snapshot: HostSnapshot;
    try {
      snapshot = await readSnapshot(true);
    } catch {
      // The newest question was lost: what the form shows may not be what the host holds, and no event will say so. Ask again after a wait, a bounded number of times (RETRY_WAITS). A lost question that is not the newest changes nothing.
      if (!disposed && mine === asked && state.phase === 'ready' && state.form === form) {
        if (scope.kind === 'plugin' && started === epoch) {
          // A provider can disappear or change privacy classification during a reload. Do not keep an editable stale schema.
          discardForm();
          setState(FAILED);
          return;
        }

        retryLater(() => {
          void refresh(0);
        });
      }

      return;
    }

    if (disposed || state.phase !== 'ready' || state.form !== form) {
      return;
    }

    if (mine !== asked) {
      // A newer question has been asked since, whatever has become of it: this answer may lack a change made after it was taken, and the form is not given it.
      return;
    }

    if (epoch !== started) {
      if (attempt + 1 < ASKS) {
        await refresh(attempt + 1);
      }

      return;
    }

    retries = 0;
    const model = modelOf(snapshot, scope);
    if (!installIfChanged(model)) {
      follow(form, model);
    }
  }

  function discardForm(): void {
    schemaKey = '';
    ownedForm?.dispose();
    ownedForm = undefined;

    applied = {};
    unapplied.clear();
    hostWaiting = [];
    setNotes(NONE);
    if (said.text !== '') {
      said = { text: '', serial: said.serial + 1 };
      for (const listener of sayListeners) {
        listener();
      }
    }
  }

  /** Preserve ordinary drafts across value changes. Replace the whole form when its provider changes schema or redaction. */
  function installIfChanged(model: SettingsModel, nextKey = schemaKeyOf(model)): boolean {
    if (state.phase === 'ready' && schemaKey === nextKey) {
      return false;
    }

    discardForm();
    schemaKey = nextKey;
    const compiled = compileSchema(model.schema);
    if (!compiled.ok) {
      setState(FAILED);
      return true;
    }

    applied = { ...model.initial };
    hostWaiting = model.pendingRestart;
    const form = createFormStore({
      schema: compiled.schema,
      mode: 'apply-on-change',
      send: 'changed',
      initial: model.initial,
      presence: model.presence,
      pendingRestart: model.pendingRestart,
      submit,
      onApplySettled: finishPatch,
      validators: { host: check },
      scheduler,
      announce,
    });
    // Once a draft is reverted or applied, its changed-elsewhere note goes with it.
    form.subscribeTo(
      (current) => [...current.dirtyIds, ...current.fields.flatMap((field) => (field.secret?.changed === true ? [field.id] : []))].join('\n'),
      (key) => {
        const drafts = key === '' ? [] : key.split('\n');
        if (Object.keys(notes).some((id) => !drafts.includes(id))) {
          setNotes(Object.fromEntries(Object.entries(notes).filter(([id]) => drafts.includes(id))));
        }
      },
    );
    ownedForm = form;
    setState({ phase: 'ready', model, form });
    return true;
  }

  function startLoad(warning?: string, superseding = false): void {
    if (disposed) {
      return;
    }

    cancelRetry();
    generation += 1;
    const mine = generation;
    wantsRefresh = false;
    if (state.phase !== 'loading' || state.warning !== warning) {
      setState(warning === undefined ? LOADING : { phase: 'loading', warning });
      if (disposed || mine !== generation) {
        return;
      }
    }

    void readSnapshot(scope.kind === 'plugin' || superseding).then(
      (snapshot) => {
        if (disposed || mine !== generation) {
          return;
        }

        if (wantsRefresh) {
          startLoad(warning, true);
          return;
        }

        retries = 0;
        installIfChanged(modelOf(snapshot, scope));
      },
      () => {
        if (!disposed && mine === generation) {
          if (wantsRefresh) {
            startLoad(warning, true);
            return;
          }

          // As before, a lost replacement read of Core retries on the clock; a failed plugin read offers Retry.
          if (superseding && scope.kind === 'host') {
            retryLater(() => {
              startLoad(warning, true);
            });
          }

          setState(warning === undefined ? FAILED : { phase: 'failed', warning });
        }
      },
    );
  }

  function load(): void {
    if (disposed || state.phase === 'ready' || (state.phase === 'loading' && generation > 0)) {
      return;
    }

    startLoad(state.warning);
  }

  const changed = (): void => {
    if (disposed) {
      return;
    }

    retries = 0;
    if (state.phase === 'ready') {
      void refresh(0);
    } else if (state.phase === 'loading') {
      wantsRefresh = true;
    } else {
      load();
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    changed,
    resetMaterial,
    refresh: () => {
      retries = 0;
      void refresh(0);
    },
    announcements: {
      getSnapshot: () => said,
      subscribe: (listener) => {
        sayListeners.add(listener);
        return () => {
          sayListeners.delete(listener);
        };
      },
    },
    elsewhere: {
      getSnapshot: () => notes,
      subscribe: (listener) => {
        noteListeners.add(listener);
        return () => {
          noteListeners.delete(listener);
        };
      },
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      cancelRetry();
      for (const timer of deadlines) {
        scheduler.clearTimeout(timer);
      }

      deadlines.clear();
      ownedForm?.dispose();
      ownedForm = undefined;
      replacement = undefined;

      listeners.clear();
      noteListeners.clear();
      sayListeners.clear();
    },
  };
}

/** One listener per transport signal, however many plugins are installed. Every form owns one immutable RPC scope. */
export function createSettingsSession(options: SessionOptions): SettingsSession {
  const { client } = options;
  const core = createScopeSession(options, HOST_SCOPE);
  const plugins = createPluginPages(client.inventory, (pluginId) => createScopeSession(options, { kind: 'plugin', pluginId }));
  const offChanged = client.onChanged((scope) => {
    if (scope.kind === 'host') {
      core.changed();
    } else {
      plugins.changed(scope.pluginId);
    }
  });
  const offInventory = client.onInventoryChanged(plugins.refresh);
  const offReconnect = client.onReconnect?.(() => {
    core.changed();
    plugins.refresh();
  });
  let disposed = false;
  core.load();
  plugins.refresh();

  return {
    ...core,
    plugins,
    refresh: () => {
      core.refresh();
      plugins.refresh();
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      offChanged();
      offInventory();
      offReconnect?.();
      core.dispose();
      plugins.dispose();
    },
  };
}
