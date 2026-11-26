import { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IMarker, type ITheme, type IViewportRange } from '@xterm/xterm';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';
import { PALETTE_ROLES } from './appearance';
import { FIND_LIMIT, type Engine, type EngineAppearance, type EngineMarker, type EngineOptions, type EngineRenderer, type Finder, type FindOptions, type FindState, type LinkHandler, type LinkHover } from './engine';
import { findDecorations } from './findColours';

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

/** The contexts a terminal may lose, or the times its addon may fail to be made, before it stays on the DOM renderer for its life. */
const GPU_FAILURES = 2;

/** The pitch of a row the host wants, in pixels: the font's size times the multiple it asked for. */
const pitchOf = (appearance: EngineAppearance): number => Math.round(appearance.fontSize * appearance.lineHeight);

/**
 * The events at the emulator's input after which it sends, inside the event itself, what the person did: a key (the keydown it takes the special keys and Enter from, and the keypress it takes a character from), text that a
 * keyboard or an input method inserted with no key (input), and a paste.
 */
const PERSON_EVENTS: Readonly<Record<string, true>> = { keydown: true, keypress: true, input: true, paste: true };

/** The characters a pasted text must not carry into a bracketed paste: ESC (which starts the sequence that ends it), ETX (which a line editor takes as an interrupt) and the C1 control CSI. */
const UNSAFE_PASTE = /[\u001b\u0003\u009b]/g;

/** What a find tells when it has nothing: no match, and none counted. */
const NOTHING: FindState = { index: -1, count: 0, capped: false };

/** The finder of a terminal whose search code could not be had, or that is gone: it finds nothing and tells nobody. */
const NO_FINDER: Finder = { next: () => undefined, previous: () => undefined, clear: () => undefined, onChange: () => () => undefined };

/** The characters the search addon counts as not part of a word (its own list): a whole word is between them, or at an end of the line. */
const NON_WORD = ' ~!@#$%^&*()+`-=[]{}|\\;:"\',./<>?';
const NON_WORD_CLASS = `[${NON_WORD.replace(/[\]\\^-]/g, '\\$&')}]`;

/**
 * A query as the regular expression of its whole words. The addon's own whole-word option looks at the first occurrence in a line and gives up when that one is not a whole word, so `foo` is not found in `foobar foo`; a
 * regular expression that says what may stand on both sides finds the later one, with the same idea of a word. A query that is not a pattern is taken literally.
 *
 * The addon runs the expression on a cut of the line, and the expression cannot tell the cut from the start or the end of the line (the line is not given to it), so the start of a cut is taken for a start of line and the
 * end of a cut for an end of line. Three cuts are known, and only the first is undone here:
 *   - a find that starts from a selection cuts the line at the selection (`line.slice(offset)` going forward, `line.slice(0, offset)` going back): the finder lets go of a selection that begins or ends inside a word
 *     (`selectionIsInsideAWord`), so that the step starts from the edge of the buffer;
 *   - the addon looks in the rest of a wrapped line from the first cell of every row that continues the one above: a word that wraps is found as a whole word from what is on its continuation row, when the query is that
 *     part of it;
 *   - the addon counts the matches of a line by going on from one column past the start of the match before, which is inside that match, on the line cut there: with a regular expression that can match the end of what it
 *     matched before (`\d+`, `\w+`, `foo|oo`) and Regex and Whole word both on, that end is counted as a whole word too (`\d+` over `123 45` counts five, not two). A query that is not a pattern is not touched: the end of a
 *     match of it is not a match of it. The last two have no remedy short of a patch of the addon, which has to be given the whole line.
 */
