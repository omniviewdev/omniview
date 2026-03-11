import type { PluginPhase } from './types';

/**
 * Valid state transitions for the plugin lifecycle state machine.
 *
 * Each key is a source phase, and the value is the list of phases
 * that it can legally transition to.
 *
 * State graph:
 *
 *   idle ──→ loading ──→ ready ──→ loading (reload)
 *                │              └──→ unloading ──→ idle
 *                └──→ error ──→ retrying ──→ loading
 *                          └──→ idle (uninstall failed)
 */
export const VALID_TRANSITIONS: Record<PluginPhase, readonly PluginPhase[]> = {
  idle: ['loading'],
  loading: ['ready', 'error'],
  ready: ['loading', 'unloading'],
  error: ['retrying', 'idle'],
  retrying: ['loading'],
  unloading: ['idle'],
};

/**
 * Assert that a transition from `from` to `to` is valid.
 * Throws a descriptive error if the transition is illegal.
 *
 * @param from The current phase
 * @param to The target phase
 */
export function assertValidTransition(from: PluginPhase, to: PluginPhase): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid plugin state transition: "${from}" → "${to}". ` +
        `Allowed transitions from "${from}": [${(allowed ?? []).map((p) => `"${p}"`).join(', ')}]`,
    );
  }
}
