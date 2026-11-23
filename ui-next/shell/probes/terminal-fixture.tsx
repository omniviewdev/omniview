// The real plugin host with NO plugin and a synthetic shell, for the Terminal probe (terminal-probe.mjs): `PluginHost` is the product's own, the Terminal tool in it is the product's own (the registry, the feed
// over an exec transport, the screen controller, xterm in its lazy chunk, the close guard and its dialog); only the far end of the transport is invented: a pty that echoes what is typed, runs a few commands
// with known output and ends when told. A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
// The synthetic shell starts at 72 columns by 27 rows, as the host's does (docs/ui-next/status/T1.md, section 6). Commands (type them and press Enter):
//   hello           prints a known line                     size            prints "<rows> <cols>" of the pty (what the last resize said)
//   colors          prints the 16 colours of the palette    flood N [W]     prints N lines of W columns (default 80), in events of about 1,000 bytes, as the host's pty reads come
//   exit [code]     prints "logout" and ends the session    fail            ends the session with an error signal
//   (anything else) prints "synthetic: command not found: <word>"
//
//   ?renderer=dom   the emulator keeps its DOM renderer (text a probe can read); the default is the GPU's while the terminal is on screen, as the product is
//   ?control=<name> the negative controls that perturb the emulator: echo-slow, big-scrollback, leaky-heap, and the two of the screen reader switch, reader-claims (the emulator is never put in screen reader mode while the window says it is)
//                   and reader-stuck (it is put in it and never taken out of it)
//
// `window.__pty` is what the probe reads and drives: `log` (what was created, written, resized, closed, every listener count), `out(id, text)` (the shell writes text now), `end(id)` (the process ends),
// `ids()`. `window.__commits` lists every commit of the tree (React's profiler; the probe builds this entry with the profiling build of React DOM).
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider } from '@omniviewdev/kit';
import { Profiler, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginHost } from '../../plugins/host/PluginHost';
import type { PluginEntry } from '../../plugins/host/pluginStore';
import type { PluginSource } from '../../plugins/host/contributions';
import { PANEL_HOST } from '../index';
import { decodeBase64, encodeInput } from '../panel/terminal/bytes';
import type { EngineLoader } from '../panel/terminal/engine';
import { createExecFeed, signalEvent, streamEvent, type ExecTransport } from '../panel/terminal/execFeed';
import type { TerminalTarget } from '../panel/terminal/feed';
import { loadXtermEngine } from '../panel/terminal/loadEngine';

type Pty = { rows: number; cols: number; line: string };

const params = new URLSearchParams(window.location.search);
const ptys = new Map<string, Pty>();
const listeners = new Map<string, Set<(data: unknown) => void>>();
const log = {
  created: [] as string[],
  writes: [] as string[],
  resizes: [] as Array<{ id: string; rows: number; cols: number; at: number }>,
  closed: [] as string[],
  floods: [] as Array<{ id: string; lines: number; bytes: number }>,
  /** The instant each flood began, where `floods` has one entry for each that ended: the probe asks for both, so that a flood that never started is not taken for one that is still running. */
  floodStarts: [] as Array<{ id: string; at: number }>,
  /** The instant each write reached the shell (`performance.now()`): the end of an input's latency. */
  writeAt: [] as number[],
};

const emit = (name: string, data: unknown): void => {
  for (const listener of [...(listeners.get(name) ?? [])]) {
    listener(data);
  }
};

/** What `?control=leaky-heap` keeps: every event the shell wrote, as a page that held on to its output would (the negative control of the probe's heap assertion). */
const leak: string[] = [];

const out = (id: string, text: string): void => {
  const encoded = encodeInput(text);
  if (control === 'leaky-heap') {
    leak.push(encoded);
  }

  emit(streamEvent(id, 'stdout'), encoded);
};

const PROMPT = '\u001b[32muser@synthetic\u001b[0m:\u001b[34m~\u001b[0m$ ';

