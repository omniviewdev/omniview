import type { EngineLoader } from './engine';

/**
 * The one place the emulator's code is asked for: a dynamic import, so the host's entry chunk holds none of it. The first time a terminal is shown the browser fetches `xtermEngine` and what it brings
 * (the emulator, its renderer and its stylesheet); before that no byte of it is requested, and a window that never opens a terminal never pays for it (docs/ui-next/status/T1.md, "Bundle proof").
 */
export const loadXtermEngine: EngineLoader = async () => (await import('./xtermEngine')).createXtermEngine;
