import { createElement, type ReactElement } from 'react';
import { platformOf } from '../../core/chords';
import type { PanelStore, Session } from '../../core/panel';
import type { PanelCard, PanelEmpty, PanelNewSession } from '../host';
import { terminalCardOf } from './card';
import { ClosePrompt } from './ClosePrompt';
import { createCloseGuard } from './closeGuard';
import type { EngineLoader } from './engine';
import type { TerminalTarget } from './feed';
import { keyOf } from './keys';
import { localShellTarget } from './localShell';
import { clearScreenIn } from './screen';
import { createScreenReaderChoice, type ScreenReaderChoice } from './screenReader';
import { closeQuestionOf } from './state';
import { TerminalBody } from './TerminalBody';
import { createTerminalSessions, type TerminalSessions } from './TerminalSessions';
import { NEW_TERMINAL, TERMINAL_EMPTY, TERMINAL_TOOL_ID } from './tool';

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
    // Only a terminal asks: a session of another tool closes as it always did.
    questionOf: (id) => (store.getSnapshot().sessions[id]?.tool === TERMINAL_TOOL_ID ? closeQuestionOf(sessions.recordOf(id)?.snapshot) : undefined),
    nameOf: (id) => {
      const session = store.getSnapshot().sessions[id];
      return session === undefined ? '' : session.scope === '' ? session.title : `${session.title} · ${session.scope}`;
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
    bodyOf: (session, visible) => createElement(TerminalBody, { sessions, session, visible, load: options.load, screenReader }),
    cardOf: (session) => terminalCardOf(sessions.recordOf(session.id)),
    prompt: createElement(ClosePrompt, { guard }),
    modal: { subscribe: guard.subscribe, open: () => guard.getSnapshot() !== null },
  };
}
