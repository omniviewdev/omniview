import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWindow, teardown } from './testing';

// The bell in the status bar (ch16 S81, S90; the mock's built-in bell and `bellFace`, shell-regions.js and shell-feedback.js): last in the bar, a 24 px button with a 16 px glyph, a 6 px dot of the worst unread
// severity and never a number (A12); its name and its tooltip carry the counts in words ("Notifications, 3 unread, 1 error"). What it draws, where and in which paint is the probe's; what it says and does is here.

afterEach(teardown);

const bell = (): HTMLElement => screen.getByRole('button', { name: /^Notifications/ });
const dot = (): HTMLElement | null => document.querySelector('[data-notices-part="bellDot"]');

describe('the bell', () => {
  it('is not in a window that has no notification centre', () => {
    mountWindow({ noCentre: true });
    expect(screen.queryByRole('button', { name: /^Notifications/ })).toBeNull();
    expect(document.querySelector('[data-notices-part="bell"]')).toBeNull();
  });

  it('is the last control of the status bar, a button that opens a dialog and has not', () => {
    mountWindow();
    const statusBar = screen.getByRole('contentinfo', { name: 'Status bar' });
    const buttons = within(statusBar).getAllByRole('button');
    expect(buttons.at(-1)).toBe(bell());
    expect(bell().getAttribute('aria-haspopup')).toBe('dialog');
    expect(bell().getAttribute('aria-expanded')).toBe('false');
    expect(bell().getAttribute('type')).toBe('button');
  });

  it('is called Notifications when nothing is unread, and has no dot', () => {
    mountWindow();
    expect(bell()).toHaveAccessibleName('Notifications');
    expect(dot()).toBeNull();
  });

  it('says the unread count in words, never a number alone: the name and the tooltip carry it and nothing visible does', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    m.f.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
    m.f.store.notify({ title: 'Quota almost used', severity: 'warning', source: 'bank' });
    await m.flush();
    expect(bell()).toHaveAccessibleName('Notifications, 3 unread, 1 error, 1 warning');
    expect(bell().getAttribute('data-ov-tip')).toBe('Notifications, 3 unread, 1 error, 1 warning');
    expect(bell().textContent.trim()).toBe('');
    expect(dot()?.textContent).toBe('');
    expect(within(bell()).queryByText(/\d/)).toBeNull();
  });

  it('draws the dot of the worst unread severity: error, else warning, else the accent', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Snapshot created', severity: 'info', source: 'stack' });
    await m.flush();
    expect(dot()?.getAttribute('data-tone')).toBe('info');
    m.f.store.notify({ title: 'Quota almost used', severity: 'warning', source: 'bank' });
    await m.flush();
    expect(dot()?.getAttribute('data-tone')).toBe('warning');
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    await m.flush();
    expect(dot()?.getAttribute('data-tone')).toBe('error');
  });

  it('loses its dot when everything is read, and says so', async () => {
    const m = mountWindow();
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    await m.flush();
    expect(dot()).not.toBeNull();
    m.f.store.readAll();
    await m.flush();
    expect(dot()).toBeNull();
    expect(bell()).toHaveAccessibleName('Notifications');
  });

  it('hides its glyph and its dot from assistive technology: the name is what it says', () => {
    mountWindow();
    const glyph = document.querySelector('[data-notices-part="bellGlyph"]');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a Tab stop (A14): a control of the status bar is never taken out of the tab order', () => {
    mountWindow();
    expect(bell().getAttribute('tabindex')).not.toBe('-1');
  });

  it('opens the centre on a click, says it is expanded, and closes it on a second click', async () => {
    const m = mountWindow();
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    await m.user.click(bell());
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    expect(bell().getAttribute('aria-expanded')).toBe('true');
    expect(bell().getAttribute('aria-controls')).toBe(screen.getByRole('dialog', { name: 'Notifications' }).id);
    expect(m.centre.getSnapshot().open).toBe(true);
    await m.user.click(bell());
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(bell().getAttribute('aria-expanded')).toBe('false');
    expect(bell().hasAttribute('aria-controls')).toBe(false);
  });

  it('opens from the keyboard with Enter and with Space', async () => {
    const m = mountWindow();
    bell().focus();
    await m.user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    m.centre.close();
    await m.flush();
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    bell().focus();
    await m.user.keyboard(' ');
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('is open when the host opens the centre (the summary toast\'s Show): the same popover, the same state', async () => {
    const m = mountWindow();
    m.centre.open();
    await m.flush();
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    expect(bell().getAttribute('aria-expanded')).toBe('true');
  });

  it('holds no listener for a press on the document while the centre is closed, however many notices come, and lets go of it when the centre closes', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const m = mountWindow();
    const presses = () => add.mock.calls.filter(([type]) => type === 'pointerdown').length - remove.mock.calls.filter(([type]) => type === 'pointerdown').length;
    m.f.store.notify({ title: 'Timed out', severity: 'error', source: 'cloud' });
    await m.flush();
    expect(presses()).toBe(0);
    m.centre.open();
    await m.flush();
    expect(presses()).toBe(1);
    m.centre.close();
    await m.flush();
    expect(presses()).toBe(0);
  });
});
