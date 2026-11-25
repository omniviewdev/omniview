import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWindow, teardown, type MountedWindow } from './testing';

// What the notification centre reads, and what it holds back (ch16 S81, S89a; the mock's `centerOpened` and `centerClosed`, shell-feedback.js): opening keeps every row as it was; closing it after a second marks what it
// listed as read, each record counted from the moment it was listed; opening a row, acting on it or dismissing it reads it at once; and while it is open the toast stack waits.

afterEach(teardown);

const bell = (): HTMLElement => screen.getByRole('button', { name: /^Notifications/ });
const dialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Notifications' });
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[data-notices-part="row"]')];
const unread = (m: MountedWindow): number => m.f.store.getSnapshot().counts.unread;
const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-notices-part="toast"]')];

describe('what the centre reads', () => {
  it('keeps every row as it was while it is open, however long: opening reads nothing', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    });
    await m.flush();
    await m.user.click(bell());
    await m.pass(30_000);
    expect(unread(m)).toBe(1);
    expect(rows()[0]?.hasAttribute('data-unread')).toBe(true);
    expect(bell()).toHaveAccessibleName('Notifications, 1 unread, 1 error');
  });

  it('reads what it listed when it closes after being open for a second', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
      m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    });
    await m.flush();
    await m.user.click(bell());
    await m.pass(1000);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(unread(m)).toBe(0);
    expect(bell()).toHaveAccessibleName('Notifications');
  });

  it('reads nothing when it closes before a second has passed', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    });
    await m.flush();
    await m.user.click(bell());
    await m.pass(900);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(unread(m)).toBe(1);
  });

  it('counts a record from the moment it arrived while the centre was open: one that came a moment ago is not read, the one that was there is', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Was there', source: 'cloud' });
    });
    await m.flush();
    await m.user.click(bell());
    await m.pass(2000);
    act(() => {
      m.f.store.notify({ title: 'Came just now', source: 'stack' });
    });
    await m.pass(300);
    expect(rows().map((row) => row.querySelector('[data-notices-part="rowTitle"]')?.textContent)).toEqual(['Info: Came just now', 'Info: Was there']);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    const left = m.f.store.getSnapshot().recent.filter((record) => record.unread).map((record) => record.title);
    expect(left).toEqual(['Came just now']);
  });

  it('reads a row at once when it is opened, and again when it is closed', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
      m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    });
    await m.flush();
    await m.user.click(bell());
    expect(unread(m)).toBe(2);
    await m.user.click(within(rows()[1]).getByRole('button', { expanded: false }));
    expect(unread(m)).toBe(1);
    expect(rows()[1]?.hasAttribute('data-unread')).toBe(false);
  });

  it('reads a row at once when one of its actions is pressed', async () => {
    const run = vi.fn();
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud', actions: [{ id: 'again', label: 'Retry', kind: 'retry', run }] });
    });
    await m.flush();
    await m.user.click(bell());
    await m.user.click(within(rows()[0]).getByRole('button', { expanded: false }));
    await m.user.click(within(rows()[0]).getByRole('button', { name: 'Retry' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(unread(m)).toBe(0);
  });

  it('reads only the rows it drew: the records behind "Show older" stay unread', async () => {
    const m = mountWindow();
    act(() => {
      for (let index = 0; index < 60; index += 1) {
        m.f.store.notify({ title: `Notice ${String(index)}`, source: `p${String(index)}` });
      }
    });

    await m.flush();
    await m.user.click(bell());
    await m.pass(1500);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(unread(m)).toBe(10);
  });

  it('does not read a record of a source it is narrowed away from: it was not listed', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
      m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    });
    await m.flush();
    act(() => {
      m.centre.filter('stack');
    });
    await m.user.click(bell());
    await m.pass(1500);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(m.f.store.getSnapshot().recent.filter((record) => record.unread).map((record) => record.title)).toEqual(['Timed out']);
  });
});

