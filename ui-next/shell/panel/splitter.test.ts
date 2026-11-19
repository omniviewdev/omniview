import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, tool } from '../core/panel/testing';
import { createSplitter, type KeyLike, type PointerLike } from './splitter';

// The splitter's cost is its point (docs/ui-next/optimisations.md HLT-34, HLT-35): a drag writes ONE style, the panel element's own `block-size`, ONCE per frame, reads nothing per frame, never
// touches the document root, and commits the model once, on release. The tests run it without React, with a frame queue of their own.

const VIEWPORT = 900;
// The default for a window 900 px high: `min(400, max(240, 30%))`; the limits: 120 at least, the window minus 312 at most.
const DEFAULT = 270;
const MIN = 120;
const MAX = VIEWPORT - 312;

let queue: Array<{ readonly id: number; readonly run: () => void }> = [];
let ids = 0;

beforeEach(() => {
  queue = [];
  ids = 0;
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
    ids += 1;
    queue.push({ id: ids, run });
    return ids;
  });

  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue = queue.filter((one) => one.id !== id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** One frame: every callback asked for since the last one runs. */
function frame(): void {
  const due = queue;
  queue = [];
  for (const one of due) {
    one.run();
  }
}

function setup() {
  const h = boot({ hostTools: [tool('logs', 'Logs', 20)] });
  h.store.show({ tool: 'logs' });
  const shell = document.createElement('div');
  shell.dataset.shellPart = 'window';
  const element = document.createElement('section');
  shell.append(element);
  document.body.append(shell);
  // The panel's own `block-size` writes, in order: the cost to count (an empty string is the size given back to the stylesheet).
  const writes: string[] = [];
  let current = '';
  Object.defineProperty(element.style, 'blockSize', {
    configurable: true,
    get: () => current,
    set: (value: string) => {
      current = value;
      writes.push(value);
    },
  });

  const splitter = createSplitter({ store: h.store, panel: () => element, viewport: () => VIEWPORT });
  const commits = { count: 0 };
  h.store.subscribe(() => {
    commits.count += 1;
  });

  return { h, shell, element, writes, splitter, commits };
}

const down = (clientY: number, extra: Partial<PointerLike> = {}): PointerLike => ({ button: 0, isPrimary: true, pointerId: 1, clientY, currentTarget: {}, ...extra });
const key = (name: string, extra: Partial<KeyLike> = {}): KeyLike & { readonly prevented: () => boolean } => {
  let prevented = false;
  return { key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: () => (prevented = true), prevented: () => prevented, ...extra };
};

describe('a drag in a window that changes height (CodeRabbit, splitter.ts:116)', () => {
  it('commits a size within the limits of the window it is released in', () => {
    const { h, element } = setup();
    h.store.resize({ size: 400 });
    let viewport = VIEWPORT;
    const splitter = createSplitter({ store: h.store, panel: () => element, viewport: () => viewport });
    splitter.pointerDown(down(500));
    viewport = 800;
    splitter.pointerMove({ pointerId: 1, clientY: 350 });
    frame();
    splitter.pointerUp({ pointerId: 1, clientY: 350 });
    // 400 and 150 px up is 550, and a window 800 px high allows 800 - 312 = 488.
    expect(h.store.getSnapshot().height).toBe(488);
  });
});

describe('a drag', () => {
  it('writes one style per frame however many moves come in it, and nothing before the frame', () => {
    const { splitter, writes, commits } = setup();
    splitter.pointerDown(down(500));
    splitter.pointerMove({ pointerId: 1, clientY: 480 });
    splitter.pointerMove({ pointerId: 1, clientY: 460 });
    splitter.pointerMove({ pointerId: 1, clientY: 440 });
    expect(writes).toEqual([]);
    expect(queue).toHaveLength(1);
    frame();
    // The handle is the panel's top edge: the pointer moved up by 60 px, so the panel is 60 px taller.
    expect(writes).toEqual([`${String(DEFAULT + 60)}px`]);
    splitter.pointerMove({ pointerId: 1, clientY: 400 });
    frame();
    expect(writes).toEqual([`${String(DEFAULT + 60)}px`, `${String(DEFAULT + 100)}px`]);
    expect(commits.count).toBe(0);
  });

  it('writes nothing in a frame where the size did not change, and clamps to the limits', () => {
    const { splitter, writes } = setup();
    splitter.pointerDown(down(500));
    splitter.pointerMove({ pointerId: 1, clientY: 0 });
    frame();
    splitter.pointerMove({ pointerId: 1, clientY: -200 });
    frame();
    splitter.pointerMove({ pointerId: 1, clientY: 900 });
    frame();
    expect(writes).toEqual([`${String(MAX)}px`, `${String(MIN)}px`]);
  });

  it('marks the shell window while it runs and never touches the document root', () => {
    const { splitter, shell } = setup();
    const root = document.documentElement;
    const before = root.getAttribute('style');
    splitter.pointerDown(down(500));
    expect(shell.dataset.resizing).toBe('y');
    splitter.pointerMove({ pointerId: 1, clientY: 450 });
    frame();
    expect(root.hasAttribute('data-resizing')).toBe(false);
    expect(root.getAttribute('style')).toBe(before);
    splitter.pointerUp({ pointerId: 1, clientY: 450 });
    expect(shell.hasAttribute('data-resizing')).toBe(false);
    expect(root.getAttribute('style')).toBe(before);
  });

  it('commits the model once, on release, and nothing while it moves', () => {
    const { h, splitter, commits } = setup();
    splitter.pointerDown(down(500));
    for (let at = 490; at >= 440; at -= 10) {
      splitter.pointerMove({ pointerId: 1, clientY: at });
      frame();
    }

    expect(commits.count).toBe(0);
    splitter.pointerUp({ pointerId: 1, clientY: 440 });
    expect(commits.count).toBe(1);
    expect(h.snapshot().height).toBe(DEFAULT + 60);
  });

  it('is put back as it was by Escape, and by a cancelled pointer: no commit, the size given back', () => {
    const { h, splitter, shell, writes, commits } = setup();
    splitter.pointerDown(down(500));
    splitter.pointerMove({ pointerId: 1, clientY: 430 });
    frame();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(splitter.dragging()).toBe(false);
    expect(writes.at(-1)).toBe('');
    expect(shell.hasAttribute('data-resizing')).toBe(false);
    expect(commits.count).toBe(0);
    expect(h.snapshot().height).toBeNull();

    splitter.pointerDown(down(500));
    splitter.pointerMove({ pointerId: 1, clientY: 430 });
    frame();
    splitter.cancel();
    expect(splitter.dragging()).toBe(false);
    expect(writes.at(-1)).toBe('');
    expect(commits.count).toBe(0);
  });

  it('released below the collapse line hides the panel and keeps the height it had', () => {
    const { h, splitter } = setup();
    splitter.pointerDown(down(500));
    splitter.pointerMove({ pointerId: 1, clientY: 800 });
    frame();
    splitter.pointerUp({ pointerId: 1, clientY: 800 });
    expect(h.snapshot().open).toBe(false);
    expect(h.snapshot().height).toBeNull();
  });

  it('ignores a secondary button, a non-primary pointer, another pointer\'s moves, and a second start', () => {
    const { splitter, writes } = setup();
    splitter.pointerDown(down(500, { button: 2 }));
    splitter.pointerDown(down(500, { isPrimary: false }));
    expect(splitter.dragging()).toBe(false);
    splitter.pointerDown(down(500));
    splitter.pointerDown(down(100, { pointerId: 2 }));
    splitter.pointerMove({ pointerId: 2, clientY: 0 });
    frame();
    expect(writes).toEqual([]);
    splitter.pointerUp({ pointerId: 2, clientY: 0 });
    expect(splitter.dragging()).toBe(true);
    splitter.dispose();
    expect(splitter.dragging()).toBe(false);
  });

  it('a release with no movement commits nothing', () => {
    const { splitter, commits } = setup();
    splitter.pointerDown(down(500));
    splitter.pointerUp({ pointerId: 1, clientY: 500 });
    expect(commits.count).toBe(0);
  });
});

describe('the keys', () => {
  it('Up grows the panel by 16 px and Down shrinks it (the handle is its top edge), 64 with Shift', () => {
    const { h, splitter } = setup();
    const up = key('ArrowUp');
    splitter.key(up);
    expect(up.prevented()).toBe(true);
    expect(h.snapshot().height).toBe(DEFAULT + 16);
    splitter.key(key('ArrowDown', { shiftKey: true }));
    expect(h.snapshot().height).toBe(DEFAULT + 16 - 64);
  });

  it('Home goes to the minimum, End to the maximum, Enter back to the default', () => {
    const { h, splitter } = setup();
    splitter.key(key('Home'));
    expect(h.snapshot().height).toBe(MIN);
    splitter.key(key('End'));
    expect(h.snapshot().height).toBe(MAX);
    splitter.key(key('Enter'));
    expect(h.snapshot().height).toBeNull();
  });

  it('leaves a key it does not own, a chord with a modifier, and any key during a drag, alone', () => {
    const { h, splitter } = setup();
    const other = key('a');
    splitter.key(other);
    splitter.key(key('ArrowUp', { ctrlKey: true }));
    splitter.key(key('ArrowUp', { metaKey: true }));
    splitter.key(key('ArrowUp', { altKey: true }));
    expect(other.prevented()).toBe(false);
    expect(h.snapshot().height).toBeNull();
    splitter.pointerDown(down(500));
    splitter.key(key('ArrowUp'));
    expect(h.snapshot().height).toBeNull();
  });

  it('a double click (reset) goes back to the default', () => {
    const { h, splitter } = setup();
    splitter.key(key('ArrowUp'));
    expect(h.snapshot().height).toBe(DEFAULT + 16);
    splitter.reset();
    expect(h.snapshot().height).toBeNull();
  });
});

describe('giving the size back', () => {
  it('release removes the inline size unless a drag is running', () => {
    const { splitter, writes } = setup();
    splitter.release();
    expect(writes).toEqual(['']);
    splitter.pointerDown(down(500));
    splitter.pointerMove({ pointerId: 1, clientY: 450 });
    frame();
    splitter.release();
    expect(writes).toEqual(['', `${String(DEFAULT + 50)}px`]);
  });
});
