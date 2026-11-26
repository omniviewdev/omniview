import { menuTrigger, useMenu, type MenuTriggerAttributes } from '@omniviewdev/kit';
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type MouseEvent } from 'react';
import type { TerminalFeedSnapshot } from '../feed';
import type { TerminalScreen } from '../screen';
import { terminalMenu } from './terminalMenu';

// The terminal's context menu on the window's one menu host (docs/ui-next/status/kit-menus.md; T3a). The host opens a menu on a secondary click, Shift F10 or the Menu key, on the nearest element that carries the
// attributes of `menuTrigger(id, undefined, 'context')`, and runs an item's action after it gave the focus back to the element the menu came from. Three things make that work for a terminal:
//
//   - the trigger is two elements. The element the emulator draws in takes the pointer; the emulator's input (a textarea: where the keys go, so where Shift F10 is pressed) takes the keyboard, and so a click the emulator moves
//     its input under. The host leaves alone the secondary click and the keys of an editor that is not itself the trigger (so as not to take the browser's own menu from a text field), and the input is an editor to it: it has to
//     be the trigger. The emulator makes it, so the screen sets the attributes (`decorateInput`) and keeps them for the emulator it makes;
//   - the program's mouse comes first. While the program has asked for mouse reports (a full-screen editor with a mouse, `top`) the emulator reports a secondary click to it, and a menu over the program would be a second answer to
//     the same click: it is stopped before the host reads it (the host ignores an event that was cancelled, and the browser's own menu stays shut), unless Shift is held, which forces the menu as in VS Code
//     ("Shift click forces the context menu");
//   - the items are read when the menu opens, so Copy is as available as the selection is then, and Paste as the terminal's input; a change that makes an item unavailable while the menu is open closes it, and a person who opens it again reads the new state.

/** What the menu is called to a person who cannot see it (the Logs tool's overflow is "Logs actions"). */
export const TERMINAL_MENU_LABEL = 'Terminal actions';

/** What the menu needs of the screen: a real `TerminalScreen` has all of it, and a test makes one with these members only. */
export type TerminalMenuScreen = Pick<TerminalScreen, 'clear' | 'selectAll' | 'paste' | 'mouseReporting' | 'decorateInput' | 'subscribe' | 'getSnapshot'>;

export type TerminalMenuOptions = {
  /** The screen of the session. Before there is one (`undefined`) there is no menu to open. */
  readonly screen: TerminalMenuScreen | undefined;
  /** The feed's status, as the body already follows it while it is on screen (the menu holds no listener of its own on the feed, and a hidden body must hold none): Paste is available while the terminal takes input, and an open menu is put away when that changes. */
  readonly status: TerminalFeedSnapshot;
  /** Opens the find over the output: the Find item. */
  readonly openFind: () => void;
  /** Copies the selection, as the toolbar's Copy button does (it confirms itself and says when the clipboard refused): the Copy item. */
  readonly copy: () => void;
  /** "New terminal here": what it opens and whether this terminal can say where it is. Absent: the menu has no such item. */
  readonly here?: TerminalMenuHere | undefined;
};

/** What the screen's element is given: the attributes of the menu's trigger, and the one rule that keeps a click for the program. Spread it on the element the emulator draws in. */
export type TerminalMenuHost = MenuTriggerAttributes & {
  readonly 'data-ov-menu-label': string;
  readonly onContextMenuCapture: (event: MouseEvent<HTMLElement>) => void;
};

export type TerminalMenu = {
  readonly host: TerminalMenuHost;
};

/** "New terminal here" of the menu: what it opens, and whether this terminal can say where it is (its feed has a `directory`). */
export type TerminalMenuHere = { readonly open: () => void; readonly available: boolean };

const quiet = (): (() => void) => () => undefined;

/**
 * Pastes what the clipboard holds, as the person's own input (through the emulator, so that a program that asked for bracketed paste gets the text between its markers). The clipboard is read here, when Paste is chosen and never
 * before: reading it may ask the person's leave. A clipboard that refuses, or is not there (a page that is not secure has none), or is empty, is one warning and nothing more. `canPaste` says whether the terminal takes input now: it is
 * asked before the clipboard is read and again when the clipboard has answered, since the read can wait for the person and the terminal may have ended meanwhile, so that a paste has nowhere to go (it is left out without a word: the lane
 * says that the input is off).
 */
async function pasteInto(screen: TerminalMenuScreen | undefined, canPaste: () => boolean): Promise<void> {
  if (!canPaste()) {
    return;
  }

  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch (error) {
    console.warn('[terminal] nothing was pasted: the clipboard could not be read', error);
    return;
  }

  if (!canPaste()) {
    return;
  }

  if (text === '') {
    console.warn('[terminal] nothing was pasted: the clipboard is empty');
    return;
  }

  screen?.paste(text);
}

export function useTerminalMenu({ screen, status, openFind, copy, here }: TerminalMenuOptions): TerminalMenu {
  // The terminal takes what is typed or pasted while it is starting or running (the screen's own rule).
  const input = status.state === 'starting' || status.state === 'running';
  // An action runs after the host gave the focus back, in whatever render the menu was chosen in: it reads what it calls from here and not from the render the menu opened in.
  const latest = useRef({ screen, openFind, copy, input, here });
  useLayoutEffect(() => {
    latest.current = { screen, openFind, copy, input, here };
  }, [screen, openFind, copy, input, here]);

  // Whether something is selected and whether the terminal takes input are the revision of the menu: the host closes an open menu when it changes (its Copy would be unavailable, or would have something to copy that the menu did not
  // offer; its Paste would have nowhere to go). A menu shows the state it opened in. The items themselves are read when the menu opens, and not from what this render heard.
  const selected = useSyncExternalStore(screen?.subscribe ?? quiet, () => screen?.getSnapshot().selected === true);
  const id = useMenu(() => {
    if (screen === undefined) {
      return null;
    }

    return terminalMenu(
      {
        copy: () => {
          latest.current.copy();
        },
        paste: () => {
          void pasteInto(latest.current.screen, () => latest.current.input);
        },
        selectAll: () => {
          latest.current.screen?.selectAll();
        },
        clear: () => {
          latest.current.screen?.clear();
        },
        find: () => {
          latest.current.openFind();
        },
        ...(here === undefined
          ? {}
          : {
            newHere: () => {
              latest.current.here?.open();
            },
          }),
      },
      { selected: screen.getSnapshot().selected, input, here: here?.available },
    );
  }, `${selected ? 'selected' : 'nothing selected'}, ${input ? 'input' : 'no input'}, ${here === undefined ? 'no new terminal' : here.available ? 'new terminal here' : 'no directory'}`);

  const trigger = useMemo(() => ({ ...menuTrigger(id, undefined, 'context'), 'data-ov-menu-label': TERMINAL_MENU_LABEL }), [id]);
  // The emulator's input is made when the screen is first shown, and the screen keeps what it is asked here for it.
  useEffect(() => {
    // The screen takes plain strings: the attributes the kit gave, without an optional one it left out.
    screen?.decorateInput(Object.fromEntries(Object.entries(trigger).filter((entry): entry is [string, string] => entry[1] !== undefined)));
  }, [screen, trigger]);

  return {
    host: {
      ...trigger,
      onContextMenuCapture: (event) => {
        // The capture phase comes before the host's listener (on the document, in the bubble phase), so the event is cancelled before the host reads it.
        if (screen?.mouseReporting() === true && !event.shiftKey) {
          event.preventDefault();
        }
      },
    },
  };
}
