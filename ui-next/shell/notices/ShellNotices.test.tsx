import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { makeNotices, manualClock } from '../core/notices/testing';
import type { ShellRegistration } from '../registration';
import { StaticShell } from '../testing';
import { createNoticesAnnouncer, type NoticesBindings } from './host';

// The toast layer in the real shell frame (ch16 S12, S13): where it sits among the regions, what F6 and Escape do with it. What it draws is `Toasts.test.tsx`'s; the pixels are the probe's.

afterEach(cleanup);

const registration: ShellRegistration = { plugin: { name: 'Acme' } };

function mountShell(withNotices = true) {
  const clock = manualClock();
  const announcer = createNoticesAnnouncer();
  const f = makeNotices({ announce: announcer.announce }, clock);
  const notices: NoticesBindings = { store: f.store, announcer };
  const view = render(
    <StaticShell registration={registration} notices={withNotices ? notices : undefined}>
      <button type="button">Inside the page</button>
    </StaticShell>,
  );
  const flush = async (): Promise<void> => {
    await act(async () => {
      await clock.advance(16);
    });
  };

  return { f, view, flush, user: userEvent.setup() };
}

const layer = (): Element | null => document.querySelector('[data-notices-part="layer"]');

describe('the toast layer in the shell frame', () => {
  it('is not mounted in a window that has no notices: no layer, no live region, no landmark', () => {
    mountShell(false);
    expect(layer()).toBeNull();
    expect(document.querySelector('[data-notices-part="live"]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
  });

  it('is the last region of the window: after the status bar, in the focus order of the shell (S12)', async () => {
    const { f, flush } = mountShell();
    act(() => {
      f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await flush();
    const window = document.querySelector('[data-shell-part="window"]')!;
    const statusBar = screen.getByRole('contentinfo', { name: 'Status bar' });
    expect(window.contains(layer())).toBe(true);
    expect(statusBar.compareDocumentPosition(layer()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is visited by F6 after the page and before the top row, and by Shift+F6 before the page (S12: toasts last)', async () => {
    const { f, flush, user } = mountShell();
    act(() => {
      f.store.notify({ title: 'One' });
    });
    await flush();
    act(() => {
      screen.getByRole('tab', { name: 'Widgets' }).focus();
    });
    await user.keyboard('{F6}');
    expect(screen.getByRole('main')).toHaveFocus();
    await user.keyboard('{F6}');
    expect(document.activeElement?.getAttribute('data-notices-part')).toBe('toast');
    await user.keyboard('{F6}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
    await user.keyboard('{Shift>}{F6}{/Shift}');
    expect(document.activeElement?.getAttribute('data-notices-part')).toBe('toast');
    await user.keyboard('{Shift>}{F6}{/Shift}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('is not a stop while it has no toast', async () => {
    const { user } = mountShell();
    act(() => {
      screen.getByRole('tab', { name: 'Widgets' }).focus();
    });
    await user.keyboard('{F6}');
    expect(screen.getByRole('main')).toHaveFocus();
    await user.keyboard('{F6}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
  });

  it('closes the focused toast with Escape and gives the focus back to the page it came from, and to the control it came from by Tab', async () => {
    const { f, flush, user } = mountShell();
    act(() => {
      f.store.notify({ title: 'One' });
    });
    await flush();
    screen.getByRole('main').focus();
    await user.keyboard('{F6}');
    expect(document.activeElement?.getAttribute('data-notices-part')).toBe('toast');
    await user.keyboard('{Escape}');
    await flush();
    expect(document.querySelector('[data-notices-part="toast"]')).toBeNull();
    expect(screen.getByRole('main')).toHaveFocus();

    f.store.notify({ title: 'Two' });
    await flush();
    const inside = screen.getByRole('button', { name: 'Inside the page' });
    inside.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss: Two' }));
    await user.keyboard('{Escape}');
    await flush();
    expect(inside).toHaveFocus();
  });
});
