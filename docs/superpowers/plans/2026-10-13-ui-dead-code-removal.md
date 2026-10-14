# UI Dead-Code Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove frontend code and dependencies that are unreachable from the active application and test entry points, prioritizing dead MUI-based surfaces without migrating any live UI.

**Architecture:** Treat `ui/main.tsx` plus Vite/Vitest entries as the roots. Use Knip for whole-program reachability, TypeScript LSP references for exported roots, and the active router in `ui/features/router/` as the route authority. Delete closed unreachable subgraphs, then rerun reachability after each cut so newly orphaned files and dependencies are removed without touching live MUI components.

**Tech Stack:** React 19, TypeScript, Vite, React Router, Redux Toolkit, pnpm, Knip, TypeScript language server.

**Spec:** User request dated 2026-10-13 in this work session.

## Global Constraints

- Work only on branch `feat/ui-migration` in `/Users/joshuapare/Repos/omniview.git/ui-migration`.
- Do not migrate live UI to another component library.
- Prioritize deletion of unreachable MUI and `@omniviewdev/ui` consumers.
- Exclude generated `ui/providers/monaco/yaml.worker.bundle.js` and declaration bootstrap `ui/vite-env.d.ts`.
- Preserve active routes from `ui/features/router/routes.tsx`: `/`, `/plugins`, `/plugins/:id`, `/settings`, and dynamic `/_plugin/*` routes.
- Use pnpm only. Build with `pnpm build`.
- Baseline evidence: `pnpm build` passes; `pnpm lint` has 1,520 pre-existing errors; `pnpm test -- --run` has 11 pre-existing failures and 12 unhandled errors across four files.

## Audit Evidence

- Knip, including tests: 114 unreachable TypeScript/TSX files totaling 11,730 lines.
- Of those, 41 import MUI directly (6,271 lines) and 8 more import `@omniviewdev/ui` without direct MUI imports (508 lines).
- LSP: `scoped` is referenced only by dead `ui/providers/PaneProvider.tsx`; `Renderer` has only its declaration; `AppContainerProvider` has no external reference.
- Active dynamic imports load external plugin URLs only; no local string-based loader reaches the candidates.
- `ui/assets/images/*` is byte-identical to `public/images/*`; all six UI copies are unreferenced.
- `ui/assets/avatars/*` has no import or string reference.
- `ui/providers/monaco/languages/nginx/register.ts` has no caller; its 872 KB `directives.json` is therefore unreachable.
- The browser-only Vite smoke could not settle outside Wails; final runtime smoke must use the available Wails/dev surface if it starts.

---

### Task 1: Remove unreachable legacy route and resource surfaces

**Files:**
- Delete: `ui/routes.tsx`
- Delete: `ui/providers/PaneProvider.tsx`
- Delete tree: `ui/pages/[plugin]/`
- Delete: `ui/pages/connecting/index.tsx`
- Delete: `ui/pages/dashboard/index.tsx`
- Delete: `ui/layouts/core/main/PluginContainer/index.tsx`
- Delete tree: `ui/layouts/core/resource/`
- Delete tree: `ui/components/tables/Resources/`
- Delete tree: `ui/pkg/router/`
- Delete tree: `ui/pkg/navigation/`
- Delete: `ui/federation/ResourceSidebarComponent.tsx`
- Delete: `ui/federation/index.tsx`
- Preserve: `ui/federation/LinkedResourceDrawer.tsx`, imported by the active right-drawer provider.

**Interfaces:**
- Consumes: active routes from `ui/features/router/routes.tsx` and plugin routes from `usePluginRoutes()`.
- Produces: no legacy `scoped` router, pane router, old plugin connection pages, or MUI resource table implementation.

- [x] Delete the listed closed import subgraphs.
- [x] Run `pnpm build`; final TypeScript and Vite build passed.
- [x] Run Knip file analysis; the sole retained test-alias exception is assessed in `docs/ui-dead-code-audit.md`.

### Task 2: Remove standalone unreachable UI components and assets

**Files:**
- Delete: `ui/components/ColorSchemeToggle.tsx`
- Delete tree: `ui/components/development/`
- Delete: `ui/components/displays/CodeEditor.tsx`
- Delete: `ui/components/displays/Loading.tsx`
- Delete: `ui/components/displays/Footer/index.tsx`
- Delete: `ui/layouts/core/main/Footer/index.tsx`
- Delete tree: `ui/components/displays/themes/`
- Delete tree: `ui/components/inputs/`
- Delete tree: `ui/components/selects/`
- Delete tree: `ui/assets/icons/`
- Delete: `ui/assets/logos/gcp/GCPColorWhiteBG.tsx`
- Delete: `ui/assets/logos/kubernetes/KubernetesColorWhiteBG.tsx`
- Delete: `ui/assets/logos/nomad/NomadColorWhite.tsx`
- Delete: `ui/assets/logos/terraform/horizontal/TerraformHorizontalBlack.tsx`
- Delete: `ui/assets/logos/terraform/horizontal/TerraformHorizontalColorBlack.tsx`
- Delete: `ui/assets/logos/terraform/horizontal/TerraformHorizontalWhite.tsx`
- Delete: `ui/assets/logos/terraform/vertical/TerraformVerticalBlack.tsx`
- Delete: `ui/assets/logos/terraform/vertical/TerraformVerticalColorBlack.tsx`
- Delete: `ui/assets/logos/terraform/vertical/TerraformVerticalColorWhite.tsx`
- Delete: `ui/assets/logos/terraform/vertical/TerraformVerticalWhite.tsx`
- Delete tree: `ui/assets/images/`
- Delete tree: `ui/assets/avatars/`
- Delete: `ui/index.css`
- Delete: `ui/oldtheme.ts`
- Delete: `ui/theme/index.ts`
- Delete: `ui/types/index.ts`

