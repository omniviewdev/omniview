import { MenuHost } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, cloudPage } from '../core/tabs/testing';
import { Shell } from '../Shell';

// The context menu of a tab (ch16 S51, S55), read through the whole shell over the real tab model. The rows themselves are `commands.ts`'s; here is what a person gets: which tab the menu is for,
// its rows, separators and reasons, that each row does what the model does, and where the focus is afterwards.

const ITEMS = ['New tab to the right', 'Duplicate tab', 'Pin tab', 'Reload tab', 'Close tab', 'Close other tabs', 'Close tabs to the right', 'Close tabs to the left', 'Close all but pinned', 'Reopen closed tab'];

function mount(count: number, onNewTab: (after?: string) => void = vi.fn()) {
  const h = boot({ home: false });
  const ids = h.openAll(Array.from({ length: count }, (_, at) => `page${String(at + 1)}`));
  render(<Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={({ id }) => <p>{`page of ${id}`}</p>} empty={<p>Nothing open</p>} onNewTab={onNewTab} />, { wrapper: MenuHost });
  return { h, ids, user: userEvent.setup() };
}

const tab = (title: string) => screen.getByRole('tab', { name: new RegExp(`^${title}`) });
const open = (title: string) => {
  fireEvent.contextMenu(tab(title), { button: 2 });
  return screen.getByRole('menu', { name: `Actions for ${title}` });
};

const labels = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'));
const disabled = (menu: HTMLElement) => Object.fromEntries(within(menu).getAllByRole('menuitem').filter((item) => item.getAttribute('aria-disabled') === 'true').map((item) => [item.getAttribute('aria-label'), item.getAttribute('aria-description')]));

// jsdom has no Popover API, so a popover stays `display: none` and its items are not in the accessibility tree.
let shown: HTMLStyleElement;
beforeEach(() => {
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});
afterEach(() => {
  cleanup();
  shown.remove();
  vi.restoreAllMocks();
});

describe('the rows', () => {
  it('right click on the 7th of 20 tabs opens one menu, for that tab, with the rows of the mock in its order, and resolves it once', () => {
    const { h } = mount(20);
    const resolved = vi.spyOn(h.store, 'canReopen');

    const menu = open('Page7');

    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(labels(menu)).toEqual(ITEMS);
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(within(menu).getByRole('menuitem', { name: 'Close tab' }).getAttribute('aria-description')).toMatch(/Ctrl\+Alt\+W|⌃⌥W/);
    expect(disabled(menu)).toEqual({ 'Reopen closed tab': 'There are no recently closed tabs' });
  });

  it('draws a separator between groups and none for the empty one between the first and the closes', () => {
    mount(3);

    expect(within(open('Page2')).getAllByRole('separator')).toHaveLength(2);
  });

  it('says Unpin tab for a pinned tab, and why a lone tab has nothing to close or reopen', () => {
    const { h, ids } = mount(1);
    expect(disabled(open('Page1'))).toEqual({
      'Close other tabs': 'There are no other tabs',
      'Close tabs to the right': 'There are no tabs to the right',
      'Close tabs to the left': 'There are no tabs to the left',
      'Reopen closed tab': 'There are no recently closed tabs',
    });

    act(() => {
      h.store.pin(ids[0], true);
    });
    const pinned = open('Page1');
    expect(labels(pinned)).toContain('Unpin tab');
    expect(disabled(pinned)['Close all but pinned']).toBe('There are no unpinned tabs');
  });

  it('says it is the pinned ones that keep Close tabs to the right and to the left from closing anything', () => {
    const { h, ids } = mount(2);
    act(() => {
      h.store.pin(ids[0], true);
      h.store.pin(ids[1], true);
    });

    expect(disabled(open('Page1'))['Close tabs to the right']).toBe('The tabs to the right are pinned');
    expect(disabled(open('Page2'))['Close tabs to the left']).toBe('The tabs to the left are pinned');
  });
});

