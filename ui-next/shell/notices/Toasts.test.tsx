import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeNotices } from '../core/notices/testing';
import { NoticesProvider } from './context';
import { createNoticesAnnouncer } from './host';
import { layerOf, mount, teardown, toastsOf, wordsOf } from './testing';
import { Toasts } from './Toasts';

// The toast layer over the real model (ch16 S76 to S79, S83, S86, S89a; O6; the mock's `renderHost`, `view`, `toastEntries`, shell-notify.js): what it draws, which roles and names it has, what a pointer and a
// key do, where the focus goes, what the model is told. What a toast lives for, which records get one, and what the live region says of one that has none are the model's (core/notices) and are not repeated here.
// jsdom has no layout and no paint: the geometry, the motion and the stacking are the probe's (probes/notices-probe.mjs).

afterEach(teardown);

const failure = { title: 'Timed out', detail: 'The cluster did not complete the request in time.', severity: 'error', initiator: 'user' } as const;
const route = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };

const partOf = (toast: HTMLElement, part: string): HTMLElement | null => toast.querySelector<HTMLElement>(`[data-notices-part="${part}"]`);
const buttonsOf = (toast: HTMLElement): HTMLElement[] => [...toast.querySelectorAll<HTMLElement>('[data-notices-part="actions"] button')];
const titlesOf = (): string[] => toastsOf().map((toast) => wordsOf(partOf(toast, 'title')));
const pageOf = (): HTMLElement => document.querySelector<HTMLElement>('[data-shell-region="island"]')!;

describe('the layer', () => {
  it('is one live region, polite and not atomic, drawn before there is any toast and the same node after (S86)', async () => {
    const m = mount();
    const layer = layerOf();
    expect(layer).toHaveAttribute('aria-live', 'polite');
    expect(layer).toHaveAttribute('aria-atomic', 'false');
    expect(toastsOf()).toEqual([]);
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    await m.flush();
    expect(toastsOf()).toHaveLength(1);
    expect(layerOf()).toBe(layer);
  });

  it('draws no landmark and offers no F6 stop while the stack is empty', () => {
    mount();
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    expect(document.querySelector('[data-shell-region="toasts"]')).toBeNull();
  });

  it('is a region named Notifications while it has toasts, and its first toast is its one stop for F6 (S12, S13)', async () => {
    const m = mount();
    m.f.store.notify({ title: 'One' });
    m.f.store.notify({ title: 'Two' });
    await m.flush();
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toHaveAttribute('data-shell-region', 'toasts');
    const [first, second] = toastsOf();
    expect(first).toHaveAttribute('data-shell-focus');
    expect(second).not.toHaveAttribute('data-shell-focus');
    expect(region.querySelectorAll('[data-shell-focus]')).toHaveLength(1);
  });
});

