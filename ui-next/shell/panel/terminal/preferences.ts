import { HOST_SCOPE, type HostSnapshot, type SettingsClient } from '../../settings/model/types';

// The terminal's settings as the page reads them (#697 step 1, docs/ui-next/status/T6-settings.md). The host declares them and holds their bounds (`internal/settings/terminal.go`, category `terminal`); the page does not
// decide a default or a bound of its own that the host does not state, and it still reads every value as one inside those bounds, because a snapshot may carry a value an older host or a file edited by hand let in.
//
// The store keeps the last snapshot for as long as something listens. It holds no listener on the host's event, no timer and no request while nobody listens. A change is ONE event of the host and ONE question of its snapshot,
// and the screens are told only when a value the terminal reads moved: the object they hold is the same until then.

export type CursorStyle = 'block' | 'underline' | 'bar';
export type Tristate = 'auto' | 'on' | 'off';
export type PasteWarning = 'auto' | 'always' | 'never';

/** What the terminal reads of the host's settings. */
export type TerminalPreferences = {
  /** Font names tried before the theme's own face; empty is the theme's face alone. */
  readonly fontFamily: string;
  /** In pixels (the text scale of the theme multiplies it). */
  readonly fontSize: number;
  /** A multiple of the font size. */
  readonly lineHeight: number;
  /** Lines kept above the screen when the emulator is made. */
  readonly scrollback: number;
  readonly cursorStyle: CursorStyle;
  readonly cursorBlink: boolean;
  readonly macOptionIsMeta: Tristate;
  readonly bell: 'off' | 'visual';
  readonly gpuAcceleration: Tristate;
  readonly copyOnSelect: boolean;
  readonly multiLinePasteWarning: PasteWarning;
};

/** The defaults the host declares, which a terminal is made with until the host has answered (and when it cannot). `cursorBlink` is the new tool's: the host declares `blinkingCursor` off, and the legacy `cursorBlink` stays on. */
export const DEFAULT_PREFERENCES: TerminalPreferences = Object.freeze({
  fontFamily: '',
  fontSize: 12,
  lineHeight: 1.5,
  scrollback: 5000,
  cursorStyle: 'block',
  cursorBlink: false,
  macOptionIsMeta: 'auto',
  bell: 'visual',
  gpuAcceleration: 'auto',
  copyOnSelect: false,
  multiLinePasteWarning: 'auto',
});

/** The host's bounds (`internal/settings/terminal.go`). */
const BOUNDS = Object.freeze({ fontSize: { min: 6, max: 72 }, lineHeight: { min: 1, max: 2 }, scrollback: { min: 0, max: 100_000 }, fontFamily: 256 });

/** The generic families of CSS: written bare, as the keyword is. Every other name is written in quotes. */
const GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'];

/** The words CSS reserves in a font list: unquoted they are not a family (`inherit` makes the whole declaration invalid, and the canvas keeps the old font), and the host refuses them (`reservedFontWords`). */
const RESERVED_WORDS = ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'];

/**
 * A list of font names, or nothing when it is anything else. The value reaches the font string of the emulator's canvas, so it is names and nothing more: each is letters, digits, spaces, dots, hyphens and underscores, in one
 * pair of quotes or none, with commas between; no semicolon, no function (`url(...)`), no brace, no backslash, no line break; no CSS-wide keyword. The same rule as the host's (`validateTerminalFontFamily`). It answers
 * the list in the form CSS reads whatever the person typed: every name that is not a generic family in double quotes (`0xProto` and `3270 Nerd Font` are not identifiers, and unquoted they are no font at all, and the
 * font load throws), a space around a comma gone.
 */
export function sanitiseFontFamily(value: unknown): string {
  return typeof value === 'string' && value.length <= BOUNDS.fontFamily ? canonicalFontFamily(value) : '';
}

/**
 * The same rule without the length limit, which is the RAW input's (the host holds it): the canonical form that `sanitiseFontFamily` answers is longer than what was typed (every name gets quotes), and is a value
 * the host accepted, so a second pass over it must keep it. A value that is not names is still nothing.
 */
