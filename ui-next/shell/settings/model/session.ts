import { compileSchema, createFormStore, sameValue, type FormStore, type Json, type RemoteValidator, type Scheduler, type SubmitOutcome, type SubmitPayload } from '../../core/fields';
import { modelOf, type SettingsModel } from './adapter';
import type { HostSnapshot, SettingsClient } from './types';

// The session is the Settings sheet's whole dealing with the host: it reads the snapshot, makes the form from it (the model of ../../core/fields, in the mode of a setting: a value applies the moment it is chosen or committed),
// sends what the person changes one setting at a time, asks the host about a typed value, and follows what changes elsewhere. Plain TypeScript over the `SettingsClient` seam: no React, no DOM; its only timers are the form's own,
// on the scheduler it is given. One session lives from the sheet's opening to its closing, and `dispose` leaves nothing behind.

export type SessionState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'failed' }
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

export type SettingsSession = {
  readonly getState: () => SessionState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Asks the host again after a failed load. */
  readonly load: () => void;
  readonly elsewhere: Elsewhere;
  /** What the form says to a screen reader (a new error or warning raised on commit, S127): the sheet draws it in a polite live region of its own, because the window's are behind the modal. */
  readonly announcements: Announcements;
  /** Stops listening to the host, abandons what is in flight and disposes the form. */
  readonly dispose: () => void;
};

export type SessionOptions = {
  readonly client: SettingsClient;
  readonly scheduler?: Scheduler | undefined;
};

const LOADING: SessionState = Object.freeze({ phase: 'loading' });
const FAILED: SessionState = Object.freeze({ phase: 'failed' });
const NONE: Readonly<Record<string, Json>> = Object.freeze({});

/** How many times an answer that may be older than the host's value is asked for again before the session gives the screen what it has. */
const ASKS = 3;

export function createSettingsSession({ client, scheduler }: SessionOptions): SettingsSession {
  let state: SessionState = LOADING;
  let disposed = false;
  let generation = 0;
  let wantsRefresh = false;
  // A change that is on its way to the host, and a counter that moves when one starts and when one ends: a snapshot asked for before or during a change may not hold it, so it is never given to the form.
  let inflight = 0;
  let epoch = 0;
  // The host's values the form was last given, so that a change under a draft can be told from the person's own.
  let applied: Record<string, Json> = {};
  // Settings the host saved and could not apply, and the ones it says wait for a restart.
  const unapplied = new Set<string>();
  let hostWaiting: readonly string[] = [];
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
    const answer = await client.validate(id, value);
    return { valid: answer.valid, ...(answer.message === undefined || answer.message === '' ? {} : { message: answer.message }), ...(answer.code === undefined || answer.code === '' ? {} : { code: answer.code }) };
  };

  const submit = async ({ values }: SubmitPayload): Promise<SubmitOutcome> => {
    inflight += 1;
    epoch += 1;
    try {
      // A refusal is a throw, and the form says it on the field in its own words.
      const result = await client.commit(values);
      const after = modelOf(result.snapshot);
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
      if (state.phase === 'ready') {
        state.form.rebase({}, { pendingRestart: waiting() });
      }

      return { ok: true, values: canonical };
    } finally {
      inflight -= 1;
      epoch += 1;
      if (inflight === 0 && wantsRefresh) {
        wantsRefresh = false;
        void refresh(0);
      }
    }
  };

  /** Gives the form what the host holds now: a field with no draft follows, one with a draft keeps it, and says it was changed under it. */
  const follow = (form: FormStore, model: SettingsModel): void => {
    const next = { ...notes };
    for (const [id, value] of Object.entries(model.initial)) {
      const dirty = form.field(id)?.dirty === true;
      if (dirty && !sameValue(applied[id], value)) {
        next[id] = value;
      } else if (!dirty) {
        delete next[id];
      }
    }

    applied = { ...model.initial };
    hostWaiting = model.pendingRestart;
    form.rebase(model.initial, { presence: model.presence, pendingRestart: waiting() });
    setNotes(next);
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

    const { form } = state;
    const started = epoch;
    let snapshot: HostSnapshot;
    try {
      snapshot = await client.snapshot();
    } catch {
      // The sheet keeps what it shows: the next change the host tells asks again.
      return;
    }

    if (disposed || state.phase !== 'ready' || state.form !== form) {
      return;
    }

    if (epoch !== started) {
      if (attempt + 1 < ASKS) {
        await refresh(attempt + 1);
      }

      return;
    }

    follow(form, modelOf(snapshot));
  }

  function load(): void {
    if (disposed || state.phase === 'ready' || (state.phase === 'loading' && generation > 0)) {
      return;
    }

    generation += 1;
    const mine = generation;
    wantsRefresh = false;
    if (state.phase !== 'loading') {
      setState(LOADING);
    }

    client.snapshot().then(
      (snapshot) => {
        if (disposed || mine !== generation) {
          return;
        }

        const model = modelOf(snapshot);
        const compiled = compileSchema(model.schema);
        if (!compiled.ok) {
          setState(FAILED);
          return;
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
          validators: { host: check },
          scheduler,
          announce,
        });
        // A draft that is put back or applied is no longer a draft, and the note that the host changed under it goes with it.
        form.subscribeTo(
          (current) => current.dirtyIds,
          (dirtyIds) => {
            if (Object.keys(notes).some((id) => !dirtyIds.includes(id))) {
              setNotes(Object.fromEntries(Object.entries(notes).filter(([id]) => dirtyIds.includes(id))));
            }
          },
        );
        setState({ phase: 'ready', model, form });
        if (wantsRefresh) {
          wantsRefresh = false;
          void refresh(0);
        }
      },
      () => {
        if (!disposed && mine === generation) {
          setState(FAILED);
        }
      },
    );
  }

  const stop = client.onChanged(() => {
    if (disposed) {
      return;
    }

    if (state.phase === 'ready') {
      void refresh(0);
    } else if (state.phase === 'loading') {
      wantsRefresh = true;
    }
  });

  load();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
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
      stop();
      if (state.phase === 'ready') {
        state.form.dispose();
      }

      listeners.clear();
      noteListeners.clear();
      sayListeners.clear();
    },
  };
}
