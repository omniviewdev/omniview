import type { Platform } from '../../core/chords';

// Which keys a terminal keeps and which it gives the window (ch16 S52: "a terminal takes every ⌃ chord on macOS and every Ctrl chord without Shift on Windows and Linux, so a shell process keeps Ctrl+W,
// Ctrl+T and Ctrl+Tab. ⌘ chords on macOS always reach the command registry"; the mock's `terminalKeeps`, shell-core.js: "plus plain typing and ⌥; F6 still leaves it"). The emulator calls the answer for
// every key before it processes it. Pure: the screen turns the answer into what it does.

/** What a key event says: the fields of a `KeyboardEvent` the rules read. */
export type KeyEventLike = {
  readonly key: string;
  /** The physical key: Option turns a letter into another character on a Mac, and a layout moves the digits, but the key stays where it is. */
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean | undefined;
  readonly keyCode?: number | undefined;
  /** What the platform says of a modifier: the one thing that tells AltGr (Control and Alt together, typing a character) from a chord. */
  readonly getModifierState?: ((key: string) => boolean) | undefined;
};

/**
 * What the terminal does with a key:
 *   `terminal`  the emulator processes it: it is typing, or a chord the shell keeps (S52)
 *   `leave`     the terminal does not take it and does not stop it, so the window's regions move the focus on (F6: A14, never trap the user; Escape is NOT a way out, programs need it)
 *   `app`       a chord of the window (a Command chord on a Mac, a Control Shift chord elsewhere): the terminal does not take it and does not stop it. So are Shift F10 and the Menu key, which open the context menu: the menu's host in the
 *               window reads them, and ignores a key that was cancelled, which is what the emulator does to a key it handles (it would send an escape sequence)
 *   `copy`      the selection goes to the clipboard
 *   `paste`     the platform pastes through the emulator's paste event, so the terminal must not also send the key
 *   `selectAll` the output is selected: Command A on a Mac (VS Code binds it there and nowhere else, "as it may conflict with shell hotkeys"), Control Shift A elsewhere (GNOME Terminal and Windows Terminal)
 *   `clear`     the screen and the scrollback are cleared: Command K on a Mac, where VS Code and JetBrains both take it while the terminal has the focus (it is also the window's palette chord: the terminal's wins there)
 *   `find`      the find over the output opens: Command F on a Mac, Control F and Control Shift F elsewhere (VS Code and JetBrains bind Control F, the written spec Control Shift F: both are taken, and the shell loses Control F,
 *               as VS Code's does)
 *   `findNext`  a find steps: F3 on every platform, Command G on a Mac; with Shift, `findPrevious`. They stay the terminal's (F3) or the window's (Command G) unless the find bar takes them
 */
export type TerminalKey = 'terminal' | 'leave' | 'app' | 'copy' | 'paste' | 'selectAll' | 'clear' | 'find' | 'findNext' | 'findPrevious';

const MODIFIERS: Readonly<Record<string, true>> = { Shift: true, Control: true, Alt: true, Meta: true, AltGraph: true, CapsLock: true, Fn: true, FnLock: true, OS: true, Hyper: true, Super: true, Dead: true, Process: true, Unidentified: true };

/**
 * The rule. Copy and paste are the platform's, and VS Code and JetBrains agree on them: Command C and V on a Mac (Control C is the interrupt, always); Control C and V on Windows, where C copies while there is a
 * selection and is the interrupt without one, and Control Shift C and V on Linux and Windows Terminal, which copy and paste always. `selected` is whether the terminal has a selection now.
 */
export function keyOf(event: KeyEventLike, platform: Platform, selected: boolean): TerminalKey {
  // A key being composed by an input method belongs to the emulator's composition helper, and a modifier alone is nothing.
  if (event.isComposing === true || event.keyCode === 229 || Object.hasOwn(MODIFIERS, event.key)) {
    return 'terminal';
  }

  if (event.code === 'F6' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return 'leave';
  }

  // The keys that open the context menu (Shift F10, the Menu key) are the menu host's to read: the terminal neither takes them nor stops them. The host ignores them with Control, Option or Command, and so does this.
  if (!event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'ContextMenu' || event.code === 'ContextMenu' || (event.shiftKey && (event.key === 'F10' || event.code === 'F10')))) {
    return 'app';
  }

  // F3 steps a find on every platform, and Shift F3 goes back.
  if (event.code === 'F3' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return event.shiftKey ? 'findPrevious' : 'findNext';
  }

  if (platform === 'mac') {
    if (event.metaKey) {
      if (event.code === 'KeyC') {
        return 'copy';
      }

      if (event.code === 'KeyV') {
        return 'paste';
      }

      // Select all, clear and find are the terminal's own on a Mac, and Command G steps the find (Shift goes back).
      if (!event.altKey && !event.ctrlKey) {
        if (!event.shiftKey) {
          if (event.code === 'KeyA') {
            return 'selectAll';
          }

          if (event.code === 'KeyK') {
            return 'clear';
          }

          if (event.code === 'KeyF') {
            return 'find';
          }
        }

        if (event.code === 'KeyG') {
          return event.shiftKey ? 'findPrevious' : 'findNext';
        }
      }

      return 'app';
    }

    return 'terminal';
  }

  // On Windows a layout's AltGr arrives as Control and Alt, and types a character.
  if (event.ctrlKey && event.altKey && event.getModifierState?.('AltGraph') === true) {
    return 'terminal';
  }

  if (event.metaKey) {
    return 'app';
  }

  if (event.ctrlKey && !event.altKey) {
    if (event.code === 'KeyC' && (event.shiftKey || selected)) {
      return 'copy';
    }

    if (event.code === 'KeyV') {
      return 'paste';
    }

    if (event.shiftKey && event.code === 'KeyA') {
      return 'selectAll';
    }

    // Control F finds, with Shift or without (VS Code and JetBrains bind it, and the written spec says Control Shift F).
    if (event.code === 'KeyF') {
      return 'find';
    }

    // Control with Shift is the window's; Control without it is the shell's.
    return event.shiftKey ? 'app' : 'terminal';
  }

  return 'terminal';
}

/**
 * What a Mac IDE terminal sends for the keys of word and line movement (VS Code's default terminal keybindings on macOS, `workbench.action.terminal.sendSequence`: Option Left and Right are `ESC b` and `ESC f`, Command Left
 * and Right are Control A and Control E, Option Backspace is Control W and Command Backspace Control U). The emulator's own encoding of these (`ESC [ 1 ; 3 D` and the like) is not what bash and zsh bind, so without them the arrows
 * move by one character whatever the modifier. Nothing elsewhere: on Windows and Linux Control Left and Right already are the shell's word movement (`ESC [ 1 ; 5 D`). The key's own meaning is cancelled when this answers.
 */
export function sequenceOf(event: KeyEventLike, platform: Platform): string | undefined {
  if (platform !== 'mac' || event.isComposing === true || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.altKey === event.metaKey) {
    return undefined;
  }

  const option = event.altKey;
  switch (event.key) {
    case 'ArrowLeft':
      return option ? '\u001bb' : '\u0001';
    case 'ArrowRight':
      return option ? '\u001bf' : '\u0005';
    case 'Backspace':
      return option ? '\u0017' : '\u0015';
    default:
      return undefined;
  }
}
