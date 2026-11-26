import type { TerminalMark } from '../feed';
import type { Engine } from '../engine';
import type { CommandState } from './words';

// SCAFFOLD (issue #694 step 5): the command gutter's model, which the next commit fills in.

export type GutterCommand = {
  readonly id: string;
  readonly state: CommandState;
  readonly command?: string | undefined;
  readonly exit?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly cwd?: string | undefined;
  /** The line of the buffer the command was typed on. */
  readonly line: number;
};

export type GutterEvent =
  | { readonly kind: 'hover'; readonly command: GutterCommand | undefined; readonly x: number; readonly y: number }
  | { readonly kind: 'said'; readonly words: string };

/** The most commands the gutter keeps (and draws): a decoration is a DOM node of the emulator's for each. */
export const MAX_COMMANDS = 200;

export type GutterEngine = Pick<Engine, 'mark' | 'decorate' | 'cursor' | 'viewport' | 'lines' | 'selectLines' | 'scrollTo' | 'scrollToBottom' | 'alternate'>;

export type CommandGutter = {
  readonly ingest: (marks: readonly TerminalMark[]) => void;
  readonly reset: () => void;
  readonly commands: () => readonly GutterCommand[];
  readonly target: () => GutterCommand | undefined;
  readonly jump: (direction: 'previous' | 'next', options?: { readonly select?: boolean }) => GutterCommand | undefined;
  readonly selectOutput: (command?: GutterCommand) => boolean;
  readonly output: (command?: GutterCommand) => string | undefined;
  readonly rerun: (command?: GutterCommand) => { readonly text: string; readonly enter: boolean } | undefined;
  readonly busy: () => boolean;
  readonly onEvent: (listener: (event: GutterEvent) => void) => () => void;
  readonly dispose: () => void;
};

export function createCommandGutter(_engine: GutterEngine): CommandGutter {
  return {
    ingest: () => undefined,
    reset: () => undefined,
    commands: () => [],
    target: () => undefined,
    jump: () => undefined,
    selectOutput: () => false,
    output: () => undefined,
    rerun: () => undefined,
    busy: () => false,
    onEvent: () => () => undefined,
    dispose: () => undefined,
  };
}
