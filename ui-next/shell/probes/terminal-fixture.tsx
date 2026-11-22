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
//
// `window.__pty` is what the probe reads and drives: `log` (what was created, written, resized, closed, every listener count), `out(id, text)` (the shell writes text now), `end(id)` (the process ends),
// `ids()`. `window.__commits` lists every commit of the tree (React's profiler; the probe builds this entry with the profiling build of React DOM).
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider } from '@omniviewdev/kit';
import { Profiler } from 'react';
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
};

const emit = (name: string, data: unknown): void => {
  for (const listener of [...(listeners.get(name) ?? [])]) {
    listener(data);
  }
};
const out = (id: string, text: string): void => {
  emit(streamEvent(id, 'stdout'), encodeInput(text));
};

const PROMPT = '\u001b[32muser@synthetic\u001b[0m:\u001b[34m~\u001b[0m$ ';

function colors(id: string): void {
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  for (const base of [30, 90]) {
    out(id, `${names.map((name, index) => `\u001b[${String(base + index)}m${name.padEnd(8)}\u001b[0m`).join(' ')}\r\n`);
  }

  out(id, `\u001b[1mbold\u001b[0m \u001b[2mdim\u001b[0m \u001b[3mitalic\u001b[0m \u001b[4munderline\u001b[0m \u001b[7minverse\u001b[0m\r\n`);
}

/** N lines of W columns, in events of about 1,000 bytes, a batch of events a task so the page is never held for the whole flood. */
function flood(id: string, lines: number, width: number): void {
  const perEvent = Math.max(1, Math.floor(1000 / (width + 2)));
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
  create: async (id) => {
    ptys.set(id, { rows: 27, cols: 72, line: '' });
    log.created.push(id);
    setTimeout(() => {
      out(id, `\u001b[2mSynthetic shell: hello, size, colors, flood N [W], exit [code], fail\u001b[0m\r\n${PROMPT}`);
    }, 20);
  },
  write: async (id, base64) => {
    const text = new TextDecoder().decode(decodeBase64(base64));
    log.writes.push(text);
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

/**
 * `?renderer=dom` keeps the emulator's own DOM renderer for the whole life of the terminal (the GPU's is never asked for): its rows are text a probe can read, where the GPU's canvas is not. The default is the
 * product's own: the GPU while the terminal is on screen.
 */
const load: EngineLoader = async () => {
  const create = await loadXtermEngine();
  return (options) => {
    const engine = create(options);
    return params.get('renderer') === 'dom' ? { ...engine, setRenderer: async () => undefined } : engine;
  };
};

const NONE: readonly PluginEntry[] = [];
const plugins: PluginSource = { getSnapshot: () => NONE, subscribe: () => () => undefined };

const commits: Array<{ phase: string; actualDuration: number }> = [];
Object.assign(window, {
  __commits: commits,
  __pty: {
    log,
    out,
    ids: () => [...ptys.keys()],
    end: (id: string) => {
      emit(signalEvent(id, 'CLOSE'), 'Session terminated');
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  },
});

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
