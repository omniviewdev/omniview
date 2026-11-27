import { createElement, type ReactElement } from 'react';
import { platformOf } from '../../core/chords';
import type { NoticesStore } from '../../core/notices';
import { roomForPane, type PanelStore, type Session, type SessionId } from '../../core/panel';
import type { PanelCard, PanelEmpty, PanelNewSession } from '../host';
import { focusTab } from '../focus';
import { terminalCardOf } from './card';
import { ClosePrompt } from './ClosePrompt';
import { createCloseGuard } from './closeGuard';
import type { EngineLoader } from './engine';
import type { TerminalBusy, TerminalDirectory, TerminalFeedHandle, TerminalRestart, TerminalTarget } from './feed';
import { createFinishedNotices } from './finishedNotice';
import { keyOf } from './keys';
import { localHereTarget, localProfileTarget, localShellTarget } from './localShell';
import { appTerminalPreferences, type PreferencesSource } from './preferences';
import { appShellList, shellMenu, type ShellChoice, type ShellList, type TerminalProfile } from './profiles';
import { clearScreenIn } from './screen';
import { createScreenReaderChoice, type ScreenReaderChoice } from './screenReader';
import { closeQuestionOf, type CloseQuestion } from './state';
import { TerminalBody } from './TerminalBody';
import { createTerminalSessions, type TerminalSessions } from './TerminalSessions';
import { CHOOSE_SHELL, NEW_TERMINAL, TERMINAL_EMPTY, TERMINAL_TOOL_ID } from './tool';

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

