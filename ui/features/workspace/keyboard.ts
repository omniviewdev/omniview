/** Terminals keep the shell's tab shortcuts (Ctrl+W, Ctrl+T, …) for the shell running in them. */
export function isTerminalTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.xterm') !== null;
}
