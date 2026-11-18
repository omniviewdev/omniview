import { describe, expect, it } from 'vitest';
import { chordOf, platformOf, type KeyLike } from './chords';

const key = (code: string, over: Partial<KeyLike> = {}): KeyLike => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe('platformOf', () => {
  it('reads a Mac from the platform, or from the user agent when there is no platform', () => {
    expect(platformOf({ platform: 'MacIntel' })).toBe('mac');
    expect(platformOf({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('mac');
  });

  it('is the other platform for Windows, Linux and for no answer', () => {
    expect(platformOf({ platform: 'Win32' })).toBe('other');
    expect(platformOf({ platform: 'Linux x86_64' })).toBe('other');
    expect(platformOf({})).toBe('other');
    expect(platformOf(undefined)).toBe('other');
  });
});

describe('the native chord', () => {
  it('is Command on a Mac: W closes, 1 to 8 jump, 9 is the last', () => {
    expect(chordOf(key('KeyW', { metaKey: true }), 'mac')).toEqual({ action: 'close' });
    expect(chordOf(key('Digit1', { metaKey: true }), 'mac')).toEqual({ action: 'jump', n: 1 });
    expect(chordOf(key('Digit8', { metaKey: true }), 'mac')).toEqual({ action: 'jump', n: 8 });
    expect(chordOf(key('Digit9', { metaKey: true }), 'mac')).toEqual({ action: 'last' });
  });

  it('is Control elsewhere', () => {
    expect(chordOf(key('KeyW', { ctrlKey: true }), 'other')).toEqual({ action: 'close' });
    expect(chordOf(key('Digit3', { ctrlKey: true }), 'other')).toEqual({ action: 'jump', n: 3 });
    expect(chordOf(key('Digit9', { ctrlKey: true }), 'other')).toEqual({ action: 'last' });
  });

  it('is not the other platform\'s modifier', () => {
    expect(chordOf(key('KeyW', { ctrlKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('KeyW', { metaKey: true }), 'other')).toBeUndefined();
    expect(chordOf(key('Digit2', { metaKey: true, ctrlKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('Digit2', { metaKey: true, ctrlKey: true }), 'other')).toBeUndefined();
  });
});

describe('the web alternate (Control and Option)', () => {
  it('does the same on any platform', () => {
    for (const platform of ['mac', 'other'] as const) {
      expect(chordOf(key('KeyW', { ctrlKey: true, altKey: true }), platform)).toEqual({ action: 'close' });
      expect(chordOf(key('Digit4', { ctrlKey: true, altKey: true }), platform)).toEqual({ action: 'jump', n: 4 });
      expect(chordOf(key('Digit9', { ctrlKey: true, altKey: true }), platform)).toEqual({ action: 'last' });
    }
  });

  it('is not the native chord with an Option added', () => {
    expect(chordOf(key('KeyW', { metaKey: true, altKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('KeyW', { ctrlKey: true, altKey: true, metaKey: true }), 'mac')).toBeUndefined();
  });
});

describe('what is not a chord', () => {
  it('is a key with no modifier, or with Shift (another chord: next, previous, reopen)', () => {
    expect(chordOf(key('KeyW'), 'mac')).toBeUndefined();
    expect(chordOf(key('KeyW', { metaKey: true, shiftKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('Digit1', { ctrlKey: true, shiftKey: true }), 'other')).toBeUndefined();
    expect(chordOf(key('KeyW', { ctrlKey: true, altKey: true, shiftKey: true }), 'other')).toBeUndefined();
  });

  it('is a key an input method is composing, or that something else already took', () => {
    expect(chordOf(key('KeyW', { metaKey: true, isComposing: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('KeyW', { metaKey: true, keyCode: 229 }), 'mac')).toBeUndefined();
    expect(chordOf(key('KeyW', { metaKey: true, defaultPrevented: true }), 'mac')).toBeUndefined();
  });

  it('is another key, or the digit 0', () => {
    expect(chordOf(key('KeyQ', { metaKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('Digit0', { metaKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('Numpad1', { metaKey: true }), 'mac')).toBeUndefined();
  });

  it('is matched by the physical key, not the character it types', () => {
    // On a Mac, Option turns W into a sigma: `code` stays KeyW and is what the chord reads.
    expect(chordOf({ ...key('KeyW', { ctrlKey: true, altKey: true }), ...{ key: 'Σ' } }, 'mac')).toEqual({ action: 'close' });
  });
});

describe('AltGr', () => {
  const altGr = { code: 'Digit7', metaKey: false, ctrlKey: true, altKey: true, shiftKey: false, getModifierState: (name: string) => name === 'AltGraph' };

  it('is not the web alternate: the character it types is the user\'s', () => {
    expect(chordOf(altGr, 'other')).toBeUndefined();
  });

  it('does not stop Control and Option, which is not AltGr', () => {
    expect(chordOf({ ...altGr, getModifierState: () => false }, 'other')).toEqual({ action: 'jump', n: 7 });
  });
});
