import { describe, expect, it } from 'vitest';
import type { KeyLike } from '../core/chords';
import { settingsChordKeys, settingsChordOf, settingsChordText, WEB_SETTINGS_CHORD } from './chords';

// Settings opens on Command comma on a Mac and Control comma elsewhere (the mock's keymap: host.settings, ⌘, and ⌃⌥, for the web), from anywhere in the window. The physical key is the comma, as the other chords of the shell are
// (`core/chords.ts`): Option turns a character into another, a layout moves it, the key stays where it is.

const key = (init: Partial<KeyLike> = {}): KeyLike => ({ code: 'Comma', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init });

describe('settingsChordOf', () => {
  it('is Command comma on a Mac and Control comma elsewhere', () => {
    expect(settingsChordOf(key({ metaKey: true }), 'mac')).toEqual({ action: 'open' });
    expect(settingsChordOf(key({ ctrlKey: true }), 'other')).toEqual({ action: 'open' });
  });

  it('is not the other platform\'s modifier: Control comma on a Mac and Command comma elsewhere are not it', () => {
    expect(settingsChordOf(key({ ctrlKey: true }), 'mac')).toBeUndefined();
    expect(settingsChordOf(key({ metaKey: true }), 'other')).toBeUndefined();
  });

  it('is Control Option comma for a browser, which keeps the first for itself, on either platform', () => {
    expect(settingsChordOf(key({ ctrlKey: true, altKey: true }), 'mac')).toEqual({ action: 'open' });
    expect(settingsChordOf(key({ ctrlKey: true, altKey: true }), 'other')).toEqual({ action: 'open' });
  });

  it('is not AltGr, which arrives as Control and Alt and types a character', () => {
    expect(settingsChordOf(key({ ctrlKey: true, altKey: true, getModifierState: (name) => name === 'AltGraph' }), 'other')).toBeUndefined();
  });

  it('is not another key, a plain comma, or a comma with Shift (another chord) or with Option alone', () => {
    expect(settingsChordOf(key({ metaKey: true, code: 'Period' }), 'mac')).toBeUndefined();
    expect(settingsChordOf(key(), 'mac')).toBeUndefined();
    expect(settingsChordOf(key({ metaKey: true, shiftKey: true }), 'mac')).toBeUndefined();
    expect(settingsChordOf(key({ altKey: true }), 'mac')).toBeUndefined();
    expect(settingsChordOf(key({ metaKey: true, altKey: true }), 'mac')).toBeUndefined();
  });

  it('is not a key that something else already took, nor one that confirms a composition', () => {
    expect(settingsChordOf(key({ metaKey: true, defaultPrevented: true }), 'mac')).toBeUndefined();
    expect(settingsChordOf(key({ metaKey: true, isComposing: true }), 'mac')).toBeUndefined();
    expect(settingsChordOf(key({ metaKey: true, keyCode: 229 }), 'mac')).toBeUndefined();
  });
});

describe('what the chord is called', () => {
  it('is written for the platform, as the palette writes its own', () => {
    expect(settingsChordText('mac')).toBe('⌘,');
    expect(settingsChordText('other')).toBe('Ctrl+,');
    expect(WEB_SETTINGS_CHORD).toEqual({ mac: '⌃⌥,', other: 'Ctrl+Alt+,' });
  });

  it('is said to assistive technology as aria-keyshortcuts writes it', () => {
    expect(settingsChordKeys('mac')).toBe('Meta+,');
    expect(settingsChordKeys('other')).toBe('Control+,');
  });
});
