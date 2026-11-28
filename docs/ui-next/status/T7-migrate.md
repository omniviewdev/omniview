# Status: T7-migrate (#696: the page opens addresses through the host's opener)

- Branch `feat/page-uses-host-opener` on `origin/main` `520c64673` (#818 merged). Not a PR. Red `e1c71240e` (5 of 7 runtime tests, 3 of 6 opener tests, the scan fail by assertion), green `028dae4d4`.

## What changed

`AppService.OpenExternalURL(address) -> { opened, reason }` (the host checks the scheme, userinfo, own servers and length) replaces every page call of Wails' `Browser.OpenURL`, whose validator lets `vscode:`, `ms-msdt:` and `smb:` through and knows nothing of the host's servers.

| Caller | Before | Now |
|---|---|---|
| `ui-next/plugins/host/openExternal.ts` (the Ports tool) | `Browser.OpenURL` | `openExternalURL` of `@omniviewdev/runtime/api` |
| `ui-next/plugins/host/PluginHostScreen.tsx` (the Terminal tool's link, `TerminalSessions.openExternal`) | its own copy of the call | imports the one `openExternal`; the copy is deleted |
| `packages/omniviewdev-runtime` hooks `usePortForwardSessions.openInBrowser`, `useResourcePortForwarder` | `Browser.OpenURL` | `openExternalURL` (the forwarder's open stays fire and forget and swallows a refusal: a forward that started is not undone by an address that was not opened) |
| `ui/pages/plugins/PluginDetails.tsx`, `ui/features/builtinplugins/grafana/Settings.tsx` (legacy `ui/`) | `Browser.OpenURL` | `openExternalURL`. Migrated: two call sites, three lines. Grafana keeps `.catch(setError)`, which now shows the refusal |
| `packages/omniviewdev-providers/lib/portforward/hooks.tsx` | `Browser.OpenURL` | `Call.ByName('main.AppService.OpenExternalURL', address)` from `@wailsio/runtime`: the package stands alone (it depends on the Wails runtime only, not on `@omniviewdev/runtime`), so it calls the bound method by name; a refusal is swallowed |

## Decisions

1. **The refusal is the call's rejection.** `openExternalURL` (`packages/omniviewdev-runtime/src/openExternal.ts`, exported from `@omniviewdev/runtime/api`) turns `{ opened: false, reason }` into `ExternalURLRefusedError(reason)`, whose message holds nothing of the address. Every caller already treated the host's refusal as a rejection (the Terminal registry warns and opens nothing; the Ports tool says so; Grafana sets its error), so each shows a refusal the way it showed one. A failure of the call (the browser could not start) passes through unchanged.
2. **The page's checks stay the first gate** (`isWebAddress`, `canFollow`, the registry's allow-list, the Ports tool's own-computer rule); the host is the last.
3. **Not migrated, on purpose:** `bench/render/shims/plugin-runtime-runtime.ts` (`BrowserOpenURL`, a compat superset for old plugin commits in a benchmark, not page code), and the runtime's `Browser` export, which plugins import. Plugins can still call `Browser.OpenURL`; closing that is the audit gate's work (`Browser.OpenURL` is pinned `deny` for them), not this PR's.
4. **The ban.** `ui-next/shell/hostOpenerOnly.test.ts` scans `ui-next`, `ui`, `packages/omniviewdev-runtime/src` and `packages/omniviewdev-providers/lib` (not tests, bindings, probes or e2e) for a call of `Browser.OpenURL(` or `BrowserOpenURL(`; its control proves the scan finds a call and skips a comment. Put a direct call back and it fails (red run: 7 files before the migration).
5. **The seam and probe.** The seam's net for the opening call (`openUrlCallOf` in `ui-next/plugins/e2e/seam.check.mjs`) now recognises the host's opener by its id (`1691046826`, `main.AppService.OpenExternalURL`, as the generated binding carries it) and answers it with `{"opened":true}` (`openUrlAnswer`); the expectations for the terminal links, OSC 8 and both Ports checks are `['host-opener', 0, 0, address]`, and a call of the runtime's own `Browser.OpenURL` (object 9) fails them. The control names (`open-call`, `menu-opens`) follow the new message text. The URL probe's fixture opener stands in for `openExternal` at the same place as before (it records `window.__opened`); its comments now say what it stands in for.

## Commands

- Red then green: `npx vitest run packages/omniviewdev-runtime/src/openExternal.test.ts ui-next/plugins/host ui-next/shell/hostOpenerOnly.test.ts` (runtime package's own run for its test).
- `npx vitest run` of `ui-next/plugins/host`, the hostOpenerOnly test, `TerminalSessions.test.ts`, `ui-next/shell/panel/ports`, `ui/pages/plugins`: 87 files, 2,731 tests pass. `task check:ui-typecheck` (tsc app, tsc test, kit): exit 0. `tsc --noEmit` of the runtime and providers packages: exit 0. `pnpm lint`: the files of this change are clean after `eslint --fix` of the new test; the 8 warnings and the other errors it reports are in files this change does not touch.
- `task local:probes -- terminal-urls`: exit 0 (103 s). `task local:seam -- terminal-core,terminal-find`: exit 0 in both engines; the links phases report `[["host-opener",0,0,<address>]]` for a plain address and an OSC 8 link. Stable `pnpm build` then `node --test scripts/react-compiler.test.mjs scripts/ui-flavour.test.mjs`: 20 of 20 pass.

## Not verified

- A real host refusal in the app: the tests give the answer. The host's side is tested in `backend/pkg/opener` (#818).
- The providers package's `Call.ByName` against a running host (it compiles and its call name is the binding's FQN, `main.AppService.OpenExternalURL`).
