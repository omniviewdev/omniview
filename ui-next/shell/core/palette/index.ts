// The command palette's model: framework-free, plugin-agnostic, no UI, not wired. README.md in this directory is the guide; types.ts is the contract.
export { createPaletteStore, seedChips } from './store';
export type { PaletteOptions, PaletteStore, SeedInput } from './store';
export { createPaletteSaver } from './saver';
export type { PaletteSaverOptions, Saver } from './saver';
export { MIGRATIONS, contextOf, recentOf, record, restoreRecents, routeKey, serialiseRecents } from './recents';
export type { RestoreRecentsOptions, RestoreRecentsResult } from './recents';
export { highlight, matchWord, partsOf, scoreCandidate, wordsOf } from './match';
export { rank } from './rank';
export type { Hit, RankSource, Ranked } from './rank';
export { KINDS, LIMITS, PALETTE_VERSION, TIMING, kindOfPrefix } from './types';
export type * from './types';
