// What the component tests load for `@wailsio/runtime` (vite.config.ts, `test.alias`): the runtime's own modules for the six names
// this code imports from it, without the package entry. The entry boots the desktop runtime when it loads: it looks for the native
// bridge (a page without one, as jsdom is, prints "Browser Environment Detected"), adds the drag, context-menu and app-region
// listeners and tells the host it is ready. A test has no host to boot against; none of these modules needs the entry.
export * as Browser from '../node_modules/@wailsio/runtime/dist/browser.js';
export * as Call from '../node_modules/@wailsio/runtime/dist/calls.js';
export * from '../node_modules/@wailsio/runtime/dist/cancellable.js';
export * as Create from '../node_modules/@wailsio/runtime/dist/create.js';
export * as Events from '../node_modules/@wailsio/runtime/dist/events.js';
export { Stream } from '../node_modules/@wailsio/runtime/dist/stream.js';
