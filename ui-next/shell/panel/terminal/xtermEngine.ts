import { FitAddon } from '@xterm/addon-fit';
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

export function createXtermEngine(options: EngineOptions): Engine {
  injectStyles();
  const { appearance } = options;
  const terminal = new Terminal({
    cols: options.cols,
    rows: options.rows,
    scrollback: options.scrollback,
    fontFamily: appearance.fontFamily,
    fontSize: appearance.fontSize,
    lineHeight: appearance.lineHeight,
    theme: themeOf(appearance),
    // Idle is zero timers: a blinking cursor is a timer for as long as the terminal has focus.
    cursorBlink: false,
    cursorInactiveStyle: 'outline',
    // Option stays the key that types characters on a Mac (VS Code's and JetBrains's default): a person who wants it as Meta sets it, and that is a later slice.
    macOptionIsMeta: false,
    scrollOnUserInput: true,
    smoothScrollDuration: 0,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  let renderer: EngineRenderer = 'dom';
  let gpu: WebglAddon | undefined;
  let disposed = false;

  return {
    open: (host) => {
      terminal.open(host);
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
      const subscription = terminal.onData(listener);
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

    setKeys: (handler) => {
      terminal.attachCustomKeyEventHandler(handler);
    },

    setAppearance: (next) => {
      terminal.options.theme = themeOf(next);
      terminal.options.fontFamily = next.fontFamily;
      terminal.options.fontSize = next.fontSize;
      terminal.options.lineHeight = next.lineHeight;
    },

    setInput: (on) => {
      terminal.options.disableStdin = !on;
    },

    setRenderer: (next) => {
      if (next === renderer || disposed) {
        return;
      }

      renderer = next;
      if (next === 'dom') {
        gpu?.dispose();
        gpu = undefined;
        return;
      }

      // The GPU renderer is its own chunk; whoever hid the screen again before it came leaves it unused.
      void import('@xterm/addon-webgl').then(({ WebglAddon: Gpu }) => {
        if (renderer !== 'gpu' || disposed || gpu !== undefined) {
          return;
        }

        try {
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
        } catch {
          gpu = undefined;
        }
      });
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

    dispose: () => {
      disposed = true;
      gpu?.dispose();
      gpu = undefined;
      terminal.dispose();
    },
  };
}
