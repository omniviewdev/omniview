import { createElement, type ReactElement } from 'react';
import type { PanelStore, Session } from '../../core/panel';
import type { PanelCard, PanelEmpty, PanelNewSession } from '../host';
import { terminalCardOf } from './card';
import { ClosePrompt } from './ClosePrompt';
import { createCloseGuard } from './closeGuard';
import type { EngineLoader } from './engine';
import type { TerminalTarget } from './feed';
import { localShellTarget } from './localShell';
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

export type Terminals = {
  readonly sessions: TerminalSessions;
  /** The store the panel is given: the host's own, with a close that asks first for a terminal that runs. */
  readonly store: PanelStore;
  /** Starts listening to the panel; returns what stops it (the window is going: every process is closed). */
  readonly attach: () => () => void;
  /** What the `+` of the tool and the button of its empty state start. */
  readonly newSession: PanelNewSession;
  readonly empty: PanelEmpty;
  readonly bodyOf: (session: Session, visible: boolean) => ReactElement;
  readonly cardOf: (session: Session) => PanelCard;
  /** The dialog of the close question: drawn once, anywhere in the window. */
  readonly prompt: ReactElement;
};

/** The registry, the guard and the answers of the Terminal tool over a window's panel store. */
export function createTerminals(store: PanelStore, options: TerminalsOptions = {}): Terminals {
  const sessions = createTerminalSessions(store);
  const guard = createCloseGuard({
    // Only a terminal asks: a session of another tool closes as it always did.
    questionOf: (id) => (store.getSnapshot().sessions[id]?.tool === TERMINAL_TOOL_ID ? closeQuestionOf(sessions.recordOf(id)?.snapshot) : undefined),
    nameOf: (id) => {
      const session = store.getSnapshot().sessions[id];
      return session === undefined ? '' : session.scope === '' ? session.title : `${session.title} · ${session.scope}`;
    },
  });
  return {
    sessions,
    store: guard.guard(store),
    attach: sessions.attach,
    newSession: {
      label: NEW_TERMINAL,
      start: () => {
        sessions.open(options.target?.() ?? localShellTarget(), { focus: true });
      },
    },
    empty: TERMINAL_EMPTY,
    bodyOf: (session, visible) => createElement(TerminalBody, { sessions, session, visible, load: options.load }),
    cardOf: (session) => terminalCardOf(sessions.recordOf(session.id)),
    prompt: createElement(ClosePrompt, { guard }),
  };
}