/** Whether the window is shown to the person: the document is visible (it is not minimised, and not on another desktop or tab). */
function documentIsVisible(): boolean {
  return document.visibilityState === 'visible';
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
  /** The shells of this machine the `+` offers beside its default (#695 step 2). Default: what the host lists. A test gives its own list. */
  readonly shells?: ShellList | undefined;
  /** What "New terminal" starts: a target the registry opens. Default: the host's own shell. A probe gives a synthetic one. */
  readonly target?: (() => TerminalTarget) | undefined;
  /** What "New terminal here" starts, given where the terminal it was opened from is: a target the registry opens. Default: the host's own shell, started there. A probe gives a synthetic one. */
  readonly here?: ((where: TerminalDirectory) => TerminalTarget) | undefined;
  /** Where the emulator's code comes from. Default: the lazy chunk. A test gives a fake emulator. */
  readonly load?: EngineLoader | undefined;
  /**
   * What the window asks the host for, once, when it attaches: the targets of the terminals this page holds a capability for (the host's own shell lists them through the channel). Each is opened as a session: a saved tab whose id is the
   * target's `sessionId` is given its feed again, and a terminal that runs and has no saved tab gets a tab of its own, neither of them shown or focused. A terminal that had already ended (`TerminalTarget.ended`) is given
   * only to a saved tab that holds its id: the host keeps it listed for the rest of its lease even after the person closed its tab, so one that no tab holds is skipped, not opened and not said. A rejection is one warning
   * on the console and nothing else: the saved tabs stay ended, which is also what an app restart looks like (the host lists no terminal that is gone). Absent: nothing is asked.
   */
  readonly restore?: (() => Promise<readonly TerminalTarget[]>) | undefined;
  /**
   * What attaches the terminal of a session again (T2d): the target for the session's id, which `TerminalSessions.takeBack` opens when the person takes back a terminal another tab took over and has left (the host's own
   * shell makes it with the page's key), after the host has been asked who holds it. Absent: a terminal this window lost cannot be taken back.
   */
  readonly reattach?: ((session: string, lost?: TerminalFeedHandle) => TerminalTarget) | undefined;
  /**
   * What makes the target that starts a terminal in place of an ended one (#695 step 5): given what the ended feed said a restart is made from and the id of the session, the target the registry opens in that session (the host's own shell makes it
   * with a fresh id, the ended terminal's shell, directory and environment). Absent: the lane of an ended terminal offers no Restart.
   */
  readonly restart?: ((restart: TerminalRestart, session: string) => TerminalTarget) | undefined;
  /**
   * What opens an address outside the app (T3a): the window's own way to do it (the system browser, through the runtime), which the Terminal tool calls with the address of a link a person followed in a terminal's output. The tool draws
   * a link only when it was given one (`TerminalSessions.canOpenExternal`: no dead link), and gives it only http and https addresses; a way that throws or rejects is one warning on the console and nothing else. Absent: no link is drawn.
   */
  readonly openExternal?: ((url: string) => void | Promise<void>) | undefined;
  /**
   * The window's notices (the shell's `core/notices` store): the tool tells them of a command that ran long in a terminal that is not in front (`finishedNotice.ts`), once for each command, with a Show that brings the terminal forward and moves
   * its view to the command. Absent: the window says nothing of a finished command.
   */
  readonly notices?: Pick<NoticesStore, 'notify'> | undefined;
  /** The person's terminal settings, as every terminal reads them (`preferences.ts`). Default: the host's settings service, asked when the first terminal is shown and never before. */
  readonly preferences?: PreferencesSource | undefined;
  /** Whether the window is shown to the person (not minimised, not on another desktop): a terminal in front of a window nobody looks at is not in front. Default: the document is visible. */
  readonly windowShown?: (() => boolean) | undefined;
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
  /**
   * Starts listening to the panel, asks the host for the terminals that were left for this window (`TerminalsOptions.restore`, once for the life of the window, however many times it attaches) and listens for the page going
   * away. Returns what stops it (the window is going): a terminal that can be left is left to live out its lease, and the others are closed. A terminal whose tab the person closes is closed.
   */
  readonly attach: () => () => void;
  /** Takes the keys of a terminal that has the focus from the window: Command K clears it, and is also the palette's chord. Returns what stops listening. It must be called before the window's own listeners are added: a key goes to them in that order. */
  readonly takeKeys: () => () => void;
  /** What the `+` of the tool and the button of its empty state start. */
  readonly newSession: PanelNewSession;
  /**
   * "New terminal here" of the session: asks the session's feed where its terminal is (`TerminalFeedHandle.directory`: the host's fact, never the page's guess) and opens a new terminal there, on screen and focused; a terminal whose
   * directory is unknown starts in the host's default directory and says so. A session with no feed, or whose feed cannot say, opens nothing. Resolves once the new terminal is opened.
   */
  readonly openHere: (session: SessionId) => Promise<void>;
  /**
   * "Split terminal" of the session (#697 step 6): the same host's fact as `openHere`, in a NEW pane beside the one the session is in, never a copy of its process. `extent` is the length the panes would share along the deck, which the
   * layout measured; with no room for another pane (each needs 80 px) nothing is asked of the host and nothing starts. A session whose feed cannot say where it is opens nothing, as `openHere` does.
   */
  readonly splitHere: (session: SessionId, extent: number) => Promise<void>;
  /** Whether `splitHere` can apply to the session: its feed can say where the terminal is. */
  readonly canSplit: (session: SessionId) => boolean;
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
  const { restore, reattach, restart, openExternal } = options;
  // The shells the `+` offers: the list is asked of the host when the menu is first drawn (and never while it is not), and the items are made again only when the list changes.
  const shells = options.shells ?? appShellList();
  const preferences = options.preferences ?? appTerminalPreferences();
  const startFrom = (profile: TerminalProfile) => {
    sessions.open(localProfileTarget(profile), { focus: true });
  };

  let itemsOf: readonly ShellChoice[] | undefined;
  let items: ReturnType<typeof shellMenu> = [];
  const menuItems = () => {
    const choices = shells.getSnapshot();
    if (choices !== itemsOf) {
      itemsOf = choices;
      items = shellMenu(choices, startFrom);
    }

    return items;
  };

  // A command that finished is told to the window's notices when it ran long in a terminal that is not in front. In front is the session on screen in an open panel, in a window that is shown; Show brings the terminal forward, and the body
  // that shows it moves its view to the command (`TerminalSessions.requestJump`).
  const finishedNotices =
    options.notices === undefined
      ? undefined
      : createFinishedNotices({
        notices: options.notices,
        shown: (session) => store.selectors.isShown(store.getSnapshot(), session) && (options.windowShown ?? documentIsVisible)(),
        show: (session, command, generation) => {
          store.revealSession(session);
          if (!sessions.requestJump(session, command, generation)) {
            options.notices?.notify({ title: 'That terminal was closed', detail: 'The command is no longer in any terminal.', severity: 'info', initiator: 'system' });
          }
        },
        nameOf: (session) => store.selectors.sessionItem(store.getSnapshot(), session)?.name,
      });
  const sessions = createTerminalSessions(store, { reattach, restart, openExternal, finished: finishedNotices?.finished });
  const screenReader = createScreenReaderChoice(restored.screenReader);
  // What the host said of the terminals left for this window, until a window that is attached opens them; whether it was asked (once for the life of the window: a development build attaches, stops and attaches again);
  // and how many attaches are on.
  let asked = false;
  let waiting: readonly TerminalTarget[] | undefined;
  let attached = 0;

  /**
   * Opens what the host listed, when a window is attached: the saved tab of each terminal gets its feed again, and a terminal that runs and that no tab holds gets a tab of its own, in the strip and not on screen (a
   * restored terminal must not cover the page). A terminal that had already ended is opened only for a saved tab that still holds its id (the panel has a session of it now: the person may have closed the tab since it
   * was saved, even while the host was being asked), and is otherwise skipped before anything is attached at the host: closing the tab of an ended terminal does not dismiss it there, so it would come back with every reload.
   */
  const openFound = (): void => {
    const targets = waiting;
    if (targets === undefined || attached === 0) {
      return;
    }

    waiting = undefined;
    for (const target of targets) {
      const held = target.sessionId !== undefined && Object.hasOwn(store.getSnapshot().sessions, target.sessionId);
      if (target.ended === true && !held) {
        continue;
      }

      sessions.open(target, { reveal: false });
    }
  };

  /** Asks the host, once, for the terminals left for this window. An answer that comes while no window is attached waits for the next one; one that never comes, or is a refusal, leaves the saved tabs as they are. */
  const findTerminals = (): void => {
    if (asked || restore === undefined) {
      return;
    }

    asked = true;
    void (async () => {
      try {
        waiting = await restore();
      } catch (error) {
        console.warn('[panel] the terminals left for this window could not be found again', error);
        return;
      }

      openFound();
    })();
  };

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

  // The directory comes from the session's own feed and from nothing the page knows: the host's `ChannelTerminalCwd` while the shell runs, the directory it started in once it ended or was lost. A feed that throws instead of
  // saying `unknown` is a feed that could not say, and the terminal opens in the host's default directory all the same.
  const openHere = async (session: SessionId, split?: { readonly extent: number }): Promise<void> => {
    const feed = sessions.feedOf(session);
    if (feed?.directory === undefined) {
      return;
    }

    let where: TerminalDirectory;
    try {
      where = await feed.directory();
    } catch {
      where = { state: 'unknown', reason: 'unanswered' };
    }

    sessions.open(options.here?.(where) ?? localHereTarget(where), { focus: true, ...(split === undefined ? {} : { split }) });
  };

  const splitHere = async (session: SessionId, extent: number): Promise<void> => {
    // The room is asked before the host is: a split with no room starts no process.
    if (!roomForPane(store.getSnapshot(), TERMINAL_TOOL_ID, extent)) {
      return;
    }

    await openHere(session, { extent });
  };

  return {
    screenReader,
    sessions,
    store: guard.guard(store),
    attach: () => {
      const stop = sessions.attach();
      // The page going away (a reload, a closed tab, a navigation: `pagehide`) leaves the terminals to the host's lease at once, instead of waiting for the host to notice that the page is gone.
      const hide = (): void => {
        sessions.leave();
      };

      window.addEventListener('pagehide', hide);
      // A terminal whose watcher was lost cannot be told when it is free: when the person comes back to the tab the host is asked, once, with no timer.
      const shown = (): void => {
        if (document.visibilityState === 'visible') {
          sessions.refreshUnwatched();
        }
      };

      document.addEventListener('visibilitychange', shown);
      attached += 1;
      findTerminals();
      openFound();
      let on = true;
      return () => {
        if (!on) {
          return;
        }

        on = false;
        attached -= 1;
        window.removeEventListener('pagehide', hide);
        document.removeEventListener('visibilitychange', shown);
        stop();
      };
    },
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
      menu: {
        label: CHOOSE_SHELL,
        subscribe: shells.subscribe,
        getSnapshot: menuItems,
      },
    },
    empty: TERMINAL_EMPTY,
    openHere: async (session) => openHere(session),
    splitHere,
    canSplit: (session) => sessions.feedOf(session)?.directory !== undefined,
    bodyOf: (session, visible) =>
      createElement(TerminalBody, {
        sessions,
        session,
        visible,
        load: options.load,
        screenReader,
        preferences,
        name: store.selectors.sessionItem(store.getSnapshot(), session.id)?.name,
        onNewHere: (id) => {
          void openHere(id);
        },
        canSplit: sessions.feedOf(session.id)?.directory !== undefined,
        onSplit: (id, extent) => {
          void splitHere(id, extent);
        },
      }),
    cardOf: (session) => terminalCardOf(sessions.recordOf(session.id)),
    prompt: createElement(ClosePrompt, { guard }),
    modal: { subscribe: guard.subscribe, open: () => guard.getSnapshot() !== null },
  };
}
