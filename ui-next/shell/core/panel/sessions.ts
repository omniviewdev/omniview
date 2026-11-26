import { normaliseRoute } from '../tabs/route';
import { effectiveSession, identifier, isLive, own, patch, refuse, sessionVisible, settle, unchanged, visibleSessions, type Context, type Step } from './state';
import { LIMITS, type CloseResult, type OpenResult, type PanelResult, type PanelState, type Route, type Session, type SessionId, type SessionInput, type SessionState } from './types';

// The sessions of the panel: opening one, what it is doing, closing it. A session is a record of what the user is looking at (a log stream, a shell), owned by the plugin that opened it; its
// output and its connection live where the owner keeps them, and the record says no more than a tab and a card need.

/** The words a person reads, cut to the limit. Identifiers are not words (`identifier`). */
const text = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, LIMITS.text) : '');
/** An id is kept as it is given (a plugin may hold it); only an empty one is refused. */
const idText = (value: unknown): string => (typeof value === 'string' && value.trim() !== '' ? value : '');

const settled = (state: SessionState): boolean => state === 'ended' || state === 'failed';

/** The id a new session gets: one nobody has used, even from a generator that repeats. */
function freshId(state: PanelState, newId: () => SessionId): SessionId {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = newId();
    if (id !== '' && own(state.sessions, id) === undefined) {
      return id;
    }
  }

  throw new Error('newId keeps answering ids that are taken');
}

export type OpenOptions = {
  /**
   * The user started this session, so the panel opens on it (S116). A session that is restored, adopted from another window or brought back by a retry says `false`: S116's "do not open it (today's quiet-tab rule)", so it opens no panel
   * and moves neither the tool nor the session on screen. What a reload brings back open is the saved panel's own flag (`restorePanel`, T2d), never a session's. Default: true.
   */
  readonly reveal?: boolean | undefined;
};

/**
 * Opens a session in a tool. It is kept even when its tool is not registered yet (a plugin's interface may still be loading): it shows when the tool does, and opens nothing before. A
 * plugin that is not live cannot open one.
 */
export function openSession(state: PanelState, input: SessionInput, ctx: Context, options: OpenOptions = {}): Step<OpenResult> {
  const tool = identifier(input.tool);
  const plugin = identifier(input.plugin);
  const title = text(input.title);
  if (tool === '' || plugin === '' || title === '') {
    return refuse(state, 'invalid', 'A session needs a tool, a plugin and a title.');
  }

  let route: Route | undefined;
  if (input.route !== undefined && input.route !== null) {
    route = normaliseRoute(input.route);
    if (route === undefined) {
      return refuse(state, 'invalid', 'The resource of a session is a route: a plugin, a page and plain parameters.');
    }
  }

  if (!isLive(state, plugin)) {
    return refuse(state, 'missing', `The plugin ${plugin} is not live.`);
  }

  const wanted = input.id === undefined ? undefined : idText(input.id);
  if (wanted === '') {
    return refuse(state, 'invalid', 'A session id is not empty.');
  }

  if (wanted !== undefined && own(state.sessions, wanted) !== undefined) {
    return refuse(state, 'taken', `There is a session ${wanted} already.`);
  }

  const id = wanted ?? freshId(state, ctx.newId);
  const initial = input.state ?? 'starting';
  const session: Session = Object.freeze({
    id,
    tool,
    plugin,
    title,
    scope: text(input.scope),
    state: initial,
    since: ctx.now(),
    cause: settled(initial) ? text(input.cause) : '',
    ...(route === undefined ? {} : { route }),
  });
  let next = patch(state, {
    sessions: Object.freeze({ ...state.sessions, [id]: session }),
    order: Object.freeze([...state.order, id]),
  });
  // The panel opens on a session the user started, when its tab can be drawn: a tool that is not there (yet) is nothing to open the panel on.
  if ((options.reveal ?? true) && sessionVisible(next, session)) {
    next = patch(next, { open: true, tool, active: Object.freeze({ ...next.active, [tool]: id }) });
  }

  return { state: settle(next), result: { status: 'done', id } };
}

export type StateChange = { readonly state: SessionState; readonly cause?: string | undefined };

/**
 * What a session came to. A change of state moves `since`; the cause comes with an end or a failure and is dropped by anything else. The same state and cause change nothing. A held session (A21) is
 * over: it was ended by its plugin's unload and is kept as it is, so nothing it hears afterwards, from the stream that was closed or from its plugin when it returns, can start it again or give it
 * another end.
 */
export function setSessionState(state: PanelState, id: SessionId, change: StateChange, now: number): Step<PanelResult> {
  const session = own(state.sessions, id);
  if (session === undefined) {
    return refuse(state, 'missing', `There is no session ${id}.`);
  }

  if (session.held === true) {
    return refuse(state, 'held', `The session ${id} ended when its plugin was unloaded and is kept as it is until it is closed.`);
  }

  const cause = settled(change.state) ? text(change.cause) : '';
  if (session.state === change.state && session.cause === cause) {
    return unchanged(state);
  }

  const moved = session.state !== change.state;
  const next: Session = Object.freeze({ ...session, state: change.state, cause, since: moved ? now : session.since });
  return { state: settle(patch(state, { sessions: Object.freeze({ ...state.sessions, [id]: next }) })), result: { status: 'done' } };
}

