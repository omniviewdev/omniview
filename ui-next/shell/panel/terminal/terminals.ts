import { createElement, type ReactElement } from 'react';
import { platformOf } from '../../core/chords';
import type { PanelStore, Session, SessionId } from '../../core/panel';
import type { PanelCard, PanelEmpty, PanelNewSession } from '../host';
import { focusTab } from '../focus';
import { terminalCardOf } from './card';
import { ClosePrompt } from './ClosePrompt';
import { createCloseGuard } from './closeGuard';
import type { EngineLoader } from './engine';
import type { TerminalBusy, TerminalTarget } from './feed';
import { keyOf } from './keys';
import { localShellTarget } from './localShell';
import { clearScreenIn } from './screen';
import { createScreenReaderChoice, type ScreenReaderChoice } from './screenReader';
import { closeQuestionOf, type CloseQuestion } from './state';
import { TerminalBody } from './TerminalBody';
import { createTerminalSessions, type TerminalSessions } from './TerminalSessions';
import { NEW_TERMINAL, TERMINAL_EMPTY, TERMINAL_TOOL_ID } from './tool';

/**
 * How long a close waits for the host to say what runs in the terminal before it asks the general question: a press of Close always leads somewhere, and a host that does not answer is a host that cannot say
 * (`unknown`: ask).
 */
export const ASK_MS = 1_500;

/** The host's answer to "what runs in it", or `unknown` when it does not come in time or the question fails: a question that was not answered is never "nothing runs". */
async function answered(question: Promise<TerminalBusy>): Promise<TerminalBusy> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ state: 'unknown' });
    }, ASK_MS);
    question.then(
      (answer) => {
        clearTimeout(timer);
        resolve(answer);
      },
      () => {
        clearTimeout(timer);
        resolve({ state: 'unknown' });
      },
    );
  });
}

/**
 * Whether the keyboard is on something of this session: its own tab in the strip of session tabs, with the pointer's close button beside it (where a close with Delete leaves it, and where a mouse press does: the button goes
 * with the tab, and the focus on it must not be dropped) or, while the session is the one on screen, its body (the emulator's input and its toolbar: where the close chord leaves it). The focus on another session's tab, close
 * button or body, on the tool's tab, the `+`, the splitter or the page belongs to nobody that closes: the person is elsewhere, and what follows a close must leave the focus there.
 */
function focusIsOn(session: SessionId, onScreen: SessionId | null): boolean {
  const { activeElement } = document;
  if (activeElement === null) {
    return false;
  }

  // The tab and its close button are the two controls of one item of the strip, which carries the session's id.
  const item = activeElement.closest('[data-shell-part="sessionTabs"] [data-tab-id]');
  if (item !== null) {
    return item.getAttribute('data-tab-id') === session;
  }

  return onScreen === session && activeElement.closest('[data-shell-part="terminalBody"]') !== null;
}

// The Terminal tool as the host plugs it in (docs/ui-next/status/T1.md): the registry of its feeds, the close guard with its dialog, and the answers the panel asks of a tool, behind one object, so that the
// host's wiring is a line for each thing the panel asks and the tool's own rules stay in this folder.

export type TerminalsOptions = {
  /** What "New terminal" starts: a target the registry opens. Default: the host's own shell. A probe gives a synthetic one. */
  readonly target?: (() => TerminalTarget) | undefined;
  /** Where the emulator's code comes from. Default: the lazy chunk. A test gives a fake emulator. */
  readonly load?: EngineLoader | undefined;
};

/** What the window restored of the tool's own state (`shell/session`). Nothing restored is the tool as it starts. */
export type TerminalsRestored = {
  /** Whether the person chose screen reader mode in an earlier run. Default: off. */
  readonly screenReader?: boolean | undefined;
};

export type Terminals = {
  readonly sessions: TerminalSessions;
  /** The store the panel is given: the host's own, with a close that asks first for a terminal that runs. */
  readonly store: PanelStore;
  /** Starts listening to the panel; returns what stops it (the window is going: every process is closed). */
  readonly attach: () => () => void;
  /** Takes the keys of a terminal that has the focus from the window: Command K clears it, and is also the palette's chord. Returns what stops listening. It must be called before the window's own listeners are added: a key goes to them in that order. */
  readonly takeKeys: () => () => void;
  /** What the `+` of the tool and the button of its empty state start. */
  readonly newSession: PanelNewSession;
  /** The window's one screen reader choice: every terminal follows it (a terminal that is made later is made in it), and the session saves it. Off until the person turns it on. */
  readonly screenReader: ScreenReaderChoice;
  readonly empty: PanelEmpty;
  readonly bodyOf: (session: Session, visible: boolean) => ReactElement;
  readonly cardOf: (session: Session) => PanelCard;
  /** The dialog of the close question: drawn once, anywhere in the window. */
  readonly prompt: ReactElement;
  /** Whether the close question is open, and who hears it open and close: the window holds its timed notices behind a modal dialog, the palette's and this one. */
  readonly modal: { readonly subscribe: (listener: () => void) => () => void; readonly open: () => boolean };
};