**Interfaces:**
- Consumes: no runtime interfaces; every listed source is absent from the production and test import graph.
- Produces: removal of dead MUI wrappers, duplicate assets, editor themes, and empty barrels.

- [x] Delete the listed components and static assets.
- [x] Preserve the active logo variants imported by `ui/pages/welcome.tsx`.
- [x] Preserve `public/images/*`, which are outside the requested UI-source cleanup and are the canonical copies.

### Task 3: Remove unreachable providers, contexts, hooks, and utilities

**Files:**
- Delete: `ui/providers/AppContainerProvider.tsx`
- Delete: `ui/providers/WindowProvider.tsx`
- Delete: `ui/providers/RightDrawer/index.tsx`
- Delete: `ui/providers/header/TabBarProvider.tsx`
- Delete: `ui/providers/plugin/PluginProvider.tsx`
- Delete: `ui/providers/BottomDrawer/types.ts`
- Delete: `ui/providers/BottomDrawer/containers/LogViewer/hooks/useLogStream.ts`
- Delete: `ui/providers/monaco/useSchemaRegistration.ts`
- Delete: `ui/providers/monaco/utils.ts`
- Delete tree: `ui/providers/monaco/languages/nginx/`
- Delete: `ui/contexts/BottomDrawerContext.tsx`
- Delete: `ui/contexts/PaneContext.tsx`
- Delete: `ui/contexts/PluginContext.tsx`
- Delete: `ui/contexts/RightDrawerContext.tsx`
- Delete: `ui/contexts/SidebarContext.ts`
- Delete: `ui/hooks/useBottomDrawer.ts`
- Delete: `ui/hooks/usePanes.ts`
- Delete: `ui/hooks/useRightDrawer.ts`
- Delete: `ui/hooks/useScript.ts`
- Delete: `ui/hooks/useWindow.ts`
- Delete tree: `ui/hooks/header/`
- Delete: `ui/hooks/resource/useResourceDefinition.tsx`
- Delete: `ui/features/extensions/sidebar/view/extension.ts`
- Delete: `ui/features/logger/patchConsole.ts`
- Delete: `ui/features/logger/useLogger.tsx`
- Delete: `ui/features/telemetry/faro.ts`
- Delete: `ui/features/telemetry/tracing.ts`
- Delete: `ui/events/index.ts`
- Delete: `ui/utils/color.ts`
- Delete: `ui/utils/index.ts`
- Delete: `ui/utils/language.ts`
- Delete: `ui/utils/resources.ts`
- Delete: `ui/utils/sort.ts`
- Delete: `ui/utils/time.ts`
- Delete: `ui/utils/units.ts`
- Delete: `ui/wdyr.ts`

**Interfaces:**
- Consumes: active providers wired in `ui/App.tsx`; active Monaco bootstrap in `ui/providers/monaco/bootstrap.ts`.
- Produces: removal of legacy duplicated context/provider stacks and unused utility barrels.

- [x] Delete the listed files and the uncalled Nginx language registration data.
- [x] Keep `ui/providers/monaco/yaml.worker.bundle.js`; it is generated by `bundle:yaml-worker` and imported by active bootstrap code.
- [x] Keep `ui/providers/monaco/bootstrap.mock.ts`; Vitest resolves the Monaco bootstrap alias to it in `vite.config.ts`.

### Task 4: Remove UI that is test-only or superseded inside live feature folders

**Files:**
- Delete: `ui/pages/plugins/DevModeSection.tsx`
- Delete: `ui/pages/plugins/InstalledPluginCard.tsx`
- Delete: `ui/features/plugins/components/PluginLoadErrorPage.tsx`
- Delete: `ui/providers/BottomDrawer/containers/LogViewer/utils/stripAnsi.ts`
- Delete: `ui/providers/BottomDrawer/containers/LogViewer/utils/stripAnsi.spec.ts`
- Delete: `ui/providers/BottomDrawer/containers/LogViewer/utils/stripAnsi.bench.ts`

**Interfaces:**
- Consumes: active plugin list/detail implementation and active single-pass `parseAnsi` implementation.
- Produces: one plugin-management UI path and one ANSI parsing path.

- [x] Delete the unused plugin cards/error page.
- [x] Delete `stripAnsi` and its tests/benchmark; LSP reports no production reference and `parseAnsi` already supplies the active plain-text output.

### Task 5: Remove registered-but-unconsumed Redux state

