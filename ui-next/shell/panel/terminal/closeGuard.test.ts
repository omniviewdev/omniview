import { describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, HOST, type CloseResult, type PanelStore } from '../../core/panel';
import { createCloseGuard, type CloseGuard, type ClosePrompt } from './closeGuard';
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

  it('asks about one session at a time: a second close waits behind the first, the question on screen stays the first one, and the second is asked when the first is answered', () => {
    const { store, guard, guarded, ids } = rig({ one: QUESTION, three: QUESTION });
    guarded.closeSession(ids[0] ?? '');
    const first = guard.getSnapshot();
    expect(guarded.closeSession(ids[2] ?? '').status).toBe('refused');
    expect(guard.getSnapshot()).toBe(first);
    guard.cancel();
    expect(guard.getSnapshot()).toEqual({ session: ids[2], name: 'three', question: QUESTION });
    expect(store.getSnapshot().sessions[ids[2] ?? '']).toBeDefined();
    guard.cancel();
    expect(guard.getSnapshot()).toBeNull();
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

  it('does not ask again for a session whose question is on screen or waits: a second press is refused at once, and what says what runs in it is called once for each session', () => {
    const { guard, guarded, ids, asked } = rig({ one: QUESTION, three: QUESTION });
    guarded.closeSession(ids[0] ?? '');
    guarded.closeSession(ids[2] ?? '');
    expect(asked).toHaveBeenCalledTimes(2);
    expect(guarded.closeSession(ids[0] ?? '').status).toBe('refused');
    expect(guarded.closeSession(ids[2] ?? '').status).toBe('refused');
    expect(asked).toHaveBeenCalledTimes(2);
    expect(guard.getSnapshot()?.session).toBe(ids[0]);
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

// A question that has to be asked of the producer first (what runs in the session is a call to the host, T1-go.md 2.3): the close the panel makes is synchronous, so the guard answers at once that nothing was closed,
// and finishes the close when the producer has answered: a question for the person, or, when nothing runs, the close itself.

type Answer = Promise<CloseQuestion | undefined>;

function asyncRig(options: { readonly focused?: boolean } = {}) {
  let counter = 0;
  const store = createPanelStore({ now: () => 1_000, newId: () => `s${String(++counter)}` });
  store.registerTool({ id: 'terminal', label: 'Terminal', icon: 'square-terminal', order: 10 });
  const ids = ['one', 'two', 'three'].map((title) => {
    const opened = store.openSession({ tool: 'terminal', plugin: HOST, title, state: 'running' });
    return opened.status === 'done' ? opened.id : '';
  });
  const deferred: Array<{ readonly id: string; readonly resolve: (question: CloseQuestion | undefined) => void }> = [];
  const questionOf = vi.fn<(id: string) => Answer>(async (id) => {
    const { promise, resolve } = Promise.withResolvers<CloseQuestion | undefined>();
    deferred.push({ id, resolve });
    return promise;
  });
  const closedLater = vi.fn<(result: CloseResult, focused: boolean) => void>();
  /** Whether the focus is in the panel now: it starts as the test says, and the test moves it. */
  let focused = options.focused ?? false;
  /** How many sessions the store held each time the guard asked where the focus is: a sample taken after a close would see one fewer. */
  const sampled: number[] = [];
  /** The sessions the guard asked about when it asked where the focus is, in order. */
  const askedAbout: Array<string | undefined> = [];
  const guard = createCloseGuard({
    questionOf,
    nameOf: (id) => store.selectors.sessionItem(store.getSnapshot(), id)?.name ?? id,
    focused: (session) => {
      sampled.push(Object.keys(store.getSnapshot().sessions).length);
      askedAbout.push(session);
      return focused;
    },
    closedLater,
  });
  const answer = async (index: number, question: CloseQuestion | undefined) => {
    deferred[index]?.resolve(question);
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }
  };

  return {
    store,
    guard,
    guarded: guard.guard(store),
    ids,
    questionOf,
    closedLater,
    answer,
    sampled,
    askedAbout,
    moveFocus: (inPanel: boolean) => {
      focused = inPanel;
    },
  };
}

describe('a close whose question is asked of the producer first', () => {
  it('closes nothing at once and says that it did not: the callers of a close read the answer, and the question is the producer\'s to answer', () => {
    const { store, guard, guarded, ids } = asyncRig();
    const result = guarded.closeSession(ids[1] ?? '');
    expect(result.status).toBe('refused');
    expect(store.getSnapshot().sessions[ids[1] ?? '']).toBeDefined();
    expect(guard.getSnapshot()).toBeNull();
  });

  it('asks the person when the producer says something runs: the dialog comes when the answer does, once, and the session is still there', async () => {
    const { store, guard, guarded, ids, answer, closedLater } = asyncRig();
    const heard = vi.fn();
    guard.subscribe(heard);
    guarded.closeSession(ids[1] ?? '');
    await answer(0, QUESTION);
    expect(guard.getSnapshot()).toEqual({ session: ids[1], name: 'two', question: QUESTION });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions[ids[1] ?? '']).toBeDefined();
    expect(closedLater).not.toHaveBeenCalled();
  });

  it('closes the session itself when the producer says nothing runs: through the host\'s store, with no dialog, and says so to whoever follows the focus, with whether the focus was in the panel when the close was pressed and still is when it is made', async () => {
    const { store, guard, guarded, ids, answer, closedLater } = asyncRig({ focused: true });
    guarded.closeSession(ids[1] ?? '');
    await answer(0, undefined);
    expect(store.getSnapshot().sessions[ids[1] ?? '']).toBeUndefined();
    expect(guard.getSnapshot()).toBeNull();
    expect(closedLater).toHaveBeenCalledTimes(1);
    expect(closedLater.mock.calls[0]?.[0]).toMatchObject({ status: 'done', closed: ids[1] });
    expect(closedLater.mock.calls[0]?.[1]).toBe(true);
  });

  it('says that the focus was not in the panel when it was not', async () => {
    const { guarded, ids, answer, closedLater } = asyncRig({ focused: false });
    guarded.closeSession(ids[1] ?? '');
    await answer(0, undefined);
    expect(closedLater.mock.calls[0]?.[1]).toBe(false);
  });

  it.each([
    { pressed: true, now: true, moved: true },
    { pressed: true, now: false, moved: false },
    { pressed: false, now: true, moved: false },
    { pressed: false, now: false, moved: false },
  ])('moves the focus after the close only when it was in the panel at the press and still is when the close is made (in the panel at the press: $pressed, in the panel then: $now, so moved: $moved)', async ({ pressed, now, moved }) => {
    const { guarded, ids, answer, closedLater, moveFocus } = asyncRig({ focused: pressed });
    guarded.closeSession(ids[1] ?? '');
    // The person goes elsewhere, or comes in, while the host is asked: the close removes the tab that had the focus, so it must not take back a focus that is on a page control, nor send one that was never in the panel.
    moveFocus(now);
    await answer(0, undefined);
    expect(closedLater.mock.calls[0]?.[1]).toBe(moved);
  });

  it('asks where the focus is again right before it closes, while the session is still there: closing removes the node that has it, so the answer after the close would always be no', async () => {
    const { guarded, ids, answer, sampled } = asyncRig({ focused: true });
    guarded.closeSession(ids[1] ?? '');
    await answer(0, undefined);
    expect(sampled).toEqual([3, 3]);
  });

  it('asks where the focus is for the session it is closing, at the press and again right before the close: the focus belongs to a session, and is not just somewhere in the panel', async () => {
    const { guarded, ids, answer, askedAbout } = asyncRig({ focused: true });
    guarded.closeSession(ids[1] ?? '');
    await answer(0, undefined);
    expect(askedAbout).toEqual([ids[1], ids[1]]);
  });

  it('asks the producer once however often the close is pressed while it thinks: the person pressed one button', async () => {
    const { guarded, ids, questionOf, answer, closedLater } = asyncRig();
    guarded.closeSession(ids[1] ?? '');
    guarded.closeSession(ids[1] ?? '');
    guarded.closeSession(ids[1] ?? '');
    expect(questionOf).toHaveBeenCalledTimes(1);
    await answer(0, undefined);
    expect(closedLater).toHaveBeenCalledTimes(1);
  });

  it('asks again for a close that comes after the answer: the question is not remembered', async () => {
    const { guard, guarded, ids, questionOf, answer } = asyncRig();
    guarded.closeSession(ids[1] ?? '');
    await answer(0, QUESTION);
    guard.cancel();
    guarded.closeSession(ids[1] ?? '');
    expect(questionOf).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the session is gone by the time the producer answers: nothing to close and nobody to ask', async () => {
    const { store, guard, guarded, ids, answer, closedLater } = asyncRig();
    guarded.closeSession(ids[1] ?? '');
    store.closeSession(ids[1] ?? '');
    await answer(0, QUESTION);
    expect(guard.getSnapshot()).toBeNull();
    expect(closedLater).not.toHaveBeenCalled();
    guarded.closeSession(ids[0] ?? '');
    store.closeSession(ids[0] ?? '');
    await answer(1, undefined);
    expect(closedLater).not.toHaveBeenCalled();
  });

  it('keeps the question on screen bound to its session until it is answered: what the producer says of another session meanwhile waits behind it, so a click meant for the one on screen cannot land on the other', async () => {
    const { store, guard, guarded, ids, answer } = asyncRig();
    guarded.closeSession(ids[0] ?? '');
    guarded.closeSession(ids[1] ?? '');
    await answer(1, QUESTION);
    const onScreen = guard.getSnapshot();
    expect(onScreen).toEqual({ session: ids[1], name: 'two', question: QUESTION });
    // The answer for the first session arrives while the second is asked about, and changes nothing the person sees.
    await answer(0, { ...QUESTION, body: 'Something else.' });
    expect(guard.getSnapshot()).toBe(onScreen);
    // A yes closes the session that the question names.
    expect(guard.confirm()).toMatchObject({ status: 'done', closed: ids[1] });
    expect(store.getSnapshot().sessions[ids[1] ?? '']).toBeUndefined();
    expect(store.getSnapshot().sessions[ids[0] ?? '']).toBeDefined();
  });

  it('asks about the session that waited when the one on screen is confirmed: its own question and its own name, and a yes then closes that one', async () => {
    const { store, guard, guarded, ids, answer } = asyncRig();
    guarded.closeSession(ids[0] ?? '');
    guarded.closeSession(ids[1] ?? '');
    await answer(1, QUESTION);
    await answer(0, { ...QUESTION, body: 'Something else.' });
    guard.confirm();
    expect(guard.getSnapshot()).toEqual({ session: ids[0], name: 'one', question: { ...QUESTION, body: 'Something else.' } });
    expect(guard.confirm()).toMatchObject({ status: 'done', closed: ids[0] });
    expect(store.getSnapshot().sessions[ids[0] ?? '']).toBeUndefined();
    expect(guard.getSnapshot()).toBeNull();
  });

  it('asks about the session that waited when the one on screen is cancelled: nothing was closed, and the next question is the one that waited', async () => {
    const { store, guard, guarded, ids, answer } = asyncRig();
    guarded.closeSession(ids[0] ?? '');
    guarded.closeSession(ids[1] ?? '');
    await answer(1, QUESTION);
    await answer(0, QUESTION);
    guard.cancel();
    expect(guard.getSnapshot()?.session).toBe(ids[0]);
    guard.cancel();
    expect(guard.getSnapshot()).toBeNull();
    expect(Object.keys(store.getSnapshot().sessions)).toHaveLength(3);
  });

  it('asks in the order the answers came, one at a time: what came first waits behind what is on screen, and what came after waits behind that', async () => {
    const { guard, guarded, ids, answer } = asyncRig();
    for (const id of ids) {
      guarded.closeSession(id);
    }

    await answer(1, QUESTION);
    await answer(2, QUESTION);
    await answer(0, QUESTION);
    expect(guard.getSnapshot()?.session).toBe(ids[1]);
    guard.cancel();
    expect(guard.getSnapshot()?.session).toBe(ids[2]);
    guard.cancel();
    expect(guard.getSnapshot()?.session).toBe(ids[0]);
    guard.cancel();
    expect(guard.getSnapshot()).toBeNull();
  });

  it('does not ask the producer again for a session whose question is on screen: the press is refused at once and the producer is called once, so no later answer can close the session under its own dialog', async () => {
    const { store, guard, guarded, ids, answer, questionOf, closedLater } = asyncRig();
    guarded.closeSession(ids[1] ?? '');
    await answer(0, QUESTION);
    const onScreen = guard.getSnapshot();
    expect(guarded.closeSession(ids[1] ?? '').status).toBe('refused');
    expect(questionOf).toHaveBeenCalledTimes(1);
    expect(guard.getSnapshot()).toBe(onScreen);
    expect(store.getSnapshot().sessions[ids[1] ?? '']).toBeDefined();
    expect(closedLater).not.toHaveBeenCalled();
  });

  it('does not ask the producer again for a session whose question waits behind the one on screen: each session is asked once, and what comes for a session that waits adds nothing', async () => {
    const { guard, guarded, ids, answer, questionOf } = asyncRig();
    guarded.closeSession(ids[0] ?? '');
    guarded.closeSession(ids[1] ?? '');
    await answer(1, QUESTION);
    await answer(0, QUESTION);
    // Each is pressed again: the one on screen and the one that waits have been asked about.
    expect(guarded.closeSession(ids[0] ?? '').status).toBe('refused');
    expect(guarded.closeSession(ids[1] ?? '').status).toBe('refused');
    expect(questionOf).toHaveBeenCalledTimes(2);
    expect(guard.getSnapshot()?.session).toBe(ids[1]);
    guard.cancel();
    expect(guard.getSnapshot()?.session).toBe(ids[0]);
    guard.cancel();
    expect(guard.getSnapshot()).toBeNull();
  });

  it('ends every question about a session it closes itself: one that came for the session while the close was being made is dropped with it, and is not left on screen naming a session that is gone', async () => {
    let counter = 0;
    const store = createPanelStore({ now: () => 1_000, newId: () => `s${String(++counter)}` });
    store.registerTool({ id: 'terminal', label: 'Terminal', icon: 'square-terminal', order: 10 });
    const opened = store.openSession({ tool: 'terminal', plugin: HOST, title: 'one', state: 'running' });
    const id = opened.status === 'done' ? opened.id : '';
    // The producer first says that nothing runs. The guard looks where the focus is right before it closes, and a press of the same close that comes at that moment finds a question for the person.
    let asks = 0;
    let looks = 0;
    let guarded: PanelStore | undefined;
    const guard = createCloseGuard({
      questionOf: (): CloseQuestion | undefined | Promise<CloseQuestion | undefined> => {
        asks += 1;
        return asks === 1 ? Promise.resolve(undefined) : QUESTION;
      },
      nameOf: () => 'one',
      focused: () => {
        looks += 1;
        if (looks === 2) {
          guarded?.closeSession(id);
        }

        return false;
      },
    });
    guarded = guard.guard(store);
    guarded.closeSession(id);
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }

    expect(asks).toBe(2);
    expect(store.getSnapshot().sessions[id]).toBeUndefined();
    expect(guard.getSnapshot()).toBeNull();
  });

  it('skips a question whose session is gone when its turn comes: nothing to close and nobody to ask', async () => {
    const { store, guard, guarded, ids, answer } = asyncRig();
    for (const id of ids) {
      guarded.closeSession(id);
    }

    await answer(1, QUESTION);
    await answer(0, QUESTION);
    await answer(2, QUESTION);
    store.closeSession(ids[0] ?? '');
    guard.cancel();
    expect(guard.getSnapshot()?.session).toBe(ids[2]);
    guard.cancel();
    expect(guard.getSnapshot()).toBeNull();
  });

  it('moves from a question to the one that waited in ONE change: the dialog is never closed in between, so whoever holds notices back for it is not told that it left', async () => {
    const { guard, guarded, ids, answer } = asyncRig();
    guarded.closeSession(ids[0] ?? '');
    guarded.closeSession(ids[1] ?? '');
    await answer(1, QUESTION);
    await answer(0, QUESTION);
    const seen: Array<ClosePrompt | null> = [];
    guard.subscribe(() => {
      seen.push(guard.getSnapshot());
    });
    guard.confirm();
    expect(seen.map((prompt) => prompt?.session)).toEqual([ids[0]]);
    guard.cancel();
    expect(seen.map((prompt) => prompt?.session)).toEqual([ids[0], undefined]);
  });

  it('goes on closing sessions that have no question the way it did: at once, in the same call', () => {
    const { store, guarded, ids } = rig();
    expect(guarded.closeSession(ids[0] ?? '')).toMatchObject({ status: 'done' });
    expect(store.getSnapshot().sessions[ids[0] ?? '']).toBeUndefined();
  });
});
