import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mountWindow, teardown, type MountedWindow } from './testing';

// The keyboard of the notification centre (ch16 S12, S80, A3, A14; ch04 §5; the mock's `centerOpened`, `H.notification.list` and `onPopoverToggle`): the focus is in it when it opens, Escape closes it and gives the
// focus back to the bell, the list is one stop and its rows are walked with the arrows, and a focus is never dropped to the page.

afterEach(teardown);

const bell = (): HTMLElement => screen.getByRole('button', { name: /^Notifications/ });
const dialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Notifications' });
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[data-notices-part="row"]')];
const toggleOf = (row: HTMLElement | undefined): HTMLElement => row!.querySelector<HTMLElement>('[data-notices-part="rowToggle"]')!;
const titleOf = (row: HTMLElement | undefined): string => row?.querySelector('[data-notices-part="rowTitle"]')?.textContent.replace(/^[A-Za-z]+: /, '') ?? '';

async function three(m: MountedWindow): Promise<void> {
  m.f.store.notify({ title: 'Oldest', source: 'a' });
  m.f.store.notify({ title: 'Middle', source: 'b' });
  m.f.store.notify({ title: 'Newest', source: 'c' });
  await m.flush();
}

describe('opening', () => {
  it('puts the focus on the title of the newest row, from the pointer and from the keyboard', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    expect(toggleOf(rows()[0])).toHaveFocus();
    m.centre.close();
    await m.flush();
    bell().focus();
    await m.user.keyboard('{Enter}');
    expect(toggleOf(rows()[0])).toHaveFocus();
  });

  it('puts the focus on the popover itself when there is no row, so that the keyboard is inside it', async () => {
    const m = mountWindow();
    await m.user.click(bell());
    expect(dialog()).toHaveFocus();
  });
});

describe('closing', () => {
  it('closes with Escape while the focus is in it, and gives the focus back to the bell', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    await m.user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(bell()).toHaveFocus();
    expect(bell().getAttribute('aria-expanded')).toBe('false');
  });

  it('does not take Escape from the page when the focus is not in it', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    screen.getByRole('button', { name: 'Inside the page' }).focus();
    await m.user.keyboard('{Escape}');
    expect(m.centre.getSnapshot().open).toBe(true);
  });

  it('closes on a press outside, and leaves the focus with the control that was pressed', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    await m.user.click(screen.getByRole('button', { name: 'Inside the page' }));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Inside the page' })).toHaveFocus();
  });

  it('stays open for a press inside it, and the bell\'s own press closes it once and does not open it again', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    await m.user.click(within(dialog()).getByRole('heading', { name: 'Notifications', level: 3 }));
    expect(m.centre.getSnapshot().open).toBe(true);
    await m.user.click(bell());
    expect(m.centre.getSnapshot().open).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
  });
});

describe('the list is one stop', () => {
  it('has the controls of one row in the tab order and the controls of no other', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    const stops = rows().map((row) => [...row.querySelectorAll('button')].map((control) => control.getAttribute('tabindex')));
    expect(stops).toEqual([['0', '0'], ['-1', '-1'], ['-1', '-1']]);
  });

  it('moves between rows with the arrows, Home and End, and the stop goes with the focus', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    await m.user.keyboard('{ArrowDown}');
    expect(toggleOf(rows()[1])).toHaveFocus();
    expect(rows()[1]?.querySelector('button')?.getAttribute('tabindex')).toBe('0');
    expect(rows()[0]?.querySelector('button')?.getAttribute('tabindex')).toBe('-1');
    await m.user.keyboard('{End}');
    expect(toggleOf(rows()[2])).toHaveFocus();
    await m.user.keyboard('{ArrowDown}');
    expect(toggleOf(rows()[2])).toHaveFocus();
    await m.user.keyboard('{ArrowUp}');
    expect(toggleOf(rows()[1])).toHaveFocus();
    await m.user.keyboard('{Home}');
    expect(toggleOf(rows()[0])).toHaveFocus();
  });

  it('goes through the controls of the current row with Tab, and leaves the list after them', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    await m.user.tab();
    expect(within(rows()[0]).getByRole('button', { name: /^Dismiss: Newest/ })).toHaveFocus();
    await m.user.tab();
    expect(rows().some((row) => row.contains(document.activeElement))).toBe(false);
  });

  it('keeps the stop on the row that last had the focus when the list is drawn again', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    await m.user.keyboard('{ArrowDown}');
    m.f.store.notify({ title: 'Brand new', source: 'd' });
    await m.flush();
    expect(titleOf(rows()[0])).toBe('Brand new');
    const stopped = rows().filter((row) => row.querySelector('button')?.getAttribute('tabindex') === '0');
    expect(stopped.map(titleOf)).toEqual(['Middle']);
  });
});

