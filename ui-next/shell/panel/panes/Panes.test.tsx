import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolInput } from '../../core/panel';
import type { ShellRegistration } from '../../registration';
import { StaticShell } from '../../testing';
import { staticPanel, type StaticSession } from '../testing';

// The panes of a tool in the panel (#697 step 6, the layout): several bodies side by side, the sash between them, and what a click does. The model is tested in ../../core/panel; this is the DOM that carries it. The bodies are the
// invented streams of ../testing.tsx (NO emulator: what a real emulator does with a pane's width is the probe's, in a real engine, and the fake one's in ../terminal/TerminalSplit.test.tsx). jsdom has no layout, so the deck's length is
// given: `clientWidth` and `getBoundingClientRect` of the deck are 800 px and 0 at the left, and a sash is 5 px.

const registration: ShellRegistration = { plugin: { name: 'Acme' } };
const TERMINAL: ToolInput = { id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 };
const running = (title: string): StaticSession => ({ tool: 'terminal', title, state: 'running' });
const DECK = 800;
const SASH = 5;

beforeEach(() => {
  window.innerHeight = 900;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-shell-part') === 'panelDeck' ? DECK : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-shell-part') === 'panelDeck' ? 200 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const sash = this.getAttribute('data-shell-part') === 'paneSash';
    const width = sash ? SASH : this.getAttribute('data-shell-part') === 'panelDeck' ? DECK : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: sash ? SASH : 0, toJSON: () => ({}) };
  });
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(sessions: readonly StaticSession[] = [running('zsh')]) {
  const panel = staticPanel({ tools: [TERMINAL], sessions, open: true });
  render(
    <StaticShell registration={registration} panel={panel}>
      <button type="button">Inside the page</button>
    </StaticShell>,
  );
  return { panel, store: panel.store, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) };
}

const slots = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-shell-part="panelBody"][data-session-id]')];
const sashes = (): HTMLElement[] => screen.queryAllByRole('separator', { name: /^Resize panes/ });
/** The sash after pane `index`, which must be there: a missing sash fails the test by its own words and not by a read of undefined. */
const sashAt = (index: number): HTMLElement => {
  const found = sashes()[index];
  expect(found, `the panes have a sash after pane ${String(index + 1)}`).toBeDefined();
  return found;
};

const deck = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-shell-part="panelDeck"]');
  if (found === null) {
    throw new Error('no deck');
  }

  return found;
};

function split(h: ReturnType<typeof mount>, count: number): void {
  for (let i = 2; i <= count; i += 1) {
    act(() => {
      h.store.splitPane('terminal', { plugin: 'host', title: `bash ${String(i)}`, state: 'running' }, { extent: DECK });
    });
  }
}

describe('a tool with one session', () => {
  it('draws its body alone, in no pane, with no sash', () => {
    mount([running('zsh')]);
    expect(sashes()).toHaveLength(0);
    expect(slots()).toHaveLength(1);
    expect(slots()[0]).not.toHaveAttribute('data-pane');
    expect(slots()[0]?.getAttribute('style') ?? '').toBe('');
    expect(deck()).not.toHaveAttribute('data-axis');
  });
});

