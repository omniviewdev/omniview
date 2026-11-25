import type { MenuAction, MenuItem } from '@omniviewdev/kit';
import { describe, expect, it, vi } from 'vitest';
import { NO_SELECTION } from '../TerminalToolbar';
import { NO_INPUT, terminalMenu, type TerminalMenuActions } from './terminalMenu';

// The terminal's context menu as data: the items of the kit's menu model, for what the terminal is now (a selection, an input that takes what is pasted). Pure: the hook gives them their actions and the kit's host draws them. What is
// checked here is the list, the words, the reasons, and that no item draws a shortcut.

const fakes = () => ({ copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn(), clear: vi.fn(), find: vi.fn() }) satisfies TerminalMenuActions;

const menu = (state: { readonly selected?: boolean; readonly input?: boolean } = {}, actions: TerminalMenuActions = fakes()): readonly MenuItem[] =>
  terminalMenu(actions, { selected: state.selected ?? true, input: state.input ?? true });

const action = (items: readonly MenuItem[], id: string): MenuAction => {
  const found = items.find((item) => item.id === id);
  if (found?.kind !== 'action') {
    throw new Error(`no action item "${id}" in ${JSON.stringify(items.map((item) => item.id))}`);
  }

  return found;
};

describe('the items', () => {
  it('are Copy, Paste, Select all, a separator, Clear and Find, in that order', () => {
    expect(menu().map((item) => [item.kind, item.id, 'label' in item ? item.label : undefined])).toEqual([
      ['action', 'copy', 'Copy'],
      ['action', 'paste', 'Paste'],
      ['action', 'select-all', 'Select all'],
      ['separator', 'tools', undefined],
      ['action', 'clear', 'Clear'],
      ['action', 'find', 'Find'],
    ]);
  });

  it('have the glyphs the kit has: Copy, Clear and Find', () => {
    const items = menu();
    expect(action(items, 'copy').icon).toBe('copy');
    expect(action(items, 'clear').icon).toBe('eraser');
    expect(action(items, 'find').icon).toBe('search');
  });
});

// The kit names a menu item by its label alone and draws its shortcut after it, so an item that draws a shortcut has an accessible name that is not all that it draws (WCAG 2.5.3, Label in Name: axe's `label-content-name-mismatch`, found
// by the terminal's probe in a real browser). The terminal takes its chords all the same (`keys.ts`); the items draw none until the kit names an item together with its shortcut.
describe('the hints', () => {
  it('are drawn on no item', () => {
    expect(menu().flatMap((item) => ('shortcut' in item && item.shortcut !== undefined ? [item.id] : []))).toEqual([]);
  });
});

describe('Copy', () => {
  it('is available when something is selected', () => {
    expect(action(menu({ selected: true }), 'copy').disabled).toBeFalsy();
  });

  it('says why it is not when nothing is selected, in the words of the toolbar button', () => {
    expect(action(menu({ selected: false }), 'copy').disabled).toBe(NO_SELECTION);
  });
});

describe('Paste', () => {
  it('is available while the terminal takes input', () => {
    expect(action(menu({ input: true }), 'paste').disabled).toBeFalsy();
  });

  it('says why it is not once the terminal takes none: a paste has nowhere to go', () => {
    expect(NO_INPUT).not.toBe('');
    expect(action(menu({ input: false }), 'paste').disabled).toBe(NO_INPUT);
  });

  it('is the only item that needs the input: the others stay available without it', () => {
    const items = menu({ input: false, selected: true });
    expect(['copy', 'select-all', 'clear', 'find'].map((id) => action(items, id).disabled ?? false)).toEqual([false, false, false, false]);
  });
});

describe('selecting an item', () => {
  it.each(['copy', 'paste', 'select-all', 'clear', 'find'] as const)('%s calls its own action, once, and no other', (id) => {
    const actions = fakes();
    const items = menu({}, actions);
    action(items, id).onSelect();
    const names = { copy: 'copy', paste: 'paste', 'select-all': 'selectAll', clear: 'clear', find: 'find' } as const;
    for (const [name, call] of Object.entries(actions)) {
      expect(call).toHaveBeenCalledTimes(name === names[id] ? 1 : 0);
    }
  });
});
