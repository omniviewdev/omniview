import { HOST } from '../../core/panel';
import type { ChannelLaunch, TerminalChannels } from './channel';
import { createExecFeed, newTerminalId } from './execFeed';
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

export function localRestartTarget(_restart: TerminalRestart, _tab: string, channels: TerminalChannels = appTerminalChannels(), _newId: () => string = newTerminalId): TerminalTarget {
  return targetOf('Terminal', channels, undefined, undefined);
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

/**
 * The target of one terminal the host keeps for this page: its `sessionId` is the terminal's id (the saved tab that has the same id is the one that shows it), its title is the shell it runs (`Terminal` when the host
 * names none), and `open` takes the terminal over instead of starting a process, each time it is opened: a tab that takes a terminal back after another tab had it opens such a feed. Nothing is attached by making the target.
 */
export function attachLocalTerminal(id: string, program?: string, channels: TerminalChannels = appTerminalChannels()): TerminalTarget {
  return {
    plugin: HOST,
    id: 'local',
    title: program ?? 'Terminal',
    retitle,
    sessionId: id,
    open: () => createExecFeed({ channels, attach: program === undefined ? { id } : { id, program } }),
  };
}

/** What the host lists of a terminal that the feed reads here: its id, the name of its shell, and whether it ended. */
type Listed = { readonly id: string; readonly program: string | undefined; readonly ended: boolean };

function listedOf(entry: unknown): Listed | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }

  const { id, shell, ended } = entry as { readonly id?: unknown; readonly shell?: unknown; readonly ended?: unknown };
  if (typeof id !== 'string' || id === '') {
    return undefined;
  }

  const name = typeof shell === 'object' && shell !== null ? (shell as { readonly name?: unknown }).name : undefined;
  return { id, program: typeof name === 'string' && name !== '' ? name : undefined, ended: ended !== undefined && ended !== null };
}

/**
 * The terminals a page that reloaded finds again: those the channels list, one target for each (`attachLocalTerminal`), in the order the host gave them. A terminal whose shell ended while no page held it is listed
 * with how it ended: its target says `ended` (and says nothing for a terminal that runs), because the host keeps such a terminal until it is dismissed or its lease runs out, and the registry gives it only to a saved tab
 * that still holds its id. Nothing is attached by the listing. Rejects when the host refuses the listing, with its error: the page says so, and starts with what it saved.
 */
export async function restoreLocalTerminals(channels: TerminalChannels = appTerminalChannels()): Promise<readonly TerminalTarget[]> {
  const targets: TerminalTarget[] = [];
  for (const entry of await channels.list()) {
    const listed = listedOf(entry);
    if (listed !== undefined) {
      targets.push({ ...attachLocalTerminal(listed.id, listed.program, channels), ...(listed.ended ? { ended: true } : {}) });
    }
  }

  return targets;
}
