# Task 6 Report

## Status

Complete. Pruned dead functions and unnecessary exports from reachable UI modules while preserving live implementations and default exports:

- Removed `getLogger`, `downloadAsText`, `downloadAsJson`, their dead `downloadBlob` helper, `resetDevSharedDeps`, and `useDevBuildStream` with its stream-only types/imports.
- Made `formatAsText` and `terminalThemes` module-private.
- Removed the redundant named exports for `logger` and `BottomDrawerProvider`; both default exports remain unchanged.
- Reduced the telemetry barrel to the live `initTelemetry` value and `LogSink` type exports.
- Reduced the plugin barrel to its three live host exports: `PluginServiceProvider`, `usePluginService`, and `usePluginRoutes`.
- Made `SORT_OPTIONS` module-private.
- Removed the reference-free `terminalThemeOptions` export and implementation identified by the focused Knip run.

## Focused checks

- `pnpm dlx knip@latest --workspace . --include exports,types`: completed analysis and exited 1 because findings remain. It identified `terminalThemeOptions`, which was confirmed reference-free and removed. The remaining `LOG_LEVELS` export and 22 exported-type findings are outside the Task 6 file/export brief and were left unchanged.
- Focused repository reference searches under `ui`: passed; no remaining references to the removed functions, stream-only type, or terminal theme options, and no remaining named export declarations for `logger`, `BottomDrawerProvider`, `terminalThemes`, `formatAsText`, or `SORT_OPTIONS`.
- `pnpm exec tsc --noEmit -p tsconfig.app.json`: blocked before TypeScript diagnostics ran because pnpm reported `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` (the current overrides configuration differs from the lockfile). The lockfile was not changed because dependency repair is outside this task.
- `git diff --check`: passed after removing two trailing blank lines introduced by deletion.

## Fix round 1 symbol dispositions

The requested `xd://lsp` device was not mounted in this worker (`No such tool`; only `ast_edit` and `debug` were available), so each disposition below was verified with TypeScript's repository language service `getReferencesAtPosition` before editing:

- `LOG_LEVELS`: deleted; declaration was its only reference.
- `ConnectionStateTarget` and `ResourceStateItem`: removed only their unused `features/connectionState/index.ts` barrel re-exports; retained the canonical exported declarations because each has real cross-file consumers.
- `ResourceStateGroup`: deleted its barrel re-export and canonical declaration; the two declarations referenced only each other.
- `HomepageCardSection`: removed the unused runtime-type re-export.
- `ResourceSidebarView` and `ResourceSidebarViewProps`: deleted; the latter was referenced only by the former, with no consumers elsewhere.
- `PluginRendererProps`: made module-private; used only by `PluginRenderer` in its defining file.
- `BoundaryKind`: made module-private; used only by boundary declarations in its defining file.
- `ExtensionRenderContext`: removed its convenience re-export while retaining its type-only import for the same-file `ResourceExtensionRenderContext` declaration.
- `ExtensionContributionRegistration`: removed its unused type import and convenience re-export.
- `ExtensionPointValue`: made module-private; used only by `NormalizedContribution` in its defining file.
- `PluginWindow`: removed the unused convenience re-export.
- `PluginListItemProps`: made module-private; used only by `PluginListItem`.
- `FilterDimension`: made module-private; used only by declarations and implementation in `useLogSources.ts`.
- `LogDataSourceHandlers`: made module-private; used only by `LogDataSource` in its defining file.
- `AnsiSegment`: removed the redundant `parseAnsi.ts` re-export; retained the canonical exported declaration in `LogViewer/types.ts` because it has real cross-file consumers.
- `HeaderAreaLocation`, `HeaderAreaType`, `HeaderAreaItem`, and `HeaderIconModal`: made module-private; all references are within `store/header/types.ts`.
- `AppDispatch`: deleted; declaration was its only reference.
- `Icon|default`: language-service references showed three named-import consumers and multiple default-import consumers. Migrated the three named imports to the prevailing default style, removed only the redundant named export, and preserved the component/default export.

## Fix round 1 checks

- `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 dlx knip@latest --workspace . --include files,dependencies,exports,types,duplicates`: completed analysis and exited 1 with only `ui/providers/monaco/bootstrap.mock.ts` reported as unused. This is the documented false positive selected by the `process.env.VITEST` alias in `vite.config.ts`; it was retained.
- `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 exec tsc --noEmit`: passed with no output.

## Commit

`chore(ui): prune dead reachable exports`

## Concerns

None.
