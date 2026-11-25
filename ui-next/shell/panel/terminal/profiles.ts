import type { MenuItem } from '@omniviewdev/kit';
import { ExecClient } from '@omniviewdev/runtime/api';

// The shells of this machine as the Terminal tool offers them (#695 step 2). The host finds them (`ListTerminalShells`: bash, zsh, fish and pwsh in the usual directories, and the default shell wherever it is) and says which one
// starts when no shell is named, which is the setting `terminal.defaultShell` where it names a shell the host starts and the host's own order where it does not: the page never works out the default, it is the producer's fact
// (docs/ui-next/terminal/HOW-WE-WORK.md, section 11). A profile is what a terminal is started from: a shell, and what a person may add to it. Detection gives a profile its name and path only; the rest is for the profiles a person
// writes (a later step), and is passed to the host as it is.

/** What a terminal is started from: a name for its tab until the host names the shell, the shell (a path), its arguments after the login flags the host adds, the environment and the directory it starts with, and how its tab looks. */
export type TerminalProfile = {
  readonly name: string;
  readonly path: string;
  readonly args?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd?: string | undefined;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
};

/** A shell the host found, and whether it is the one that starts when none is named: by the host's word. */
export type ShellChoice = { readonly profile: TerminalProfile; readonly isDefault: boolean };

/** The shells the host found, as a store the menu reads. `getSnapshot` is the same list until the host's answer changes it. */
export type ShellList = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => readonly ShellChoice[];
};

/** Where the list comes from: the host's answer, and the event that says the settings changed (the default may have moved). */
export type ShellListSource = {
  readonly list: () => Promise<unknown>;
  readonly onChanged: (listener: () => void) => () => void;
  /** Where the page says what it could not do. Default: the console. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

/** What a profile asks of the host when it makes the terminal (`ChannelLaunch`): the shell and its arguments, the directory and the environment, each only when the profile has one. */
export type ProfileLaunch = {
  readonly command: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
};

const NONE: readonly ShellChoice[] = Object.freeze([]);

/** The shells of the host's answer (`shellenv.Shell`: `name`, `path`, `default`). An entry without a name and a path is left out, and an answer that is not a list is no shells. */
export function shellsOf(answer: unknown): readonly ShellChoice[] {
  if (!Array.isArray(answer)) {
    return NONE;
  }

  const choices: ShellChoice[] = [];
  for (const entry of answer as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const { name, path, default: marked } = entry as { readonly name?: unknown; readonly path?: unknown; readonly default?: unknown };
    if (typeof name === 'string' && name !== '' && typeof path === 'string' && path !== '') {
      choices.push({ profile: { name, path }, isDefault: marked === true });
    }
  }

  return choices;
}

const warnOnConsole = (message: string, error?: unknown): void => {
  console.warn(message, error);
};

/**
 * The list the page keeps. It asks the host when the first listener comes and again whenever the settings change while someone listens, and it holds no listener of its own on the settings, no timer and no request while nobody
 * listens. The answers of two questions that overlap are taken in the order they were asked: an earlier answer that comes in late is dropped. A host that cannot answer is one warning, and the list stays as it was.
 */
export function createShellList(source: ShellListSource): ShellList {
  const warn = source.warn ?? warnOnConsole;
  const listeners = new Set<() => void>();
  let choices = NONE;
  let asked = 0;
  let stopChanged: (() => void) | undefined;

  const ask = () => {
    asked += 1;
    const mine = asked;
    source.list().then(
      (answer) => {
        if (mine !== asked || listeners.size === 0) {
          return;
        }

        choices = shellsOf(answer);
        listeners.forEach((listener) => {
          listener();
        });
      },
      (error: unknown) => {
        if (mine === asked) {
          warn('[terminal] the shells of this machine could not be listed', error);
        }
      },
    );
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        stopChanged = source.onChanged(ask);
        ask();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopChanged?.();
          stopChanged = undefined;
          // An answer still on its way is no longer wanted.
          asked += 1;
        }
      };
    },
    getSnapshot: () => choices,
  };
}

/** What a profile asks of the host. */
export function launchOf(profile: TerminalProfile): ProfileLaunch {
  return {
    command: [profile.path, ...(profile.args ?? [])],
    ...(profile.cwd === undefined ? {} : { cwd: profile.cwd }),
    ...(profile.env === undefined ? {} : { env: profile.env }),
  };
}

/** The items of the `+`'s menu: a row for each shell with its path, and the default marked with a check and its word. Choosing one opens a terminal from its profile. */
export function shellMenu(choices: readonly ShellChoice[], open: (profile: TerminalProfile) => void): readonly MenuItem[] {
  return choices.map(({ profile, isDefault }) => ({
    kind: 'action',
    id: `shell:${profile.path}`,
    label: profile.name,
    metadata: isDefault ? { text: `Default  ${profile.path}`, icon: 'check' } : profile.path,
    onSelect: () => {
      open(profile);
    },
  }));
}

/** The list of the app: the host's `ListTerminalShells`, asked again when the host says its settings changed. The settings' own client is a lazy chunk (the sheet's), so it is loaded when the first listener comes. */
export function appShellList(): ShellList {
  return createShellList({
    list: async () => ExecClient.ListTerminalShells(),
    onChanged: (listener) => {
      let stop: (() => void) | undefined;
      let left = false;
      void import('../../settings/runtime').then(({ runtimeClient }) => {
        if (!left) {
          stop = runtimeClient().onChanged(listener);
        }
      });
      return () => {
        left = true;
        stop?.();
      };
    },
  });
}
