import { ExecClient } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import { parseAppError } from '@omniviewdev/runtime/ui/v1';
import { HOST } from '../../core/panel';
import { createExecFeed, listedOf, newTerminalId, type ExecFeed, type ExecLaunch, type ExecTransport } from './execFeed';
import type { TerminalTarget } from './feed';

// The host's own shell as a feed: `CreateTerminal` starts the user's login shell on a pty of this machine (backend/pkg/terminal/manager.go: an empty command is the account shell, with `TERM=xterm-256color`), and
// the session is read and written through the exec lane's events and calls (backend/pkg/plugin/exec/controller.go). This file is only the mapping of `ExecTransport` onto those bindings; the rules of the
// session are the feed's (`execFeed.ts`). Input goes through the host's ORDERED calls, `WriteTerminal` and `ResizeTerminal`: the feed counts them and hands each call its number, and this file passes it on as it is, in
// the tick the call is made, so that the host can put the calls in the order of the numbers whatever order the transport delivers them in (docs/ui-next/status/T1-go.md 2.4). The `launch` it passes is the measured size
// and, for a terminal that outlives its page (docs/ui-next/status/T2-go.md), the page's key and lease: the pty opens at the size, and the shell, the directory and the environment are the backend's own choices
// (docs/ui-next/status/T1-go.md, section 2). A page that comes back finds its terminals with `ListTerminals` and takes one over with `AttachTerminal`; a page that is going away leaves one with `DetachTerminal`. What the
// host says back is read by the feed: the shell it started, how it ended, what runs in it, the code of a refusal, and the shells it tried.

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
    launch: { readonly cols: number; readonly rows: number; readonly page_key?: string; readonly lease_ms?: number },
  ): PromiseLike<unknown>;
  ListTerminals(pageKey: string): PromiseLike<unknown>;
  AttachTerminal(id: string, request: { readonly page_key: string; readonly from_offset?: number }): PromiseLike<unknown>;
  DetachTerminal(id: string, request: { readonly page_key: string }): PromiseLike<unknown>;
  WriteTerminal(id: string, seq: number, data: string): PromiseLike<unknown>;
  ResizeTerminal(id: string, seq: number, rows: number, cols: number): PromiseLike<unknown>;
  CloseSession(id: string): PromiseLike<unknown>;
  AckTerminal(id: string, bytes: number): PromiseLike<unknown>;
  IsBusy(id: string): PromiseLike<unknown>;
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

/** What the host's launch says: the size, and for a terminal with a key the key and the lease, as the host names them (`terminal.Launch`). Nothing is said that was not given. */
const launchOf = (size: { readonly cols: number; readonly rows: number }, launch: ExecLaunch | undefined) => ({
  cols: size.cols,
  rows: size.rows,
  ...(launch?.pageKey === undefined ? {} : { page_key: launch.pageKey }),
  ...(launch?.leaseMs === undefined ? {} : { lease_ms: launch.leaseMs }),
});

/** The transport of the host's own shell over the exec lane. */
export function localShellTransport(deps: LocalShellDeps = REAL): ExecTransport {
  const { client, events } = deps;
  return {
    create: async (id, size, launch) => Promise.resolve(client.CreateTerminal({ id, tty: true, command: [], labels: {}, params: {}, resource_plugin: '', resource_key: '' }, launchOf(size, launch))),
    list: async (pageKey) => Promise.resolve(client.ListTerminals(pageKey)),
    // An offset of 0 is an offset: the request carries it when it is given, and carries none when it is not (a fresh emulator has nothing).
    attach: async (id, request) => Promise.resolve(client.AttachTerminal(id, request.fromOffset === undefined ? { page_key: request.pageKey } : { page_key: request.pageKey, from_offset: request.fromOffset })),
    detach: async (id, request) => Promise.resolve(client.DetachTerminal(id, { page_key: request.pageKey })),
    write: async (id, seq, base64) => Promise.resolve(client.WriteTerminal(id, seq, base64)),
    resize: async (id, seq, rows, cols) => Promise.resolve(client.ResizeTerminal(id, seq, rows, cols)),
    close: async (id) => Promise.resolve(client.CloseSession(id)),
    ack: async (id, bytes) => Promise.resolve(client.AckTerminal(id, bytes)),
    busy: async (id) => Promise.resolve(client.IsBusy(id)),
    on: (name, listener) =>
      events.On(name, (event) => {
        listener(event.data);
      }),
    describe: (error) => parseAppError(error).detail,
    isGone: (error) => parseAppError(error).type === SESSION_NOT_FOUND,
    codeOf: (error) => parseAppError(error).code,
    // The tokens are the runtime's reading of the problem (`AppError.tried`, host #672): a token it does not know is `other` there, and is handed on as it is.
    triedOf: (error) => parseAppError(error).tried,
  };
}

/** Starts the host's own shell: the feed listens first, then the process starts. */
export function openLocalShell(deps: LocalShellDeps = REAL): ExecFeed {
  return createExecFeed({ transport: localShellTransport(deps) });
}

/** The tab is named by the shell the host says it started. */
const retitle: TerminalTarget['retitle'] = (status) => status.program;

/**
 * The target of "New terminal": the host's own, called `Terminal` until the host says which shell it started (the answer to the call that starts it names it: `zsh`, `bash`), and then called by that name. Its id names
 * the kind of thing it runs; every press is a new process all the same (the registry never looks for a session of a target).
 *
 * Given the page's key the terminal outlives the page for a lease (docs/ui-next/status/T2-go.md): it is started under an id made here, which is also the id of the panel session that shows it (`sessionId`), so that a
 * tab that was saved with it finds its terminal again after a reload (`restoreLocalTerminals`).
 */
export function localShellTarget(deps: LocalShellDeps = REAL, pageKey?: string): TerminalTarget {
  const named = { plugin: HOST, id: 'local', title: 'Terminal', retitle };
  if (pageKey === undefined) {
    return { ...named, open: () => openLocalShell(deps) };
  }

  const sessionId = newTerminalId();
  return { ...named, sessionId, open: () => createExecFeed({ transport: localShellTransport(deps), pageKey, newId: () => sessionId }) };
}

/**
 * The target of one terminal the host holds for the page's key (docs/ui-next/status/T2-go.md): its `sessionId` is the terminal's id (the saved tab that has the same id is the one that shows it), its title is the shell it
 * runs (`Terminal` when the host names none), and `open` takes the terminal over instead of starting a process, each time it is opened: a tab that takes a terminal back after another tab had it opens such a feed. Nothing is
 * attached by making the target.
 */
export function attachLocalTerminal(pageKey: string, id: string, program?: string, deps: LocalShellDeps = REAL): TerminalTarget {
  const transport = localShellTransport(deps);
  return {
    plugin: HOST,
    id: 'local',
    title: program ?? 'Terminal',
    retitle,
    sessionId: id,
    open: () => createExecFeed({ transport, pageKey, attach: program === undefined ? { id } : { id, program } }),
  };
}

/**
 * The terminals a page that reloaded finds again: those the host lists for its key, one target for each (`attachLocalTerminal`), in the order the host gave them. A terminal whose shell ended while no page held it is
 * listed with how it ended: its target says `ended` (and says nothing for a terminal that runs), because the host keeps such a terminal until its lease runs out even after the page closed it, and the registry gives it
 * only to a saved tab that still holds its id. Nothing is attached by the listing. Rejects when the host refuses the listing, with its error: the page says so, and starts with what it saved.
 */
export async function restoreLocalTerminals(_channels?: unknown): Promise<readonly TerminalTarget[]> {
  return Promise.resolve([]);
}
