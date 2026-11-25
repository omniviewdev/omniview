import { act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layerOf, mount, teardown, toastsOf } from './testing';

// What the toast layer does with the page under it (ch16 S79, P7; ./placement.ts is the rule and is tested on its own, with the mock's algorithm as the oracle): it measures the controls of the page, moves the stack
// out of their way, hides it when it has no room, tells what nobody can see, and watches only while it has a toast. jsdom has no layout: the boxes are given here, each element's by what it is, and the point at an
// element's centre reaches it unless the test says it does not. What an engine lays out, hit-tests and paints is the probe's (probes/notices-probe.mjs).

type Rect = { left: number; top: number; right: number; bottom: number };

const HOME: Rect = { left: 1008, top: 770, right: 1428, bottom: 856 };
const failure = { title: 'Timed out', detail: 'The cluster did not complete the request in time.', severity: 'error', initiator: 'user' } as const;

/** Where each control of the page is, by its text. */
const controls = new Map<string, Rect>();
/** The controls that nothing answers at: covered or clipped. */
const covered = new Set<string>();

const rectOf = (box: Rect): DOMRect => ({ ...box, x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, toJSON: () => box });
const hostOf = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-notices-part="host"]');

beforeEach(() => {
  controls.clear();
  covered.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function boxOf(this: Element) {
    if (this.matches('[data-notices-part="layer"]')) {
      return rectOf({ ...HOME, top: HOME.bottom });
    }

    if (this.matches('[data-notices-part="host"]')) {
      return rectOf(HOME);
    }

    if (this.closest('[data-notices-part="layer"]') !== null) {
      // The stack's own controls are all over home: none of them may count.
      return rectOf(HOME);
    }

    return rectOf(controls.get(this.textContent) ?? { left: 0, top: 0, right: 0, bottom: 0 });
  });
  document.elementsFromPoint = (x: number, y: number): Element[] =>
    [...document.querySelectorAll('button')].filter((button) => {
      // The stack's own buttons answer all over home, so that a control that counted them would be moved by them.
      const box = button.closest('[data-notices-part="layer"]') === null ? controls.get(button.textContent) : HOME;
      return box !== undefined && !covered.has(button.textContent) && x >= box.left && x < box.right && y >= box.top && y < box.bottom;
    });
});

