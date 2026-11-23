import { describe, expect, it } from 'vitest';
import { keyOf, sequenceOf, type KeyEventLike } from './keys';

// Which keys a terminal keeps and which it gives the window (ch16 S52: "a terminal takes every ⌃ chord on macOS and every Ctrl chord without Shift on Windows and Linux, so a shell process keeps Ctrl+W, Ctrl+T
// and Ctrl+Tab. ⌘ chords on macOS always reach the command registry"; the mock's `terminalKeeps`: "plus plain typing and ⌥; F6 still leaves it"), and what copy and paste are on each platform. VS Code and
// JetBrains agree on the platform chords: Command C and V on a Mac; Control C and V on Windows, where C copies a selection and is the interrupt without one (docs/ui-next/status/T1.md quotes both).

const key = (code: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike => ({ key: code.replace(/^Key|^Digit/, '').toLowerCase(), code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });

describe('the key that leaves the terminal', () => {
  it.each(['mac', 'other'] as const)('is F6, with or without Shift, on %s: the terminal does not take it, so the window\'s regions move the focus on (A14: never trap)', (platform) => {
    expect(keyOf(key('F6', { key: 'F6' }), platform, false)).toBe('leave');
    expect(keyOf(key('F6', { key: 'F6', shiftKey: true }), platform, false)).toBe('leave');
  });
});

describe('on a Mac', () => {
  it('keeps plain typing, Shift, Option and every Control chord for the shell: Control C is the interrupt, Control W deletes a word, Control Tab is the shell\'s', () => {
    expect(keyOf(key('KeyA'), 'mac', false)).toBe('terminal');
    expect(keyOf(key('KeyA', { shiftKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('KeyB', { altKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('KeyC', { ctrlKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('KeyC', { ctrlKey: true }), 'mac', true)).toBe('terminal');
    expect(keyOf(key('KeyW', { ctrlKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('Tab', { key: 'Tab', ctrlKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('Escape', { key: 'Escape' }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('Tab', { key: 'Tab' }), 'mac', false)).toBe('terminal');
  });

  it('gives every Command chord to the window: toggle the panel, close the session, the tab chords', () => {
    expect(keyOf(key('KeyJ', { metaKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('KeyW', { metaKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('KeyT', { metaKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('Digit3', { metaKey: true }), 'mac', false)).toBe('app');
  });

  it('copies on Command C and pastes on Command V, and Command A is the terminal\'s own (it selects its output)', () => {
    expect(keyOf(key('KeyC', { metaKey: true }), 'mac', true)).toBe('copy');
    expect(keyOf(key('KeyC', { metaKey: true }), 'mac', false)).toBe('copy');
    expect(keyOf(key('KeyV', { metaKey: true }), 'mac', false)).toBe('paste');
    expect(keyOf(key('KeyA', { metaKey: true }), 'mac', false)).toBe('selectAll');
  });
});

describe('on Windows and Linux', () => {
  it('keeps plain typing, Shift, Alt and every Control chord without Shift for the shell: Control W, Control T and Control Tab are the shell\'s (S52)', () => {
    expect(keyOf(key('KeyA'), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyW', { ctrlKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyT', { ctrlKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('Tab', { key: 'Tab', ctrlKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyB', { altKey: true }), 'other', false)).toBe('terminal');
  });

  it('gives the window the Control Shift chords: Control Shift W closes the session, as the panel says (S118)', () => {
    expect(keyOf(key('KeyW', { ctrlKey: true, shiftKey: true }), 'other', false)).toBe('app');
    expect(keyOf(key('KeyT', { ctrlKey: true, shiftKey: true }), 'other', false)).toBe('app');
  });

  it('makes Control C a copy while there is a selection and the interrupt when there is none (VS Code on Windows and JetBrains agree), and Control Shift C always a copy', () => {
    expect(keyOf(key('KeyC', { ctrlKey: true }), 'other', true)).toBe('copy');
    expect(keyOf(key('KeyC', { ctrlKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyC', { ctrlKey: true, shiftKey: true }), 'other', true)).toBe('copy');
    expect(keyOf(key('KeyC', { ctrlKey: true, shiftKey: true }), 'other', false)).toBe('copy');
  });

  it('pastes on Control V and Control Shift V', () => {
    expect(keyOf(key('KeyV', { ctrlKey: true }), 'other', false)).toBe('paste');
    expect(keyOf(key('KeyV', { ctrlKey: true, shiftKey: true }), 'other', false)).toBe('paste');
  });
});

describe('what is not a key press', () => {
  it('is the terminal\'s: a key being composed by an input method, and a modifier alone', () => {
    expect(keyOf({ ...key('KeyJ', { metaKey: true }), isComposing: true }, 'mac', false)).toBe('terminal');
    expect(keyOf({ ...key('KeyJ', { metaKey: true }), keyCode: 229 }, 'mac', false)).toBe('terminal');
    expect(keyOf(key('MetaLeft', { key: 'Meta', metaKey: true }), 'mac', false)).toBe('terminal');
  });

  it('is the terminal\'s: a Windows layout\'s AltGr (Control and Alt together) types a character, it is not a chord', () => {
    expect(keyOf({ ...key('KeyQ', { ctrlKey: true, altKey: true }), getModifierState: (name: string) => name === 'AltGraph' }, 'other', false)).toBe('terminal');
  });
});

describe('select all and clear', () => {
  it('are Command A and Command K on a Mac (VS Code binds the first only there, and both products clear with Command K), and not with another modifier', () => {
    expect(keyOf(key('KeyA', { metaKey: true }), 'mac', false)).toBe('selectAll');
    expect(keyOf(key('KeyK', { metaKey: true }), 'mac', false)).toBe('clear');
    expect(keyOf(key('KeyK', { metaKey: true, shiftKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('KeyK', { ctrlKey: true }), 'mac', false)).toBe('terminal');
  });

  it('are Control Shift A elsewhere (GNOME Terminal and Windows Terminal), and Control A and Control K stay the shell\'s', () => {
    expect(keyOf(key('KeyA', { ctrlKey: true, shiftKey: true }), 'other', false)).toBe('selectAll');
    expect(keyOf(key('KeyA', { ctrlKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyK', { ctrlKey: true }), 'other', false)).toBe('terminal');
  });
});

describe('the sequences of a Mac IDE terminal', () => {
  const arrow = (name: string, modifiers: Partial<KeyEventLike>) => key(name, { key: name, ...modifiers });

  it('are VS Code\'s: Option Left and Right move by a word, Command Left and Right go to the ends of the line, Option and Command Backspace delete a word and the line', () => {
    expect(sequenceOf(arrow('ArrowLeft', { altKey: true }), 'mac')).toBe('\u001bb');
    expect(sequenceOf(arrow('ArrowRight', { altKey: true }), 'mac')).toBe('\u001bf');
    expect(sequenceOf(arrow('ArrowLeft', { metaKey: true }), 'mac')).toBe('\u0001');
    expect(sequenceOf(arrow('ArrowRight', { metaKey: true }), 'mac')).toBe('\u0005');
    expect(sequenceOf(arrow('Backspace', { altKey: true }), 'mac')).toBe('\u0017');
    expect(sequenceOf(arrow('Backspace', { metaKey: true }), 'mac')).toBe('\u0015');
  });

  it('are none for another key, a key with Shift or Control, both Option and Command, an input method, or another platform: the emulator\'s own encoding stands', () => {
    expect(sequenceOf(arrow('ArrowUp', { altKey: true }), 'mac')).toBeUndefined();
    expect(sequenceOf(arrow('ArrowLeft', {}), 'mac')).toBeUndefined();
    expect(sequenceOf(arrow('ArrowLeft', { altKey: true, shiftKey: true }), 'mac')).toBeUndefined();
    expect(sequenceOf(arrow('ArrowLeft', { altKey: true, ctrlKey: true }), 'mac')).toBeUndefined();
    expect(sequenceOf(arrow('ArrowLeft', { altKey: true, metaKey: true }), 'mac')).toBeUndefined();
    expect(sequenceOf(arrow('ArrowLeft', { altKey: true, isComposing: true }), 'mac')).toBeUndefined();
    expect(sequenceOf(arrow('ArrowLeft', { altKey: true }), 'other')).toBeUndefined();
    expect(sequenceOf(arrow('ArrowLeft', { ctrlKey: true }), 'other')).toBeUndefined();
  });
});
