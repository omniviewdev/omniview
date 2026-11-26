import { describe, expect, it } from 'vitest';
import { chordOf, panelChordOf, platformOf, type KeyLike } from './chords';

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

describe('reopen, next and previous', () => {
  it('reopen is Command Shift T on a Mac, Control Shift T elsewhere, and Control Option Shift T for the web', () => {
    expect(chordOf(key('KeyT', { metaKey: true, shiftKey: true }), 'mac')).toEqual({ action: 'reopen' });
    expect(chordOf(key('KeyT', { ctrlKey: true, shiftKey: true }), 'other')).toEqual({ action: 'reopen' });
    expect(chordOf(key('KeyT', { ctrlKey: true, altKey: true, shiftKey: true }), 'mac')).toEqual({ action: 'reopen' });
    expect(chordOf(key('KeyT', { metaKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('KeyT', { ctrlKey: true, shiftKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('KeyT', { metaKey: true, shiftKey: true }), 'other')).toBeUndefined();
  });

  it('reopen in the app\'s own window on Windows and Linux is Control Option Shift T alone, because its menu owns Control Shift T; a Mac and a browser tab keep theirs', () => {
    const ctrlShiftT = key('KeyT', { ctrlKey: true, shiftKey: true });
    expect(chordOf(ctrlShiftT, 'other', true)).toBeUndefined();
    expect(chordOf(key('KeyT', { ctrlKey: true, altKey: true, shiftKey: true }), 'other', true)).toEqual({ action: 'reopen' });
    expect(chordOf(ctrlShiftT, 'other', false)).toEqual({ action: 'reopen' });
    expect(chordOf(key('KeyT', { metaKey: true, shiftKey: true }), 'mac', true)).toEqual({ action: 'reopen' });
  });

  it('next is Control Tab, Command Shift ] on a Mac, and Control Option Right for the web; previous is the mirror', () => {
    expect(chordOf(key('Tab', { ctrlKey: true }), 'mac')).toEqual({ action: 'next' });
    expect(chordOf(key('Tab', { ctrlKey: true }), 'other')).toEqual({ action: 'next' });
    expect(chordOf(key('BracketRight', { metaKey: true, shiftKey: true }), 'mac')).toEqual({ action: 'next' });
    expect(chordOf(key('ArrowRight', { ctrlKey: true, altKey: true }), 'other')).toEqual({ action: 'next' });
    expect(chordOf(key('Tab', { ctrlKey: true, shiftKey: true }), 'mac')).toEqual({ action: 'previous' });
    expect(chordOf(key('BracketLeft', { metaKey: true, shiftKey: true }), 'mac')).toEqual({ action: 'previous' });
    expect(chordOf(key('ArrowLeft', { ctrlKey: true, altKey: true }), 'mac')).toEqual({ action: 'previous' });
  });

  it('binds the bracket chords on a Mac and nowhere else: Control Shift ] and [ are not chords elsewhere', () => {
    expect(chordOf(key('BracketRight', { ctrlKey: true, shiftKey: true }), 'other')).toBeUndefined();
    expect(chordOf(key('BracketLeft', { ctrlKey: true, shiftKey: true }), 'other')).toBeUndefined();
  });

  it('leave the keys of the text under the caret alone: Command Right, Option Right, a bare Tab, a bracket without Shift', () => {
    expect(chordOf(key('ArrowRight', { metaKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('ArrowRight', { altKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('Tab'), 'mac')).toBeUndefined();
    expect(chordOf(key('Tab', { ctrlKey: true, altKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('BracketRight', { metaKey: true }), 'mac')).toBeUndefined();
    expect(chordOf(key('Tab', { ctrlKey: true, isComposing: true }), 'mac')).toBeUndefined();
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

// The panel's chords (ch16 S106, S118): the panel toggles with Command J (Control J elsewhere, Control Option J where a browser keeps the first), and while the focus is in the panel Close session
// is Command W on a Mac and Control Shift W elsewhere, so Control W stays Close tab (ported from the mock's harness, ShellStore/unit.cjs "host.panel.close-session").
describe('the panel chords', () => {
  const at = (code: string, platform: 'mac' | 'other', over: Partial<KeyLike> = {}, inPanel = false) => panelChordOf(key(code, over), platform, inPanel);

  it('toggle with Command J on a Mac and Control J elsewhere, from anywhere', () => {
    expect(at('KeyJ', 'mac', { metaKey: true })).toEqual({ action: 'toggle' });
    expect(at('KeyJ', 'other', { ctrlKey: true })).toEqual({ action: 'toggle' });
    expect(at('KeyJ', 'mac', { metaKey: true }, true)).toEqual({ action: 'toggle' });
  });

  it('toggle with Control Option J on any platform (the web alternate)', () => {
    for (const platform of ['mac', 'other'] as const) {
      expect(at('KeyJ', platform, { ctrlKey: true, altKey: true })).toEqual({ action: 'toggle' });
    }
  });

  it('are not the other platform\'s modifier, not Shift (Command Shift J maximizes: not built), not a bare key', () => {
    expect(at('KeyJ', 'mac', { ctrlKey: true })).toBeUndefined();
    expect(at('KeyJ', 'other', { metaKey: true })).toBeUndefined();
    expect(at('KeyJ', 'mac', { metaKey: true, shiftKey: true })).toBeUndefined();
    expect(at('KeyJ', 'other', { ctrlKey: true, shiftKey: true })).toBeUndefined();
    expect(at('KeyJ', 'mac', { metaKey: true, altKey: true })).toBeUndefined();
    expect(at('KeyJ', 'mac')).toBeUndefined();
  });

  it('close the session with Command W on a Mac, Control Shift W elsewhere, and Control Option W for the web, only while the focus is in the panel', () => {
    expect(at('KeyW', 'mac', { metaKey: true }, true)).toEqual({ action: 'close-session' });
    expect(at('KeyW', 'other', { ctrlKey: true, shiftKey: true }, true)).toEqual({ action: 'close-session' });
    expect(at('KeyW', 'mac', { ctrlKey: true, altKey: true }, true)).toEqual({ action: 'close-session' });
    expect(at('KeyW', 'other', { ctrlKey: true, altKey: true }, true)).toEqual({ action: 'close-session' });
    expect(at('KeyW', 'mac', { metaKey: true }, false)).toBeUndefined();
    expect(at('KeyW', 'other', { ctrlKey: true, shiftKey: true }, false)).toBeUndefined();
  });

  it('leave Control W elsewhere to Close tab, even in the panel', () => {
    expect(at('KeyW', 'other', { ctrlKey: true }, true)).toBeUndefined();
    expect(chordOf(key('KeyW', { ctrlKey: true }), 'other')).toEqual({ action: 'close' });
  });

  it('are not a key an input method is composing, or that something else already took, or AltGr', () => {
    expect(at('KeyJ', 'mac', { metaKey: true, isComposing: true })).toBeUndefined();
    expect(at('KeyJ', 'mac', { metaKey: true, keyCode: 229 })).toBeUndefined();
    expect(at('KeyJ', 'mac', { metaKey: true, defaultPrevented: true })).toBeUndefined();
    expect(panelChordOf({ code: 'KeyJ', metaKey: false, ctrlKey: true, altKey: true, shiftKey: false, getModifierState: (name: string) => name === 'AltGraph' }, 'other', false)).toBeUndefined();
  });

  it('are matched by the physical key', () => {
    expect(panelChordOf({ ...key('KeyJ', { ctrlKey: true, altKey: true }), ...{ key: '∆' } }, 'mac', false)).toEqual({ action: 'toggle' });
  });
});