describe('a toast', () => {
  it('says its severity with a glyph and a word, then its title and its one sentence (S83)', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Connection added', detail: 'prod-east is ready to use.', severity: 'info' });
    await m.flush();
    const toast = screen.getByRole('status', { name: 'Info: Connection added' });
    expect(partOf(toast, 'severity')?.textContent).toBe('Info: ');
    expect(partOf(toast, 'glyph')?.querySelector('svg')).toHaveAttribute('data-ov-glyph', 'status-info');
    expect(wordsOf(partOf(toast, 'title'))).toBe('Connection added');
    expect(wordsOf(partOf(toast, 'message'))).toBe('prod-east is ready to use.');
    expect(toast).toHaveAttribute('data-severity', 'info');
  });

  it('is a div, whose role is the one that announces it: ARIA in HTML allows neither alert nor status on an article (axe: aria-allowed-role)', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    m.f.store.notify(failure);
    await m.flush();
    const toasts = toastsOf();
    expect(toasts.map((toast) => toast.getAttribute('role'))).toEqual(['status', 'alert']);
    expect(toasts.map((toast) => toast.tagName)).toEqual(['DIV', 'DIV']);
  });

  it('says which toast stays until the user acts (S78): a failure is marked sticky, a timed one is not', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    m.f.store.notify(failure);
    await m.flush();
    const [timed, sticky] = toastsOf();
    expect(timed).not.toHaveAttribute('data-sticky');
    expect(sticky).toHaveAttribute('data-sticky');
  });

  it('draws the shipped glyph and says the word of each severity, so no severity is a colour alone', async () => {
    const m = mount();
    const severities = [['info', 'status-info', 'Info'], ['success', 'status-success', 'Success'], ['warning', 'status-warning', 'Warning'], ['error', 'status-error', 'Error']] as const;
    for (const [severity, glyph, word] of severities) {
      m.f.store.notify({ title: `A ${severity}`, severity, initiator: 'system' });
      await m.flush();
      const [toast] = toastsOf();
      expect(partOf(toast, 'glyph')?.querySelector('svg')).toHaveAttribute('data-ov-glyph', glyph);
      expect(partOf(toast, 'severity')?.textContent).toBe(`${word}: `);
      expect(toast).toHaveAttribute('aria-label', `${word}: A ${severity}`);
      act(() => {
        m.f.store.dismissToasts();
      });
      await m.flush();
    }
  });

  it('is an alert for an error of work the user started, and a status for everything else (S86, O6)', async () => {
    const m = mount();
    m.f.store.notify(failure);
    await m.flush();
    expect(screen.getByRole('alert', { name: 'Error: Timed out' })).toBeInTheDocument();
    act(() => {
      m.f.store.dismissToasts();
    });
    m.f.store.notify({ ...failure, title: 'Sync failed', initiator: 'system' });
    m.f.store.notify({ title: 'Disk is filling', severity: 'warning' });
    await m.flush();
    expect(screen.getByRole('status', { name: 'Error: Sync failed' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Warning: Disk is filling' })).toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: /^Error/ })).toBeNull();
  });

  it('draws no second line for a record with no sentence, and no buttons for one with no action', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    await m.flush();
    const [toast] = toastsOf();
    expect(partOf(toast, 'message')).toBeNull();
    expect(partOf(toast, 'actions')).toBeNull();
  });

  it('takes the focus by script only, and its controls are the Tab stops (A14)', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    await m.flush();
    const [toast] = toastsOf();
    expect(toast).toHaveAttribute('tabindex', '-1');
    await m.user.tab();
    expect(document.activeElement).toBe(m.opener);
    await m.user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss: Snapshot created' }));
  });

  it('keeps its words in a bidirectional text of its own: a right-to-left sentence aligns and clips at its own end', async () => {
    const m = mount();
    m.f.store.notify({ title: 'تم الاتصال', detail: 'جاهز للاستخدام.' });
    await m.flush();
    const [toast] = toastsOf();
    expect(partOf(toast, 'title')).toHaveAttribute('dir', 'auto');
    expect(partOf(toast, 'message')?.querySelector('[dir="auto"]')).not.toBeNull();
  });
});

describe('announced once', () => {
  it('is told by being inserted, and a count that moves is no text added or changed inside the live region', async () => {
    const m = mount();
    m.f.store.notify(failure);
    await m.flush();
    const layer = layerOf();
    const [before] = toastsOf();
    expect(wordsOf(partOf(before, 'title'))).toBe('Timed out');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => {
      records.push(...list);
    });
    observer.observe(layer, { subtree: true, childList: true, characterData: true, attributes: true });
    m.f.store.notify(failure);
    await m.flush();
    m.f.store.notify(failure);
    await m.flush();
    records.push(...observer.takeRecords());
    observer.disconnect();
    const [after] = toastsOf();
    expect(after).toBe(before);
    expect(wordsOf(partOf(after, 'title'))).toBe('Timed out 3 times');
    expect(records.length).toBeGreaterThan(0);
    expect(records.filter((record) => record.type === 'characterData')).toEqual([]);
    expect(records.flatMap((record) => (record.type === 'childList' ? [...record.addedNodes] : []))).toEqual([]);
    expect(after).toHaveAttribute('aria-label', 'Error: Timed out 3 times');
  });

  it('draws the words of a toast that changed as generated content, the second line too (the mock\'s rule for a folded record)', async () => {
    const m = mount();
    m.f.store.notify(failure);
    await m.flush();
    const [toast] = toastsOf();
    expect(partOf(toast, 'message')?.querySelector('[data-text]')).toBeNull();
    expect(wordsOf(partOf(toast, 'message'))).toBe('The cluster did not complete the request in time.');
    m.f.store.notify(failure);
    await m.flush();
    const message = partOf(toast, 'message')?.querySelector('[data-text]');
    expect(message).not.toBeNull();
    expect(wordsOf(message)).toBe('The cluster did not complete the request in time.');
    expect(message?.textContent).toBe('');
  });

  it('is told again by a toast that comes back: one that was dismissed and fails again is a new node, which a live region announces', async () => {
    const m = mount();
    const handle = m.f.store.notify(failure);
    await m.flush();
    const [first] = toastsOf();
    handle.dismiss();
    await m.flush();
    expect(toastsOf()).toEqual([]);
    m.f.store.notify(failure);
    await m.flush();
    const [again] = toastsOf();
    expect(again).toBeDefined();
    expect(again).not.toBe(first);
    expect(wordsOf(partOf(again, 'title'))).toBe('Timed out 2 times');
  });
});

