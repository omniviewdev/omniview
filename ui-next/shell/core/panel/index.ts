// The bottom panel's model: framework-free, plugin-agnostic, no UI. README.md in this directory is the guide; types.ts is the contract.
export { createPanelStore, UNLOADED_CAUSE } from './store';
export type { PanelStore, PanelStoreOptions } from './store';
export { createSelectors } from './selectors';
export { toolIdOf } from './tools';
export type { PluginTools } from './tools';
export type { OpenOptions, StateChange } from './sessions';
export type { ShowOptions } from './arrange';
export { COLLAPSE_BELOW, MIN_HEIGHT, ROOM_ABOVE, collapses, defaultHeight, heightKey, limitsOf, resolveHeight } from './height';
export type { HeightKey, HeightLimits } from './height';
export { restorePanel, serialise, MIGRATIONS, RESTORED_CAUSE } from './persist';
export type { MigrateResult, Migration, RestoreOptions, RestoreResult } from './persist';
export { createPanelSaver } from './saver';
export type { PanelSaverOptions } from './saver';
export { checkInvariants, emptyPanel } from './state';
export { HOST, LIMITS, PANEL_VERSION } from './types';
export type * from './types';
