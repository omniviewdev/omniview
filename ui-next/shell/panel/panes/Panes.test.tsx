import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolInput } from '../../core/panel';
import type { ShellRegistration } from '../../registration';
import { StaticShell } from '../../testing';
import { staticPanel, type StaticSession } from '../testing';
import { usePaneRoom } from './room';

// The panes of a tool in the panel (#697 step 6, the layout): several bodies side by side, the sash between them, and what a click does. The model is tested in ../../core/panel; this is the DOM that carries it. The bodies are the
// invented streams of ../testing.tsx (NO emulator: what a real emulator does with a pane's width is the probe's, in a real engine, and the fake one's in ../terminal/TerminalSplit.test.tsx). jsdom has no layout, so the deck's length is
// given: `clientWidth` and `getBoundingClientRect` of the deck are 800 px and 0 at the left, and a sash is 5 px.

const registration: ShellRegistration = { plugin: { name: 'Acme' } };
const TERMINAL: ToolInput = { id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 };
const running = (title: string): StaticSession => ({ tool: 'terminal', title, state: 'running' });
const DECK = 800;
const SASH = 5;
/** The deck's length now: a test that changes the window changes it. */
let deckWidth = DECK;

beforeEach(() => {
  deckWidth = DECK;
  window.innerHeight = 900;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-shell-part') === 'panelDeck' ? deckWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-shell-part') === 'panelDeck' ? 200 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const sash = this.getAttribute('data-shell-part') === 'paneSash';
    const width = sash ? SASH : this.getAttribute('data-shell-part') === 'panelDeck' ? deckWidth : 0;
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
  it('draws every body of the group on screen, in the group\'s order in the document, each with its share', () => {
    const h = mount([running('zsh')]);
    split(h, 3);
    act(() => {
      h.store.focusPane('terminal', 'p1');
    });
    act(() => {
      h.store.splitPane('terminal', { plugin: 'host', title: 'fish', state: 'running' }, { extent: DECK });
    });
    // The group is [first, fourth, second, third]; the document has them so (the fourth was inserted, none moved).
    const shown = slots().filter((slot) => !slot.hidden);
    const [s1, s2, s3, s4] = h.store.getSnapshot().order;
    expect(shown.map((slot) => slot.getAttribute('data-session-id'))).toEqual([s1, s4, s2, s3]);
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

/** The deck's children that are a body or a sash, in the document's order: what the Tab key walks. */
const walk = (): Array<string | null> => [...deck().children].flatMap((child) => (child instanceof HTMLElement && child.hasAttribute('data-session-id') ? [child.getAttribute('data-session-id')] : child.getAttribute('data-shell-part') === 'paneSash' ? ['sash'] : []));

describe('the document\'s order is the visual order (WCAG 2.4.3)', () => {
  it('has each sash just before the pane after it: pane 1, sash, pane 2, sash, pane 3, also after a split in the middle', () => {
    const h = mount();
    split(h, 3);
    const [a, b, c] = h.store.getSnapshot().order;
    expect(walk().filter((one) => one !== null && !slots().some((slot) => slot.hidden && slot.getAttribute('data-session-id') === one))).toEqual([a, 'sash', b, 'sash', c]);
    act(() => {
      h.store.focusPane('terminal', 'p1');
    });
    act(() => {
      h.store.splitPane('terminal', { plugin: 'host', title: 'fish', state: 'running' }, { extent: DECK });
    });
    const order = h.store.getSnapshot().order;
    expect(walk()).toEqual([order[0], 'sash', order[3], 'sash', order[1], 'sash', order[2]]);
  });

  it('inserts the new pane and moves no pane that is there: the nodes are the same, in the same order, and none is removed', () => {
    const h = mount();
    split(h, 3);
    const before = slots();
    const seen: Array<{ readonly added: number; readonly removed: number }> = [];
    const watcher = new MutationObserver((records) => {
      for (const record of records) {
        seen.push({ added: record.addedNodes.length, removed: record.removedNodes.length });
      }
    });
    watcher.observe(deck(), { childList: true });
    act(() => {
      h.store.focusPane('terminal', 'p1');
    });
    act(() => {
      h.store.splitPane('terminal', { plugin: 'host', title: 'fish', state: 'running' }, { extent: DECK });
    });
    const records = watcher.takeRecords();
    watcher.disconnect();
    const all = [...seen, ...records.map((record) => ({ added: record.addedNodes.length, removed: record.removedNodes.length }))];
    expect(all.reduce((total, one) => total + one.removed, 0), 'no node of the deck was removed (a move is a removal and an insertion)').toBe(0);
    expect(before.every((slot) => slot.isConnected)).toBe(true);
    expect(slots().filter((slot) => before.includes(slot))).toEqual(before);
  });
});

describe('a sash follows its place, not the place it was made in', () => {
  const ratios = (h: ReturnType<typeof mount>): readonly number[] => h.store.getSnapshot().panes.terminal?.ratios ?? [];

  it('after a split in the middle each sash moves the two panes beside it', async () => {
    const h = mount();
    split(h, 3);
    act(() => {
      h.store.focusPane('terminal', 'p1');
    });
    act(() => {
      h.store.splitPane('terminal', { plugin: 'host', title: 'fish', state: 'running' }, { extent: DECK });
    });
    const before = ratios(h);
    act(() => {
      sashAt(1).focus();
    });
    await h.user.keyboard('{ArrowRight}');
    const after = ratios(h);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
    expect(after[2]).toBeLessThan(before[2]);
    expect(after[3]).toBe(before[3]);
  });

  it('after a middle pane closes the last sash still moves the last two panes', async () => {
    const h = mount();
    split(h, 4);
    act(() => {
      h.store.closeSession(h.store.getSnapshot().order[1]);
    });
    const before = ratios(h);
    act(() => {
      sashAt(1).focus();
    });
    await h.user.keyboard('{ArrowRight}');
    const after = ratios(h);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
    expect(after[2]).toBeLessThan(before[2]);
  });
});

describe('which pane is the active one', () => {
  it('is marked on its body alone, follows a click, and no body of a tool with one session is marked', () => {
    const h = mount();
    expect(slots()[0]).not.toHaveAttribute('data-pane-active');
    split(h, 3);
    const marked = (): Array<string | null> => slots().filter((slot) => slot.hasAttribute('data-pane-active')).map((slot) => slot.getAttribute('data-pane'));
    expect(marked()).toEqual(['p3']);
    fireEvent.pointerDown(slots()[0]);
    expect(marked()).toEqual(['p1']);
    act(() => {
      h.store.closeSession(h.store.getSnapshot().order[0]);
    });
    expect(marked()).toEqual(['p2']);
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

  it('reads the deck again when it is released: a window that changed while the pointer was down gives the length the minimum is held against', () => {
    const h = mount();
    split(h, 2);
    const sash = sashAt(0);
    fireEvent.pointerDown(sash, { button: 0, isPrimary: true, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: 100 });
    deckWidth = 300;
    fireEvent.pointerUp(sash, { pointerId: 1, clientX: -500 });
    expect((h.store.getSnapshot().panes.terminal?.ratios[0] ?? 0) * (300 - SASH)).toBeGreaterThanOrEqual(80 - 1e-6);
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

  it('cancels the drag when a pane before the sash closes: the preview is cleared from the panes it was written to, and nothing is committed', () => {
    const h = mount();
    split(h, 3);
    const [first] = h.store.getSnapshot().order;
    const sash = sashAt(1);
    fireEvent.pointerDown(sash, { button: 0, isPrimary: true, pointerId: 1, clientX: 530 });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: 400 });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(slots().some((slot) => slot.style.getPropertyValue('flex-grow') !== '')).toBe(true);
    const before = h.store.getSnapshot().panes.terminal?.ratios;
    act(() => {
      h.store.closeSession(first);
    });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: 300 });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(slots().filter((slot) => slot.style.getPropertyValue('flex-grow') !== '')).toEqual([]);
    fireEvent.pointerUp(sash, { pointerId: 1, clientX: 300 });
    expect(before).toHaveLength(3);
    expect(h.store.getSnapshot().panes.terminal?.ratios).toHaveLength(2);
    expect(h.store.getSnapshot().panes.terminal?.ratios.every((one) => Math.abs(one - 0.5) < 1e-9)).toBe(true);
  });

  it('keeps the preview within 80 px when the deck gets shorter during the drag', () => {
    const callbacks: Array<() => void> = [];
    class Observer {
      observe = vi.fn();

      disconnect = vi.fn();

      constructor(callback: () => void) {
        callbacks.push(callback);
      }
    }

    vi.stubGlobal('ResizeObserver', Observer);
    const h = mount();
    split(h, 2);
    const sash = sashAt(0);
    fireEvent.pointerDown(sash, { button: 0, isPrimary: true, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(sash, { pointerId: 1, clientX: 30 });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    deckWidth = 300;
    act(() => {
      for (const callback of callbacks) {
        callback();
      }
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    const [left] = slots().filter((slot) => !slot.hidden);
    expect(Number(left.style.getPropertyValue('flex-grow')) * (300 - SASH)).toBeGreaterThanOrEqual(80 - 1e-6);
    fireEvent.pointerCancel(sash);
    vi.unstubAllGlobals();
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
    const resized: Array<() => void> = [];
    class Observer {
      observe = vi.fn();

      disconnect = vi.fn();

      constructor(callback: () => void) {
        resized.push(callback);
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
      for (const callback of resized) {
        callback();
      }
    });
    expect((h.store.getSnapshot().panes.terminal?.ratios[0] ?? 0) * (DECK - SASH)).toBeGreaterThanOrEqual(80 - 1e-6);
    vi.unstubAllGlobals();
  });
});

/** A body that says what the deck tells it: whether one more pane fits and the length a split would be given. */
function Room() {
  const room = usePaneRoom();
  return <div data-fixture="room" data-fits={String(room?.fits)} data-extent={String(room?.extent())} />;
}

describe('the room for one more pane', () => {
  it('is what the deck measured: one more fits while every pane would keep 80 px, and the length a split is given has the sash the new pane brings', () => {
    const resized: Array<() => void> = [];
    class Observer {
      observe = vi.fn();

      disconnect = vi.fn();

      constructor(callback: () => void) {
        resized.push(callback);
      }
    }

    vi.stubGlobal('ResizeObserver', Observer);
    const panel = staticPanel({ tools: [TERMINAL], sessions: [running('zsh')], open: true, renderBody: () => <Room /> });
    render(<StaticShell registration={registration} panel={panel} />);
    act(() => {
      panel.store.splitPane('terminal', { plugin: 'host', title: 'two', state: 'running' }, { extent: DECK });
    });
    const read = (): { fits: string | null; extent: string | null } => {
      const element = document.querySelector('[data-fixture="room"]');
      return { fits: element?.getAttribute('data-fits') ?? null, extent: element?.getAttribute('data-extent') ?? null };
    };

    act(() => {
      for (const callback of resized) {
        callback();
      }
    });
    // Two panes and a sash in 800 px: a third needs 240 of the 790 two sashes leave.
    expect(read()).toEqual({ fits: 'true', extent: String(DECK - 2 * SASH) });
    deckWidth = 200;
    act(() => {
      for (const callback of resized) {
        callback();
      }
    });
    expect(read().fits).toBe('false');
    vi.unstubAllGlobals();
  });
});

/** A body with a text input where the keyboard goes, as an emulator's is. */
function Input({ title }: { readonly title: string }) {
  return <textarea className="xterm-helper-textarea" aria-label={`Terminal input, ${title}`} />;
}

describe('the pane chords (the keyboard moves between panes)', () => {
  function chordRig(count: number) {
    const panel = staticPanel({ tools: [TERMINAL], sessions: [running('zsh')], open: true, renderBody: (session) => <Input title={session.title} /> });
    render(
      <StaticShell registration={registration} panel={panel}>
        <button type="button">Inside the page</button>
      </StaticShell>,
    );
    for (let i = 2; i <= count; i += 1) {
      act(() => {
        panel.store.splitPane('terminal', { plugin: 'host', title: `bash ${String(i)}`, state: 'running' }, { extent: DECK });
      });
    }

    const inputs = (): HTMLElement[] => slots().filter((slot) => !slot.hidden).map((slot) => slot.querySelector<HTMLElement>('textarea') as HTMLElement);
    return { panel, store: panel.store, inputs };
  }

  const press = (target: Element, code: string, extra: Partial<KeyboardEventInit> = {}): boolean => fireEvent.keyDown(target, { code, key: code, ctrlKey: true, shiftKey: true, ...extra });

  it('moves the keyboard to the pane on the left and on the right, into its input, and makes it the active pane', () => {
    const r = chordRig(3);
    const [one, two, three] = r.inputs();
    act(() => {
      three.focus();
    });
    expect(r.store.getSnapshot().panes.terminal?.active).toBe('p3');
    act(() => {
      press(three, 'ArrowLeft');
    });
    expect(two).toHaveFocus();
    expect(r.store.getSnapshot().panes.terminal?.active).toBe('p2');
    act(() => {
      press(two, 'ArrowLeft');
    });
    expect(one).toHaveFocus();
    act(() => {
      press(one, 'ArrowRight');
    });
    expect(two).toHaveFocus();
  });

  it('stops at the ends for left and right, and wraps for the next and the previous pane', () => {
    const r = chordRig(3);
    const [one, , three] = r.inputs();
    act(() => {
      one.focus();
    });
    act(() => {
      press(one, 'ArrowLeft');
    });
    expect(one).toHaveFocus();
    act(() => {
      press(one, 'BracketLeft');
    });
    expect(three).toHaveFocus();
    act(() => {
      press(three, 'BracketRight');
    });
    expect(one).toHaveFocus();
  });

  it('is cancelled when it moved the keyboard (the terminal must not also see it), and left alone when there is nowhere to go', () => {
    const r = chordRig(2);
    const [one, two] = r.inputs();
    act(() => {
      one.focus();
    });
    let moved = true;
    act(() => {
      moved = press(one, 'ArrowRight');
    });
    expect(moved).toBe(false);
    expect(two).toHaveFocus();
    act(() => {
      moved = press(two, 'ArrowRight');
    });
    expect(moved).toBe(true);
  });

  it('does nothing outside the panel, with one pane, or for the other platform\'s chord', () => {
    const r = chordRig(2);
    const [one, two] = r.inputs();
    const outside = screen.getByRole('button', { name: 'Inside the page' });
    act(() => {
      outside.focus();
    });
    act(() => {
      press(outside, 'ArrowRight');
    });
    expect(outside).toHaveFocus();
    act(() => {
      one.focus();
    });
    act(() => {
      press(one, 'ArrowRight', { ctrlKey: false, metaKey: true, altKey: true, shiftKey: false });
    });
    expect(one).toHaveFocus();
    expect(two).not.toHaveFocus();
    act(() => {
      r.store.closeSession(r.store.getSnapshot().order[1]);
    });
    act(() => {
      one.focus();
    });
    act(() => {
      press(one, 'ArrowRight');
    });
    expect(one).toHaveFocus();
  });
});