describe('the buttons of a toast', () => {
  it('opens the page an action names through the tab model, as a notification (S64)', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Disk is filling', severity: 'warning', actions: [{ id: 'go', label: 'Open instance', route }] });
    await m.flush();
    await m.user.click(screen.getByRole('button', { name: 'Open instance' }));
    expect(m.f.opened).toHaveLength(1);
    expect(m.f.opened[0]?.destination).toMatchObject({ route });
    expect(m.f.opened[0]?.options).toMatchObject({ source: 'notification' });
    await m.flush();
    expect(toastsOf()).toEqual([]);
  });

  it('runs the command an action names through the host\'s registry', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Signed out', severity: 'warning', actions: [{ id: 'in', label: 'Sign in', command: { id: 'host.signIn', arg: { who: 'me' } } }] });
    await m.flush();
    await m.user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(m.f.commands).toEqual([{ id: 'host.signIn', arg: { who: 'me' } }]);
  });

  it('paints a Retry as the one primary button, with the glyph that turns', async () => {
    const m = mount();
    m.f.store.begin({ title: 'Reconnecting data source', initiator: 'user', onRetry: () => undefined }).fail('Nothing answered.');
    await m.flush();
    const [toast] = toastsOf();
    const [retry] = buttonsOf(toast);
    expect(retry).toHaveTextContent('Retry');
    expect(retry).toHaveAttribute('data-ov-variant', 'primary');
    expect(retry?.querySelector('svg')).toHaveAttribute('data-ov-glyph', 'refresh');
  });

  it('draws no button for an action that cannot be used, and says why in words under the sentence (a button that does nothing is a stub)', async () => {
    const m = mount();
    m.f.off.add('cloud');
    m.f.store.notify({ title: 'Disk is filling', severity: 'warning', actions: [{ id: 'go', label: 'Open instance', route }] });
    await m.flush();
    const [toast] = toastsOf();
    expect(buttonsOf(toast)).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Open instance' })).toBeNull();
    expect(wordsOf(partOf(toast, 'reason'))).toBe('Open instance is unavailable. Cloud is turned off.');
  });

  it('draws at most two, and only the ones that can be used', async () => {
    const m = mount();
    const run = (): undefined => undefined;
    m.f.store.notify({ title: 'Three ways', severity: 'warning', actions: [{ id: 'a', label: 'First', run }, { id: 'b', label: 'Second', run }, { id: 'c', label: 'Third', run }] });
    await m.flush();
    const [toast] = toastsOf();
    expect(buttonsOf(toast).map((button) => button.textContent)).toEqual(['First', 'Second']);
  });

  it('tells the person when the host refuses an action, instead of doing nothing', async () => {
    const m = mount({ store: { run: undefined } });
    m.f.store.notify({ title: 'Signed out', severity: 'warning', actions: [{ id: 'in', label: 'Sign in', command: { id: 'host.signIn' } }] });
    await m.flush();
    await m.user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(m.announcer.polite.getSnapshot().text).toBe('Nothing here can run this command.');
  });
});

describe('dismissing', () => {
  it('dismisses with its own control, named for the toast, and the record stays in the history, read', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    m.f.store.notify({ title: 'Backup finished', severity: 'success' });
    await m.flush();
    await m.user.click(screen.getByRole('button', { name: 'Dismiss: Snapshot created' }));
    await m.flush();
    expect(titlesOf()).toEqual(['Backup finished']);
    expect(m.f.store.getSnapshot().recent.map((record) => [record.name, record.read])).toEqual([['Backup finished', false], ['Snapshot created', true]]);
  });

  it('leaves the stack with no toast and no landmark when the last is dismissed, and the live region stays', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    await m.flush();
    await m.user.click(screen.getByRole('button', { name: 'Dismiss: Snapshot created' }));
    await m.flush();
    expect(toastsOf()).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    expect(layerOf()).toHaveAttribute('aria-live', 'polite');
  });
});

