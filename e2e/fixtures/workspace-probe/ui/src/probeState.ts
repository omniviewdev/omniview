// Verification-only state that outlives this bundle. Every evaluation of the bundle takes the
// next number, so a cell renderer or drawer from a reloaded bundle is distinguishable from the
// one it replaced. A bundle evaluated while `contribute` is false ships without its cell
// renderer, as a plugin update that drops it would.
type ProbeViewState = { instances: number; contribute?: boolean };
const probeWindow = window as typeof window & { __workspaceProbeResourceCell?: ProbeViewState };
const state = (probeWindow.__workspaceProbeResourceCell ??= { instances: 0 });
state.instances += 1;

/** The number of this evaluation of the bundle. */
export const moduleInstance = state.instances;

/** Whether this evaluation of the bundle contributes the resource cell renderer. */
export const contributesCell = state.contribute !== false;
