import { HOST } from '../../core/panel';
import type { ChannelLaunch, TerminalChannels } from './channel';
import { createExecFeed, newTerminalId, type ExecAttach } from './execFeed';
import type { TerminalDirectory, TerminalFeedSnapshot, TerminalRestart, TerminalTarget } from './feed';
import { appTerminalChannels } from './terminalChannel';
import { launchOf, type TerminalProfile } from './profiles';

// The host's own shell as a feed, on the terminal channel (docs/ui-next/terminal-channel-protocol.md): `CreateTerminal` with `launch.channel` starts the user's login shell on a pty of this machine
// (backend/pkg/terminal/manager.go: an empty command is the account shell, with `TERM=xterm-256color`), and the terminal is reached by one stream (`terminalChannel.ts`, which holds the capabilities and speaks the frames).
// This file is only the mapping of the targets of the Terminal tool onto `TerminalChannels` (`channel.ts`); the rules of the session are the feed's (`execFeed.ts`). The terminal outlives the page for a lease: it is started
// under an id made here, which is also the id of the panel session that shows it (`sessionId`), so that a tab that was saved with it finds its terminal again after a reload (`restoreLocalTerminals`). What the host says
// back is read by the feed: the shell it started, how it ended, what runs in it, the code of a refusal, and the shells it tried.

/** The tab is named by the title a program set while it runs (the host says when one does: `status.title`), and otherwise by the shell the host says it started. */
const retitle: TerminalTarget['retitle'] = (status) => status.title ?? status.program;

/**
 * The target of "New terminal": the host's own, called `Terminal` until the host says which shell it started (the answer to the call that starts it names it: `zsh`, `bash`), and then called by that name. Its id names
 * the kind of thing it runs; every press is a new process all the same (the registry never looks for a session of a target). The terminal is started under the id of its `sessionId`, and kept for `leaseMs` once no
 * stream holds it (the host's default when it is not given). It names no shell: the host starts the default (`terminal.defaultShell`, else its own order).
 */
export function localShellTarget(channels: TerminalChannels = appTerminalChannels(), leaseMs?: number): TerminalTarget {
  return targetOf('Terminal', channels, leaseMs, undefined);
}

/**
 * The target of a terminal started from a profile (a shell the person chose in the menu of the `+`): called by the profile until the host says which shell it started, and asking the host for the profile's shell, its
 * arguments, directory and environment (`launch`). In every other way it is the target of the `+`.
 */
export function localProfileTarget(profile: TerminalProfile, channels: TerminalChannels = appTerminalChannels(), leaseMs?: number): TerminalTarget {
  return targetOf(profile.name, channels, leaseMs, launchOf(profile));
}

/**
 * The target of "New terminal here": the host's own shell, started where the terminal it was opened from says it is (a `known` directory goes to the host as the terminal's `cwd`) or, when that terminal could not say, in the host's
 * own default directory (home), with the status saying so until the first thing is typed. The directory is the producer's fact (`TerminalFeedHandle.directory`), passed on as it was given.
 */
export function localHereTarget(where: TerminalDirectory, channels: TerminalChannels = appTerminalChannels(), leaseMs?: number): TerminalTarget {
  return where.state === 'known' ? targetOf('Terminal', channels, leaseMs, { cwd: where.path }, undefined, where.source === 'start') : targetOf('Terminal', channels, leaseMs, undefined, 'home-for-unknown-directory');
}

/**
 * The target of a terminal that stands in for an ended one (restart, #695 step 5): the host's own shell, started under a FRESH id (never the ended terminal's, which a host may still hold a record of, nor the tab's) from what the ended
 * terminal's feed said a restart is made from (its shell, directory and environment), for the tab of the ended terminal's session: the session is the tab's, so the tab keeps its place and its title. The host lists the terminal with the
 * tab (`tab`), so that a page that reloads gives the tab its new terminal. A directory that was removed since is the home directory, and the status says so.
 */
