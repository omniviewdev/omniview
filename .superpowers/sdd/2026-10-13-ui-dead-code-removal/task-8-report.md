# Task 8 Report

## Status

Task 8 documentation and stale-prose cleanup are complete. The cumulative cleanup builds successfully, Knip has one documented test-configuration exception, and the full Vitest failure counts and identities match the recorded red baseline. The Wails application starts, but browser smoke remains on the development-mode splash while diagnostics logging and an incompatible installed AWS plugin fail repeatedly.

## Changes

- Removed the stale `DevModeSection` mention from `ui/App.tsx` without changing runtime code.
- Removed the deleted `PluginLoadErrorPage.tsx` entry from `ui/features/plugins/README.md`.
- Added `docs/ui-dead-code-audit.md` with categorized inventory, metrics, exclusions, retained candidates, and exact verification outcomes.
- Corrected the audit after restoring active `LinkedResourceDrawer.tsx` and Vitest-only `bootstrap.mock.ts`, deleting the residual unused footer and pruning confirmed dead exports/types.
- Updated the implementation plan checkboxes and final counts.

## Metrics (`94485ccebb6b589f548077df1bcaa3e4837fc870..f7ee9423554d6cbe37e576f2da2a50bc0539e5b0`)

- 148 deleted UI files.
- 13,714 net TypeScript/TSX lines removed (13,743 removed, 29 added), measured with `git diff --shortstat 94485ccebb6b589f548077df1bcaa3e4837fc870..f7ee9423554d6cbe37e576f2da2a50bc0539e5b0 -- 'ui/**/*.ts' 'ui/**/*.tsx'`.
- 3,577,834 deleted bytes (sum of deleted Git blob sizes).
- 41 deleted direct-MUI files totaling 6,271 lines.
- Root manifest declarations: 87 to 62, a reduction of 25.

## Checks

1. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 install --frozen-lockfile`
   - PASS with pnpm 10.34.7; lockfile current; generated YAML worker rebuilt.
2. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 build`
   - PASS. TypeScript and Vite completed; 17,213 modules transformed. Vite emitted the existing ineffective-dynamic-import warning for `devSharedDeps.ts`.
3. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 dlx knip@latest --workspace . --include files,dependencies,exports,types,duplicates`
   - EXIT 1 with one unused-file report: `ui/providers/monaco/bootstrap.mock.ts`. Retained because `vite.config.ts:58-60` aliases `@/providers/monaco/bootstrap` to that file under `process.env.VITEST`; Knip does not follow that environment-conditional configuration edge. No dependency/export/type/duplicate finding remains.
4. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 exec vitest run ui/providers/monaco/schemaRegistry.spec.ts ui/providers/monaco/__tests__/schemaRegistry.test.ts ui/features/plugins/components/consumerMigration.test.ts ui/features/router/routeProvider.test.tsx ui/providers/BottomDrawer/__tests__/provider.test.tsx ui/features/telemetry`
   - 9 passed files, 1 failed file; 67 passed tests, 1 failed test. The existing Monaco schema-registry flush assertion did not observe `monacoYaml.update`.
5. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 test -- --run`
   - 42 passed files, 4 failed files; 827 passed tests, 11 failed tests; 12 unhandled errors. Failed suites: `PluginContextProvider.spec.tsx`, `schemaRegistry.test.ts`, `Terminal.test.tsx`, and `BottomDrawer.test.tsx`. These counts and identities match the four-file/11-test/12-error baseline. Passed files decreased from 43 because the passing `stripAnsi.spec.ts` was intentionally deleted with its unused implementation.
6. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 lint`
   - EXIT 1 with 1,310 errors, down from the 1,520-error baseline. Eighteen modified live/test files still have diagnostics: `App.tsx`, `features/connectionState/types.ts`, `features/logger/index.ts`, `features/plugins/adapters/devSharedDeps.ts`, `PluginRenderer.tsx`, `PluginSurfaceBoundary.tsx`, `consumerMigration.test.ts`, `features/plugins/core/types.ts`, `useDevServer.ts`, `HeaderContextArea.tsx`, `PluginFilterPopover.tsx`, `PluginListItem.tsx`, `useLogSources.ts`, LogViewer `types.ts`, `downloadLogs.ts`, `parseAnsi.ts`, BottomDrawer `provider.tsx`, and header `configurations.ts`. The Task 8 prose-only line has no diagnostic; no whole-suite green claim is made.
7. Wails smoke:
   - Created an external temporary `pnpm` shim that executes `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 "$@"`, prepended it to `PATH`, and launched `task dev` on port 9245.
   - Native build, Vite, and Wails started; Wails connected to the frontend server.
   - A real managed Chromium browser visited `/`, `/plugins`, `/plugins/aws`, `/settings`, and `/_plugin/aws`. Each URL returned title `Omniview` and rendered only `Omniview / The IDE for / DEVELOPMENT MODE`.
   - Browser page-error capture remained empty. The console saturated with `[bridgeSink] DiagnosticsClient.Log failed: [object Object]`.
   - Wails logs showed the installed AWS plugin repeatedly failing with unimplemented `omniview.sdk.resource.v1.ResourcePlugin`, restarting, and exhausting its crash budget.
   - Browser and Wails service were stopped cleanly; the external shim was removed.

## Preserved/excluded

- `ui/providers/monaco/yaml.worker.bundle.js`: generated and preserved.
- `ui/vite-env.d.ts`: declaration bootstrap preserved.
- `ui/providers/monaco/bootstrap.mock.ts`: retained Vitest alias target.
- `ui/federation/LinkedResourceDrawer.tsx`: retained active right-drawer dependency.
- MUI, Emotion, and `@omniviewdev/ui`: retained due to active imports.

## Commit

Commit only the corrected audit, plan, and this internal report. Generated build outputs remain excluded.
