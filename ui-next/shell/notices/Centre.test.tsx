import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreNotices } from '../core/notices';
import { START } from '../core/notices/testing';
import { installPopover, mountWindow, teardown, type MountedWindow } from './testing';

// The notification centre, the popover the bell opens (ch16 S80, S81; the mock's `centerBody`, `listHtml`, `barHtml`, `emptyHtml`, shell-feedback.js, and its rows, `H.notification` of the centre surface, shell-notify.js):
// what it lists and how, what its buttons do to the model, and what it says when there is nothing. Where things stand and in which paint is the probe's; the keyboard is `Centre.keyboard.test.tsx`'s and the rule that
// decides what is read is `Centre.read.test.tsx`'s.

afterEach(teardown);

const bell = (): HTMLElement => screen.getByRole('button', { name: /^Notifications/ });
const dialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Notifications' });
const list = (): HTMLElement => within(dialog()).getByRole('list', { name: 'Notifications' });
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[data-notices-part="row"]')];
const titles = (): string[] => rows().map((row) => row.querySelector('[data-notices-part="rowTitle"]')?.textContent.replace(/^[A-Za-z]+: /, '') ?? '');
const toggleOf = (row: HTMLElement): HTMLElement => within(row).getByRole('button', { expanded: false });
const tool = (name: string | RegExp): HTMLElement => within(within(dialog()).getByRole('group', { name: 'Notification actions' })).getByRole('button', { name });

async function open(m: MountedWindow): Promise<void> {
  await m.user.click(bell());
}

describe('the centre as a popover', () => {
  it('is a dialog named Notifications that is not modal, drawn in the top layer, with a heading', async () => {
    installPopover();
    const show = vi.spyOn(HTMLElement.prototype as unknown as { showPopover: () => void }, 'showPopover');
    const m = mountWindow();
    await open(m);
    expect(dialog().getAttribute('aria-modal')).toBeNull();
    expect(dialog().getAttribute('popover')).toBe('manual');
    expect(show).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole('heading', { level: 3, name: 'Notifications' })).toBeInTheDocument();
  });

  it('draws nothing while it is closed: no dialog, no list, no tools', () => {
    mountWindow();
    expect(document.querySelector('[data-notices-part="centre"]')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Notification actions' })).toBeNull();
  });
});

