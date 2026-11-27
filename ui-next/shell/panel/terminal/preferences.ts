import type { HostSnapshot, SettingsClient } from '../../settings/model/types';

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

/** The defaults the host declares, which a terminal is made with until the host has answered (and when it cannot). `cursorBlink` is the new tool's: the host declares `cursorBlinkNext` off, and the legacy `cursorBlink` stays on. */
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

/**
 * A list of font names, or nothing when it is anything else. The value reaches the font string of the emulator's canvas, so it is names and nothing more: each is letters, digits, spaces, dots, hyphens and underscores, in one
 * pair of quotes or none, with commas between; no semicolon, no function (`url(...)`), no brace, no backslash, no line break. The same rule as the host's (`validateTerminalFontFamily`). It answers the list in a plain form
 * (a space around a comma is one space).
 */
export function sanitiseFontFamily(value: unknown): string {
  if (typeof value !== 'string' || value.length > BOUNDS.fontFamily || value.trim() === '') {
    return '';
  }

  const names: string[] = [];
  for (const part of value.split(',')) {
    const name = part.trim();
    const quote = name.at(0);
    const bare = name.length >= 2 && (quote === '"' || quote === '\'') && name.endsWith(quote) ? name.slice(1, -1) : name;
    if (bare.trim() === '' || !/^[\p{L}\p{N} ._-]+$/u.test(bare)) {
      return '';
    }

    names.push(name);
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
    cursorBlink: read('cursorBlinkNext') === true,
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

export type PreferencesSourceOptions = Pick<SettingsClient, 'snapshot' | 'onChanged' | 'onReconnect'> & {
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
  let answered!: () => void;
  const first = new Promise<void>((resolve) => {
    answered = resolve;
  });
  let askedOnce = false;

  const ask = (): void => {
    asked += 1;
    const mine = asked;
    askedOnce = true;
    client.snapshot().then(
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

        answered();
      },
      (error: unknown) => {
        if (mine === asked) {
          warn('[terminal] the terminal settings could not be read', error);
          answered();
        }
      },
    );
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        stopChanged = client.onChanged(ask);
        stopReconnect = client.onReconnect?.(ask);
        ask();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopChanged?.();
          stopChanged = undefined;
          stopReconnect?.();
          stopReconnect = undefined;
          // The host replays nothing: what is held may be stale by the next listener, who asks again. An answer still on its way is no longer wanted.
          asked += 1;
        }
      };
    },
    getSnapshot: () => current,
    settled: async () => {
      if (!askedOnce) {
        ask();
      }

      // A host that does not answer does not hold the terminal: the settings are the defaults until it does (an answer that comes later is taken as any other).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SETTLE_MS);
      });
      try {
        await Promise.race([first, late]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** The store of the app: the host's settings service, loaded with the first ask (the settings client is a lazy chunk, the sheet's). */
export function appTerminalPreferences(): PreferencesSource {
  // The settings client is the sheet's lazy chunk: the page that has no terminal never loads it, so it is imported with the first question and not before.
  let held: Promise<SettingsClient> | undefined;
  const client = async (): Promise<SettingsClient> => {
    held ??= import('../../settings/runtime').then(({ runtimeClient }) => runtimeClient());
    return held;
  };

  return createTerminalPreferences({
    snapshot: async () => (await client()).snapshot(),
    onChanged: (listener) => {
      let stop: (() => void) | undefined;
      let left = false;
      void client().then((settings) => {
        if (!left) {
          stop = settings.onChanged(listener);
          // The host does not replay a change made before this listener was registered: ask again now that it is.
          listener();
        }
      });
      return () => {
        left = true;
        stop?.();
      };
    },
    onReconnect: (listener) => {
      let stop: (() => void) | undefined;
      let left = false;
      void client().then((settings) => {
        if (!left) {
          stop = settings.onReconnect?.(listener);
        }
      });
      return () => {
        left = true;
        stop?.();
      };
    },
  });
}
