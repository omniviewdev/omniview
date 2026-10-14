# Task 8 Report

## Status

Task 8 documentation and stale-prose cleanup are complete, but cumulative verification is **not green**. The implementation head contains a retained import of deleted `ui/federation/LinkedResourceDrawer`, Knip still reports reviewed candidates, and Wails could not launch a usable surface.

## Changes

- Removed the stale `DevModeSection` mention from `ui/App.tsx` without changing runtime code.
- Removed the deleted `PluginLoadErrorPage.tsx` entry from `ui/features/plugins/README.md`.
- Added `docs/ui-dead-code-audit.md` with categorized inventory, metrics, exclusions, retained candidates, and exact verification outcomes.
- Updated the implementation plan checkboxes and final counts.

## Metrics (`94485ccebb6b589f548077df1bcaa3e4837fc870..2a0fbf38`)

- 149 deleted UI files.
- 13,788 deleted TypeScript/TSX lines.
- 3,582,625 deleted bytes (sum of deleted Git blob sizes).
- 40 deleted direct-MUI files totaling 6,232 lines.
- Root manifest declarations: 87 to 62, a reduction of 25.

## Checks

1. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 install --frozen-lockfile`
   - PASS, pnpm 10.34.7; lockfile current; generated YAML worker rebuilt.
2. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 build`
   - FAIL during Vite after TypeScript: `ui/providers/RightDrawerProvider.tsx` imports missing `ui/federation/LinkedResourceDrawer`.
3. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 dlx knip@latest --workspace . --include files,dependencies,exports,types,duplicates`
   - EXIT 1. Findings: 1 unused file (`ui/layouts/core/main/Footer/index.tsx`), 1 unused export (`LOG_LEVELS`), 22 unused exported types, and 1 duplicate export (`Icon|default`). No unused dependency finding. All retained for explicit review rather than deletion.
4. Targeted retained-path invocation: `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 test -- --run ui/features/plugins/components/consumerMigration.test.ts ui/features/telemetry ui/providers/BottomDrawer/__tests__/provider.test.tsx ui/features/router/routeProvider.test.tsx`
   - The script already runs `vitest run`; passthrough caused the full suite to execute. 40 passed files, 6 failed files; 792 passed tests, 5 failed tests; 12 unhandled errors.
5. Full comparison: `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 test -- --run`
   - Same result: 40 passed files, 6 failed files; 792 passed tests, 5 failed tests; 12 unhandled errors. Baseline: 43 passed files, 4 failed files, 11 failed tests, 12 unhandled errors. New suite failures include unresolved deleted federation and Monaco imports; existing plugin-context and terminal failures remain.
6. `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 lint`
   - EXIT 1 with 1,308 errors, reduced from 1,520 baseline errors. The Task 8 comment line has no diagnostic. Several reachable files changed by earlier tasks still have diagnostics, so the cumulative change cannot be certified as adding none from aggregate evidence.
7. Wails smoke:
   - `task dev` failed because `127.0.0.1:9245` was already in use.
   - `WAILS_VITE_PORT=9255 task dev` entered the Wails build but failed when its internal plain `pnpm install` reported `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` for overrides.
   - No usable Wails surface was launched; core and plugin routes were not visually exercised. Both attempted Task 8 processes exited, leaving no service to terminate.

## Preserved/excluded

- `ui/providers/monaco/yaml.worker.bundle.js`: generated and preserved.
- `ui/vite-env.d.ts`: declaration bootstrap preserved.
- MUI, Emotion, and `@omniviewdev/ui`: retained due to active imports.

## Commit

Pending at report creation; commit only the two prose edits, plan, public audit, and this internal report. Generated outputs are unchanged and must remain outside the commit.
