// The tab and open model of the shell: framework-free, plugin-agnostic, no UI. README.md in this directory is the guide; types.ts is the contract.
export { createTabsStore, newUuid } from './store';
export { closeSet } from './close';
export type { TabsStore, TabsStoreOptions } from './store';
export { createSelectors } from './selectors';
export { dispositionOf } from './disposition';
export { qualify, hostFacets } from './identity';
export type { QualifyItem } from './identity';
export { restoreTabs, serialise, migrate, MIGRATIONS } from './persist';
export type { Migration, MigrateOptions, MigrateResult, RestoreOptions, RestoreResult } from './persist';
export { createSaver } from './saver';
export type { Saver, SaverOptions } from './saver';
export { checkInvariants } from './state';
export { DEFAULT_KEEP_ALIVE } from './keepAlive';
export { normaliseRoute, sameRoute } from './route';
export type { ErrorHook } from './plugins';
export { LIMITS, STATE_VERSION } from './types';
export { clip } from './face';
export type * from './types';