const wholeWordPattern = (query: string, regex: boolean): string => `(?<=^|${NON_WORD_CLASS})(?:${regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|${NON_WORD_CLASS})`;

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
  /** The contexts lost and the addons that could not be made so far: at `GPU_FAILURES` the terminal stays on the DOM's renderer for its life. */
  let gpuFailures = 0;
  let disposed = false;
  let element: HTMLElement | undefined;
  let pitch = pitchOf(appearance);
  /** An input method's commit is on its way to the listeners from a timer of the emulator's: see `personDid`. */
  let committing = false;
  /** A paste the host asked for is being made: it is the person's own input, though no event of the person is under way (a menu's item asked for it). */
  let pasting = false;
  /** The colours of the theme the emulator has now: a find draws its highlights in them. */
  let theme = appearance.theme;
  /** The most matches a find highlights and counts. */
  const limit = options.findLimit ?? FIND_LIMIT;
  /** The finder, once it was asked for: its code is loaded by the first ask, and the same finder answers every later one. */
  let finder: Promise<Finder> | undefined;
  /** Draws the find that is up again in the colours of the theme the emulator has now: the finder sets it, so it is there once a find was asked for. */
  let redrawFind: (() => void) | undefined;
  /** The links the host asked for: the handler it gave (`setLinks`), kept as an object of its own, so that a setting is told from the next by what it is and not by the handler (the same handler can be set again). */
  let linking: { readonly handler: LinkHandler } | undefined;
  let links: WebLinksAddon | undefined;
  /** The attributes the host asked the input to have, and the names of those set on it: a call replaces what the one before set. */
  let wantedAttributes: Readonly<Record<string, string>> = {};
  let appliedAttributes: readonly string[] = [];

  /**
   * The ONE paste path (#698 item 13): the platform's chord (the browser's paste event, taken in `open`) and the context menu's Paste both end here. xterm 6.0.0 wraps a pasted text in the markers of bracketed paste without
   * sanitising it, so a pasted `ESC [ 201 ~` would end the bracket and what follows would run as typed commands. While the program has bracketed paste on, ESC, ETX and the C1 control CSI (0x9b) are dropped before the wrap
   * (VS Code's and xterm master's sanitising); with it off there is no bracket to end, and the text is the person's. Line endings are the emulator's own (`terminal.paste` makes them carriage returns). One trailing newline is
   * KEPT, as VS Code keeps it in bracketed mode: the program between the markers tells a paste from typing and decides, and a newline cut off silently changes what a pasted line means.
   */
  const pasteText = (text: string): void => {
    pasting = true;
    try {
      terminal.paste(terminal.modes.bracketedPasteMode ? text.replace(UNSAFE_PASTE, '') : text);
    } finally {
      pasting = false;
    }
  };

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
    return pasting || committing || (current !== undefined && Object.hasOwn(PERSON_EVENTS, current.type));
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

  /**
   * The host element says while a program has the alternate screen up (`data-alternate`): the gutter's decorations belong to the normal screen's lines and are hidden by a rule of the stylesheet while it is up (a decoration is the
   * emulator's DOM node and the emulator draws it by the line of its marker, whichever screen is shown).
   */
  const markAlternate = (): void => {
    element?.toggleAttribute('data-alternate', terminal.buffer.active.type === 'alternate');
  };

  const marks = [terminal.onWriteParsed(markScrollable), terminal.onScroll(markScrollable), terminal.buffer.onBufferChange(markAlternate)];
  /** The emulator's own marker behind each one the engine gave out: a decoration is made on it. */
  const rawMarkers = new WeakMap<EngineMarker, IMarker>();

  /** Puts the attributes the host asked for on the input, and takes off those that an earlier call set and this one does not: nothing before the emulator is opened, which has no input yet. */
  const applyAttributes = (): void => {
    const input = terminal.textarea;
    if (input === undefined) {
      return;
    }

    for (const name of appliedAttributes) {
      if (!Object.hasOwn(wantedAttributes, name)) {
        input.removeAttribute(name);
      }
    }

    for (const [name, value] of Object.entries(wantedAttributes)) {
      input.setAttribute(name, value);
    }

    appliedAttributes = Object.keys(wantedAttributes);
  };

  /**
   * Where a link is, for a tooltip: the top left corner of its first cell, in the pixels of the viewport. The link's range is in cells of the buffer (1-based), the screen element has the pixels, and a row of the buffer is
   * in view at its distance from the top of the viewport. With no layout to measure (a screen that has no size) it is the pointer's own place.
   */
  const hoverOf = (event: MouseEvent, uri: string, range: IViewportRange): LinkHover => {
    const screen = terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (screen === undefined || screen.width <= 0 || screen.height <= 0) {
      return { uri, x: event.clientX, y: event.clientY };
    }

    return {
      uri,
      x: screen.left + ((range.start.x - 1) * screen.width) / terminal.cols,
      y: screen.top + ((range.start.y - 1 - terminal.buffer.active.viewportY) * screen.height) / terminal.rows,
    };
  };

  // The hyperlinks a program writes (OSC 8) have a link provider of their own in the emulator, which is always there and acts through this option: with none it asks the person with `confirm` and opens a window, whatever the
  // host thinks of the click. So the emulator has a handler of ours from the start (nothing can be used before the terminal is opened), which gives the click, the pointer and its leaving to the handler the host set, the one the
  // printed addresses go to: the host's rule for a link, the key that is held and the schemes it follows, is one rule for both. It does nothing while the host has set none. Only http and https are offered at all.
  terminal.options.linkHandler = {
    activate: (event, uri) => {
      linking?.handler.activate(uri, event);
    },
    hover: (event, uri, range) => {
      linking?.handler.hover(hoverOf(event, uri, range));
    },
    leave: () => {
      linking?.handler.hover(undefined);
    },
    allowNonHttpProtocols: false,
  };

  /** The character in a cell of the buffer, as the search addon reads a line: an empty cell is nothing (a space to the addon), and the second half of a wide character is the character before it. */
  const characterAt = (row: number, column: number): string => {
    const cell = terminal.buffer.active.getLine(row)?.getCell(column);
    if (cell === undefined) {
      return '';
    }

    return cell.getWidth() === 0 && column > 0 ? characterAt(row, column - 1) : cell.getChars();
  };

  const isWordCharacter = (character: string): boolean => character !== '' && !NON_WORD.includes(character.charAt(0));

  /**
   * Whether a position in the buffer is between two characters of one word: the cell before it and the cell at it are both parts of a word. A position past the last cell of a row is the first cell of the next row when that
   * row continues it, and the first cell of a row that continues the one above has the last cell of that row before it.
   */
  const insideAWord = (row: number, column: number): boolean => {
    const buffer = terminal.buffer.active;
    const continues = column >= terminal.cols && buffer.getLine(row + 1)?.isWrapped === true;
    const at = { row: continues ? row + 1 : row, column: continues ? 0 : column };
    let before = '';
    if (at.column > 0) {
      before = characterAt(at.row, at.column - 1);
    } else if (at.row > 0 && buffer.getLine(at.row)?.isWrapped === true) {
      before = characterAt(at.row - 1, terminal.cols - 1);
    }

    return isWordCharacter(before) && isWordCharacter(characterAt(at.row, at.column));
  };

  /**
   * Whether the selection begins or ends inside a word. The emulator gives its position in 0-based cells with the end past the last selected cell (the search addon reads it so; the typings say 1-based). A whole word is a
   * regular expression, and the addon runs it on the line from the column it starts at, a selection's start going forward and its end going back, so a start inside a word is a start of line to the expression, and an end
   * inside a word an end of line: the rest of the word would be taken for a whole word.
   */
  const selectionIsInsideAWord = (): boolean => {
    const selection = terminal.getSelectionPosition();
    return selection !== undefined && (insideAWord(selection.start.y, selection.start.x) || insideAWord(selection.end.y, selection.end.x));
  };

  /**
   * The finder over the buffer. The search addon is a chunk of its own, fetched here by the first find: nothing of it is in a terminal nobody searches. It is a dynamic import because the code is wanted only when the person
   * searches (the GPU renderer's is the same). It never rejects: a chunk that cannot be had, or an emulator that is gone, is a finder that finds nothing.
   *
   * The addon counts and highlights from the oldest line down and stops at the limit it is given, so a find over more matches than that counts the oldest ones (`capped`): it is given one more than the limit, which is how a
   * find knows it left matches out and is not counted. It tells where the find stands only when it draws decorations, and it does not draw them again when only the options change with the query the same, so a change of
   * option clears them first. A pattern that does not parse throws from the addon; here it finds nothing.
   */
  const loadFinder = async (): Promise<Finder> => {
    if (disposed) {
      return NO_FINDER;
    }

    const listeners = new Set<(state: FindState) => void>();
    const tell = (state: FindState): void => {
      for (const listener of [...listeners]) {
        listener(state);
      }
    };

    let Search: typeof SearchAddon;
    let addon: SearchAddon;
    /** A new addon over the buffer, telling the listeners of the finder what it finds. The match one past the limit is not counted, and the screen on it has no place in the count. */
    const begin = (): SearchAddon => {
      const made = new Search({ highlightLimit: limit + 1 });
      terminal.loadAddon(made);
      made.onDidChangeResults(({ resultIndex, resultCount }) => {
        tell({ index: resultIndex < limit ? resultIndex : -1, count: Math.min(resultCount, limit), capped: resultCount > limit });
      });
      return made;
    };

    try {
      ({ SearchAddon: Search } = await import('@xterm/addon-search'));
      if (disposed) {
        return NO_FINDER;
      }

      addon = begin();
    } catch {
      return NO_FINDER;
    }

    /**
     * Takes the find down: the highlights, the selection and the term the addon remembers. The addon looks again 200 ms after the last write, from a timer of its own that only its disposal cancels, and one that was waiting
     * when the find went would run with no term and clear the selection the person made after it. So the addon is disposed (its highlights with it) and a new one takes its place.
     */
    const forget = (): void => {
      if (disposed) {
        return;
      }

      addon.dispose();
      terminal.clearSelection();
      addon = begin();
    };

    /** The options of the last step, to see that they changed, and the find that is up, to draw it again for a new theme: its query and options, and the colours it was drawn in. Nothing while there is none. */
    let last: FindOptions | undefined;
    let active: { readonly query: string; readonly options: FindOptions; readonly colours: string } | undefined;
    const step = (direction: 'next' | 'previous', query: string, given: FindOptions): void => {
      // An emulator that is gone has nothing to find, and the addon would read it: xterm registers what it reads on a store it has disposed of, and leaks it.
      if (disposed) {
        tell(NOTHING);
        return;
      }

      const changed = last !== undefined && (last.caseSensitive !== given.caseSensitive || last.regex !== given.regex || last.wholeWord !== given.wholeWord);
      last = given;
      const decorations = findDecorations(theme);
      active = query === '' ? undefined : { query, options: given, colours: JSON.stringify(decorations) };
      try {
        if (changed) {
          addon.clearDecorations();
        }

        const whole = given.wholeWord && query !== '';
        const searching = { caseSensitive: given.caseSensitive, regex: given.regex || whole, wholeWord: false, decorations };
        const term = whole ? wholeWordPattern(query, given.regex) : query;
        // A selection inside a word is let go of, so that the step starts from the edge of the buffer; one at the edges of a word stays, and the step goes on from it.
        if (whole && selectionIsInsideAWord()) {
          terminal.clearSelection();
        }

        if (direction === 'next') {
          addon.findNext(term, searching);
        } else {
          addon.findPrevious(term, searching);
        }
      } catch {
        active = undefined;
        forget();
        tell(NOTHING);
      }
    };

    /**
     * Draws the find again in the colours of the theme the emulator has now. The addon draws the matches once for a query and does not draw them again for the same query, so a new theme would leave every match but the
     * current one in the colours before until the query changed: the highlights are cleared and the query is found again from the selection, which is the current match, so that it stays; and the viewport stays where the
     * person scrolled it (finding scrolls to the match when it is out of view). A new look that leaves the colours as they were (a new text size) draws nothing again.
     */
    redrawFind = () => {
      if (active === undefined || active.colours === JSON.stringify(findDecorations(theme))) {
        return;
      }

      const { query, options: given } = active;
      const top = terminal.buffer.active.viewportY;
      addon.clearDecorations();
      step('next', query, given);
      terminal.scrollToLine(top);
    };

    return {
      next: (query, given) => {
        step('next', query, given);
      },
      previous: (query, given) => {
        step('previous', query, given);
      },
      clear: () => {
        active = undefined;
        last = undefined;
        forget();
        tell(NOTHING);
      },
      onChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  };

  return {
    open: (host) => {
      element = host;
      terminal.open(host);
      markAlternate();
      calibrate();
      applyAttributes();
      // The emulator's own paste handler is never reached: this one takes the event first (capture, at the host) and stops it, so a paste is made once, by `pasteText`.
      host.addEventListener(
        'paste',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (text !== '') {
            pasteText(text);
          }
        },
        true,
      );
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

    onBinary: (listener) => {
      const subscription = terminal.onBinary((data) => {
        // xterm hands the bytes as a string of one char for each byte (0 to 255): the shell must read those bytes, and not the UTF-8 of the chars.
        const bytes = new Uint8Array(data.length);
        for (let at = 0; at < data.length; at += 1) {
          bytes[at] = data.charCodeAt(at) & 0xff;
        }

        listener(bytes);
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
      theme = next.theme;
      terminal.options.theme = themeOf(next);
      terminal.options.fontFamily = next.fontFamily;
      terminal.options.fontSize = next.fontSize;
      pitch = pitchOf(next);
      calibrate();
      redrawFind?.();
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

      // The addon is made once for a terminal and kept while the screen is hidden: in addon-webgl 0.19.0 `dispose()` does not release the GL context (WebKit allows 16 live ones in a page), so a hiding that
      // disposed it would leak one context for every showing. A hidden terminal is not on screen, and the emulator's own render service pauses what is not intersecting, so it draws nothing there. The addon goes on
      // a lost context and with the terminal; a terminal that lost two, or could not make one twice, stays on the DOM's renderer for its life.
      renderer = next;
      if (next === 'dom' || gpu !== undefined) {
        return;
      }

      if (gpuFailures >= GPU_FAILURES) {
        renderer = 'dom';
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
            gpuFailures += 1;
          }
        });
        terminal.loadAddon(addon);
        gpu = addon;
        calibrate();
      } catch {
        // No chunk, or no context: the DOM's renderer stays, and draws the same screen.
        renderer = 'dom';
        gpu = undefined;
        gpuFailures += 1;
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

    find: async () => (finder ??= loadFinder()),

    mouseReporting: () => terminal.modes.mouseTrackingMode !== 'none',

    paste: pasteText,

    decorateInput: (attributes) => {
      wantedAttributes = attributes;
      applyAttributes();
    },

    setLinks: (handler) => {
      links?.dispose();
      links = undefined;
      linking = handler === undefined ? undefined : { handler };
      const setting = linking;
      if (setting === undefined) {
        return;
      }

      // Its own handler, never the addon's default (which opens a window): a click is the host's to judge. The addon is activated by hand, so that a handler that changes does not leave a spent addon in the emulator's list.
      // The emulator keeps the link under the pointer when the addon goes (a press and a release on its cell, with no move, would still reach it), so what it calls is heard only while its setting is the current one.
      const addon: WebLinksAddon = new WebLinksAddon(
        (event, uri) => {
          if (linking === setting) {
            setting.handler.activate(uri, event);
          }
        },
        {
          hover: (event, uri, range) => {
            if (linking === setting) {
              setting.handler.hover(hoverOf(event, uri, range));
            }
          },
          leave: () => {
            if (linking === setting) {
              setting.handler.hover(undefined);
            }
          },
        },
      );
      links = addon;
      addon.activate(terminal);
    },

    mark: () => {
      if (disposed || terminal.buffer.active.type === 'alternate') {
        return undefined;
      }

      const raw = terminal.registerMarker(0);
      if (raw === undefined) {
        return undefined;
      }

      const marker: EngineMarker = {
        line: () => (raw.isDisposed ? -1 : raw.line),
        onDispose: (listener) => {
          if (raw.isDisposed) {
            listener();
            return () => undefined;
          }

          const subscription = raw.onDispose(listener);
          return () => {
            subscription.dispose();
          };
        },
        dispose: () => {
          raw.dispose();
        },
      };
      rawMarkers.set(marker, raw);
      return { marker, column: terminal.buffer.active.cursorX };
    },

    decorate: (marker, paint) => {
      const raw = rawMarkers.get(marker);
      if (disposed || raw === undefined || raw.isDisposed) {
        return undefined;
      }

      const decoration = terminal.registerDecoration({ marker: raw, x: 0, width: 1, height: 1 });
      if (decoration === undefined) {
        return undefined;
      }

      // The emulator hands the element when it draws the decoration, and again when it draws it anew.
      decoration.onRender(paint);
      if (decoration.element !== undefined) {
        paint(decoration.element);
      }

      return {
        refresh: () => {
          if (decoration.element !== undefined) {
            paint(decoration.element);
          }
        },
        dispose: () => {
          decoration.dispose();
        },
      };
    },

    cursor: () => {
      const buffer = terminal.buffer.active;
      return { line: buffer.baseY + buffer.cursorY, column: buffer.cursorX };
    },

    viewport: () => {
      const buffer = terminal.buffer.active;
      return { top: buffer.viewportY, rows: terminal.rows, atBottom: buffer.viewportY >= buffer.baseY };
    },

    lines: (from, to) => {
      const buffer = terminal.buffer.active;
      const out: string[] = [];
      for (let index = Math.max(0, from); index < Math.min(to, buffer.length); index += 1) {
        const line = buffer.getLine(index);
        if (line === undefined) {
          continue;
        }

        // A row that the next one continues is full, so its end is part of the text; the end of the last row of a logical line is trimmed below.
        const text = line.translateToString(false);
        if (line.isWrapped && out.length > 0 && index > from) {
          out[out.length - 1] = `${out[out.length - 1] ?? ''}${text}`;
        } else {
          out.push(text);
        }
      }

      return out.map((text) => text.trimEnd()).join('\n');
    },

    selectLines: (from, to) => {
      const last = Math.min(to, terminal.buffer.active.length) - 1;
      if (last >= from && from >= 0) {
        terminal.selectLines(from, last);
      }
    },

    scrollTo: (line) => {
      terminal.scrollToLine(Math.max(0, line));
    },

    scrollToBottom: () => {
      terminal.scrollToBottom();
    },

    alternate: () => terminal.buffer.active.type === 'alternate',

    dispose: () => {
      disposed = true;
      links?.dispose();
      links = undefined;
      linking = undefined;
      gpu?.dispose();
      gpu = undefined;
      for (const mark of marks) {
        mark.dispose();
      }

      terminal.dispose();
    },
  };
}
