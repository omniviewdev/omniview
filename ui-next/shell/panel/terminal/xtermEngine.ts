import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';
import { PALETTE_ROLES } from './appearance';
import type { Engine, EngineAppearance, EngineOptions, EngineRenderer } from './engine';

// The emulator: xterm.js behind the host's `Engine` (docs/ui-next/status/T1.md, "The renderer"). This is the ONLY file that imports `@xterm/*`, and it is reached only through `loadEngine.ts`'s dynamic import, so
// a window that never opens a terminal never fetches it. The GPU renderer is a second chunk inside it, fetched the first time a terminal is shown with the GPU on screen.

/** The emulator's own stylesheet, once per document, in the layer the kit's components are in: the host's overrides (layer `ov.shell`) win over it whatever their specificity. */
function injectStyles(): void {
  if (document.querySelector('style[data-terminal-engine]') !== null) {
    return;
  }

  const style = document.createElement('style');
  style.dataset.terminalEngine = '';
  style.textContent = `@layer ov.components {\n${xtermCss}\n}`;
  document.head.append(style);
}

/** The emulator's theme object, from the host's: the sixteen colours by the names the emulator gives them. */
function themeOf(appearance: EngineAppearance): ITheme {
  const { theme } = appearance;
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.cursorAccent,
    selectionBackground: theme.selectionBackground,
    selectionInactiveBackground: theme.selectionInactiveBackground,
    ...Object.fromEntries(PALETTE_ROLES.map((role, index) => [role, theme.palette[index]])),
  };
}

/** The pitch of a row the host wants, in pixels: the font's size times the multiple it asked for. */
const pitchOf = (appearance: EngineAppearance): number => Math.round(appearance.fontSize * appearance.lineHeight);

/**
 * The events at the emulator's input after which it sends, inside the event itself, what the person did: a key (the keydown it takes the special keys and Enter from, and the keypress it takes a character from), text that a
 * keyboard or an input method inserted with no key (input), and a paste.
 */
const PERSON_EVENTS: Readonly<Record<string, true>> = { keydown: true, keypress: true, input: true, paste: true };