export function localRestartTarget(restart: TerminalRestart, tab: string, channels: TerminalChannels = appTerminalChannels(), newId: () => string = newTerminalId): TerminalTarget {
  const { command, cwd, env } = restart;
  const launch: Pick<ChannelLaunch, 'command' | 'cwd' | 'env'> = {
    ...(command === undefined || command.length === 0 ? {} : { command }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined || Object.keys(env).length === 0 ? {} : { env }),
  };
  return {
    plugin: HOST,
    id: 'local',
    title: 'Terminal',
    retitle,
    sessionId: tab,
    open: () => {
      const fresh = freshId(newId, [restart.id, tab]);
      return createExecFeed({ channels, newId: () => fresh, tab, launch, ...(cwd === undefined ? {} : { homeIfMissing: true }) });
    },
  };
}

/** How many times an id is asked for before the source is given up on: a random source answers a taken id never, so a source that does is broken, and nothing may start under an id a host may hold records of. */
const ID_TRIES = 8;

/** An id that is none of `taken`: the ended terminal's own (a host that still holds its end, or a close in flight, must never meet it again) and the tab's. Throws when the source gives only those. */
function freshId(newId: () => string, taken: readonly string[]): string {
  for (let tries = 0; tries < ID_TRIES; tries += 1) {
    const id = newId();
    if (!taken.includes(id)) {
      return id;
    }
  }

  throw new Error('a terminal id that is not the id of the ended terminal could not be made');
}

function targetOf(
  title: string,
  channels: TerminalChannels,
  leaseMs: number | undefined,
  launch: Pick<ChannelLaunch, 'command' | 'cwd' | 'env'> | undefined,
  startNote?: TerminalFeedSnapshot['startNote'],
  homeIfMissing?: boolean,
): TerminalTarget {
  const sessionId = newTerminalId();
  return {
    plugin: HOST,
    id: 'local',
    title,
    retitle,
    sessionId,
    open: () =>
      createExecFeed({
        channels,
        newId: () => sessionId,
        ...(leaseMs === undefined ? {} : { leaseMs }),
        ...(launch === undefined ? {} : { launch }),
        ...(startNote === undefined ? {} : { startNote }),
        ...(homeIfMissing === true ? { homeIfMissing } : {}),
      }),
  };
}

/** What a page that reloaded learns of a terminal from the host's listing besides its id and shell: the tab it belongs to (`params.tab`), the path of its shell and what it was asked to start with (`params.launch`). */
type Kept = { readonly tab?: string | undefined; readonly shell?: string | undefined; readonly replaced?: true; readonly launch?: ExecAttach['launch'] };

/**
 * The target of one terminal the host keeps for this page: its `sessionId` is the tab it belongs to (the terminal's own id, unless a restart made it for the tab of an ended terminal: `Kept.tab`; the saved tab that has the same id is the one
 * that shows it), its title is the shell it runs (`Terminal` when the host names none), and `open` takes the terminal over instead of starting a process, each time it is opened: a tab that takes a terminal back after another tab had it opens
 * such a feed. Nothing is attached by making the target.
 */
export function attachLocalTerminal(id: string, program?: string, channels: TerminalChannels = appTerminalChannels(), kept: Kept = {}): TerminalTarget {
  return {
    plugin: HOST,
    id: 'local',
    title: program ?? 'Terminal',
    retitle,
    sessionId: kept.tab ?? id,
    open: () => createExecFeed({ channels, attach: { id, ...(program === undefined ? {} : { program }), ...(kept.shell === undefined ? {} : { shell: kept.shell }), ...(kept.replaced === true ? { replaced: true } : {}), ...(kept.launch === undefined ? {} : { launch: kept.launch }) } }),
  };
}

/** What the host lists of a terminal that the feed reads here: its id, the name and path of its shell, whether it ended, when it was made, and what the page attached to it. */
type Listed = {
  readonly id: string;
  readonly program: string | undefined;
  readonly ended: boolean;
  readonly madeAt: string;
  readonly kept: Kept;
};

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * What the page asked the terminal to start with, as it attached it (`params.launch`, written by the feed that made it). The listing is read as untrusted: anything that is not a shell and its arguments in words, and an environment of
 * names and text, is nothing; an entry of the environment that is not text is dropped.
 */