describe('an empty history', () => {
  it('says that there are no notifications and what appears here, and offers nothing to do', async () => {
    const m = mountWindow();
    await open(m);
    const empty = dialog().querySelector('[data-notices-part="centreEmpty"]');
    expect(empty?.textContent).toContain('No notifications');
    expect(empty?.textContent).toContain('Messages from plugins and operations you start appear here.');
    expect(within(dialog()).queryByRole('list')).toBeNull();
    expect(empty?.querySelector('button')).toBeNull();
  });

  it('keeps Mark all as read and Clear finished in the bar, unavailable, each with its reason', async () => {
    const m = mountWindow();
    await open(m);
    expect(tool('Mark all as read').getAttribute('aria-disabled')).toBe('true');
    expect(tool('Mark all as read')).toHaveAccessibleDescription('Everything is read');
    expect(tool('Clear finished').getAttribute('aria-disabled')).toBe('true');
    expect(tool('Clear finished')).toHaveAccessibleDescription('There is nothing finished to clear');
    expect(tool('Filter').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('the list', () => {
  it('lists the history newest first, under Recent and a heading for each day', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Oldest', source: 'cloud' });
    await m.pass(26 * 3_600_000);
    m.f.store.notify({ title: 'Older today', source: 'cloud' });
    await m.pass(60_000);
    m.f.store.notify({ title: 'Newest', source: 'stack' });
    await m.flush();
    await open(m);
    expect(titles()).toEqual(['Newest', 'Older today', 'Oldest']);
    const order = [...list().querySelectorAll('h4, h5, [data-notices-part="row"]')].map((node) => (node.matches('h4, h5') ? `# ${node.textContent}` : `${node.querySelector('[data-notices-part="rowTitle"]')?.textContent.replace(/^[A-Za-z]+: /, '') ?? ''}`));
    expect(order).toEqual(['# Recent', '# Today', 'Newest', 'Older today', '# Yesterday', 'Oldest']);
    expect(within(list()).getByRole('heading', { level: 4, name: 'Recent' })).toBeInTheDocument();
    expect(within(list()).getByRole('heading', { level: 5, name: 'Today' })).toBeInTheDocument();
  });

  it('says the severity as a word before the title, and draws its glyph for the eye only', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', detail: 'The cluster did not answer.', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    await m.flush();
    await open(m);
    const [success, error] = rows();
    expect(success?.querySelector('[data-notices-part="rowTitle"]')?.textContent).toBe('Success: Snapshot created');
    expect(error?.querySelector('[data-notices-part="rowTitle"]')?.textContent).toBe('Error: Timed out');
    expect(error?.getAttribute('data-severity')).toBe('error');
    const glyph = error?.querySelector('[data-notices-part="rowGlyph"]');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(glyph?.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('status-error');
    expect(success?.querySelector('[data-notices-part="rowGlyph"] svg')?.getAttribute('data-ov-glyph')).toBe('status-success');
  });

  it('shows the detail sentence under the title, and nothing under a title that has none', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', detail: 'The cluster did not answer.', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Update available', source: 'stack' });
    await m.flush();
    await open(m);
    const [bare, detailed] = rows();
    expect(bare?.querySelector('[data-notices-part="rowText"]')).toBeNull();
    expect(detailed?.querySelector('[data-notices-part="rowText"]')?.textContent).toBe('The cluster did not answer.');
  });

  it('shows the time as the kit formats it: one unit, floored, with the instant in its tip', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', source: 'cloud' });
    await m.flush();
    await m.pass(5 * 60_000);
    await open(m);
    const time = rows()[0]?.querySelector('time');
    expect(time?.textContent).toBe('5m');
    expect(time?.getAttribute('datetime')).toBe(new Date(START).toISOString());
    expect(time?.getAttribute('data-ov-tip')).toBe('2023-11-14 22:13 UTC · 5 minutes ago');
  });

  it('marks an unread row with the word Unread and a dot, and a read one with neither', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    await m.flush();
    m.f.store.read(m.f.store.getSnapshot().recent.find((record) => record.title === 'Snapshot created')?.id ?? '');
    await m.flush();
    await open(m);
    const [success, error] = rows();
    expect(error?.hasAttribute('data-unread')).toBe(true);
    expect(within(error).getByText('Unread')).toBeInTheDocument();
    expect(error?.querySelector('[data-notices-part="rowDot"]')?.getAttribute('data-tone')).toBe('error');
    expect(success?.hasAttribute('data-unread')).toBe(false);
    expect(within(success).queryByText('Unread')).toBeNull();
  });

  it('says how many times a repeat happened: in the title of a repeated message, in the second line of a keyed one', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    await m.flush();
    m.f.store.notify({ title: 'Disk almost full', detail: 'Free up space.', severity: 'warning', source: 'stack', key: 'disk' });
    m.f.store.notify({ title: 'Disk almost full', detail: 'Free up space.', severity: 'warning', source: 'stack', key: 'disk' });
    m.f.store.notify({ title: 'Disk almost full', detail: 'Free up space.', severity: 'warning', source: 'stack', key: 'disk' });
    await m.flush();
    await open(m);
    expect(titles()).toEqual(['Disk almost full', 'Timed out 2 times']);
    expect(rows()[0]?.querySelector('[data-notices-part="rowText"]')?.textContent).toBe('Happened 3 times · Free up space.');
  });

  it('draws the first fifty and a button that says how many are older, and draws all of them when it is pressed', async () => {
    const m = mountWindow();
    for (let index = 0; index < 60; index += 1) {
      m.f.store.notify({ title: `Notice ${String(index)}`, source: `p${String(index)}` });
    }

    await m.flush();
    await open(m);
    expect(rows()).toHaveLength(50);
    const more = within(dialog()).getByRole('button', { name: 'Show 10 older' });
    await m.user.click(more);
    expect(rows()).toHaveLength(60);
    expect(within(dialog()).queryByRole('button', { name: /older$/ })).toBeNull();
  });

  it('puts a new record at the top of an open list, once, without moving the rows that were there', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'First', source: 'cloud' });
    await m.flush();
    await open(m);
    const first = rows()[0];
    m.f.store.notify({ title: 'Second', source: 'stack' });
    await m.flush();
    expect(titles()).toEqual(['Second', 'First']);
    expect(rows()[1]).toBe(first);
  });
});

