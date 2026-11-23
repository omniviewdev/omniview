import { ExecClient } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import { parseAppError } from '@omniviewdev/runtime/ui/v1';
import { HOST } from '../../core/panel';
import { createExecFeed, type ExecFeed, type ExecTransport } from './execFeed';
import type { TerminalTarget } from './feed';

// The host's own shell as a feed: `CreateTerminal` starts the user's login shell on a pty of this machine (backend/pkg/terminal/manager.go: an empty command is the account shell, with `TERM=xterm-256color`), and
// the session is read and written through the exec lane's events and calls (backend/pkg/plugin/exec/controller.go). This file is only the mapping of `ExecTransport` onto those bindings; the rules of the
// session are the feed's (`execFeed.ts`). The `launch` it passes is the measured size and nothing else: the pty opens at it, and the shell, the directory and the environment are the backend's own choices (docs/ui-next/status/T1-go.md, section 2).

/** The type of the error the host answers for a session it does not have (backend/pkg/apperror `SessionNotFound`, `ErrorTypes.SESSION_NOT_FOUND` in the runtime). */
const SESSION_NOT_FOUND = 'omniview:session/not-found';

/** What of `ExecClient` the transport uses. */
export type ExecClientLike = {
  CreateTerminal(
    options: {
      readonly id: string;
      readonly tty: boolean;
      readonly command: string[];
      readonly labels: Record<string, string>;
      readonly params: Record<string, string>;
      readonly resource_plugin: string;
      readonly resource_key: string;
    },
    launch: { readonly cols: number; readonly rows: number },
  ): PromiseLike<unknown>;
  WriteSession(id: string, data: string): PromiseLike<unknown>;
  ResizeSession(id: string, rows: number, cols: number): PromiseLike<unknown>;
  CloseSession(id: string): PromiseLike<unknown>;
};

/** What of the Wails runtime's `Events` the transport uses. */
export type EventsLike = {
  On(name: string, listener: (event: { readonly data: unknown }) => void): () => void;
};

export type LocalShellDeps = {
  readonly client: ExecClientLike;
  readonly events: EventsLike;
};

const REAL: LocalShellDeps = { client: ExecClient, events: Events };

/** The transport of the host's own shell over the exec lane. */
export function localShellTransport(deps: LocalShellDeps = REAL): ExecTransport {
  const { client, events } = deps;
  return {
    create: async (id, size) => Promise.resolve(client.CreateTerminal({ id, tty: true, command: [], labels: {}, params: {}, resource_plugin: '', resource_key: '' }, { cols: size.cols, rows: size.rows })),
    write: async (id, base64) => Promise.resolve(client.WriteSession(id, base64)),
    resize: async (id, rows, cols) => Promise.resolve(client.ResizeSession(id, rows, cols)),
    close: async (id) => Promise.resolve(client.CloseSession(id)),
    on: (name, listener) =>
      events.On(name, (event) => {
        listener(event.data);
      }),
    describe: (error) => parseAppError(error).detail,
    isGone: (error) => parseAppError(error).type === SESSION_NOT_FOUND,
  };
}

/** Starts the host's own shell: the feed listens first, then the process starts. */
export function openLocalShell(deps: LocalShellDeps = REAL): ExecFeed {
  return createExecFeed({ transport: localShellTransport(deps) });
}

/**
 * The target of "New terminal": the host's own, called `Terminal` (the backend does not say which shell it starts, so the tab has no better word: docs/ui-next/status/T1.md). Its id names the kind of thing it runs; every
 * press is a new process all the same (the registry never looks for a session of a target).
 */
export function localShellTarget(deps: LocalShellDeps = REAL): TerminalTarget {
  return { plugin: HOST, id: 'local', title: 'Terminal', open: () => openLocalShell(deps) };
}
