/**
 * The MCP relay's Wails binding, for the host's own UI only: the approval
 * dialog (`McpConfirmationProvider`) and the AI Tools settings page.
 *
 * Plugin code runs in this realm and imports `@omniviewdev/runtime`, `/api`,
 * `/runtime` and `/models`, so a binding exported from any of them is a binding
 * every plugin can call. The relay answers agent approvals and hands out the
 * bearer token, so it is not exported from them. Import it from here, never
 * from the runtime package, and never re-export it from `shared_dependencies.ts`
 * or the Vite plugin's `SHARED_PACKAGES`.
 *
 * This keeps the calls out of the shared modules. It is not an access check:
 * the Go service cannot tell host code from plugin code in the same window.
 */
export * as McpRelayClient from '../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/internal/mcprelay/servicewrapper';
