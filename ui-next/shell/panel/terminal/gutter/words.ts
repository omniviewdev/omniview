// The words of the command gutter (issue #694 step 5): what a hover says, what is said to a person who cannot see the gutter when they jump to a command, and the names of the actions. Pure. The facts are the producer's (the shell's
// exit status, the host's times): nothing here reads a clock.

/** The state of a command as the gutter shows it: running, finished with status 0 (`success`), finished with another status (`failure`), or finished with no status to tell (`incomplete`: a shell that does not report one, or one that was replaced before it did). */
export type CommandState = 'running' | 'success' | 'failure' | 'incomplete';

/** What the words need of a command. */
export type CommandFacts = {
  readonly state: CommandState;
  readonly command?: string | undefined;
  readonly exit?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly cwd?: string | undefined;
};

/** A duration as a person says it: `830 ms`, `2.1 s`, `45 s`, `3 min 5 s`, `2 h 4 min`. The producer's number: a negative or a number that is not one is no duration. */
export function durationWords(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '';
  }

  if (ms < 1000) {
    return `${String(Math.round(ms))} ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${(Math.round(seconds * 10) / 10).toFixed(1)} s`;
  }

  if (seconds < 60) {
    return `${String(Math.round(seconds))} s`;
  }

  const total = Math.round(seconds);
  if (total < 3600) {
    return `${String(Math.floor(total / 60))} min ${String(total % 60)} s`;
  }

  return `${String(Math.floor(total / 3600))} h ${String(Math.floor((total % 3600) / 60))} min`;
}

/** The state in words: it never rests on a colour. */
export function stateWords(command: CommandFacts): string {
  switch (command.state) {
    case 'running':
      return 'Running';
    case 'success':
      return 'Succeeded';
    case 'failure':
      return command.exit === undefined ? 'Failed' : `Failed, exit ${String(command.exit)}`;
    case 'incomplete':
      return 'Ended with no exit status';
  }
}

/** The status and the time on one line: `Failed, exit 1, took 2.1 s`. A command that runs has no time yet. */
export function statusLine(command: CommandFacts): string {
  const took = command.state === 'running' || command.durationMs === undefined ? '' : durationWords(command.durationMs);
  return took === '' ? stateWords(command) : `${stateWords(command)}, took ${took}`;
}

/** The lines of the hover: the command line when the shell proved it, the status and the time, and the directory when the shell said it. */
export function tipLines(command: CommandFacts): readonly string[] {
  return [
    ...(command.command === undefined || command.command === '' ? [] : [command.command]),
    statusLine(command),
    ...(command.cwd === undefined || command.cwd === '' ? [] : [command.cwd]),
  ];
}

/** What a jump says to a person who cannot see where the view went: which command it is among all of them, how it ended, and the line when it is known. */
export function jumpWords(command: CommandFacts, index: number, count: number): string {
  const line = command.command === undefined || command.command === '' ? '' : `: ${command.command}`;
  return `Command ${String(index + 1)} of ${String(count)}, ${statusLine(command)}${line}`;
}

export const NO_PREVIOUS = 'No previous command';
export const NO_NEXT = 'No next command, back at the prompt';
export const NO_COMMANDS = 'No commands yet';
export const NO_OUTPUT = 'This command printed no output';
export const SELECTED_OUTPUT = 'Selected the output of the command';
export const COPIED_OUTPUT = 'Copied the output of the command';
export const COULD_NOT_COPY = 'Could not copy the output';
export const RERUN_RUNNING = 'A command is running';
export const RERUN_TYPED = 'The command line is typed; press Enter to run it';
export const RERUN_SENT = 'Running the command again';
export const NO_LINE = 'The command line is not known';
export const INPUT_OFF = 'Input is off';