describe('a group of panes', () => {
  it('draws every body of the group on screen, in the group\'s order whatever order they were mounted in, each with its share', () => {
    const h = mount([running('zsh')]);
    split(h, 3);
    act(() => {
      h.store.focusPane('terminal', 'p1');
    });
    act(() => {
      h.store.splitPane('terminal', { plugin: 'host', title: 'fish', state: 'running' }, { extent: DECK });
    });
    // The group is [first, fourth, second, third]; the bodies stay mounted in the order they opened in.
    const shown = slots().filter((slot) => !slot.hidden);
    const [s1, s2, s3, s4] = h.store.getSnapshot().order;
    expect(shown.map((slot) => slot.getAttribute('data-session-id'))).toEqual([s1, s2, s3, s4]);
    const byOrder = [...shown].sort((a, b) => Number(a.style.getPropertyValue('--_order')) - Number(b.style.getPropertyValue('--_order'))).map((slot) => slot.getAttribute('data-session-id'));
    expect(byOrder).toEqual([s1, s4, s2, s3]);
    expect(shown.map((slot) => slot.style.getPropertyValue('--_share'))).toEqual(['0.25', '0.25', '0.25', '0.25']);
    expect(sashes()).toHaveLength(3);
    expect(deck()).toHaveAttribute('data-axis', 'row');
  });

  it('has a separator between each two panes: named, a Tab stop, vertical for side by side, and its value is where the line is', () => {
    const h = mount();
    split(h, 3);
    const [first, second] = sashes();
    expect(first).toHaveAttribute('aria-orientation', 'vertical');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAccessibleName('Resize panes 1 and 2');
    expect(second).toHaveAccessibleName('Resize panes 2 and 3');
    expect(first).toHaveAttribute('aria-valuenow', '33');
    expect(second).toHaveAttribute('aria-valuenow', '67');
    expect(first.getAttribute('aria-controls')?.split(' ')).toHaveLength(2);
    // Placed between the bodies they divide, by `order`.
    expect([first, second].map((one) => Number(one.style.getPropertyValue('--_order')))).toEqual([1, 3]);
  });

  it('is laid out as a column when the model says stacked: horizontal separators', () => {
    const h = mount();
    act(() => {
      h.store.splitPane('terminal', { plugin: 'host', title: 'two', state: 'running' }, { extent: DECK, axis: 'column' });
    });
    expect(deck()).toHaveAttribute('data-axis', 'column');
    expect(sashes()[0]).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('dissolves with the group: closing a pane\'s session leaves one body and no sash', () => {
    const h = mount();
    split(h, 2);
    act(() => {
      h.store.closeSession(h.store.getSnapshot().order[1]);
    });
    expect(sashes()).toHaveLength(0);
    expect(slots().filter((slot) => !slot.hidden)).toHaveLength(1);
    expect(slots()[0]?.getAttribute('style') ?? '').toBe('');
  });

  it('hides the bodies of a group when the tool is not on screen, and draws no sash', () => {
    const h = mount();
    split(h, 2);
    act(() => {
      h.store.hide();
    });
    expect(slots().every((slot) => slot.hidden)).toBe(true);
    expect(sashes()).toHaveLength(0);
  });

  it('makes a pane the active one when the keyboard or a click goes into it, and changes nothing when it already is', () => {
    const h = mount();
    split(h, 2);
    expect(h.store.getSnapshot().panes.terminal?.active).toBe('p2');
    const [one, two] = h.store.getSnapshot().order;
    const first = slots().find((slot) => slot.getAttribute('data-session-id') === one);
    expect(first).toBeDefined();
    fireEvent.pointerDown(first!);
    expect(h.store.getSnapshot().panes.terminal?.active).toBe('p1');
    expect(h.store.getSnapshot().active.terminal).toBe(one);
    const state = h.store.getSnapshot();
    fireEvent.pointerDown(first!);
    expect(h.store.getSnapshot()).toBe(state);
    const second = slots().find((slot) => slot.getAttribute('data-session-id') === two);
    const inside = document.createElement('button');
    second!.append(inside);
    act(() => {
      inside.focus();
    });
    expect(h.store.getSnapshot().panes.terminal?.active).toBe('p2');
  });
});

describe('the sash\'s keys', () => {
  const ratios = (h: ReturnType<typeof mount>): readonly number[] => h.store.getSnapshot().panes.terminal?.ratios ?? [];
  const EXTENT = DECK - SASH;

  it('moves the line by 16 px an arrow, 64 with Shift, in the direction of the arrow', async () => {
    const h = mount();
    split(h, 2);
    const sash = sashAt(0);
    act(() => {
      sash.focus();
    });
    await h.user.keyboard('{ArrowRight}');
    expect(ratios(h)[0]).toBeCloseTo(0.5 + 16 / EXTENT, 9);
    await h.user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(ratios(h)[0]).toBeCloseTo(0.5 + 16 / EXTENT - 64 / EXTENT, 9);
    expect(ratios(h).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('stops at 80 px for either pane: Home and End take the line to the minimum', async () => {
    const h = mount();
    split(h, 2);
    const sash = sashAt(0);
    act(() => {
      sash.focus();
    });
    await h.user.keyboard('{Home}');
    expect(ratios(h)[0] * EXTENT).toBeCloseTo(80, 6);
    await h.user.keyboard('{End}');
    expect(ratios(h)[1] * EXTENT).toBeCloseTo(80, 6);
  });

  it('shares the room equally again on Enter and on a double click', async () => {
    const h = mount();
    split(h, 3);
    const first = sashAt(0);
    act(() => {
      first.focus();
    });
    await h.user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}');
    expect(ratios(h)).not.toEqual([1 / 3, 1 / 3, 1 / 3]);
    await h.user.keyboard('{Enter}');
    expect(ratios(h)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    await h.user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    fireEvent.doubleClick(sashAt(1));
    expect(ratios(h)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('uses the up and down arrows when the panes are stacked', async () => {
    const h = mount();
    act(() => {
      h.store.splitPane('terminal', { plugin: 'host', title: 'two', state: 'running' }, { extent: 200, axis: 'column' });
    });
    const sash = sashAt(0);
    act(() => {
      sash.focus();
    });
    const before = ratios(h)[0];
    await h.user.keyboard('{ArrowRight}');
    expect(ratios(h)[0]).toBe(before);
    await h.user.keyboard('{ArrowDown}');
    expect(ratios(h)[0]).toBeGreaterThan(before);
  });
});

describe('the sash\'s drag', () => {
  const ratios = (h: ReturnType<typeof mount>): readonly number[] => h.store.getSnapshot().panes.terminal?.ratios ?? [];
  const EXTENT = DECK - SASH;

  it('writes the two panes\' share on a frame and tells the model once, on release; the shares drawn then are the model\'s', () => {
    const h = mount();
    split(h, 2);
    const sash = sashAt(0);
    const told = vi.fn();
    const stop = h.store.subscribe(told);
    fireEvent.pointerDown(sash, { button: 0, isPrimary: true, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: 200 });
    expect(told).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    const [left, right] = slots().filter((slot) => !slot.hidden);
    const wanted = (200 - SASH / 2) / EXTENT;
    expect(Number(left.style.getPropertyValue('flex-grow'))).toBeCloseTo(wanted, 9);
    expect(Number(right.style.getPropertyValue('flex-grow'))).toBeCloseTo(1 - wanted, 9);
    expect(told).not.toHaveBeenCalled();
    fireEvent.pointerUp(sash, { pointerId: 1, clientX: 200 });
    stop();
    expect(told).toHaveBeenCalledTimes(1);
    expect(ratios(h)[0]).toBeCloseTo(wanted, 9);
    expect(left.style.getPropertyValue('flex-grow')).toBe('');
    expect(left.style.getPropertyValue('--_share')).toBe(String(ratios(h)[0]));
    expect(document.querySelector('[data-shell-part="window"]')).not.toHaveAttribute('data-resizing');
  });

  it('holds the 80 px minimum in pixels while it is dragged, and on release', () => {
    const h = mount();
    split(h, 2);
    const sash = sashAt(0);
    fireEvent.pointerDown(sash, { button: 0, isPrimary: true, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: -500 });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    const [left] = slots().filter((slot) => !slot.hidden);
    expect(Number(left.style.getPropertyValue('flex-grow')) * EXTENT).toBeCloseTo(80, 6);
    fireEvent.pointerUp(sash, { pointerId: 1, clientX: -500 });
    expect(ratios(h)[0] * EXTENT).toBeCloseTo(80, 6);
  });

  it('puts the shares back on Escape and on a cancelled pointer, and tells the model nothing', () => {
    const h = mount();
    split(h, 2);
    const sash = sashAt(0);
    const told = vi.fn();
    const stop = h.store.subscribe(told);
    fireEvent.pointerDown(sash, { button: 0, isPrimary: true, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: 250 });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(slots().filter((slot) => !slot.hidden).every((slot) => slot.style.getPropertyValue('flex-grow') === '')).toBe(true);
    fireEvent.pointerDown(sash, { button: 0, isPrimary: true, pointerId: 2, clientX: 400 });
    fireEvent.pointerMove(sash, { pointerId: 2, clientX: 250 });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    fireEvent.pointerCancel(sash);
    stop();
    expect(told).not.toHaveBeenCalled();
    expect(ratios(h)).toEqual([0.5, 0.5]);
  });

  it('ignores a pointer that is not the primary button\'s', () => {
    const h = mount();
    split(h, 2);
    const sash = sashAt(0);
    fireEvent.pointerDown(sash, { button: 2, isPrimary: true, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: 250 });
    fireEvent.pointerUp(sash, { pointerId: 1, clientX: 250 });
    expect(ratios(h)).toEqual([0.5, 0.5]);
  });
});

describe('a resize of the panel', () => {
  it('brings the shares within the minimum of the length the deck has now', () => {
    let resized: (() => void) | undefined;
    class Observer {
      observe = vi.fn();

      disconnect = vi.fn();

      constructor(callback: () => void) {
        resized = callback;
      }
    }

    vi.stubGlobal('ResizeObserver', Observer);
    const h = mount();
    split(h, 2);
    act(() => {
      h.store.moveSash('terminal', 0, 0.02, 10_000);
    });
    expect(h.store.getSnapshot().panes.terminal?.ratios[0]).toBeCloseTo(0.02, 9);
    act(() => {
      resized?.();
    });
    expect((h.store.getSnapshot().panes.terminal?.ratios[0] ?? 0) * (DECK - SASH)).toBeGreaterThanOrEqual(80 - 1e-6);
    vi.unstubAllGlobals();
  });
});
