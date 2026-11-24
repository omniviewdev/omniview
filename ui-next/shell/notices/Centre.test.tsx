import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreNotices } from '../core/notices';
import { START } from '../core/notices/testing';
import { installPopover, mountWindow, teardown, ZONES, type MountedWindow } from './testing';

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

/** A time as the viewer's clock writes it: the local fields of 2026, so that the same history is on the same local days in every zone. Call it after the zone is set (`vi.stubEnv('TZ', zone)`). */
const local = (day: number, hour: number, minute = 0): number => new Date(2026, 10, day, hour, minute).getTime();

/** What a heading says of a date that is neither today nor yesterday: the weekday, month and day, in the viewer's locale. */
const dated = (time: number): string => new Date(time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** The list as it reads: a heading as `# words`, a row as its title. */
const outline = (): string[] =>
  [...list().querySelectorAll('h4, h5, [data-notices-part="row"]')].map((node) =>
    node.matches('h4, h5') ? `# ${node.textContent}` : (node.querySelector('[data-notices-part="rowTitle"]')?.textContent.replace(/^[A-Za-z]+: /, '') ?? ''),
  );

/** The page is visible again, as it is when a laptop wakes: the page's age clock reads the time again at once (its own timer does the same within a minute). */
async function wake(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
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
    expect(within(dialog()).queryByRole('status')).toBeNull();
    expect(empty?.hasAttribute('aria-live')).toBe(false);
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
  // A heading is a LOCAL day, so the history is built from local times: noon of the 14th, and 26 hours later (the afternoon of the 15th), are on two local days in every zone. (A fixed instant is not: `START` is 22:13 UTC, and
  // 26 hours after it the first record was two local days back in UTC and in Paris, and this test read "Tue, Nov 14" where it wanted "Yesterday": the failure CI showed that a laptop in Chicago did not.)
  it.each(ZONES)('lists the history newest first, under Recent and a heading for each day, in %s', async (zone) => {
    vi.stubEnv('TZ', zone);
    const m = mountWindow({ at: local(14, 12) });
    m.f.store.notify({ title: 'Oldest', source: 'cloud' });
    await m.pass(26 * 3_600_000);
    m.f.store.notify({ title: 'Older today', source: 'cloud' });
    await m.pass(60_000);
    m.f.store.notify({ title: 'Newest', source: 'stack' });
    await m.flush();
    await open(m);
    expect(titles()).toEqual(['Newest', 'Older today', 'Oldest']);
    expect(outline()).toEqual(['# Recent', '# Today', 'Newest', 'Older today', '# Yesterday', 'Oldest']);
    expect(within(list()).getByRole('heading', { level: 4, name: 'Recent' })).toBeInTheDocument();
    expect(within(list()).getByRole('heading', { level: 5, name: 'Today' })).toBeInTheDocument();
  });

  // axe's `list` rule: an `ul` holds `li` and nothing else, and an `li` with a role of its own (`presentation`) is not a list item. The mock's headings are list items (`li.sectionlabel`), and so are these, each holding its heading.
  it('holds only plain list items, each a row or a heading: no item takes a role away', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Oldest', source: 'cloud' });
    await m.pass(26 * 3_600_000);
    m.f.store.notify({ title: 'Newest', source: 'stack' });
    await m.flush();
    await open(m);
    const items = [...list().children];
    expect(items.map((item) => item.tagName)).toEqual(['LI', 'LI', 'LI', 'LI', 'LI']);
    expect(items.map((item) => item.getAttribute('role'))).toEqual([null, null, null, null, null]);
    expect(items.map((item) => item.querySelector('h4, h5, [data-notices-part="row"]')?.tagName)).toEqual(['H4', 'H5', 'ARTICLE', 'H5', 'ARTICLE']);
    expect(within(list()).getAllByRole('listitem')).toHaveLength(5);
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

// A DAY THAT ENDS WHILE THE CENTRE IS OPEN (the lead's CI finding on the day grouping, O1b-2). The mock reads the clock whenever it draws the list (`dayLabel` takes `new Date()`, shell-feedback.js:657-660; the signature of what it
// drew has the hour in it, :758, so that a draw after the hour changed is not skipped), so its headings are right at the next draw; it has no timer for midnight, only the 10 s tick of the time labels (shell-notify.js:1470-1474).
// Here a heading is the age of its day on the page's age clock: it changes by itself at the local midnight, and a notice that arrives after midnight is under Today whatever day the centre was opened on.
describe('a day that ends while the centre is open', () => {
  it.each(ZONES)('turns Today into Yesterday at midnight, and puts what arrives after it under Today, in %s', async (zone) => {
    vi.stubEnv('TZ', zone);
    const m = mountWindow({ at: local(13, 10) });
    m.f.store.notify({ title: 'Day before', source: 'cloud' });
    await m.pass(local(14, 23, 40) - m.clock.now());
    m.f.store.notify({ title: 'Late', source: 'cloud' });
    await m.pass(local(14, 23, 50) - m.clock.now());
    await open(m);
    expect(outline()).toEqual(['# Recent', '# Today', 'Late', '# Yesterday', 'Day before']);
    await m.pass(local(15, 0, 10) - m.clock.now());
    await wake();
    expect(outline()).toEqual(['# Recent', '# Yesterday', 'Late', `# ${dated(local(13, 10))}`, 'Day before']);
    m.f.store.notify({ title: 'After midnight', source: 'stack' });
    await m.flush();
    expect(outline()).toEqual(['# Recent', '# Today', 'After midnight', '# Yesterday', 'Late', `# ${dated(local(13, 10))}`, 'Day before']);
  });

  it.each(ZONES)('puts the first notice of a new day under Today in %s, whatever day the centre was opened on', async (zone) => {
    vi.stubEnv('TZ', zone);
    const m = mountWindow({ at: local(14, 23, 30) });
    m.f.store.notify({ title: 'Last of the day', source: 'cloud' });
    await m.flush();
    await open(m);
    await m.pass(local(15, 0, 5) - m.clock.now());
    await wake();
    m.f.store.notify({ title: 'First of the next', source: 'stack' });
    await m.flush();
    expect(outline()).toEqual(['# Recent', '# Today', 'First of the next', '# Yesterday', 'Last of the day']);
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

  // The shared menu reserves a mark column for its radios and adds an icon column when it shows the source commands.
  it('has a column for the marks of its radios, and one for the glyphs of its commands once a source is chosen', async () => {
    const m = mountWindow();
    await two(m);
    await m.user.click(tool('Filter'));
    expect(menu().querySelector('[data-ov-menu-body][data-ov-mark]')).not.toBeNull();
    expect(menu().querySelector('[data-ov-menu-body][data-ov-icon]')).toBeNull();
    await m.user.click(within(menu()).getByRole('menuitemradio', { name: 'Cloud (2)' }));
    await m.user.click(tool('Filter'));
    expect(menu().querySelector('[data-ov-menu-body][data-ov-mark]')).not.toBeNull();
    expect(menu().querySelector('[data-ov-menu-body][data-ov-icon]')).not.toBeNull();
  });

  it('marks the chosen source with a dot and no other source, and gives each command its glyph', async () => {
    const m = mountWindow();
    await two(m);
    await m.user.click(tool('Filter'));
    await m.user.click(within(menu()).getByRole('menuitemradio', { name: 'Cloud (2)' }));
    await m.user.click(tool('Filter'));
    const marks = within(menu())
      .getAllByRole('menuitemradio')
      .map((choice) => [choice.textContent, choice.querySelector('[data-ov-menu-mark][data-ov-menu-radio]') !== null, choice.querySelector('svg') !== null]);
    expect(marks).toEqual([
      ['All sources', false, false],
      ['Cloud (2)', true, false],
      ['Stack (1)', false, false],
    ]);
    const glyphs = within(menu())
      .getAllByRole('menuitem')
      .map((command) => [command.textContent, command.querySelector('svg')?.getAttribute('data-ov-glyph')]);
    expect(glyphs).toEqual([
      ['Mute Cloud for 1 hour', 'bell-off'],
      ['Clear filters', 'close'],
    ]);
  });

  it('opens with its first item active, whichever source is chosen, as the mock\'s menu does', async () => {
    const m = mountWindow();
    await two(m);
    await m.user.click(tool('Filter'));
    await m.user.click(within(menu()).getByRole('menuitemradio', { name: 'Cloud (2)' }));
    await m.user.click(tool('Filter'));
    expect(within(menu()).getByRole('menuitemradio', { name: 'All sources' })).toHaveFocus();
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
    expect(tool('Filter')).toHaveFocus();
    await m.user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
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

  it('keeps Filter open for an unrelated mute but dismisses the Unmute action when the selected mute expires', async () => {
    const m = mountWindow();
    await two(m);
    m.centre.filter('cloud');
    m.f.store.mute('cloud', m.clock.now() + 1_000);
    await m.flush();
    const filter = tool('Filter');
    await m.user.click(filter);
    const opened = menu();
    expect(within(opened).getByRole('menuitem', { name: 'Unmute Cloud' })).toBeInTheDocument();

    m.f.store.mute('stack');
    await m.flush();
    expect(menu()).toBe(opened);

    await m.pass(1_000);
    await m.flush();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(filter).toHaveFocus();
    await m.user.click(filter);
    expect(within(menu()).getByRole('menuitem', { name: 'Mute Cloud for 1 hour' })).toBeInTheDocument();
  });

  it('does not announce an Unmute that the store has already applied before publishing its new snapshot', async () => {
    const m = mountWindow();
    await two(m);
    m.centre.filter('cloud');
    m.f.store.mute('cloud');
    await m.flush();
    await m.user.click(tool('Filter'));
    const unmute = within(menu()).getByRole('menuitem', { name: 'Unmute Cloud' });
    const announced = m.announcer.polite.getSnapshot();
    expect(m.f.store.unmute('cloud')).toBe(true);
    expect(unmute).toBeInTheDocument();
    fireEvent.click(unmute);
    expect(m.announcer.polite.getSnapshot()).toBe(announced);
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
    expect(empty).not.toBeInTheDocument();
    expect(titles()).toEqual(['Snapshot created']);
    expect(tool('Filter')).toHaveFocus();
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

// NO DEAD CONTROL (the lead's ruling of 2026-11-21): the centre draws what the step builds and nothing that points at a later slice. The segmented view (All, Unread, Active, Needs attention), the severity filter, the details of a
// record (Details, Copy details), the Active group's progress and Cancel, and the footer's links (Open Operations, Notification settings) are later slices (docs/ui-next/status/O1b-2.md, "Later slices"): each has nothing yet to open, so
// none is drawn, in the list, in an open row, in the Filter menu or in the empty states.
describe('what the centre does not draw', () => {
  const LATER = /^unread\b|^active\b|needs attention|^any severity|^(errors|warnings|success|info)$|details|copy|operations|settings|cancel|show all/i;

  async function everything(m: MountedWindow): Promise<string[]> {
    m.f.store.notify({ title: 'Timed out', detail: 'The cluster did not answer.', severity: 'error', source: 'cloud', actions: [{ id: 'again', label: 'Retry', kind: 'retry', run: () => undefined }], details: 'stack trace' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    await m.flush();
    await open(m);
    await m.user.click(toggleOf(rows()[1]));
    await m.user.click(tool('Filter'));
    const names = [
      ...dialog().querySelectorAll('button, [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="radio"], a[href]'),
    ].map((control) => (control.getAttribute('aria-label') ?? control.textContent).trim());
    return names;
  }

  it('has only the controls the step builds, in the list, in an open row and in the Filter menu', async () => {
    const m = mountWindow();
    const names = await everything(m);
    expect(names.filter((name) => LATER.test(name))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(['Mark all as read', 'Clear finished', 'Filter', 'Retry', 'All sources']));
  });

  it('has no segmented view, no footer, no tab and no radio group but the Filter menu\'s own', async () => {
    const m = mountWindow();
    await everything(m);
    expect(within(dialog()).queryByRole('tab')).toBeNull();
    expect(within(dialog()).queryByRole('tablist')).toBeNull();
    expect(within(dialog()).queryByRole('radiogroup')).toBeNull();
    expect(dialog().querySelector('footer, [data-notices-part="centreFooter"]')).toBeNull();
    expect(within(dialog()).queryByRole('link')).toBeNull();
  });

  it('does not show the diagnostics of a record that has them: Details is a later slice', async () => {
    const m = mountWindow();
    await everything(m);
    expect(dialog().textContent).not.toContain('stack trace');
  });
});
