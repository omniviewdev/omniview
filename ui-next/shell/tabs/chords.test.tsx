import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, type Harness } from '../core/tabs/testing';
import { Shell } from '../Shell';

// `useTabChords` through the shell, with real key events on the document (the rules themselves are core/chords.test.ts). The model is the real one: five invented pages.

const PAGES = ['one', 'two', 'three', 'four', 'five'] as const;

function mount(platform: string | undefined = undefined, pages: readonly string[] = PAGES) {
  if (platform !== undefined) {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  }

  const h = boot({ home: false });
  const ids = h.openAll(pages);
  h.store.goto(1);
  const view = render(<Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={() => <input aria-label="A field" />} empty={null} />);
  return { h, ids, view };
}

const press = (init: KeyboardEventInit, target: Element | Document = document) => fireEvent.keyDown(target, init);
/** An input in a page: the pages that are hidden hold one each, so the first is the one on screen. */
const field = (): HTMLElement => screen.getAllByLabelText('A field')[0];
const titles = (h: Harness) => h.titles();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('on a Mac', () => {
  it('closes the tab on screen with Command W, and the tab to its right takes its place', () => {
    const { h, ids } = mount('MacIntel');

    expect(press({ code: 'KeyW', metaKey: true })).toBe(false);
    expect(titles(h)).toEqual(['Two', 'Three', 'Four', 'Five']);
    expect(h.active()).toBe(ids[1]);
  });

  it('jumps to the Nth tab with Command 1 to 8, and to the last with Command 9', () => {
    const { h, ids } = mount('MacIntel');

    press({ code: 'Digit3', metaKey: true });
    expect(h.active()).toBe(ids[2]);
    press({ code: 'Digit9', metaKey: true });
    expect(h.active()).toBe(ids[4]);
    press({ code: 'Digit1', metaKey: true });
    expect(h.active()).toBe(ids[0]);
  });

  it('leaves Control W and Control 3 to the page', () => {
    const { h, ids } = mount('MacIntel');

    expect(press({ code: 'KeyW', ctrlKey: true })).toBe(true);
    expect(press({ code: 'Digit3', ctrlKey: true })).toBe(true);
    expect(h.ids()).toHaveLength(5);
    expect(h.active()).toBe(ids[0]);
  });
});

describe('elsewhere', () => {
  it('uses Control, the same way', () => {
    const { h, ids } = mount();

    press({ code: 'Digit2', ctrlKey: true });
    expect(h.active()).toBe(ids[1]);
    press({ code: 'Digit9', ctrlKey: true });
    expect(h.active()).toBe(ids[4]);
    press({ code: 'KeyW', ctrlKey: true });
    expect(titles(h)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('leaves Command W alone', () => {
    const { h } = mount();

    expect(press({ code: 'KeyW', metaKey: true })).toBe(true);
    expect(h.ids()).toHaveLength(5);
  });
});

describe('the web alternate (Control and Option)', () => {
  it('does the same on any platform, where a browser keeps Command or Control W for itself', () => {
    for (const platform of ['MacIntel', 'Win32']) {
      const { h, ids } = mount(platform);

      press({ code: 'Digit4', ctrlKey: true, altKey: true });
      expect(h.active()).toBe(ids[3]);
      press({ code: 'KeyW', ctrlKey: true, altKey: true });
      expect(h.ids()).toHaveLength(4);
      cleanup();
      vi.restoreAllMocks();
    }
  });
});

describe('what is not a chord', () => {
  it('is a key with Shift, one that is composing, one something else already took, and another key', () => {
    const { h, ids } = mount('MacIntel');

    expect(press({ code: 'KeyW', metaKey: true, shiftKey: true })).toBe(true);
    expect(press({ code: 'KeyW', metaKey: true, isComposing: true })).toBe(true);
    expect(press({ code: 'KeyQ', metaKey: true })).toBe(true);
    expect(press({ code: 'Digit0', metaKey: true })).toBe(true);
    const taken = new KeyboardEvent('keydown', { code: 'KeyW', metaKey: true, bubbles: true, cancelable: true });
    const stop = (event: Event) => {
      event.preventDefault();
    };

    field().addEventListener('keydown', stop);
    field().dispatchEvent(taken);

    expect(h.ids()).toHaveLength(5);
    expect(h.active()).toBe(ids[0]);
  });

  it('is matched by the physical key: a layout that types another letter for W is still W', () => {
    const { h } = mount('MacIntel');

    press({ code: 'KeyW', key: 'z', metaKey: true });
    expect(h.ids()).toHaveLength(4);
  });

  it('is heard from inside a page too, since it is bound to the document', () => {
    const { h } = mount('MacIntel');

    press({ code: 'KeyW', metaKey: true }, field());
    expect(h.ids()).toHaveLength(4);
  });

  it('closes nothing, and throws nothing, with no tab on screen', () => {
    const { h, ids } = mount('MacIntel', ['solo']);
    h.world.setHome(false);

    press({ code: 'KeyW', metaKey: true });
    expect(h.ids()).toEqual([]);
    expect(ids).toHaveLength(1);
    expect(() => press({ code: 'KeyW', metaKey: true })).not.toThrow();
    expect(() => press({ code: 'Digit9', metaKey: true })).not.toThrow();
  });
});

describe('the binding', () => {
  it('is released when the shell unmounts', () => {
    const { h, view } = mount('MacIntel');
    view.unmount();

    expect(press({ code: 'KeyW', metaKey: true })).toBe(true);
    expect(h.ids()).toHaveLength(5);
  });
});