describe('removing a row from the keyboard', () => {
  it('removes the focused row with Delete and puts the focus on the row that took its place', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    await m.user.keyboard('{ArrowDown}');
    await m.user.keyboard('{Delete}');
    expect(rows().map(titleOf)).toEqual(['Newest', 'Oldest']);
    expect(toggleOf(rows()[1])).toHaveFocus();
  });

  it('puts the focus on the last row when the last one is removed, and on the popover when none is left', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Only', source: 'a' });
    m.f.store.notify({ title: 'Second', source: 'b' });
    await m.flush();
    await m.user.click(bell());
    await m.user.keyboard('{End}');
    await m.user.keyboard('{Delete}');
    expect(toggleOf(rows()[0])).toHaveFocus();
    await m.user.keyboard('{Delete}');
    expect(rows()).toHaveLength(0);
    expect(dialog()).toHaveFocus();
  });
});

describe('the tools and the Filter menu', () => {
  it('has one Tab stop for the three tools, and moves between them with the arrows', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    const tools = within(within(dialog()).getByRole('group', { name: 'Notification actions' })).getAllByRole('button');
    expect(tools.map((tool) => tool.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    tools[0]?.focus();
    await m.user.keyboard('{ArrowRight}');
    expect(tools[1]).toHaveFocus();
  });

  it('opens the menu with Enter, walks it with the arrows, closes only the menu with Escape, and gives the focus back to Filter', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    const filter = within(dialog()).getByRole('button', { name: 'Filter' });
    filter.focus();
    await m.user.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'Filter notifications' });
    expect(within(menu).getByRole('menuitemradio', { name: 'All sources' })).toHaveFocus();
    await m.user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitemradio', { name: 'A (1)' })).toHaveFocus();
    await m.user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(filter).toHaveFocus();
    expect(m.centre.getSnapshot().open).toBe(true);
  });

  it('keeps the menu inside the centre and distinguishes presses inside the centre from presses outside both', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    const filter = within(dialog()).getByRole('button', { name: 'Filter' });
    await m.user.click(filter);
    expect(dialog()).toContainElement(screen.getByRole('menu', { name: 'Filter notifications' }));
    await m.user.click(within(dialog()).getByRole('heading', { name: 'Notifications' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(m.centre.getSnapshot().open).toBe(true);

    await m.user.click(filter);
    const outside = screen.getByRole('button', { name: 'Inside the page' });
    await m.user.click(outside);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(outside).toHaveFocus();
  });

  it('chooses a source with Enter, narrows the list, and closes the menu with the focus on Filter', async () => {
    const m = mountWindow();
    await three(m);
    await m.user.click(bell());
    const filter = within(dialog()).getByRole('button', { name: 'Filter' });
    filter.focus();
    await m.user.keyboard('{Enter}');
    await m.user.keyboard('{ArrowDown}{ArrowDown}');
    await m.user.keyboard('{Enter}');
    expect(rows().map(titleOf)).toEqual(['Middle']);
    expect(filter).toHaveFocus();
  });
});