function keptLaunchOf(raw: unknown): ExecAttach['launch'] {
  if (typeof raw !== 'string') {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const { command, env } = parsed as { readonly command?: unknown; readonly env?: unknown };
  if (command !== undefined && !(Array.isArray(command) && command.every((word) => typeof word === 'string'))) {
    return undefined;
  }

  if (env !== undefined && (typeof env !== 'object' || env === null || Array.isArray(env))) {
    return undefined;
  }

  const words = command === undefined || command.length === 0 ? undefined : command;
  const entries = env === undefined ? [] : Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  const vars = entries.length === 0 ? undefined : Object.fromEntries(entries);
  return words === undefined && vars === undefined ? undefined : { ...(words === undefined ? {} : { command: words }), ...(vars === undefined ? {} : { env: vars }) };
}

function listedOf(entry: unknown): Listed | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }

  const { id, shell, ended, params, created_at: madeAt } = entry as { readonly id?: unknown; readonly shell?: unknown; readonly ended?: unknown; readonly params?: unknown; readonly created_at?: unknown };
  if (typeof id !== 'string' || id === '') {
    return undefined;
  }

  const name = typeof shell === 'object' && shell !== null ? (shell as { readonly name?: unknown }).name : undefined;
  const path = typeof shell === 'object' && shell !== null ? text((shell as { readonly path?: unknown }).path) : undefined;
  const attached = typeof params === 'object' && params !== null ? (params as { readonly tab?: unknown; readonly launch?: unknown }) : {};
  const launch = keptLaunchOf(attached.launch);
  const replaced = typeof shell === 'object' && shell !== null && text((shell as { readonly requested?: unknown }).requested) !== undefined;
  return {
    id,
    program: typeof name === 'string' && name !== '' ? name : undefined,
    ended: ended !== undefined && ended !== null,
    madeAt: typeof madeAt === 'string' ? madeAt : '',
    kept: { tab: text(attached.tab), shell: path, ...(replaced ? { replaced: true as const } : {}), ...(launch === undefined ? {} : { launch }) },
  };
}

/**
 * An RFC 3339 time (Go's `time.Time` JSON, which trims the zeros of its fraction) as a number that orders as the instants do: the seconds, then the fraction to nanoseconds. A time that cannot be read is the earliest.
 */
function instantOf(raw: string): string {
  const found = /^(.*?T\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(raw);
  const seconds = found === null ? Number.NaN : Date.parse(`${found[1] ?? ''}${found[3] ?? ''}`);
  return Number.isNaN(seconds) ? '' : `${String(seconds / 1000).padStart(15, '0')}.${(found?.[2] ?? '').padEnd(9, '0').slice(0, 9)}`;
}

/** Whether `next` is the terminal a tab keeps, in place of `held`, when the host lists two for it (the one a restart replaced may still be listed): the one that runs, else the one made last, else the later listed. */
function replaces(next: Listed, held: Listed): boolean {
  if (next.ended !== held.ended) {
    return !next.ended;
  }

  return instantOf(next.madeAt) >= instantOf(held.madeAt);
}

/**
 * The terminals a page that reloaded finds again: those the channels list, one target for each tab (`attachLocalTerminal`), in the order the host gave them. A terminal whose shell ended while no page held it is listed
 * with how it ended: its target says `ended` (and says nothing for a terminal that runs), because the host keeps such a terminal until it is dismissed or its lease runs out, and the registry gives it only to a saved tab
 * that still holds its id. A terminal a restart made for the tab of an ended one says so (`params.tab`) and is given that tab. Nothing is attached by the listing. Rejects when the host refuses the listing, with its error: the page says so, and starts with what it saved.
 */
export async function restoreLocalTerminals(channels: TerminalChannels = appTerminalChannels()): Promise<readonly TerminalTarget[]> {
  const slots: Listed[] = [];
  const at = new Map<string, number>();
  for (const entry of await channels.list()) {
    const listed = listedOf(entry);
    if (listed === undefined) {
      continue;
    }

    const tab = listed.kept.tab ?? listed.id;
    const slot = at.get(tab);
    if (slot === undefined) {
      at.set(tab, slots.length);
      slots.push(listed);
    } else if (replaces(listed, slots[slot] ?? listed)) {
      slots[slot] = listed;
    }
  }

  return slots.map((listed) => ({ ...attachLocalTerminal(listed.id, listed.program, channels, listed.kept), ...(listed.ended ? { ended: true } : {}) }));
}