/** Characters a title never holds: controls (C0, DEL, C1), line and paragraph separators, format characters that draw nothing or reorder (zero-width, bidirectional, the tags: all of Cf but the joiner an emoji sequence is made of) and the fillers. A title is drawn on one line as text, and nothing in it may carry an escape sequence or reorder the tab's words. */
const NOT_IN_A_TITLE = /[\p{Cc}\u2028\u2029\u115f\u1160\u3164\uffa0\u2800]|(?![\u200c\u200d])\p{Cf}/gu;

/** A title as the model keeps it: the words of `text` without what a title never holds. */
const titleText = (value: unknown): string => (typeof value === 'string' ? text(value.replaceAll(NOT_IN_A_TITLE, '')) : '');

/**
 * The title of a session, from its owner (`pinned` false) or from the person (`pinned` true). The title is cut as an opened session's is and has no control character. Only the title (and the pin) change, so the state, the
 * time, the place and the choices of the session are as they were; the tab's name, its twins and its ordinal follow from the snapshot (`selectors`). The same title changes nothing. A held session (A21) is over and never
 * changes again, so it is refused like a change of its state. A session the person named refuses its owner's naming, until the person clears the name (an empty title from them).
 */
function titled(state: PanelState, id: SessionId, title: string, pinned: boolean): Step<PanelResult> {
  const session = own(state.sessions, id);
  if (session === undefined) {
    return refuse(state, 'missing', `There is no session ${id}.`);
  }

  if (session.held === true) {
    return refuse(state, 'held', `The session ${id} ended when its plugin was unloaded and is kept as it is until it is closed.`);
  }

  if (!pinned && session.titlePinned === true) {
    return refuse(state, 'pinned', `The session ${id} has the name its user gave it.`);
  }

  const cut = titleText(title);
  if (cut === '' && pinned && session.titlePinned === true) {
    // An empty name undoes the person's name: the title stays as it is until its owner names the session again, and the owner may.
    const { titlePinned: _named, ...rest } = session;
    return { state: settle(patch(state, { sessions: Object.freeze({ ...state.sessions, [id]: Object.freeze(rest) }) })), result: { status: 'done' } };
  }

  if (cut === '') {
    return refuse(state, 'invalid', 'A session needs a title.');
  }

  if (cut === session.title && (!pinned || session.titlePinned === true)) {
    return unchanged(state);
  }

  const next: Session = Object.freeze({ ...session, title: cut, ...(pinned ? { titlePinned: true as const } : {}) });
  return { state: settle(patch(state, { sessions: Object.freeze({ ...state.sessions, [id]: next }) })), result: { status: 'done' } };
}

/**
 * Gives a session another title: what its tab is called once its owner knows more than it did when it opened it (the name of the shell its host resolved, a title the program set). A session the person named
 * (`renameSession`) is refused: their name stands.
 */
export function retitleSession(state: PanelState, id: SessionId, title: string): Step<PanelResult> {
  return titled(state, id, title, false);
}

/** The person names a session: its title is theirs from now on, saved with the session, and its owner's naming no longer changes it (`retitleSession` is refused). */
export function renameSession(state: PanelState, id: SessionId, title: string): Step<PanelResult> {
  return titled(state, id, title, true);
}

/**
 * Closes a session: its tab and its body go, and the session on screen passes to the one after it in its tool's strip, else the one before (as a closed tab does). The panel stays as it
 * is: a tool with no session left shows its empty state. Whoever owns the session's work stops it when its body unmounts (the host's viewer, or the plugin's body).
 */
export function closeSession(state: PanelState, id: SessionId): Step<CloseResult> {
  const session = own(state.sessions, id);
  if (session === undefined) {
    return refuse(state, 'missing', `There is no session ${id}.`);
  }

  const strip = visibleSessions(state, session.tool).map((one) => one.id);
  const at = strip.indexOf(id);
  const onScreen = effectiveSession(state, session.tool) === id;
  const neighbour = strip[at + 1] ?? strip[at - 1];
  const { [id]: _closed, ...sessions } = state.sessions;
  const { [session.tool]: current, ...others } = state.active;
  let active: Readonly<Record<string, SessionId>> = state.active;
  if (onScreen && neighbour !== undefined) {
    active = { ...others, [session.tool]: neighbour };
  } else if (current === id) {
    active = others;
  }

  const next = patch(state, { sessions: Object.freeze(sessions), order: Object.freeze(state.order.filter((one) => one !== id)), active: Object.freeze(active), mounted: Object.freeze(state.mounted.filter((one) => one !== id)) });
  const settledState = settle(next);
  return { state: settledState, result: { status: 'done', closed: id, active: effectiveSession(settledState, session.tool) } };
}
