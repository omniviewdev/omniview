// The Settings sheet's lazy chunk: everything the sheet is, behind one dynamic import (`host.ts`, `load`). A window that never opens Settings never fetches it. The chunk holds the sheet's component, the adapter, the session, the
// form model it runs and the parts it draws (the bundle report says how many bytes, and the always-loaded part of Settings is the control, the chord and the context).

export { createSession } from './runtime';
export { Surface } from './view/Surface';