afterEach(() => {
  teardown();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

const settle = (ms = 140): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('the stack at home', () => {
  it('stays there while no control is near: no data-place, no box', async () => {
    controls.set('Far', { left: 10, top: 10, right: 110, bottom: 38 });
    const m = mount({ around: <button type="button">Far</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    expect(hostOf()).not.toHaveAttribute('data-place');
    expect(hostOf()?.getAttribute('style')).toBeNull();
  });

  it('is not moved by its own controls, by a native disabled control, by an inert or hidden one, nor by one that nothing answers at (clipped or covered)', async () => {
    for (const name of ['Disabled', 'Inert', 'Hidden', 'Covered']) {
      controls.set(name, { left: 1100, top: 780, right: 1300, bottom: 840 });
    }

    covered.add('Covered');
    const m = mount({
      around: (
        <>
          <button type="button" disabled>
            Disabled
          </button>
          <div inert>
            <button type="button">Inert</button>
          </div>
          <div hidden>
            <button type="button">Hidden</button>
          </div>
          <button type="button">Covered</button>
        </>
      ),
    });
    act(() => {
      m.f.store.notify({ title: 'Quota is close', severity: 'warning', actions: [{ id: 'go', label: 'Open', route: { plugin: 'cloud', contribution: 'quota', params: {} } }] });
    });
    await m.flush();
    expect(toastsOf()).toHaveLength(1);
    expect(hostOf()).not.toHaveAttribute('data-place');
  });
});

describe('the stack in the way of a control', () => {
  it('moves to where the rule puts it, in a box of its own: above the control, in the same column, 8 px clear', async () => {
    controls.set('Run', { left: 1100, top: 780, right: 1300, bottom: 808 });
    const m = mount({ around: <button type="button">Run</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    const host = hostOf();
    expect(host).toHaveAttribute('data-place', 'moved');
    expect(host?.style.getPropertyValue('--_x')).toBe('1008px');
    expect(host?.style.getPropertyValue('--_y')).toBe('686px');
    expect(host?.style.getPropertyValue('--_w')).toBe('420px');
    expect(host).toHaveAttribute('data-shell-region', 'toasts');
    expect(host).not.toHaveAttribute('inert');
  });

  it('counts an aria-disabled control as one: it stays focusable and says why it is off', async () => {
    controls.set('Stop', { left: 1100, top: 780, right: 1300, bottom: 808 });
    const m = mount({
      around: (
        <button type="button" aria-disabled="true">
          Stop
        </button>
      ),
    });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    expect(hostOf()).toHaveAttribute('data-place', 'moved');
  });

  it('goes home once the control is gone and the page has been still for 120 ms, and not before', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    controls.set('Run', { left: 1100, top: 780, right: 1300, bottom: 808 });
    const m = mount({ around: <button type="button">Run</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    expect(hostOf()).toHaveAttribute('data-place', 'moved');
    controls.delete('Run');
    fireEvent(window, new Event('resize'));
    settle(100);
    expect(hostOf()).toHaveAttribute('data-place', 'moved');
    settle(60);
    expect(hostOf()).not.toHaveAttribute('data-place');
  });

  it('decides again when the page is scrolled and when something under it changes: a control that appears is moved away from', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const m = mount();
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    expect(hostOf()).not.toHaveAttribute('data-place');
    controls.set('Late', { left: 1100, top: 780, right: 1300, bottom: 808 });
    const late = document.createElement('button');
    late.textContent = 'Late';
    document.body.append(late);
    await act(async () => {
      await Promise.resolve();
    });
    settle();
    expect(hostOf()).toHaveAttribute('data-place', 'moved');
    controls.delete('Late');
    late.remove();
    fireEvent.scroll(document.body);
    settle();
    expect(hostOf()).not.toHaveAttribute('data-place');
  });

  it('is not woken by what the stack does to itself: a change inside the layer is not news', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const m = mount();
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    settle();
    const before = vi.getTimerCount();
    hostOf()?.setAttribute('class', 'again');
    await act(async () => {
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe('the stack with no room', () => {
  const wall = { left: 0, top: 0, right: 1440, bottom: 900 };

  it('is hidden and inert, is no stop for F6, and tells what nobody can see once, politely (S86)', async () => {
    controls.set('Everything', wall);
    const m = mount({ around: <button type="button">Everything</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    const host = hostOf();
    expect(host).toHaveAttribute('data-place', 'yield');
    expect(host).toHaveAttribute('inert');
    expect(host).not.toHaveAttribute('data-shell-region');
    expect(m.announcer.polite.getSnapshot().text).toBe('Success: Snapshot created');
    expect(m.announcer.assertive.getSnapshot().text).toBe('');
    // The same toast is not told again by the next decision.
    const told = m.announcer.polite.getSnapshot().serial;
    fireEvent(window, new Event('resize'));
    await m.flush();
    expect(m.announcer.polite.getSnapshot().serial).toBe(told);
  });

  it('tells an error the user caused assertively, in the words of its toast: no toast and no live region would have said it', async () => {
    controls.set('Everything', wall);
    const m = mount({ around: <button type="button">Everything</button> });
    act(() => {
      m.f.store.notify(failure);
    });
    await m.flush();
    expect(hostOf()).toHaveAttribute('data-place', 'yield');
    expect(m.announcer.assertive.getSnapshot().text).toBe('Error: Timed out. The cluster did not complete the request in time.');
    expect(m.announcer.polite.getSnapshot().text).toBe('');
  });

  it('tells a toast that comes while it waits, and says how many when more than one has no room', async () => {
    controls.set('Everything', wall);
    const m = mount({ around: <button type="button">Everything</button> });
    act(() => {
      m.f.store.notify({ title: 'One', severity: 'success' });
    });
    await m.flush();
    m.f.store.notify({ title: 'Two', severity: 'success' });
    await m.flush();
    expect(m.announcer.polite.getSnapshot().text).toBe('Success: Two');
    m.f.store.notify({ title: 'Three', severity: 'success' });
    m.f.store.notify({ title: 'Four', severity: 'success' });
    await m.flush();
    // The stack composed two and a summary of the rest: three new toasts, of which the summary stands for two.
    expect(m.announcer.polite.getSnapshot().text).toMatch(/^\d+ new notifications\.$/);
  });

  it('comes back as soon as there is room, and is told again the next time it has none', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    controls.set('Everything', wall);
    const m = mount({ around: <button type="button">Everything</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    expect(hostOf()).toHaveAttribute('data-place', 'yield');
    const told = m.announcer.polite.getSnapshot().serial;
    controls.delete('Everything');
    fireEvent(window, new Event('resize'));
    settle();
    const host = hostOf();
    expect(host).not.toHaveAttribute('data-place');
    expect(host).not.toHaveAttribute('inert');
    expect(host).toHaveAttribute('data-shell-region', 'toasts');
    controls.set('Everything', wall);
    fireEvent(window, new Event('resize'));
    settle();
    expect(hostOf()).toHaveAttribute('data-place', 'yield');
    expect(m.announcer.polite.getSnapshot().serial).toBe(told + 1);
  });
});

describe('the stack when it is not there', () => {
  it('holds no timer, observer or listener while it has no toast, and none is left when the last toast goes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const add = vi.spyOn(window, 'addEventListener');
    const m = mount();
    expect(add.mock.calls.filter(([type]) => type === 'resize')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    const made = await act(() => m.f.store.notify({ title: 'Snapshot created', severity: 'success' }));
    await m.flush();
    expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
    fireEvent(window, new Event('resize'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => {
      m.f.store.dismiss(made.record?.id ?? '');
    });
    await m.flush();
    expect(toastsOf()).toEqual([]);
    expect(layerOf()).toBeInTheDocument();
    const timers = vi.getTimerCount();
    fireEvent(window, new Event('resize'));
    expect(vi.getTimerCount()).toBe(timers);
  });
});

// The lead's ruling of 2026-11-21, "never lose a message unseen" and "never drop the focus": while the stack yields nothing expires where nobody can read it (no centre yet; the mock's clocks keep running), and a focus that
// is inside the stack goes back to where it came from, else to the mock's fallback (the nearest control), never to the body.
describe('the stack that yields', () => {
  const wall = { left: 0, top: 0, right: 1440, bottom: 900 };
  const fakeTimers = (): void => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  };

  it('holds the model\'s clocks: a timed toast is still there after twenty seconds with no room, and closes after its remaining time once there is', async () => {
    fakeTimers();
    controls.set('Everything', wall);
    const m = mount({ around: <button type="button">Everything</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    expect(hostOf()).toHaveAttribute('data-place', 'yield');
    expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
    await act(async () => {
      await m.clock.advance(20_000);
    });
    expect(toastsOf()).toHaveLength(1);
    controls.delete('Everything');
    fireEvent(window, new Event('resize'));
    settle();
    expect(hostOf()).not.toHaveAttribute('data-place');
    expect(m.f.store.getSnapshot().toasts.paused).toBe(false);
    await act(async () => {
      await m.clock.advance(7990);
    });
    expect(toastsOf()).toHaveLength(1);
    await act(async () => {
      await m.clock.advance(20);
    });
    expect(toastsOf()).toEqual([]);
  });

  it('lets go of the hold when the window goes while it yields', async () => {
    controls.set('Everything', wall);
    const m = mount({ around: <button type="button">Everything</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    expect(m.f.store.getSnapshot().toasts.paused).toBe(true);
    m.unmount();
    expect(m.f.store.getSnapshot().toasts.paused).toBe(false);
  });

  it('gives a focus that is in the stack back to where it came from before the stack is inert: never the body', async () => {
    fakeTimers();
    const m = mount({ around: <button type="button">Everything</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    m.opener.focus();
    const toast = toastsOf()[0];
    act(() => {
      toast.focus();
    });
    expect(document.activeElement).toBe(toast);
    controls.set('Everything', wall);
    fireEvent(window, new Event('resize'));
    settle();
    expect(hostOf()).toHaveAttribute('data-place', 'yield');
    expect(document.activeElement).toBe(m.opener);
  });

  it('gives it to the mock\'s fallback, the nearest control that comes before the stack, when where it came from is gone: never the body', async () => {
    fakeTimers();
    // jsdom lays nothing out: every element has a box here, so that a control can be a place to land.
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [rectOf({ left: 0, top: 0, right: 10, bottom: 10 })] as unknown as DOMRectList);
    const m = mount({ around: <button type="button">Everything</button> });
    act(() => {
      m.f.store.notify({ title: 'Snapshot created', severity: 'success' });
    });
    await m.flush();
    m.opener.focus();
    const toast = toastsOf()[0];
    act(() => {
      toast.focus();
    });
    m.opener.remove();
    controls.set('Everything', wall);
    fireEvent(window, new Event('resize'));
    settle();
    expect(hostOf()).toHaveAttribute('data-place', 'yield');
    expect(document.activeElement?.textContent).toBe('Everything');
  });
});
