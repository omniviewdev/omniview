import { describe, expect, it, vi } from 'vitest';
import { boot, dest } from '../core/tabs/testing';
import { tabCommands, type TabCommandId } from './commands';

// The reasons a tab command says it cannot run (the mock's words, `shell-tabs.js` `menuItems`), asked of the real model. A reason is only said when the model would do nothing.

function world(count: number, pinned = 0) {
  const h = boot({ home: false });
  const ids = h.openAll(Array.from({ length: count }, (_, at) => `page${String(at + 1)}`));
  ids.slice(0, pinned).forEach((id) => h.store.pin(id, true));
  const reasons = (id: string | null): Partial<Record<TabCommandId, string>> =>
    Object.fromEntries(Object.entries(tabCommands({ tabs: h.store, platform: 'mac', native: true }, id)).flatMap(([name, command]) => (command.unavailable === undefined ? [] : [[name, command.unavailable]])));
  return { h, ids, reasons };
}

describe('why a command cannot run', () => {
  it('says there is no other tab, to the right or to the left, for a lone tab; Close all but pinned still can', () => {
    const { ids, reasons } = world(1);

    expect(reasons(ids[0] ?? null)).toEqual({
      'new-right': 'This window has no new tab',
      'close-others': 'There are no other tabs',
      'close-right': 'There are no tabs to the right',
      'close-left': 'There are no tabs to the left',
      'move-to': 'There is no other window',
      reopen: 'There are no recently closed tabs',
      next: 'There is no other tab.',
      previous: 'There is no other tab.',
    });
  });

  it('says the ends of the strip have no tabs beyond them, and that pinned ones are what is left when the tabs beyond are pinned', () => {
    const { ids, reasons } = world(3, 2);

    expect(reasons(ids[0] ?? null)['close-left']).toBe('There are no tabs to the left');
    expect(reasons(ids[1] ?? null)['close-left']).toBe('The tabs to the left are pinned');
    expect(reasons(ids[2] ?? null)['close-right']).toBe('There are no tabs to the right');
  });

  it('says the other tabs are pinned, and that there are no unpinned tabs, when all are pinned', () => {
    const { ids, reasons } = world(2, 2);

    expect(reasons(ids[0] ?? null)).toMatchObject({ 'close-others': 'The other tabs are pinned', 'close-unpinned': 'There are no unpinned tabs' });
  });

  it('says only one of a singleton page can exist', () => {
    const h = boot({ home: false });
    const id = h.open(dest('host', 'settings'), { how: 'new' });
    h.store.open(dest('host', 'plugins'), { how: 'new' });

    expect(tabCommands({ tabs: h.store, platform: 'mac', native: true }, id).duplicate.unavailable).toBe('Only one Settings tab can exist');
  });

  it('says there is no tab for a command that acts on one, when none is on screen', () => {
    const { reasons } = world(0);

    expect(reasons(null)).toMatchObject({ close: 'There is no tab', pin: 'There is no tab', 'close-unpinned': 'There is no tab', duplicate: 'There is no tab' });
  });
});

describe('what the commands are called, and what they show', () => {
  it('says Unpin tab for a pinned tab and Pin tab for the rest', () => {
    const { h, ids } = world(2, 1);
    const titleOf = (id: string | undefined) => tabCommands({ tabs: h.store, platform: 'mac', native: true }, id ?? null).pin.title;

    expect([titleOf(ids[0]), titleOf(ids[1])]).toEqual(['Unpin tab', 'Pin tab']);
  });

  it.each([
    ['mac', true, '⌘W'],
    ['other', true, 'Ctrl+W'],
    ['mac', false, '⌃⌥W'],
    ['other', false, 'Ctrl+Alt+W'],
  ] as const)('writes the close chord for %s, in the app\'s own window: %s', (platform, native, chord) => {
    const { h } = world(1);

    expect(tabCommands({ tabs: h.store, platform, native }, null).close.shortcut).toBe(chord);
  });
});

describe('the window commands', () => {
  const windowed = (others: ReadonlyArray<{ name: string; label: string }>) => {
    const h = boot({ home: false });
    const [id = ''] = h.openAll(['page1']);
    const windows = { others: () => others, moveToNew: vi.fn(() => ({ status: 'done' as const })), moveTo: vi.fn(() => ({ status: 'done' as const })) };
    return { id, windows, commands: tabCommands({ tabs: { ...h.store, windows }, platform: 'mac', native: true }, id) };
  };

  it('say there is no other window to move to, and offer none', () => {
    const { commands } = windowed([]);

    expect(commands['move-to']).toMatchObject({ title: 'Move to window', unavailable: 'There is no other window', choices: [] });
    expect(commands['move-new'].unavailable).toBeUndefined();
  });

  it('move the tab the menu is for: to a new window, or to the one picked from the other windows', () => {
    const { commands, id, windows } = windowed([{ name: 'main', label: 'Window 1' }, { name: 'window-3', label: 'Window 3' }]);

    expect(commands['move-to'].unavailable).toBeUndefined();
    expect(commands['move-to'].choices).toEqual([{ id: 'main', title: 'Window 1' }, { id: 'window-3', title: 'Window 3' }]);
    commands['move-new'].run();
    commands['move-to'].run('window-3');

    expect(windows.moveToNew).toHaveBeenCalledWith(id);
    expect(windows.moveTo).toHaveBeenCalledExactlyOnceWith('window-3', id);
  });
});