export function canonicalFontFamily(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return '';
  }

  const names: string[] = [];
  for (const part of value.split(',')) {
    const name = part.trim();
    const quote = name.at(0);
    const bare = (name.length >= 2 && (quote === '"' || quote === '\'') && name.endsWith(quote) ? name.slice(1, -1) : name).trim();
    if (bare === '' || !/^[\p{L}\p{N} ._-]+$/u.test(bare) || RESERVED_WORDS.includes(bare.toLowerCase())) {
      return '';
    }

    names.push(GENERIC_FAMILIES.includes(bare.toLowerCase()) && name === bare ? bare.toLowerCase() : `"${bare}"`);
  }

  return names.join(', ');
}

const whole = (value: unknown, min: number, max: number, fallback: number): number => (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback);

const inRange = (value: unknown, min: number, max: number, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback);

function oneOf<T extends string>(value: unknown, words: readonly T[], fallback: T): T {
  return words.find((word) => word === value) ?? fallback;
}

/** The terminal's settings of a host snapshot: each a value inside the producer's bounds, the declared default for what is missing or outside them. */
export function preferencesOf(snapshot: HostSnapshot | undefined): TerminalPreferences {
  const held = snapshot?.categories.terminal?.settings;
  const read = (id: string): unknown => {
    const entry = held?.[id];
    return entry?.value ?? entry?.default ?? undefined;
  };

  const defaults = DEFAULT_PREFERENCES;
  return {
    fontFamily: sanitiseFontFamily(read('fontFamily')),
    fontSize: whole(read('fontSize'), BOUNDS.fontSize.min, BOUNDS.fontSize.max, defaults.fontSize),
    lineHeight: inRange(read('lineHeight'), BOUNDS.lineHeight.min, BOUNDS.lineHeight.max, defaults.lineHeight),
    scrollback: whole(read('scrollback'), BOUNDS.scrollback.min, BOUNDS.scrollback.max, defaults.scrollback),
    cursorStyle: oneOf(read('cursorStyle'), ['block', 'underline', 'bar'], defaults.cursorStyle),
    cursorBlink: read('blinkingCursor') === true,
    macOptionIsMeta: oneOf(read('macOptionIsMeta'), ['auto', 'on', 'off'], defaults.macOptionIsMeta),
    bell: oneOf(read('bell'), ['off', 'visual'], defaults.bell),
    gpuAcceleration: oneOf(read('gpuAcceleration'), ['auto', 'on', 'off'], defaults.gpuAcceleration),
    copyOnSelect: read('copyOnSelect') === true,
    multiLinePasteWarning: oneOf(read('multiLinePasteWarning'), ['auto', 'always', 'never'], defaults.multiLinePasteWarning),
  };
}

/** How long the first answer of the host is waited for. */
const SETTLE_MS = 1_500;

const KEYS = Object.keys(DEFAULT_PREFERENCES) as ReadonlyArray<keyof TerminalPreferences>;

const same = (a: TerminalPreferences, b: TerminalPreferences): boolean => KEYS.every((key) => a[key] === b[key]);

/** What a screen reads: the settings now, and when they change. */
export type PreferencesSource = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TerminalPreferences;
  /**
   * Resolves when the host has answered the first time (or could not), so that a terminal is made in the person's settings and not in the defaults: a font that is not the default is loaded and measured before the first cell is
   * drawn. It asks the host once, if nobody has.
   */
  readonly settled: () => Promise<void>;
};

/** The settings with nothing behind them: the defaults, forever. For a body that is given no host (a test, a probe that has none). */
export const DEFAULT_PREFERENCES_SOURCE: PreferencesSource = Object.freeze({
  subscribe: () => () => undefined,
  getSnapshot: () => DEFAULT_PREFERENCES,
  settled: async () => Promise.resolve(),
});

