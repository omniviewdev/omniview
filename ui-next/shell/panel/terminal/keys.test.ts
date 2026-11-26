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

// Find, the steps of a find, and the context menu's keys (T3a). VS Code and JetBrains both bind Command F on a Mac and Control F elsewhere to the find of the terminal, and the written spec (S52) says Control Shift F: the host takes
// both, so the shell loses Control F (VS Code lists it among the commands that skip the shell, and says so). F3 and Shift F3 step a find on every platform, and Command G and Command Shift G on a Mac. Shift F10 and the Menu key open the
// context menu, and the menu's host in the window reads them: they are the window's, so that the terminal neither takes nor stops them.

describe('find', () => {
  it('is Command F on a Mac, and no other chord with F there: Control F stays the shell\'s (it moves forward a character), and Command Shift F and Command Option F are the window\'s', () => {
    expect(keyOf(key('KeyF', { metaKey: true }), 'mac', false)).toBe('find');
    expect(keyOf(key('KeyF', { metaKey: true }), 'mac', true)).toBe('find');
    expect(keyOf(key('KeyF', { ctrlKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('KeyF', { metaKey: true, shiftKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('KeyF', { metaKey: true, altKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('KeyF'), 'mac', false)).toBe('terminal');
    expect(keyOf(key('KeyF', { altKey: true }), 'mac', false)).toBe('terminal');
  });

  it('is Control F and Control Shift F elsewhere: VS Code and JetBrains bind the first, the written spec the second, and both are the find; Control Alt F, Alt F, Command F and plain F are not', () => {
    expect(keyOf(key('KeyF', { ctrlKey: true }), 'other', false)).toBe('find');
    expect(keyOf(key('KeyF', { ctrlKey: true }), 'other', true)).toBe('find');
    expect(keyOf(key('KeyF', { ctrlKey: true, shiftKey: true }), 'other', false)).toBe('find');
    expect(keyOf(key('KeyF', { ctrlKey: true, altKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyF', { altKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyF', { metaKey: true }), 'other', false)).toBe('app');
    expect(keyOf(key('KeyF'), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyF', { shiftKey: true }), 'other', false)).toBe('terminal');
  });

  it('is not a find while an input method composes, and Control Alt F with a layout\'s AltGr on Windows is a character', () => {
    expect(keyOf({ ...key('KeyF', { metaKey: true }), isComposing: true }, 'mac', false)).toBe('terminal');
    expect(keyOf({ ...key('KeyF', { ctrlKey: true }), keyCode: 229 }, 'other', false)).toBe('terminal');
    expect(keyOf({ ...key('KeyF', { ctrlKey: true, altKey: true }), getModifierState: (name: string) => name === 'AltGraph' }, 'other', false)).toBe('terminal');
  });
});

describe('the steps of a find', () => {
  it.each(['mac', 'other'] as const)('are F3 and Shift F3 on %s: next and previous', (platform) => {
    expect(keyOf(key('F3', { key: 'F3' }), platform, false)).toBe('findNext');
    expect(keyOf(key('F3', { key: 'F3', shiftKey: true }), platform, false)).toBe('findPrevious');
  });

  it.each(['mac', 'other'] as const)('are not F3 with Control, Option or Command on %s: those chords are as they were (the window\'s with Command, the shell\'s otherwise)', (platform) => {
    expect(keyOf(key('F3', { key: 'F3', ctrlKey: true }), platform, false)).toBe('terminal');
    expect(keyOf(key('F3', { key: 'F3', altKey: true }), platform, false)).toBe('terminal');
    expect(keyOf(key('F3', { key: 'F3', metaKey: true }), platform, false)).toBe('app');
  });

  it('are Command G and Command Shift G on a Mac: next and previous (VS Code: Command G, secondary F3)', () => {
    expect(keyOf(key('KeyG', { metaKey: true }), 'mac', false)).toBe('findNext');
    expect(keyOf(key('KeyG', { metaKey: true, shiftKey: true }), 'mac', false)).toBe('findPrevious');
    expect(keyOf(key('KeyG', { metaKey: true, altKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('KeyG', { ctrlKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('KeyG'), 'mac', false)).toBe('terminal');
  });

  it('are not Control G elsewhere: it is the shell\'s (it aborts a search in readline), and Control Shift G is the window\'s', () => {
    expect(keyOf(key('KeyG', { ctrlKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('KeyG', { ctrlKey: true, shiftKey: true }), 'other', false)).toBe('app');
  });
});

describe('the keys of the context menu', () => {
  it.each(['mac', 'other'] as const)('are Shift F10 and the Menu key on %s, and the window\'s: the terminal neither takes them nor stops them, so the menu\'s host sees the event (a key the terminal handles is cancelled)', (platform) => {
    expect(keyOf(key('F10', { key: 'F10', shiftKey: true }), platform, false)).toBe('app');
    expect(keyOf(key('ContextMenu', { key: 'ContextMenu' }), platform, false)).toBe('app');
    expect(keyOf(key('ContextMenu', { key: 'ContextMenu', shiftKey: true }), platform, false)).toBe('app');
  });

  it.each(['mac', 'other'] as const)('are no other F10 on %s: F10 alone and with Option stay the terminal\'s, and a Menu key with a modifier the menu\'s host ignores stays as it was', (platform) => {
    expect(keyOf(key('F10', { key: 'F10' }), platform, false)).toBe('terminal');
    expect(keyOf(key('F10', { key: 'F10', shiftKey: true, ctrlKey: true }), platform, false)).toBe(platform === 'mac' ? 'terminal' : 'app');
    expect(keyOf(key('F10', { key: 'F10', shiftKey: true, altKey: true }), platform, false)).toBe('terminal');
    expect(keyOf(key('ContextMenu', { key: 'ContextMenu', altKey: true }), platform, false)).toBe('terminal');
  });
});

// THE JUMP TO A COMMAND (issue #694 step 5): VS Code's chords. Command Up and Down on a Mac (the window's own Command chords stay the window's), Control Up and Down on Windows and Linux (a Control chord without Shift is the shell's, and
// this is the one the terminal takes back), each with Shift to select the command's output as well. Option is the word movement of the shell, and Control and Command together are nobody's.

describe('the keys that jump to a command', () => {
  it('are Command Up and Down on a Mac, and with Shift they select the output', () => {
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', metaKey: true }), 'mac', false)).toBe('previousCommand');
    expect(keyOf(key('ArrowDown', { key: 'ArrowDown', metaKey: true }), 'mac', false)).toBe('nextCommand');
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', metaKey: true, shiftKey: true }), 'mac', false)).toBe('selectPreviousCommand');
    expect(keyOf(key('ArrowDown', { key: 'ArrowDown', metaKey: true, shiftKey: true }), 'mac', false)).toBe('selectNextCommand');
  });

  it('are Control Up and Down on Windows and Linux, and with Shift they select the output', () => {
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', ctrlKey: true }), 'other', false)).toBe('previousCommand');
    expect(keyOf(key('ArrowDown', { key: 'ArrowDown', ctrlKey: true }), 'other', false)).toBe('nextCommand');
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', ctrlKey: true, shiftKey: true }), 'other', false)).toBe('selectPreviousCommand');
    expect(keyOf(key('ArrowDown', { key: 'ArrowDown', ctrlKey: true, shiftKey: true }), 'other', false)).toBe('selectNextCommand');
  });

  it('are not the other platform\'s: Control Up on a Mac is the shell\'s, Command Up on Windows and Linux the window\'s', () => {
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', ctrlKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', metaKey: true }), 'other', false)).toBe('app');
  });

  it('are not these keys with Option or Alt, with both Control and Command, or on the other keys of the arrow cluster: Option Up is the shell\'s, Control Left is the shell\'s word movement', () => {
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', metaKey: true, altKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', ctrlKey: true, altKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp', altKey: true }), 'mac', false)).toBe('terminal');
    expect(keyOf(key('ArrowLeft', { key: 'ArrowLeft', ctrlKey: true }), 'other', false)).toBe('terminal');
    expect(keyOf(key('ArrowLeft', { key: 'ArrowLeft', metaKey: true }), 'mac', false)).toBe('app');
    expect(keyOf(key('ArrowUp', { key: 'ArrowUp' }), 'other', false), 'plain Up is the shell\'s history').toBe('terminal');
  });
});