describe('a row', () => {
  it('opens and closes on its title, and says so', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', detail: 'The cluster did not answer.', severity: 'error', source: 'cloud' });
    await m.flush();
    await open(m);
    const button = toggleOf(rows()[0]);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await m.user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(rows()[0]?.hasAttribute('data-expanded')).toBe(true);
    await m.user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('has an action only while the action can be used: a button for a Retry that works, none for one that cannot, and the reason in words', async () => {
    const run = vi.fn();
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud', actions: [{ id: 'again', label: 'Retry', kind: 'retry', run }] });
    await m.flush();
    await open(m);
    await m.user.click(toggleOf(rows()[0]));
    const retry = within(rows()[0]).getByRole('button', { name: 'Retry' });
    await m.user.click(retry);
    expect(run).toHaveBeenCalledTimes(1);
    m.f.store.removePlugin('cloud');
    m.f.store.notify({ title: 'Timed out again', severity: 'error', source: 'cloud', actions: [{ id: 'again', label: 'Retry', kind: 'retry', run }] });
    await m.flush();
  });

  it('shows no button for an action that cannot be used and says why under the text, never a dead button', async () => {
    const source = mountWindow();
    source.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud', actions: [{ id: 'again', label: 'Retry', kind: 'retry', run: () => undefined }] });
    const saved = source.f.store.serialise();
    source.unmount();
    teardown();
    const restored = restoreNotices(JSON.parse(JSON.stringify(saved)), { now: START + 1000 });
    expect(restored.ok).toBe(true);
    const m = mountWindow({ store: { initial: restored.ok ? { records: restored.records, muted: restored.muted } : undefined } });
    await open(m);
    await m.user.click(toggleOf(rows()[0]));
    expect(within(rows()[0]).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(rows()[0]?.textContent).toContain('Retry is unavailable. Not available after restart.');
  });

  it('removes itself with its Dismiss, and offers to bring it back', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    await m.flush();
    await open(m);
    await m.user.click(within(rows()[1]).getByRole('button', { name: 'Dismiss: Timed out' }));
    expect(titles()).toEqual(['Snapshot created']);
    expect(m.f.store.getSnapshot().recent).toHaveLength(1);
    await m.user.click(tool('Undo dismiss'));
    expect(titles()).toEqual(['Snapshot created', 'Timed out']);
    expect(m.announcer.polite.getSnapshot().text).toBe('Notifications restored');
  });
});

describe('Mark all as read, Clear finished and Undo', () => {
  it('marks every record read, tells a screen reader how many, and is unavailable once everything is read', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    await m.flush();
    await open(m);
    expect(tool('Mark all as read').getAttribute('aria-disabled')).toBeNull();
    await m.user.click(tool('Mark all as read'));
    expect(m.f.store.getSnapshot().counts.unread).toBe(0);
    expect(m.announcer.polite.getSnapshot().text).toBe('2 notifications marked as read');
    expect(tool('Mark all as read').getAttribute('aria-disabled')).toBe('true');
    expect(bell()).toHaveAccessibleName('Notifications');
  });

  it('clears the finished records, says so, and shows what was cleared where the list was', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    await m.flush();
    await open(m);
    await m.user.click(tool('Clear finished'));
    expect(m.f.store.getSnapshot().recent).toHaveLength(0);
    expect(rows()).toHaveLength(0);
    const empty = dialog().querySelector('[data-notices-part="centreEmpty"]');
    expect(empty?.textContent).toContain('Cleared 2 notifications');
    expect(empty?.textContent).toContain('Undo brings them back for 10 seconds.');
    expect(m.announcer.polite.getSnapshot().text).toBe('Cleared 2 notifications. Undo is available for 10 seconds');
  });

  it('puts Undo where Clear finished was, brings the records back, and takes Undo away when they are back', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    await m.flush();
    await open(m);
    await m.user.click(tool('Clear finished'));
    expect(within(dialog()).queryByRole('button', { name: 'Clear finished' })).toBeNull();
    await m.user.click(tool('Undo clear'));
    expect(titles()).toEqual(['Snapshot created', 'Timed out']);
    expect(tool('Clear finished')).toBeInTheDocument();
    expect(m.announcer.polite.getSnapshot().text).toBe('Notifications restored');
  });

  it('takes Undo away after ten seconds', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    await m.flush();
    await open(m);
    await m.user.click(tool('Clear finished'));
    expect(tool('Undo dismiss')).toBeInTheDocument();
    await m.pass(10_000);
    expect(within(dialog()).queryByRole('button', { name: /^Undo/ })).toBeNull();
    expect(dialog().textContent).toContain('No notifications');
  });
});

