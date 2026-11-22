// What the Plugins page reads of the host's events (docs/development-plugin-lifecycle.md; `backend/pkg/plugin/events.go`). The page draws state the host says and nothing it guesses, so each event is read for the few members it is
// wanted for, as values the host owns: an id, a phase, one of six causes. The text an event may carry (a state change's `reason` holds the error of a failure, in the plugin's own words) is never read.

/** The phases a plugin is in (`backend/pkg/plugin/lifecycle/state.go`): a closed set, so a word that is not one of these is not a phase of this host. */
export const PHASES = ['Uninstalled', 'Installing', 'Installed', 'Building', 'BuildFailed', 'Validating', 'Starting', 'Running', 'Degraded', 'Recovering', 'Stopping', 'Stopped', 'Failed', 'Uninstalling'] as const;

export type Phase = (typeof PHASES)[number];

const isPhase = (value: unknown): value is Phase => PHASES.some((phase) => phase === value);

/** A plugin that entered a phase. */
export type StateChange = { readonly id: string; readonly phase: Phase };

/** The plugin and the phase it entered, from the payload of `plugin/state_change`; `undefined` for a payload that is not an id and a phase of this host. */
export function readStateChange(data: unknown): StateChange | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const id: unknown = Reflect.get(data, 'pluginID');
  const phase: unknown = Reflect.get(data, 'to');
  return typeof id === 'string' && id !== '' && isPhase(phase) ? { id, phase } : undefined;
}

/** A plugin turned on or off. */
export type Enablement = { readonly id: string; readonly enabled: boolean };

/** The plugin and whether it is on, from the payload of `plugin/enablement_changed` (`{ pluginID, enabled }`); `undefined` for a payload that is not that. */
export function readEnablement(data: unknown): Enablement | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const id: unknown = Reflect.get(data, 'pluginID');
  const enabled: unknown = Reflect.get(data, 'enabled');
  return typeof id === 'string' && id !== '' && typeof enabled === 'boolean' ? { id, enabled } : undefined;
}
