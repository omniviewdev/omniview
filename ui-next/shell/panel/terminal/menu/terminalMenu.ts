import type { MenuItem } from '@omniviewdev/kit';
import { NO_SELECTION } from '../TerminalToolbar';

// The terminal's context menu as data (docs/ui-next/status/T-terminal-bar.md: Copy, Paste, Select all, Clear, Find): the items of the kit's menu model, for what the terminal is now. Pure, so that its test can read it whole. The hook
// (`useTerminalMenu.ts`) gives the items their actions and registers them with the window's menu host, which draws them, moves the focus and runs the action after the focus is back in the terminal.

/** Why Paste is unavailable: the terminal takes no input (an ended or taken-over session: the lane says "Input is off" for it), so a paste would have nowhere to go. */
export const NO_INPUT = 'Input is off';

/** Why "New terminal here" is unavailable: the terminal's producer cannot say where it is (a terminal of a plugin runs on another machine), so there is no directory to open in. */
export const NO_DIRECTORY = 'This terminal cannot say where it is';

/** What each item does. The menu does not bind a key and does not know how any of it is done. */
export type TerminalMenuActions = {
  readonly copy: () => void;
  readonly paste: () => void;
  readonly selectAll: () => void;
  readonly clear: () => void;
  readonly find: () => void;
  /** Opens a new terminal in the directory of this one, as the host says it is. Absent: the menu has no such item (a window that cannot open a terminal). */
  readonly newHere?: (() => void) | undefined;
};

/** What the terminal is now, as the menu is opened. */
export type TerminalMenuState = {
  /** Some of the output is selected: Copy has something to copy. */
  readonly selected: boolean;
  /** The terminal takes what is typed or pasted. */
  readonly input: boolean;
  /** The terminal can say where it is (its feed has a `directory`): "New terminal here" has a directory to start in. Read only when the menu has a `newHere` action. */
  readonly here?: boolean | undefined;
};

/**
 * Copy, Paste and Select all, a separator, then Clear and Find, and, for a window that can open a terminal, a separator and New terminal here. Copy says why it is unavailable when nothing is selected (the toolbar's own words), and so
 * does Paste when the terminal takes no input, and New terminal here when the terminal cannot say where it is. Paste and Select all have no glyph yet: the kit has none for either, and an item with none keeps its label on the same track
 * as the ones that have.
 */
export function terminalMenu(actions: TerminalMenuActions, { selected, input, here }: TerminalMenuState): readonly MenuItem[] {
  // No item passes a `shortcut`, the hint the kit draws at the end of a row, though the terminal takes the chords (`keys.ts`). The kit's `MenuPanel` (packages/kit/src/components/Menu/MenuPanel.tsx) names an item with
  // `aria-label={entry.label}` and leaves the drawn shortcut out of that name, so an item that draws one fails Label in Name (WCAG 2.5.3, axe `label-content-name-mismatch`): the terminal's probe measured it, and found that hiding the
  // shortcut from the accessibility tree does not help where not drawing it does. Add the hints back, written with `chordText` as the Find button's tip is, when the kit names an item together with its shortcut.
  const items: MenuItem[] = [
    { kind: 'action', id: 'copy', label: 'Copy', icon: 'copy', disabled: selected ? undefined : NO_SELECTION, onSelect: actions.copy },
    { kind: 'action', id: 'paste', label: 'Paste', disabled: input ? undefined : NO_INPUT, onSelect: actions.paste },
    { kind: 'action', id: 'select-all', label: 'Select all', onSelect: actions.selectAll },
    { kind: 'separator', id: 'tools' },
    { kind: 'action', id: 'clear', label: 'Clear', icon: 'eraser', onSelect: actions.clear },
    { kind: 'action', id: 'find', label: 'Find', icon: 'search', onSelect: actions.find },
  ];
  const { newHere } = actions;
  if (newHere !== undefined) {
    // It does not depend on the input: a terminal that ended is still a place to open a new one from (the directory it started in).
    items.push({ kind: 'separator', id: 'terminals' }, { kind: 'action', id: 'new-here', label: 'New terminal here', icon: 'plus', disabled: here === true ? undefined : NO_DIRECTORY, onSelect: newHere });
  }

  return items;
}