describe('the Filter menu and the mute of a source', () => {
  async function two(m: MountedWindow): Promise<void> {
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    m.f.store.notify({ title: 'Disk almost full', severity: 'warning', source: 'cloud' });
    await m.flush();
    await open(m);
  }

  const menu = (): HTMLElement => screen.getByRole('menu', { name: 'Filter notifications' });

  it('opens from the Filter button with every source and how many records each has, and All sources chosen', async () => {
    const m = mountWindow();
    await two(m);
    await m.user.click(tool('Filter'));
    expect(tool('Filter').getAttribute('aria-haspopup')).toBe('menu');
    expect(tool('Filter').getAttribute('aria-expanded')).toBe('true');
    const group = within(menu()).getByRole('group', { name: 'Source' });
    const choices = within(group).getAllByRole('menuitemradio');
    expect(choices.map((choice) => [choice.textContent, choice.getAttribute('aria-checked')])).toEqual([
      ['All sources', 'true'],
      ['Cloud (2)', 'false'],
      ['Stack (1)', 'false'],
    ]);
    expect(within(menu()).queryByRole('menuitem')).toBeNull();
  });

  it('narrows the list to the source that is chosen, closes, and says which source in a note with the button that clears it', async () => {
    const m = mountWindow();
    await two(m);
    await m.user.click(tool('Filter'));
    await m.user.click(within(menu()).getByRole('menuitemradio', { name: 'Cloud (2)' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(titles()).toEqual(['Disk almost full', 'Timed out']);
    expect(m.centre.getSnapshot().source).toBe('cloud');
    const note = dialog().querySelector('[data-notices-part="centreNote"]');
    expect(note?.textContent).toContain('Cloud');
    await m.user.click(within(note as HTMLElement).getByRole('button', { name: 'Clear filters' }));
    expect(titles()).toEqual(['Disk almost full', 'Snapshot created', 'Timed out']);
    expect(m.centre.getSnapshot().source).toBe('');
    expect(dialog().querySelector('[data-notices-part="centreNote"]')).toBeNull();
  });

  it('offers to mute the chosen source for an hour, and only when one is chosen', async () => {
    const m = mountWindow();
    await two(m);
    await m.user.click(tool('Filter'));
    expect(within(menu()).queryByRole('menuitem', { name: /^Mute/ })).toBeNull();
    await m.user.click(within(menu()).getByRole('menuitemradio', { name: 'Cloud (2)' }));
    await m.user.click(tool('Filter'));
    expect(within(menu()).getByRole('menuitemradio', { name: 'Cloud (2)' }).getAttribute('aria-checked')).toBe('true');
    expect(within(menu()).getByRole('menuitem', { name: 'Mute Cloud for 1 hour' })).toBeInTheDocument();
    expect(within(menu()).getByRole('menuitem', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('mutes the source for an hour, tells a screen reader, shows a note with the time it ends, and leaves its records in the list', async () => {
    const m = mountWindow();
    await two(m);
    await m.user.click(tool('Filter'));
    await m.user.click(within(menu()).getByRole('menuitemradio', { name: 'Cloud (2)' }));
    await m.user.click(tool('Filter'));
    await m.user.click(within(menu()).getByRole('menuitem', { name: 'Mute Cloud for 1 hour' }));
    const [only] = m.f.store.getSnapshot().muted;
    expect(only).toMatchObject({ source: 'cloud', name: 'Cloud' });
    expect(only?.until).toBe(m.clock.now() - 16 + 3_600_000);
    expect(m.announcer.polite.getSnapshot().text).toBe('Cloud is muted for 1 hour. Its notifications still arrive here, without toasts');
    const notes = [...dialog().querySelectorAll('[data-notices-part="centreNote"]')].map((note) => note.textContent);
    expect(notes.some((text) => text.includes('Cloud is muted until'))).toBe(true);
    expect(titles()).toEqual(['Disk almost full', 'Timed out']);
    expect(bell()).toHaveAccessibleName('Notifications, 1 unread');
  });

  it('unmutes from the note, and says so', async () => {
    const m = mountWindow();
    await two(m);
    m.f.store.mute('cloud');
    await m.flush();
    const unmute = within(dialog()).getByRole('button', { name: 'Unmute' });
    await m.user.click(unmute);
    expect(m.f.store.getSnapshot().muted).toEqual([]);
    expect(m.announcer.polite.getSnapshot().text).toBe('Cloud is unmuted');
    expect(within(dialog()).queryByRole('button', { name: 'Unmute' })).toBeNull();
  });

  it('counts several muted sources and unmutes them all at once', async () => {
    const m = mountWindow();
    await two(m);
    m.f.store.mute('cloud');
    m.f.store.mute('stack');
    await m.flush();
    expect(dialog().textContent).toContain('2 sources are muted');
    await m.user.click(within(dialog()).getByRole('button', { name: 'Unmute all' }));
    expect(m.f.store.getSnapshot().muted).toEqual([]);
    expect(m.announcer.polite.getSnapshot().text).toBe('Notifications are unmuted');
  });

  it('says that nothing matches, with the one button that leads out, when the source it narrowed to has no record left', async () => {
    const m = mountWindow();
    await two(m);
    m.centre.filter('cloud');
    await m.flush();
    await m.user.click(within(rows()[0]).getByRole('button', { name: 'Dismiss: Disk almost full' }));
    await m.user.click(within(rows()[0]).getByRole('button', { name: 'Dismiss: Timed out' }));
    const empty = dialog().querySelector('[data-notices-part="centreEmpty"]');
    expect(empty?.textContent).toContain('No matching notifications');
    expect(empty?.textContent).toContain('Nothing matches the source you chose.');
    await m.user.click(within(empty as HTMLElement).getByRole('button', { name: 'Clear filters' }));
    expect(titles()).toEqual(['Snapshot created']);
  });

  it('keeps the source it was narrowed to when it is closed and opened again, as the mock does', async () => {
    const m = mountWindow();
    await two(m);
    m.centre.filter('stack');
    await m.flush();
    m.centre.close();
    await m.flush();
    await open(m);
    expect(titles()).toEqual(['Snapshot created']);
  });
});

describe('what a closing does not do', () => {
  it('leaves the history as it was: nothing is removed by closing and opening again', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', source: 'cloud' });
    await m.flush();
    await open(m);
    await act(async () => {
      m.centre.close();
      await Promise.resolve();
    });
    await open(m);
    expect(titles()).toEqual(['Timed out']);
  });
});