/** The registry, the guard and the answers of the Terminal tool over a window's panel store. */
export function createTerminals(store: PanelStore, options: TerminalsOptions = {}, restored: TerminalsRestored = {}): Terminals {
  const sessions = createTerminalSessions(store);
  const screenReader = createScreenReaderChoice(restored.screenReader);
  const guard = createCloseGuard({
    // Only a terminal asks: a session of another tool closes as it always did. A terminal whose feed can say what runs in it is asked at the moment of the close (the host's `IsBusy`: one call, no polling), and asks
    // only when something runs, the host cannot tell, or typing may have started a program that its answer does not know (an `idle` is true of the moment the host looked); one that cannot say is asked the general question at once.
    questionOf: (id): CloseQuestion | undefined | Promise<CloseQuestion | undefined> => {
      if (store.getSnapshot().sessions[id]?.tool !== TERMINAL_TOOL_ID) {
        return undefined;
      }

      const snapshot = sessions.recordOf(id)?.snapshot;
      const feed = sessions.feedOf(id);
      if (snapshot?.state !== 'running' || feed?.busy === undefined) {
        return closeQuestionOf(snapshot);
      }

      const ask = feed.busy.bind(feed);
      // What the feed knew of the typing when the host was asked: how many calls it had taken, and whether any typing was still on its way to the process.
      const typedBefore = feed.inputs?.();
      const onItsWayBefore = feed.inputsSettled?.() === false;
      const asked = (async (): Promise<TerminalBusy> => ask())();
      return answered(asked).then((busy) => {
        // An `idle` is true of the moment the host looked, and typing may have started a program since or not have reached the shell yet. It is not one to close on unless the feed says that nothing was typed meanwhile (it counts
        // the calls of the typing, and none came) and that nothing was on its way, when the host was asked or now: then it is the general question, as for a host that cannot tell.
        const doubtful = busy.state === 'idle' && (typedBefore === undefined || feed.inputs?.() !== typedBefore || onItsWayBefore || feed.inputsSettled?.() === false);
        return closeQuestionOf(sessions.recordOf(id)?.snapshot, doubtful ? { state: 'unknown' } : busy);
      });
    },
    // A close that waited for the host and found nothing running is made by the guard, and the focus follows it as it does after the shell's own close paths: the neighbour tab, or the tool's tab when it was the last.
    // It follows only when the focus belonged to the session that closes at the press and still does when the close is made (its tab, or its body while it is on screen): a person who moved to another tab, the splitter or a
    // page control meanwhile, or who was never on the session, keeps the focus where it is.
    focused: (id) => focusIsOn(id, store.selectors.activeSession(store.getSnapshot(), TERMINAL_TOOL_ID)),
    closedLater: (result, focused) => {
      if (focused && result.status === 'done') {
        if (result.active === null) {
          focusTab('panelTools', TERMINAL_TOOL_ID);
        } else {
          focusTab('sessionTabs', result.active);
        }
      }
    },
    nameOf: (id) => {
      const state = store.getSnapshot();
      const session = state.sessions[id];
      // As the tab names it, with the ordinal of a twin (`zsh (2)`): two terminals of one shell are told apart in the question as they are in the strip.
      return store.selectors.sessionItem(state, id)?.name ?? (session === undefined ? '' : session.scope === '' ? session.title : `${session.title} · ${session.scope}`);
    },
  });
  return {
    screenReader,
    sessions,
    store: guard.guard(store),
    attach: sessions.attach,
    takeKeys: () => {
      const platform = platformOf(navigator);
      const listener = (event: KeyboardEvent) => {
        if (keyOf(event, platform, false) === 'clear' && clearScreenIn(event.target)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };

      window.addEventListener('keydown', listener, true);
      return () => {
        window.removeEventListener('keydown', listener, true);
      };
    },
    newSession: {
      label: NEW_TERMINAL,
      start: () => {
        sessions.open(options.target?.() ?? localShellTarget(), { focus: true });
      },
    },
    empty: TERMINAL_EMPTY,
    bodyOf: (session, visible) => createElement(TerminalBody, { sessions, session, visible, load: options.load, screenReader, name: store.selectors.sessionItem(store.getSnapshot(), session.id)?.name }),
    cardOf: (session) => terminalCardOf(sessions.recordOf(session.id)),
    prompt: createElement(ClosePrompt, { guard }),
    modal: { subscribe: guard.subscribe, open: () => guard.getSnapshot() !== null },
  };
}
