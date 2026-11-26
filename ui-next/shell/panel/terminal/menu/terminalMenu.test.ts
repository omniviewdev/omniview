import type { MenuAction, MenuItem } from '@omniviewdev/kit';
import { describe, expect, it, vi } from 'vitest';
import { NO_SELECTION } from '../TerminalToolbar';
import { NO_DIRECTORY, NO_INPUT, terminalMenu, type TerminalMenuActions } from './terminalMenu';

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

describe('New terminal here', () => {
  const withHere = (state: { readonly here?: boolean } = {}) => {
    const actions = { ...fakes(), newHere: vi.fn() };
    return { actions, items: terminalMenu(actions, { selected: true, input: true, here: state.here ?? true }) };
  };

  it('is not in the menu of a window that cannot open a terminal: no action, no item', () => {
    expect(menu().map((item) => item.id)).not.toContain('new-here');
  });

  it('is the last item, after a separator of its own, with the kit\'s plus glyph', () => {
    const { items } = withHere();
    expect(items.map((item) => [item.kind, item.id, 'label' in item ? item.label : undefined])).toEqual([
      ['action', 'copy', 'Copy'],
      ['action', 'paste', 'Paste'],
      ['action', 'select-all', 'Select all'],
      ['separator', 'tools'],
      ['action', 'clear', 'Clear'],
      ['action', 'find', 'Find'],
      ['separator', 'terminals'],
      ['action', 'new-here', 'New terminal here'],
    ].map(([kind, id, label]) => [kind, id, label ?? undefined]));
    expect(action(items, 'new-here').icon).toBe('plus');
  });

  it('is available when the terminal can say where it is', () => {
    expect(action(withHere({ here: true }).items, 'new-here').disabled).toBeFalsy();
  });

  it('says why it is not for a terminal that cannot say where it is: there is no directory to open in', () => {
    expect(NO_DIRECTORY).not.toBe('');
    expect(action(withHere({ here: false }).items, 'new-here').disabled).toBe(NO_DIRECTORY);
  });

  it('does not depend on the input: an ended terminal can still be the place a new one opens from', () => {
    const actions = { ...fakes(), newHere: vi.fn() };
    expect(action(terminalMenu(actions, { selected: false, input: false, here: true }), 'new-here').disabled).toBeFalsy();
  });

  it('calls its own action, once, and no other', () => {
    const { actions, items } = withHere();
    action(items, 'new-here').onSelect();
    for (const [name, call] of Object.entries(actions)) {
      expect(call, name).toHaveBeenCalledTimes(name === 'newHere' ? 1 : 0);
    }
  });
});

// THE COMMANDS OF THE SHELL'S MARKS (issue #694 step 5): the keyboard path to what the gutter shows. Every action of the gutter is an item of this menu, named, with the reason it is unavailable when it is.

describe('the commands of the shell', () => {
  const withCommands = (commands: { readonly count?: number; readonly output?: boolean; readonly rerun?: string | undefined } = {}) => {
    const actions = { ...fakes(), commands: { previous: vi.fn(), next: vi.fn(), selectOutput: vi.fn(), copyOutput: vi.fn(), rerun: vi.fn() } };
    const items = terminalMenu(actions, { selected: true, input: true, commands: { count: commands.count ?? 3, output: commands.output ?? true, rerun: 'rerun' in commands ? commands.rerun : undefined } });
    return { actions, items };
  };

  it('are not in the menu of a window or a screen that has none: no actions, no items', () => {
    expect(menu().map((item) => item.id)).not.toContain('previous-command');
  });

  it('are five items after the tools, behind a separator of their own: the jumps, the output, and the line again, in the words a person says', () => {
    const { items } = withCommands();
    expect(items.map((item) => [item.kind, item.id, 'label' in item ? item.label : undefined])).toEqual([
      ['action', 'copy', 'Copy'],
      ['action', 'paste', 'Paste'],
      ['action', 'select-all', 'Select all'],
      ['separator', 'tools', undefined],
      ['action', 'clear', 'Clear'],
      ['action', 'find', 'Find'],
      ['separator', 'commands', undefined],
      ['action', 'previous-command', 'Previous command'],
      ['action', 'next-command', 'Next command'],
      ['action', 'select-command-output', 'Select command output'],
      ['action', 'copy-command-output', 'Copy command output'],
      ['action', 'rerun-command', 'Run command again'],
    ]);
  });

  it('are available when there are commands, and each says why it is not when there are none', () => {
    const some = withCommands().items;
    expect(['previous-command', 'next-command', 'select-command-output', 'copy-command-output', 'rerun-command'].map((id) => action(some, id).disabled ?? false)).toEqual([false, false, false, false, false]);
    const none = withCommands({ count: 0, output: false, rerun: 'No commands yet' }).items;
    expect(['previous-command', 'next-command', 'select-command-output', 'copy-command-output', 'rerun-command'].map((id) => action(none, id).disabled)).toEqual(Array.from({ length: 5 }, () => 'No commands yet'));
  });

  it('say that the command printed no output for the two items that need it, and leave the jumps and the re-run alone', () => {
    const { items } = withCommands({ output: false });
    expect(action(items, 'select-command-output').disabled).toBe('This command printed no output');
    expect(action(items, 'copy-command-output').disabled).toBe('This command printed no output');
    expect(action(items, 'previous-command').disabled).toBeFalsy();
    expect(action(items, 'rerun-command').disabled).toBeFalsy();
  });

  it('say why the line cannot be typed again: a command that runs, input that is off', () => {
    expect(action(withCommands({ rerun: 'A command is running' }).items, 'rerun-command').disabled).toBe('A command is running');
    expect(action(withCommands({ rerun: 'Input is off' }).items, 'rerun-command').disabled).toBe('Input is off');
  });

  it('draw no shortcut and call their own action, once, and no other', () => {
    const { actions, items } = withCommands();
    expect(items.flatMap((item) => ('shortcut' in item && item.shortcut !== undefined ? [item.id] : []))).toEqual([]);
    const names = { 'previous-command': 'previous', 'next-command': 'next', 'select-command-output': 'selectOutput', 'copy-command-output': 'copyOutput', 'rerun-command': 'rerun' } as const;
    for (const [id, name] of Object.entries(names)) {
      action(items, id).onSelect();
      expect(actions.commands[name], id).toHaveBeenCalledTimes(1);
    }
  });

  it('come before New terminal here, which stays the last item', () => {
    const actions = { ...fakes(), newHere: vi.fn(), commands: { previous: vi.fn(), next: vi.fn(), selectOutput: vi.fn(), copyOutput: vi.fn(), rerun: vi.fn() } };
    const ids = terminalMenu(actions, { selected: true, input: true, here: true, commands: { count: 1, output: true, rerun: undefined } }).map((item) => item.id);
    expect(ids.at(-1)).toBe('new-here');
    expect(ids.indexOf('rerun-command')).toBeLessThan(ids.indexOf('terminals'));
  });
});