export type PreferencesSourceOptions = {
  /** The host's snapshot of its own settings. */
  readonly snapshot: () => Promise<HostSnapshot>;
  /** Listens for a change of the HOST's settings (a plugin's are not the terminal's). Answers the function that stops it. */
  readonly onChanged: (listener: () => void) => () => void;
  readonly onReconnect?: SettingsClient['onReconnect'];
  /** False while the host's events could not be registered for a listener that is waiting for them: `settled()` then asks again, which is how the registration is tried again. Default: always true. */
  readonly healthy?: () => boolean;
  /** Where the page says what it could not do. Default: the console. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

const warnOnConsole = (message: string, error?: unknown): void => {
  console.warn(message, error);
};

/** The store of the terminal's settings over the host's settings client. */
export function createTerminalPreferences(client: PreferencesSourceOptions): PreferencesSource {
  const warn = client.warn ?? warnOnConsole;
  const listeners = new Set<() => void>();
  let current = DEFAULT_PREFERENCES;
  let asked = 0;
  let stopChanged: (() => void) | undefined;
  let stopReconnect: (() => void) | undefined;
  /** The question on its way, if any, and the promise of its end (an answer, or the host's failure). */
  let inflight: Promise<void> | undefined;

  const ask = async (): Promise<void> => {
    asked += 1;
    const mine = asked;
    const done = client.snapshot().then(
      (snapshot) => {
        if (mine !== asked) {
          return;
        }

        const next = preferencesOf(snapshot);
        if (!same(next, current)) {
          current = next;
          for (const listener of [...listeners]) {
            if (listeners.has(listener)) {
              listener();
            }
          }
        }
      },
      (error: unknown) => {
        if (mine === asked) {
          warn('[terminal] the terminal settings could not be read', error);
        }
      },
    );
    const mineDone = done.then(() => {
      if (inflight === mineDone) {
        inflight = undefined;
      }
    });
    inflight = mineDone;
    return mineDone;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        stopChanged = client.onChanged(ask);
        stopReconnect = client.onReconnect?.(ask);
        // A question already on its way (a terminal waiting to be made asked it) is the answer this listener needs.
        if (inflight === undefined) {
          void ask();
        }
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopChanged?.();
          stopChanged = undefined;
          stopReconnect?.();
          stopReconnect = undefined;
        }
      };
    },
    getSnapshot: () => current,
    settled: async () => {
      // With someone listening the snapshot is kept current by the host's events and the question of the first listener has been answered or is on its way. With nobody listening (the last terminal was closed) what is held may be stale,
      // because the host replays nothing: the next terminal asks again and waits for the answer.
      if (listeners.size === 0 || client.healthy?.() === false) {
        void ask();
      }

      // Until no question is on its way: a newer question replaces the one this waited for, and the older answer is dropped without being published.
      const answer = (async () => {
        while (inflight !== undefined) {
          await inflight;
        }
      })();
      // A host that does not answer does not hold the terminal: the settings are the defaults until it does (an answer that comes later is taken as any other).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SETTLE_MS);
      });
      try {
        await Promise.race([answer, late]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** The store of the app: the host's settings service, loaded with the first ask (the settings client is a lazy chunk, the sheet's). `load` is where the client comes from: the lazy chunk by default, a test gives its own. */
export function appTerminalPreferences(load: () => Promise<SettingsClient> = async () => import('../../settings/runtime').then(({ runtimeClient }) => runtimeClient())): PreferencesSource {
  // The settings client is the sheet's lazy chunk: the page that has no terminal never loads it, so it is loaded with the first question and not before.
  let held: Promise<SettingsClient> | undefined;
  const client = async (): Promise<SettingsClient> => {
    held ??= load();
    try {
      return await held;
    } catch (error) {
      // A chunk that failed to load is tried again by the next question, and not kept as the answer for the rest of the session.
      held = undefined;
      throw error;
    }
  };

  /** The host's events for the listener the store has (`wanted`): registered once the client is there, and again by the next question when it could not be. */
  let wanted: (() => void) | undefined;
  let stops: Array<(() => void) | undefined> = [];
  let registering = false;
  const registered = (): boolean => stops.length > 0;

  const register = async (): Promise<void> => {
    const want = wanted;
    if (want === undefined || registered() || registering) {
      return;
    }

    registering = true;
    try {
      const settings = await client();
      // Gone, or registered by another turn, while the client loaded.
      if (wanted === want && !registered()) {
        stops = [
          settings.onChanged((scope) => {
            if (scope.kind === 'host') {
              want();
            }
          }),
          settings.onReconnect?.(want),
        ];
        // The host replays nothing: what changed before the registration is asked for now.
        want();
      }
    } catch (error) {
      warnOnConsole('[terminal] the terminal settings could not be listened to', error);
    } finally {
      registering = false;
    }
  };

  return createTerminalPreferences({
    snapshot: async () => {
      const settings = await client();
      // A question is the way back from a registration that failed: the client is there now.
      void register();
      return settings.snapshot(HOST_SCOPE);
    },
    onChanged: (listener) => {
      wanted = listener;
      void register();
      return () => {
        wanted = undefined;
        for (const stop of stops) {
          stop?.();
        }

        stops = [];
      };
    },
    // The reconnect is registered with the change event, for the same listener.
    onReconnect: () => () => undefined,
    healthy: () => wanted === undefined || registered(),
  });
}
