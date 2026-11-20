import { describe, expect, it } from 'vitest';
import type { KeyLike } from '../core/chords';
import { blocksUnderModal, paletteChordOf } from './chords';

// The palette's chords as a function from a key event to what it asks (ch16 S66: Command K on a Mac and Control K elsewhere, a toggle, from anywhere) and the chords a modal palette keeps
// from the window behind it (the mock's chord router: `modalOpen() && !binding.modal` ignores the binding). Framework-free: the DOM adapter is `usePaletteChords.ts`.

const key = (init: Partial<KeyLike> & { readonly key?: string }): KeyLike & { readonly key?: string } => ({ code: 'KeyK', key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init });

describe('the search chord', () => {
  it('is Command K on a Mac', () => {
    expect(paletteChordOf(key({ metaKey: true }), 'mac')).toEqual({ action: 'toggle' });
    expect(paletteChordOf(key({ ctrlKey: true }), 'mac')).toBeUndefined();
  });

  it('is Control K elsewhere', () => {
    expect(paletteChordOf(key({ ctrlKey: true }), 'other')).toEqual({ action: 'toggle' });
    expect(paletteChordOf(key({ metaKey: true }), 'other')).toBeUndefined();
  });

  it('is not another chord that has K in it: with Shift or Option it is something else', () => {
    expect(paletteChordOf(key({ metaKey: true, shiftKey: true }), 'mac')).toBeUndefined();
    expect(paletteChordOf(key({ metaKey: true, altKey: true }), 'mac')).toBeUndefined();
    expect(paletteChordOf(key({ ctrlKey: true, shiftKey: true }), 'other')).toBeUndefined();
    expect(paletteChordOf(key({ ctrlKey: true, altKey: true }), 'other')).toBeUndefined();
  });

  it('is the key the user means: the letter K on any layout, and the key in K\'s place where the layout has another letter there', () => {
    expect(paletteChordOf(key({ metaKey: true, code: 'KeyV', key: 'k' }), 'mac')).toEqual({ action: 'toggle' });
    expect(paletteChordOf(key({ metaKey: true, code: 'KeyK', key: 'л' }), 'mac')).toEqual({ action: 'toggle' });
    expect(paletteChordOf(key({ metaKey: true, code: 'KeyJ', key: 'j' }), 'mac')).toBeUndefined();
  });

  it('is not a chord while an input method composes, or when something else already took the key', () => {
    expect(paletteChordOf(key({ metaKey: true, isComposing: true }), 'mac')).toBeUndefined();
    expect(paletteChordOf(key({ metaKey: true, keyCode: 229 }), 'mac')).toBeUndefined();
    expect(paletteChordOf(key({ metaKey: true, defaultPrevented: true }), 'mac')).toBeUndefined();
  });
});

describe('what a modal palette keeps from the window behind it', () => {
  it('blocks the tab chords: closing a page, or jumping to one, behind a palette would be a surprise', () => {
    expect(blocksUnderModal(key({ code: 'KeyW', key: 'w', metaKey: true }), 'mac')).toBe(true);
    expect(blocksUnderModal(key({ code: 'Digit3', key: '3', metaKey: true }), 'mac')).toBe(true);
    expect(blocksUnderModal(key({ code: 'KeyW', key: 'w', ctrlKey: true }), 'other')).toBe(true);
    expect(blocksUnderModal(key({ code: 'KeyW', key: 'w', ctrlKey: true, altKey: true }), 'other')).toBe(true);
  });

  it('blocks the panel toggle', () => {
    expect(blocksUnderModal(key({ code: 'KeyJ', key: 'j', metaKey: true }), 'mac')).toBe(true);
    expect(blocksUnderModal(key({ code: 'KeyJ', key: 'j', ctrlKey: true }), 'other')).toBe(true);
  });

  it('leaves the keys of editing and moving alone: a copy, a paste, select all, the arrows, Enter, Escape, typing', () => {
    for (const init of [
      { code: 'KeyC', key: 'c', metaKey: true },
      { code: 'KeyV', key: 'v', metaKey: true },
      { code: 'KeyA', key: 'a', metaKey: true },
      { code: 'ArrowDown', key: 'ArrowDown' },
      { code: 'Enter', key: 'Enter', metaKey: true },
      { code: 'Escape', key: 'Escape' },
      { code: 'KeyW', key: 'w' },
      { code: 'KeyJ', key: 'j' },
    ]) {
      expect(blocksUnderModal(key(init), 'mac')).toBe(false);
    }
  });

  it('does not block what the palette itself asks', () => {
    expect(blocksUnderModal(key({ metaKey: true }), 'mac')).toBe(false);
  });
});
