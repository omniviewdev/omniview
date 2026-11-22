import type { Installed, Operation, State } from './types';

// What a person can do to a plugin now (ch16 S135, S136) and, when they cannot, why: a function that cannot run says so and says why (S2). The answers follow what the host can truthfully do
// (docs/ui-next/status/PL1.md, "What the backend can tell the page"): a plugin that is turned off is not reloaded (the host says it starts again and never starts it), a plugin the product ships is not uninstalled, and nothing is
// begun on a plugin the host or this page is already working on.

export type Availability = { readonly available: true } | { readonly available: false; readonly reason: string };

export type Actions = {
  /** Ask the host to start a plugin that failed again. */
  readonly retry: Availability;
  /** Stop a plugin and start it again; for a plugin that is stopped, start it. */
  readonly reload: Availability;
  readonly enable: Availability;
  readonly disable: Availability;
  readonly uninstall: Availability;
};

const CAN: Availability = { available: true };

const reloadable = (installed: Installed, state: State): boolean => installed.enabled && (state.kind === 'running' || state.kind === 'degraded' || state.kind === 'stopped');

/** What can be done to the plugin now. `op` is the work this page has under way on it. */
export function actionsOf(installed: Installed, state: State, op: Operation | null): Actions {
  const working = op !== null ? 'Wait for the running operation to finish.' : state.busy ? 'Wait for it to finish.' : undefined;
  const gate = (allowed: boolean, why: string): Availability => (working !== undefined ? { available: false, reason: working } : allowed ? CAN : { available: false, reason: why });
  const reloadWhy = !installed.enabled ? 'Enable it first.' : state.kind === 'failed' ? 'Use Retry.' : 'It is not running.';
  return {
    retry: gate(state.kind === 'failed', 'It has not failed.'),
    reload: gate(reloadable(installed, state), reloadWhy),
    enable: gate(!installed.enabled, 'It is already enabled.'),
    disable: gate(installed.enabled, 'It is already disabled.'),
    uninstall: installed.builtin ? { available: false, reason: 'Built into Omniview. Disable it instead.' } : gate(true, ''),
  };
}