function colors(id: string): void {
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  for (const base of [30, 90]) {
    out(id, `${names.map((name, index) => `\u001b[${String(base + index)}m${name.padEnd(8)}\u001b[0m`).join(' ')}\r\n`);
  }

  out(id, '\u001b[1mbold\u001b[0m \u001b[2mdim\u001b[0m \u001b[3mitalic\u001b[0m \u001b[4munderline\u001b[0m \u001b[7minverse\u001b[0m\r\n');
}

/** N lines of W columns, in events of about 1,000 bytes, a batch of events a task so the page is never held for the whole flood. */
function flood(id: string, lines: number, width: number): void {
  const perEvent = Math.max(1, Math.floor(1000 / (width + 2)));
  log.floodStarts.push({ id, at: performance.now() });
  let next = 0;
  let bytes = 0;
  const step = (): void => {
    for (let batch = 0; batch < 40 && next < lines; batch += 1) {
      const count = Math.min(perEvent, lines - next);
      let text = '';
      for (let at = 0; at < count; at += 1) {
        text += `${String(next + at).padStart(7, '0')} ${'x'.repeat(Math.max(0, width - 8))}\r\n`;
      }

      bytes += text.length;
      next += count;
      out(id, text);
    }

    if (next < lines) {
      setTimeout(step, 0);
      return;
    }

    log.floods.push({ id, lines, bytes });
    out(id, PROMPT);
  };

  step();
}

function run(id: string, pty: Pty, command: string): void {
  const [word = '', ...args] = command.trim().split(/\s+/);
  switch (word) {
    case '':
      break;
    case 'hello':
      out(id, 'hello from the synthetic shell\r\n');
      break;
    case 'size':
      out(id, `${String(pty.rows)} ${String(pty.cols)}\r\n`);
      break;
    case 'colors':
      colors(id);
      break;
    case 'flood':
      flood(id, Number(args[0] ?? 1000), Number(args[1] ?? 80));
      return;
    case 'exit':
      out(id, 'logout\r\n');
      setTimeout(() => {
        emit(signalEvent(id, 'CLOSE'), 'Session terminated');
      }, 5);
      return;
    case 'fail':
      emit(signalEvent(id, 'ERROR'), { title: 'Connection lost', message: 'The shell stopped answering' });
      return;
    default:
      out(id, `synthetic: command not found: ${word}\r\n`);
  }

  out(id, PROMPT);
}

/** What the user typed, as the pty's line discipline would take it: echo, backspace, interrupt, a line at Enter. Escape sequences (arrows) are dropped. */
function typed(id: string, pty: Pty, data: string): void {
  for (const ch of data.replace(/\u001b\[[0-9;?]*[A-Za-z~]/g, '').replace(/\u001b/g, '')) {
    if (ch === '\r') {
      out(id, '\r\n');
      const line = pty.line;
      pty.line = '';
      run(id, pty, line);
    } else if (ch === '\u007f') {
      if (pty.line !== '') {
        pty.line = pty.line.slice(0, -1);
        out(id, '\b \b');
      }
    } else if (ch === '\u0003') {
      pty.line = '';
      out(id, `^C\r\n${PROMPT}`);
    } else if (ch >= ' ') {
      pty.line += ch;
      out(id, ch);
    }
  }
}

const transport: ExecTransport = {
  create: async (id, size) => {
    // The pty opens at the size the view measured (the backend's `launch`); the log keeps it as the first size the pty was given.
    ptys.set(id, { rows: size.rows, cols: size.cols, line: '' });
    log.resizes.push({ id, rows: size.rows, cols: size.cols, at: performance.now() });
    log.created.push(id);
    setTimeout(() => {
      out(id, `\u001b[90mSynthetic shell: hello, size, colors, flood N [W], exit [code], fail\u001b[0m\r\n${PROMPT}`);
    }, 20);
  },
  write: async (id, base64) => {
    const text = new TextDecoder().decode(decodeBase64(base64));
    log.writes.push(text);
    log.writeAt.push(performance.now());
    const pty = ptys.get(id);
    if (pty !== undefined) {
      typed(id, pty, text);
    }
  },
  resize: async (id, rows, cols) => {
    log.resizes.push({ id, rows, cols, at: performance.now() });
    const pty = ptys.get(id);
    if (pty !== undefined) {
      pty.rows = rows;
      pty.cols = cols;
    }
  },
  close: async (id) => {
    log.closed.push(id);
    ptys.delete(id);
    setTimeout(() => {
      emit(signalEvent(id, 'CLOSE'), 'Session terminated');
    }, 5);
  },
  on: (name, listener) => {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
    return () => {
      set.delete(listener);
    };
  },
  describe: (error) => (error instanceof Error ? error.message : String(error)),
  isGone: () => false,
};

const target = (): TerminalTarget => ({ plugin: PANEL_HOST, id: 'synthetic', title: 'Terminal', open: () => createExecFeed({ transport }) });

/** Burns the main thread for `ms` milliseconds: what a janky renderer or a slow handler does, for the probe's negative controls. */
const burn = (ms: number): void => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // spin
  }
};

/**
 * What the emulator was given and what it parsed, for the probe (`window.__engine`): the bytes accepted by `write` and the bytes whose callback has run, the instant of the last write, the instants of what the
 * user typed, and the renderers asked for in order. The GPU draws on a canvas: this is the only record of what reached it.
 */
const stats = { writes: 0, accepted: 0, parsed: 0, lastWriteAt: 0, typedAt: [] as number[], renderers: [] as string[], engines: 0, grid: (): { cols: number; rows: number } => ({ cols: 0, rows: 0 }) };

/**
 * The emulator is the product's own, wrapped to keep `stats`. `?renderer=dom` keeps its DOM renderer for the whole life of the terminal (the GPU's is never asked for): its rows are text a probe can read, where the
 * GPU's canvas is not; the default is the product's own, the GPU while the terminal is on screen. `?control=echo-slow` is the negative control of the probe's latency assertion: a handler that takes 80 ms for each
 * key typed. `?control=reader-claims` and `?control=reader-stuck` are the negative controls of the screen reader assertions: an emulator that ignores the window's choice (it is never in screen reader mode, so the printed
 * lines are not in the accessibility tree while the store and the description say they are) and one that ignores only the choice to turn it off (the lines stay in the tree).
 */
const control = params.get('control');
const load: EngineLoader = async () => {
  const create = await loadXtermEngine();
  return (options) => {
    // `?control=big-scrollback` is the negative control of the probe's scrollback cap: an emulator that keeps four times the lines. `?control=reader-claims` makes it in the mode the person did not choose (off) whatever the window says.
    const engine = create(control === 'big-scrollback' ? { ...options, scrollback: 20_000 } : control === 'reader-claims' ? { ...options, screenReaderMode: false } : options);
    stats.engines += 1;
    stats.grid = () => engine.size();
    return {
      ...engine,
      write: (data, done) => {
        const size = typeof data === 'string' ? data.length : data.byteLength;
        stats.writes += 1;
        stats.accepted += size;
        stats.lastWriteAt = performance.now();

        engine.write(data, () => {
          stats.parsed += size;
          done?.();
        });
      },
      onData: (listener) =>
        engine.onData((data) => {
          stats.typedAt.push(performance.now());
          if (control === 'echo-slow') {
            burn(80);
          }

          listener(data);
        }),
      setScreenReaderMode: (on) => {
        if (control === 'reader-claims' || (control === 'reader-stuck' && !on)) {
          return;
        }

        engine.setScreenReaderMode(on);
      },
      setRenderer: async (renderer) => {
        stats.renderers.push(renderer);
        if (params.get('renderer') !== 'dom') {
          await engine.setRenderer(renderer);
        }
      },
    };
  };
};

const NONE: readonly PluginEntry[] = [];
const plugins: PluginSource = { getSnapshot: () => NONE, subscribe: () => () => undefined };

const commits: Array<{ phase: string; actualDuration: number }> = [];
Object.assign(window, {
  __commits: commits,
  __engine: stats,
  __pty: {
    log,
    out: (id: string, text: string) => {
      out(id, text);
      chunkListeners.forEach((listener) => {
        listener();
      });
    },
    ids: () => [...ptys.keys()],
    end: (id: string) => {
      emit(signalEvent(id, 'CLOSE'), 'Session terminated');
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    /** How many events `?control=leaky-heap` holds on to. */
    leaked: () => leak.length,
  },
});

/**
 * `?control=chunk-commit` is the negative control of the probe's "no React commit for an output chunk" assertion: a component of the page that renders for every chunk the shell writes, as a view that kept
 * the output in React state would.
 */
function ChunkCounter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const listener = () => {
      setCount((n) => n + 1);
    };

    chunkListeners.add(listener);
    return () => {
      chunkListeners.delete(listener);
    };
  }, []);
  return <span hidden>{count}</span>;
}

const chunkListeners = new Set<() => void>();

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <ThemeProvider>
      <Profiler
        id="host"
        onRender={(_id, phase, actualDuration) => {
          commits.push({ phase, actualDuration });
        }}
      >
        {control === 'chunk-commit' ? <ChunkCounter /> : null}
        <PluginHost
          plugins={plugins}
          inventory="ready"
          link={{ plugin: params.get('plugin') ?? undefined, page: undefined, connection: undefined, params: {} }}
          onRetry={() => undefined}
          onRetryInventory={() => undefined}
          terminals={{ target, load }}
        />
      </Profiler>
    </ThemeProvider>,
  );
}