export function createXtermEngine(options: EngineOptions): Engine {
  injectStyles();
  const { appearance } = options;
  const terminal = new Terminal({
    // The Unicode version API is a proposed one in the emulator's typings.
    allowProposedApi: true,
    cols: options.cols,
    rows: options.rows,
    scrollback: options.scrollback,
    fontFamily: appearance.fontFamily,
    fontSize: appearance.fontSize,
    lineHeight: 1,
    theme: themeOf(appearance),
    // Idle is zero timers: a blinking cursor is a timer for as long as the terminal has focus.
    cursorBlink: false,
    cursorInactiveStyle: 'outline',
    // Option stays the key that types characters on a Mac (VS Code's and JetBrains's default): a person who wants it as Meta sets it, and that is a later slice.
    macOptionIsMeta: false,
    scrollOnUserInput: true,
    smoothScrollDuration: 0,
    // The printed lines are in the accessibility tree only in this mode: the emulator's rows (and the GPU's canvas) are hidden from it. Off unless the person chose it, and changed at run time by `setScreenReaderMode`.
    screenReaderMode: options.screenReaderMode,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  // Unicode 11 widths, VS Code's default (`terminal.integrated.unicodeVersion`): the shells count with tables far newer than the emulator's default (Unicode 6), which gives an emoji one cell where the shell counts two, so the shell's
  // idea of the cursor column and the screen's part after the first emoji.
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  let renderer: EngineRenderer = 'dom';
  let gpu: WebglAddon | undefined;
  let disposed = false;
  let element: HTMLElement | undefined;
  let pitch = pitchOf(appearance);
  /** An input method's commit is on its way to the listeners from a timer of the emulator's: see `personDid`. */
  let committing = false;

  /**
   * Whether what the emulator sends now is what the person did, and not what it says by itself. The emulator sends both through one event and knows inside which is which (its own flag for input), which its public interface does
   * not show. What it sends for the person it sends inside the event at its input that the person caused (`PERSON_EVENTS`), so the page's current event is one of those while it does; what it says by itself (the answer to a
   * query it parses, a report of its focus) it says while it parses, which is from a timer or a write, or inside a focus event, and never inside one of those. The text an input method commits when its composition ends is sent
   * outside any event, from a timer the emulator sets in its own handler of that event, and `committing` covers that timer (see `open`); the text of a key an input method took without composing (`keyCode` 229, a virtual
   * keyboard) is sent from a timer of the emulator's too, and is not covered: it is not the person's here. Nor is what the mouse sends (a report of a click, the arrows a wheel turns into in a full-screen program): it is dropped
   * with the answers while a replay is applied, as it refers to a screen the replay is about to replace.
   */
  const personDid = (): boolean => {
    const current = window.event;
    return committing || (current !== undefined && Object.hasOwn(PERSON_EVENTS, current.type));
  };

  /**
   * The height of the cell the emulator draws now, or nothing before it has drawn: the height of its screen over its rows. The screen element is there under both renderers (the DOM renderer's own rows are gone
   * once the GPU renderer takes over, and a measure of them would give nothing from then on, so a change of line height after the GPU started would never be calibrated).
   */
  const cellHeight = (): number | undefined => {
    const height = (element?.querySelector<HTMLElement>('.xterm-screen')?.getBoundingClientRect().height ?? 0) / terminal.rows;
    return Number.isFinite(height) && height > 0 ? height : undefined;
  };

  /**
   * The emulator's row is the font's own height times `lineHeight`, rounded down: a multiple that is right for one font is not for another. This finds the multiple that makes the row the pitch the host asked for
   * (the mock's rows are 18 px at 12 px) by looking at the row it makes, and stops when it is, or after a few tries (a font that rounds the other way).
   */
  const calibrate = (): void => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const cell = cellHeight();
      if (cell === undefined || cell === pitch) {
        return;
      }

      terminal.options.lineHeight = (terminal.options.lineHeight ?? 1) * (pitch / cell) + (attempt > 1 ? 0.01 : 0);
    }
  };

  /**
   * Whether there is anything to scroll to: the host element carries `data-scrollable` once the buffer holds more lines than the screen, and the stylesheet draws no scrollbar before (`TerminalBody.module.css`). One
   * comparison per parsed write; nothing runs while the terminal is idle.
   */
  const markScrollable = (): void => {
    const scrollable = terminal.buffer.active.baseY > 0;
    if (element !== undefined && element.hasAttribute('data-scrollable') !== scrollable) {
      element.toggleAttribute('data-scrollable', scrollable);
    }
  };

  const marks = [terminal.onWriteParsed(markScrollable), terminal.onScroll(markScrollable)];

  return {
    open: (host) => {
      element = host;
      terminal.open(host);
      calibrate();
      // This listener comes after the emulator's own for the same event, so the timer it sets comes after the emulator's, and the commit is sent while `committing` is set.
      terminal.textarea?.addEventListener('compositionend', () => {
        committing = true;
        setTimeout(() => {
          committing = false;
        }, 0);
      });
    },

    measure: () => {
      const proposed = fit.proposeDimensions();
      return proposed !== undefined && Number.isFinite(proposed.cols) && Number.isFinite(proposed.rows) && proposed.cols > 0 && proposed.rows > 0 ? { cols: proposed.cols, rows: proposed.rows } : undefined;
    },

    resize: (cols, rows) => {
      terminal.resize(cols, rows);
    },

    size: () => ({ cols: terminal.cols, rows: terminal.rows }),

    write: (data, done) => {
      terminal.write(data, done);
    },

    onData: (listener) => {
      const subscription = terminal.onData((data) => {
        listener(data, personDid());
      });
      return () => {
        subscription.dispose();
      };
    },

    onSelection: (listener) => {
      const subscription = terminal.onSelectionChange(listener);
      return () => {
        subscription.dispose();
      };
    },

    onBell: (listener) => {
      const subscription = terminal.onBell(listener);
      return () => {
        subscription.dispose();
      };
    },

    setKeys: (handler) => {
      terminal.attachCustomKeyEventHandler(handler);
    },

    setAppearance: (next) => {
      terminal.options.theme = themeOf(next);
      terminal.options.fontFamily = next.fontFamily;
      terminal.options.fontSize = next.fontSize;
      pitch = pitchOf(next);
      calibrate();
    },

    setInput: (on) => {
      terminal.options.disableStdin = !on;
    },

    setScreenReaderMode: (on) => {
      terminal.options.screenReaderMode = on;
    },

    setRenderer: async (next) => {
      if (next === renderer || disposed) {
        return;
      }

      renderer = next;
      if (next === 'dom') {
        gpu?.dispose();
        gpu = undefined;
        return;
      }

      try {
        // The GPU renderer is its own chunk; whoever hid the screen again before it came leaves it unused.
        const { WebglAddon: Gpu } = await import('@xterm/addon-webgl');
        if (renderer !== 'gpu' || disposed || gpu !== undefined) {
          return;
        }

        const addon = new Gpu();
        // A lost context falls back to the DOM's renderer, with the screen as it was.
        addon.onContextLoss(() => {
          addon.dispose();
          if (gpu === addon) {
            gpu = undefined;
          }
        });
        terminal.loadAddon(addon);
        gpu = addon;
        calibrate();
      } catch {
        // No chunk, or no context: the DOM's renderer stays, and draws the same screen.
        renderer = 'dom';
        gpu = undefined;
      }
    },

    describe: (label, descriptionId) => {
      terminal.textarea?.setAttribute('aria-label', label);
      terminal.textarea?.setAttribute('aria-describedby', descriptionId);
    },

    focus: () => {
      terminal.focus();
    },

    hasFocus: () => terminal.textarea !== undefined && document.activeElement === terminal.textarea,

    hasSelection: () => terminal.hasSelection(),

    selection: () => terminal.getSelection(),

    clear: () => {
      terminal.clear();
    },

    selectAll: () => {
      terminal.selectAll();
    },

    dispose: () => {
      disposed = true;
      gpu?.dispose();
      gpu = undefined;
      for (const mark of marks) {
        mark.dispose();
      }

      terminal.dispose();
    },
  };
}
