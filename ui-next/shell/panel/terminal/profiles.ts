import type { MenuItem } from '@omniviewdev/kit';

export type TerminalProfile = {
  readonly name: string;
  readonly path: string;
  readonly args?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd?: string | undefined;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
};

export type ShellChoice = { readonly profile: TerminalProfile; readonly isDefault: boolean };

export type ShellList = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => readonly ShellChoice[];
};

export type ShellListSource = {
  readonly list: () => Promise<unknown>;
  readonly onChanged: (listener: () => void) => () => void;
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

export type ProfileLaunch = { readonly command: readonly string[]; readonly cwd?: string | undefined; readonly env?: Readonly<Record<string, string>> | undefined };

export function shellsOf(_answer: unknown): readonly ShellChoice[] {
  return [];
}

export function createShellList(_source: ShellListSource): ShellList {
  return { subscribe: () => () => undefined, getSnapshot: () => [] };
}

export function shellMenu(_choices: readonly ShellChoice[], _open: (profile: TerminalProfile) => void): readonly MenuItem[] {
  return [];
}

export function launchOf(profile: TerminalProfile): ProfileLaunch {
  return { command: [profile.path] };
}