describe('the toast stack while the centre is open', () => {
  it('waits while it is open, and is back when it closes before the records were read', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud', initiator: 'user' });
    });
    await m.flush();
    expect(toasts()).toHaveLength(1);
    await m.user.click(bell());
    expect(toasts()).toHaveLength(0);
    await m.pass(500);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(toasts()).toHaveLength(1);
  });

  it('does not bring back a toast whose record the centre read', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud', initiator: 'user' });
    });
    await m.flush();
    await m.user.click(bell());
    await m.pass(1500);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(toasts()).toHaveLength(0);
  });

  it('is opened by the summary toast\'s Show, which the window has now that it has a centre', async () => {
    const m = mountWindow();
    act(() => {
      for (let index = 1; index <= 5; index += 1) {
        m.f.store.notify({ title: `Notice ${String(index)}`, severity: 'error', source: `p${String(index)}` });
      }
    });

    await m.flush();
    const show = within(toasts()[0]).getByRole('button', { name: 'Show' });
    await m.user.click(show);
    expect(m.centre.getSnapshot().open).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    expect(toasts()).toHaveLength(0);
  });

  it('has no Show on the summary toast in a window that has no centre: a button that opens nothing is a stub', async () => {
    const m = mountWindow({ noCentre: true });
    act(() => {
      for (let index = 1; index <= 5; index += 1) {
        m.f.store.notify({ title: `Notice ${String(index)}`, severity: 'error', source: `p${String(index)}` });
      }
    });

    await m.flush();
    expect(within(toasts()[0]).queryByRole('button', { name: 'Show' })).toBeNull();
  });
});

// ONE PRESENTER (the lead's ruling of 2026-11-21; core/notices/lifetime.test.ts has the model's side): the list presents what it lists, so while it is open nothing is drawn twice.
describe('one presenter: the list and the toasts', () => {
  it('puts a notice that arrives while it is open in the list, raises no toast for it, and tells it once', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'First', source: 'cloud' });
    });
    await m.flush();
    await m.user.click(bell());
    const told = (): number => m.announcer.assertive.getSnapshot().serial + m.announcer.polite.getSnapshot().serial;
    const before = told();
    act(() => {
      m.f.store.notify({ title: 'Timed out', detail: 'The cluster did not answer.', severity: 'error', source: 'stack', initiator: 'user' });
    });
    await m.flush();
    expect(rows().map((row) => row.querySelector('[data-notices-part="rowTitle"]')?.textContent)).toEqual(['Error: Timed out', 'Info: First']);
    expect(toasts()).toHaveLength(0);
    expect(m.announcer.assertive.getSnapshot().text).toContain('Timed out');
    expect(told()).toBe(before + 1);
    act(() => {
      m.centre.close();
    });
    await m.pass(500);
    expect(toasts().map((toast) => toast.getAttribute('aria-label'))).toEqual(['Info: First']);
    expect(told()).toBe(before + 1);
  });

  it('brings back a toast that was waiting with what it had left, when the centre closes before it read the record', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'cloud' });
    });
    await m.flush();
    await m.pass(7000);
    expect(toasts()).toHaveLength(1);
    await m.user.click(bell());
    expect(toasts()).toHaveLength(0);
    await m.pass(500);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(toasts()).toHaveLength(1);
    await m.pass(1500);
    expect(toasts()).toHaveLength(1);
    await m.pass(600);
    expect(toasts()).toHaveLength(0);
  });

  it('does not bring back a timed toast whose record the centre read while it was open for a second', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'cloud' });
    });
    await m.flush();
    await m.pass(3000);
    await m.user.click(bell());
    await m.pass(1500);
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(toasts()).toHaveLength(0);
    await m.pass(10_000);
    expect(toasts()).toHaveLength(0);
    expect(unread(m)).toBe(0);
  });

  it('does not bring back a toast whose record was opened in the list: acting on a record reads it', async () => {
    const m = mountWindow();
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'cloud' });
    });
    await m.flush();
    await m.user.click(bell());
    await m.user.click(within(rows()[0]).getByRole('button', { expanded: false }));
    act(() => {
      m.centre.close();
    });
    await m.flush();
    expect(toasts()).toHaveLength(0);
  });
});