describe('the keys and the pointer', () => {
  it.each([
    ['Shift F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }],
  ])('opens on %s for the tab that has the focus', (_name, init) => {
    mount(3);
    const focused = tab('Page2');
    focused.focus();
    fireEvent.keyDown(focused, init);

    expect(screen.getByRole('menu', { name: 'Actions for Page2' })).toBeInTheDocument();
  });

  it('does not select a tab that is Control clicked on a Mac, and does anywhere else', async () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { h, ids, user } = mount(3);
    h.store.activate(ids[0]);
    await user.keyboard('{Control>}');
    await user.pointer({ keys: '[MouseLeft>]', target: tab('Page3') });
    expect(h.active()).toBe(ids[0]);

    platform.mockReturnValue('Win32');
    await user.pointer({ keys: '[MouseLeft>]', target: tab('Page3') });
    expect(h.active()).toBe(ids[2]);
  });
});

describe('the rows run the model', () => {
  it('Close other tabs closes all but that tab and the pinned', () => {
    const { h, ids } = mount(7);
    act(() => {
      h.store.pin(ids[0], true);
    });

    fireEvent.click(within(open('Page4')).getByRole('menuitem', { name: 'Close other tabs' }));

    expect(h.titles()).toEqual(['Page1', 'Page4']);
  });

  it.each([
    ['Close tabs to the right', ['Page1', 'Page2', 'Page3', 'Page4']],
    ['Close tabs to the left', ['Page1', 'Page4', 'Page5', 'Page6']],
    ['Close all but pinned', ['Page1']],
    ['Close tab', ['Page1', 'Page2', 'Page3', 'Page5', 'Page6']],
  ])('%s, with the first tab pinned and the menu on the 4th', (label, left) => {
    const { h, ids } = mount(6);
    act(() => {
      h.store.pin(ids[0], true);
    });

    fireEvent.click(within(open('Page4')).getByRole('menuitem', { name: label }));

    expect(h.titles()).toEqual(left);
  });

  it('Reopen closed tab brings the last closed one back, Duplicate and Pin act on the tab the menu is for and not the one on screen', () => {
    const { h, ids } = mount(3);
    h.store.activate(ids[0]);

    fireEvent.click(within(open('Page3')).getByRole('menuitem', { name: 'Pin tab' }));
    expect(h.titles()).toEqual(['Page3', 'Page1', 'Page2']);

    fireEvent.click(within(open('Page2')).getByRole('menuitem', { name: 'Duplicate tab' }));
    expect(h.titles()).toEqual(['Page3', 'Page1', 'Page2', 'Page2']);

    fireEvent.click(within(open('Page1')).getByRole('menuitem', { name: 'Close tab' }));
    expect(h.titles()).toEqual(['Page3', 'Page2', 'Page2']);
    fireEvent.click(within(open('Page3')).getByRole('menuitem', { name: 'Reopen closed tab' }));
    expect(h.titles()).toEqual(['Page3', 'Page1', 'Page2', 'Page2']);
  });

  it('New tab to the right asks the host for a tab after that one', () => {
    const onNewTab = vi.fn();
    const { ids } = mount(3, onNewTab);

    fireEvent.click(within(open('Page2')).getByRole('menuitem', { name: 'New tab to the right' }));

    expect(onNewTab).toHaveBeenCalledWith(ids[1]);
  });
});

describe('the focus', () => {
  it('Close tab from the menu leaves the focus on the tab that is on screen next, not on the page\'s body', async () => {
    const { h, ids } = mount(3);
    h.store.activate(ids[1]);
    const focused = tab('Page2');
    focused.focus();
    fireEvent.keyDown(focused, { key: 'F10', shiftKey: true });

    fireEvent.click(within(screen.getByRole('menu', { name: 'Actions for Page2' })).getByRole('menuitem', { name: 'Close tab' }));

    expect(h.titles()).toEqual(['Page1', 'Page3']);
    await waitFor(() => {
      expect(tab('Page3')).toHaveFocus();
    });
  });
});