**Files:**
- Modify: `ui/store/store.ts`
- Delete tree: `ui/store/tabs/`
- Delete tree: `ui/store/settings/`
- Modify: `ui/store/header/slice.ts`
- Modify: `ui/store/header/configurations.ts`
- Delete tree: `ui/store/header/sections/`

**Interfaces:**
- Consumes: `Header` reads only `state.header.areas`.
- Produces: a static header reducer/state; no `tabs` or `settings` keys in `RootState`.

- [x] Remove `tabsReducer` and `settingsReducer` from `ui/store/store.ts`.
- [x] Replace the unused header action reducers with a reducer that returns `TabsWithSearch`.
- [x] Delete unused header presets `ContextWithSearch`, `TabsWithItems`, the `configurations` registry, and all uncalled header actions/selectors.
- [x] Run TypeScript diagnostics; final build evidence and the unresolved import regression are recorded in the audit.

### Task 6: Prune dead functions and unnecessary exports in reachable modules

**Files:**
- Modify: `ui/features/telemetry/index.ts`
- Modify: `ui/features/logger/index.ts`
- Modify: `ui/providers/BottomDrawer/provider.tsx`
- Modify: `ui/providers/BottomDrawer/containers/terminalThemes.ts`
- Modify: `ui/providers/BottomDrawer/containers/LogViewer/utils/downloadLogs.ts`
- Modify: `ui/features/plugins/adapters/devSharedDeps.ts`
- Modify: `ui/hooks/plugin/useDevServer.ts`
- Modify: `ui/pages/plugins/PluginFilterPopover.tsx`
- Modify: `ui/features/plugins/index.ts`

**Interfaces:**
- Consumes: existing internal references.
- Produces: smaller internal export surface with no compatibility aliases.

- [x] Delete `getLogger`, `downloadAsText`, `downloadAsJson`, their now-dead `downloadBlob`, `resetDevSharedDeps`, and `useDevBuildStream` plus its private types/imports.
- [x] Make `formatAsText` and `terminalThemes` private because only same-file code uses them.
- [x] Remove redundant named exports where only the default export is consumed (`logger`, `BottomDrawerProvider`).
- [x] Remove unused plugin/telemetry barrel re-exports and `SORT_OPTIONS` export without deleting internally used implementations.
- [x] Run Knip again; retained findings are assessed in `docs/ui-dead-code-audit.md`.

### Task 7: Remove dependencies orphaned by the cutover

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: package imports remaining after Tasks 1–6.
- Produces: dependency declarations matching the reachable source graph.

- [x] Remove confirmed runtime dependencies: `@grafana/faro-web-sdk`, `@grafana/faro-web-tracing`, `@omniviewdev/providers`, `@opentelemetry/core`, `@opentelemetry/resources`, `@opentelemetry/sdk-trace-base`, `immer`, `jsonpath`, `lodash.get`, `monaco-editor-nginx`, `prettier`, `react-use`, and `tinycolor2`.
- [x] Remove orphaned types: `@types/jsonpath`, `@types/lodash.get`, and `@types/tinycolor2` when their source packages are gone.
- [x] Remove confirmed unused development dependencies after config checks: `@tanstack/react-query-devtools`, `@welldone-software/why-did-you-render`, `autoprefixer`, `eslint-config-love`, `eslint-plugin-n`, `eslint-plugin-promise`, `eslint-plugin-react`, `identity-obj-proxy`, and `ts-node`.
- [x] Use pnpm so the lockfile is updated by pnpm.
- [x] Keep MUI, Emotion, and `@omniviewdev/ui`; active UI still imports them and migration is out of scope.

### Task 8: Verify and document the deletion

**Files:**
- Modify: `docs/superpowers/plans/2026-10-13-ui-dead-code-removal.md` with checked steps and final counts.
- Modify: `ui/App.tsx` and `ui/features/plugins/README.md` to remove stale prose references.
- Create: `docs/ui-dead-code-audit.md`.

**Interfaces:**
- Consumes: cleaned source tree.
- Produces: reproducible evidence for the migration-prep branch.

- [x] Run `pnpm build`; final TypeScript and Vite build passed.
- [x] Run Knip and assess every finding; only the configured Vitest alias target `ui/providers/monaco/bootstrap.mock.ts` remains.
- [x] Run targeted retained-path tests and the full suite; full result: 42 passed files, 4 failed files, 827 passed tests, 11 failed tests, and 12 unhandled errors, matching baseline failure counts and identities.
- [x] Run `pnpm lint`; 1,310 errors versus the 1,520-error baseline, with changed-file diagnostics documented.
- [x] Start the actual Wails surface through a temporary pnpm 10 shim and browser-smoke all requested route shapes; runtime observations are recorded in the audit.
- [x] Record final metrics: 148 deleted UI files, 13,714 net TypeScript/TSX lines removed (13,743 removed, 29 added), 3,577,834 deleted bytes, 41 direct-MUI files/6,271 lines removed, and 25 manifest declarations removed.
- [x] Remove the two stale prose references and publish `docs/ui-dead-code-audit.md`.
