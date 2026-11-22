import { describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, HOST, type PanelStore } from '../../core/panel';
import { createCloseGuard, type CloseGuard } from './closeGuard';
import type { CloseQuestion } from './state';

// The question a close asks (S115: "Closing a session with a foreground process running opens a confirmation (Terminate session?, buttons Cancel and Terminate session); any other close is immediate", L12). The
// panel's own paths to a close (the tab's button, its middle button, Delete on the tab, the close chord) all end in `store.closeSession`, and that call is synchronous by design: the guard is the store they are
// given, whose `closeSession` asks first when the session has a question and closes at once when it has none. What the registry or a plugin does through the host's own store never asks.

const QUESTION: CloseQuestion = { title: 'Terminate session?', body: 'This ends the terminal session.', confirm: 'Terminate session' };

type Rig = { readonly store: PanelStore; readonly guard: CloseGuard; readonly guarded: PanelStore; readonly ids: readonly string[]; readonly asked: Mock<(id: string) => CloseQuestion | undefined> };

function rig(questions: Record<string, CloseQuestion | undefined> = {}): Rig {
  let counter = 0;
  const store = createPanelStore({ now: () => 1_000, newId: () => `s${String(++counter)}` });
  store.registerTool({ id: 'terminal', label: 'Terminal', icon: 'square-terminal', order: 10 });
  const ids = ['one', 'two', 'three'].map((title) => {
    const opened = store.openSession({ tool: 'terminal', plugin: HOST, title, state: 'running' });
    return opened.status === 'done' ? opened.id : '';
  });
  // The questions are given by the title of the session they are about.
  const asked = vi.fn<(id: string) => CloseQuestion | undefined>((id) => questions[store.getSnapshot().sessions[id]?.title ?? '']);
  const guard = createCloseGuard({ questionOf: asked, nameOf: (id) => store.selectors.sessionItem(store.getSnapshot(), id)?.name ?? id });
  return { store, guard, guarded: guard.guard(store), ids, asked };
}

describe('a close with nothing to ask', () => {
  it('closes at once and answers what the store answers: the session on screen passes to its neighbour, as a close does', () => {
    const { store, guard, guarded, ids, asked } = rig();
    const result = guarded.closeSession(ids[1] ?? '');
    expect(result).toMatchObject({ status: 'done', closed: ids[1] });
    expect(store.getSnapshot().sessions[ids[1] ?? '']).toBeUndefined();
    expect(guard.getSnapshot()).toBeNull();
    expect(asked).toHaveBeenCalledWith(ids[1]);
  });

  it('answers what the store answers for a session that is not there', () => {
    const { guarded } = rig();
    expect(guarded.closeSession('nobody')).toMatchObject({ status: 'refused', reason: 'missing' });
  });
});

describe('a close with a question', () => {
  it('closes nothing, asks, and says that it did not close: the callers of a close read the answer, and the keyboard\'s Delete keeps its focus', () => {
    const { store, guard, guarded, ids } = rig({ two: QUESTION });
    const result = guarded.closeSession(ids[1] ?? '');
    expect(result.status).not.toBe('done');
    expect(store.getSnapshot().sessions[ids[1] ?? '']).toBeDefined();
    expect(guard.getSnapshot()).toEqual({ session: ids[1], name: 'two', question: QUESTION });
  });

  it('closes the session when the person confirms, through the store, and answers where the strip went', () => {
    const { store, guard, guarded, ids } = rig({ two: QUESTION });
    guarded.closeSession(ids[1] ?? '');
    const closed = guard.confirm();
    expect(closed).toMatchObject({ status: 'done', closed: ids[1] });
    expect(store.getSnapshot().sessions[ids[1] ?? '']).toBeUndefined();
    expect(guard.getSnapshot()).toBeNull();
  });

  it('leaves everything as it was when the person cancels', () => {
    const { store, guard, guarded, ids } = rig({ two: QUESTION });
    const before = store.getSnapshot();
    guarded.closeSession(ids[1] ?? '');
    guard.cancel();
    expect(guard.getSnapshot()).toBeNull();
    expect(store.getSnapshot()).toBe(before);
  });

  it('has nothing to confirm or cancel when nothing was asked', () => {
    const { guard } = rig();
    expect(guard.confirm()).toBeUndefined();
    expect(() => {
      guard.cancel();
    }).not.toThrow();
  });

  it('asks about one session at a time: a second close asks about the second, and the question of the first is gone', () => {
    const { guard, guarded, ids } = rig({ one: QUESTION, three: QUESTION });
    guarded.closeSession(ids[0] ?? '');
    guarded.closeSession(ids[2] ?? '');
    expect(guard.getSnapshot()?.session).toBe(ids[2]);
  });

  it('is one question however often the same close is asked: the same prompt object, and nobody told twice', () => {
    const { guard, guarded, ids } = rig({ two: QUESTION });
    const heard = vi.fn();
    guard.subscribe(heard);
    guarded.closeSession(ids[1] ?? '');
    const first = guard.getSnapshot();
    guarded.closeSession(ids[1] ?? '');
    expect(guard.getSnapshot()).toBe(first);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('tells a listener of a question and of its answer, and a listener that stopped hears nothing', () => {
    const { guard, guarded, ids } = rig({ two: QUESTION });
    const heard = vi.fn();
    const stop = guard.subscribe(heard);
    guarded.closeSession(ids[1] ?? '');
    guard.cancel();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    guarded.closeSession(ids[1] ?? '');
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('the store it hands the panel', () => {
  it('is the host\'s own store in everything but the close: every other member is the same, so the panel reads and changes the same model', () => {
    const { store, guarded } = rig();
    for (const name of Object.keys(store)) {
      if (name !== 'closeSession') {
        expect(Reflect.get(guarded, name), name).toBe(Reflect.get(store, name));
      }
    }

    expect(guarded.closeSession).not.toBe(store.closeSession);
  });

  it('leaves the host\'s own close alone: what the registry and a plugin close through the host\'s store never asks', () => {
    const { store, guard, ids } = rig({ two: QUESTION });
    expect(store.closeSession(ids[1] ?? '')).toMatchObject({ status: 'done' });
    expect(guard.getSnapshot()).toBeNull();
  });
});