describe('the summary toast (S79)', () => {
  const five = async (m: ReturnType<typeof mount>, worst = 4): Promise<void> => {
    for (let index = 1; index <= 5; index += 1) {
      m.f.store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}`, severity: index === worst ? 'error' : 'info', initiator: 'system' });
    }

    await m.flush();
  };

  it('stands for the records that do not fit: three toasts, the summary on top and the two newest below it, newest at the bottom', async () => {
    const m = mount();
    await five(m);
    const shown = toastsOf();
    expect(shown).toHaveLength(3);
    expect(shown[0]).toHaveAttribute('data-notices-summary');
    expect(titlesOf()).toEqual(['3 more notifications', 'Notice 4', 'Notice 5']);
  });

  it('carries the worst severity of what it hides, as a glyph and a word, and is a status and never an alert', async () => {
    const m = mount();
    await five(m, 2);
    const [summary] = toastsOf();
    expect(summary).toHaveAttribute('role', 'status');
    expect(summary).toHaveAttribute('data-severity', 'error');
    expect(partOf(summary, 'glyph')?.querySelector('svg')).toHaveAttribute('data-ov-glyph', 'status-error');
    expect(summary).toHaveAttribute('aria-label', 'Error: 3 more notifications');
  });

  it('has no Show while the window has no notification centre: a button that opens nothing is a stub', async () => {
    const m = mount({ centre: false });
    await five(m);
    const [summary] = toastsOf();
    expect(buttonsOf(summary)).toEqual([]);
    expect(within(summary).getByRole('button', { name: 'Dismiss: 3 more notifications' })).toBeInTheDocument();
  });

  it('has a Show that opens the centre when the window has one', async () => {
    const m = mount({ centre: true });
    await five(m);
    const [summary] = toastsOf();
    await m.user.click(within(summary).getByRole('button', { name: 'Show' }));
    expect(m.f.centre.opened).toBe(1);
  });

  it('dismisses what it stands for with its own control, and the toasts that were drawn stay', async () => {
    const m = mount();
    await five(m);
    await m.user.click(screen.getByRole('button', { name: 'Dismiss: 3 more notifications' }));
    await m.flush();
    expect(titlesOf()).toEqual(['Notice 4', 'Notice 5']);
  });

  it('is told once when it appears, and a count that moves is generated content, not text', async () => {
    const m = mount();
    await five(m);
    const [summary] = toastsOf();
    expect(wordsOf(partOf(summary, 'title'))).toBe('3 more notifications');
    expect(partOf(summary, 'title')?.hasAttribute('data-text')).toBe(false);
    m.f.store.forSource('p6').notify({ title: 'Notice 6', initiator: 'system' });
    await m.flush();
    const [moved] = toastsOf();
    expect(moved).toBe(summary);
    expect(wordsOf(partOf(moved, 'title'))).toBe('4 more notifications');
    expect(partOf(moved, 'title')?.hasAttribute('data-text')).toBe(true);
  });
});

describe('the focus', () => {
  it('is never taken by a toast that appears: the control that had it keeps it (S13)', async () => {
    const m = mount();
    m.opener.focus();
    const moves = vi.fn();
    document.addEventListener('focusin', moves);
    m.f.store.notify(failure);
    await m.flush();
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    await m.flush();
    document.removeEventListener('focusin', moves);
    expect(toastsOf()).toHaveLength(2);
    expect(document.activeElement).toBe(m.opener);
    expect(moves).not.toHaveBeenCalled();
  });

  it('is reached with F6, which lands on the first toast, from the region the focus was in (S12, S13)', async () => {
    const m = mount();
    m.f.store.notify({ title: 'One' });
    m.f.store.notify({ title: 'Two' });
    await m.flush();
    pageOf().focus();
    await m.user.keyboard('{F6}');
    expect(document.activeElement).toBe(toastsOf()[0]);
    await m.user.keyboard('{F6}');
    expect(document.activeElement).toBe(pageOf());
  });

  it('skips the stack with F6 while it has no toast: a region with nothing to focus is not a stop', async () => {
    const m = mount();
    pageOf().focus();
    await m.user.keyboard('{F6}');
    expect(document.activeElement).toBe(pageOf());
  });

  it('closes the focused toast with Escape and gives the focus back to where it was, and leaves the other toasts (never a trap)', async () => {
    const m = mount();
    m.f.store.notify({ title: 'One' });
    m.f.store.notify({ title: 'Two' });
    await m.flush();
    pageOf().focus();
    await m.user.keyboard('{F6}');
    expect(document.activeElement).toBe(toastsOf()[0]);
    await m.user.keyboard('{Escape}');
    await m.flush();
    expect(titlesOf()).toEqual(['Two']);
    expect(document.activeElement).toBe(pageOf());
  });

  it('closes the toast from one of its buttons too, and gives the focus back to the control it came from (Escape acts on the toast the focus is in)', async () => {
    const m = mount();
    m.opener.focus();
    m.f.store.notify({ title: 'Disk is filling', severity: 'warning', actions: [{ id: 'fix', label: 'Fix it', run: () => undefined }] });
    await m.flush();
    await m.user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fix it' }));
    await m.user.keyboard('{Escape}');
    await m.flush();
    expect(toastsOf()).toEqual([]);
    expect(document.activeElement).toBe(m.opener);
  });

  it('gives the focus back where it was when the toast that has it is removed by anything else: the model dismisses it', async () => {
    const m = mount();
    m.opener.focus();
    const handle = m.f.store.notify({ title: 'One' });
    await m.flush();
    toastsOf()[0].focus();
    expect(document.activeElement).toBe(toastsOf()[0]);
    act(() => {
      handle.dismiss();
    });
    await m.flush();
    expect(toastsOf()).toEqual([]);
    expect(document.activeElement).toBe(m.opener);
  });

  it('gives the focus back when the toast that has it goes under the summary because more arrived', async () => {
    const m = mount();
    m.opener.focus();
    m.f.store.forSource('p1').notify({ title: 'Notice 1' });
    m.f.store.forSource('p2').notify({ title: 'Notice 2' });
    m.f.store.forSource('p3').notify({ title: 'Notice 3' });
    await m.flush();
    toastsOf()[0].focus();
    m.f.store.forSource('p4').notify({ title: 'Notice 4' });
    m.f.store.forSource('p5').notify({ title: 'Notice 5' });
    await m.flush();
    expect(toastsOf()).toHaveLength(3);
    expect(document.activeElement).toBe(m.opener);
  });

  it('leaves the focus alone when the user moved it on before the toast went: it is theirs', async () => {
    const m = mount({ around: <button type="button">Other</button> });
    m.opener.focus();
    const handle = m.f.store.notify({ title: 'One' });
    await m.flush();
    toastsOf()[0].focus();
    const other = screen.getByRole('button', { name: 'Other' });
    other.focus();
    act(() => {
      handle.dismiss();
    });
    await m.flush();
    expect(document.activeElement).toBe(other);
  });

  it('closes the summary toast with Escape too, which dismisses what it stands for', async () => {
    const m = mount();
    for (let index = 1; index <= 5; index += 1) {
      m.f.store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}` });
    }

    await m.flush();
    pageOf().focus();
    await m.user.keyboard('{F6}');
    expect(document.activeElement).toBe(toastsOf()[0]);
    await m.user.keyboard('{Escape}');
    await m.flush();
    expect(titlesOf()).toEqual(['Notice 4', 'Notice 5']);
  });
});

describe('the hold of the pointer and the focus on the clocks (S78)', () => {
  const timed = async (m: ReturnType<typeof mount>): Promise<void> => {
    m.f.store.notify({ title: 'One' });
    m.f.store.notify({ title: 'Two' });
    await m.flush();
  };

  it('pauses the stack as one while the pointer is over a toast, and runs again a moment after it left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = mount();
      await timed(m);
      const [toast] = toastsOf();
      fireEvent.pointerOver(toast);
      await m.flush();
      expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
      fireEvent.pointerOut(toast);
      await act(async () => {
        vi.advanceTimersByTime(119);
      });
      expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(m.f.store.getSnapshot().toasts.paused).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let go when the pointer only crosses from one toast to the next', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = mount();
      await timed(m);
      const [first, second] = toastsOf();
      fireEvent.pointerOver(first);
      fireEvent.pointerOut(first);
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.pointerOver(second);
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses while a toast has the focus, and runs again when the focus leaves the stack', async () => {
    const m = mount();
    await timed(m);
    m.opener.focus();
    await act(async () => {
      toastsOf()[0].focus();
    });
    expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
    await act(async () => {
      m.opener.focus();
    });
    expect(m.f.store.getSnapshot().toasts.paused).toBe(false);
  });

  it('keeps the pause while the focus moves from one control of the stack to another', async () => {
    const m = mount();
    m.f.store.notify({ title: 'Disk is filling', severity: 'warning', actions: [{ id: 'fix', label: 'Fix it', run: () => undefined }] });
    await m.flush();
    await act(async () => {
      screen.getByRole('button', { name: 'Fix it' }).focus();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Dismiss: Disk is filling' }).focus();
    });
    expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
  });

  it('lets go of both when the last toast goes, and leaves no timer behind: nothing is left to hold', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = mount();
      m.f.store.notify({ title: 'One' });
      await m.flush();
      const [toast] = toastsOf();
      fireEvent.pointerOver(toast);
      await act(async () => {
        toast.focus();
      });
      expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
      act(() => {
        m.f.store.dismissToasts();
      });
      await m.flush();
      expect(toastsOf()).toEqual([]);
      expect(m.f.store.getSnapshot().toasts.paused).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets go of what it holds when the window goes', async () => {
    const m = mount();
    await timed(m);
    await act(async () => {
      toastsOf()[0].focus();
    });
    expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
    m.unmount();
    expect(m.f.store.getSnapshot().toasts.paused).toBe(false);
  });
});

describe('while a modal owns the window (S89a)', () => {
  it('draws nothing, keeps the layer, and brings the stack back when the modal closes, without moving the focus', async () => {
    const m = mount();
    m.opener.focus();
    m.f.store.notify(failure);
    await m.flush();
    expect(toastsOf()).toHaveLength(1);
    act(() => {
      m.f.store.hold('modal', true);
    });
    await m.flush();
    expect(toastsOf()).toEqual([]);
    expect(layerOf()).toHaveAttribute('aria-live', 'polite');
    m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    await m.flush();
    expect(toastsOf()).toEqual([]);
    act(() => {
      m.f.store.hold('modal', false);
    });
    await m.flush();
    expect(toastsOf()).toHaveLength(2);
    expect(document.activeElement).toBe(m.opener);
  });
});

describe('the window\'s live regions: a record that has no toast (S86)', () => {
  const polite = (): HTMLElement => document.querySelector<HTMLElement>('[data-notices-part="live"]')!;
  const assertive = (): HTMLElement => document.querySelector<HTMLElement>('[data-notices-part="alert"]')!;

  it('has a polite and an assertive live region, empty, visually hidden, always there, and with no role: the page\'s own status and alert are found by their roles alone', () => {
    mount();
    expect(polite()).toHaveAttribute('aria-live', 'polite');
    expect(polite()).toHaveAttribute('aria-atomic', 'true');
    expect(assertive()).toHaveAttribute('aria-live', 'assertive');
    expect(assertive()).toHaveAttribute('aria-atomic', 'true');
    expect(polite()).not.toHaveAttribute('role');
    expect(assertive()).not.toHaveAttribute('role');
    expect(polite().textContent).toBe('');
    expect(assertive().textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('tells what the model says to the region it says it to: an error of work the user started is assertive, the rest polite', async () => {
    const m = mount();
    await act(async () => {
      m.announcer.announce('Failed: Scaling orders-api', { urgent: true });
    });
    expect(assertive().textContent).toBe('Failed: Scaling orders-api');
    expect(polite().textContent).toBe('');
    await act(async () => {
      m.announcer.announce('Succeeded: Backup', { urgent: false });
    });
    expect(polite().textContent).toBe('Succeeded: Backup');
  });

  it('tells the same sentence twice as two announcements: the node is replaced, not rewritten', async () => {
    const m = mount();
    await act(async () => {
      m.announcer.announce('Retrying: Backup', { urgent: false });
    });
    const first = polite().firstElementChild;
    await act(async () => {
      m.announcer.announce('Retrying: Backup', { urgent: false });
    });
    expect(polite().textContent).toBe('Retrying: Backup');
    expect(polite().firstElementChild).not.toBe(first);
  });

  it('does not tell a window that has just opened what was told before it existed', () => {
    const announcer = createNoticesAnnouncer();
    announcer.announce('Before', { urgent: false });
    announcer.announce('Before, urgently', { urgent: true });
    const { store } = makeNotices();
    render(
      <NoticesProvider notices={{ store, announcer }}>
        <Toasts />
      </NoticesProvider>,
    );
    expect(polite().textContent).toBe('');
    expect(assertive().textContent).toBe('');
  });
});
