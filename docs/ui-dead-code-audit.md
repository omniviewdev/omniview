# UI Dead-Code Audit

## Scope and method

This audit compares base `94485ccebb6b589f548077df1bcaa3e4837fc870` with implementation head `2a0fbf38`. The production roots were `ui/main.tsx`, the active router, and the Vite/Vitest entries. Deletions were limited to closed, unreachable UI subgraphs and their orphaned dependencies; reachable MUI, Emotion, and `@omniviewdev/ui` code remains.

Reproduce the file inventory with:

```sh
git diff --diff-filter=D --name-only 94485ccebb6b589f548077df1bcaa3e4837fc870..2a0fbf38 -- ui
```

## Metrics

| Measure | Result |
| --- | ---: |
| Deleted UI files | 149 |
| Deleted TypeScript/TSX source lines | 13,788 |
| Deleted bytes (sum of deleted Git blobs) | 3,582,625 |
| Deleted files importing MUI directly | 40 |
| Lines in deleted direct-MUI files | 6,232 |
| Root manifest dependencies + devDependencies | 87 → 62 (25 removed) |

The broader Git diff reports 21,815 deleted text lines because it also counts non-TypeScript data, notably the uncalled Nginx directives JSON. Metrics exclude modifications to reachable files and lockfile churn.

## Deletion inventory

### Legacy routes, resource UI, and federation

- `ui/routes.tsx`
- `ui/pages/[plugin]/` (all 14 files)
- `ui/pages/connecting/index.tsx`
- `ui/pages/dashboard/index.tsx`
- `ui/layouts/core/main/PluginContainer/index.tsx`
- `ui/layouts/core/resource/` (3 files)
- `ui/components/tables/Resources/` (21 files)
- `ui/pkg/router/` (3 files)
- `ui/pkg/navigation/` (2 files)
- `ui/federation/` (3 files)

### Standalone components and assets

- `ui/components/ColorSchemeToggle.tsx`
- `ui/components/development/InfoPanel.tsx`
- `ui/components/displays/CodeEditor.tsx`
- `ui/components/displays/Loading.tsx`
- `ui/components/displays/Footer/index.tsx`
- `ui/components/displays/themes/BrillianceBlack.ts`
- `ui/components/displays/themes/GithubDark.ts`
- `ui/components/inputs/SearchInput.tsx`
- `ui/components/inputs/index.ts`
- `ui/components/selects/MultipleSelect.tsx`
- `ui/components/selects/NamespaceSelect.tsx`
- `ui/assets/icons/GoogleIcons.tsx`
- `ui/assets/icons/KubernetesLogo.tsx`
- `ui/assets/icons/MuiLogo.tsx`
- `ui/assets/logos/gcp/GCPColorWhiteBG.tsx`
- `ui/assets/logos/kubernetes/KubernetesColorWhiteBG.tsx`
- `ui/assets/logos/nomad/NomadColorWhite.tsx`
- `ui/assets/logos/terraform/horizontal/{TerraformHorizontalBlack,TerraformHorizontalColorBlack,TerraformHorizontalWhite}.tsx`
- `ui/assets/logos/terraform/vertical/{TerraformVerticalBlack,TerraformVerticalColorBlack,TerraformVerticalColorWhite,TerraformVerticalWhite}.tsx`
- `ui/assets/images/{app_preview.png,app_preview_2.png,clouds.webp,cover.webp,mountains.webp,stars.webp}`
- `ui/assets/avatars/{person1x24.jpeg,person1x48.jpeg,person2x24.jpeg,person2x48.jpeg,person3x24.jpeg,person3x48.jpeg,person4x24.jpeg,person4x48.jpeg,person5x40.jpeg,person5x80.jpeg}`
- `ui/index.css`
- `ui/oldtheme.ts`
- `ui/theme/index.ts`
- `ui/types/index.ts`

The six `ui/assets/images/*` files were byte-identical, unreferenced duplicates of retained `public/images/*` files. Active logo variants used by the welcome page were preserved.

### Providers, contexts, hooks, utilities, and telemetry

- `ui/providers/AppContainerProvider.tsx`
- `ui/providers/WindowProvider.tsx`
- `ui/providers/RightDrawer/index.tsx`
- `ui/providers/header/TabBarProvider.tsx`
- `ui/providers/plugin/PluginProvider.tsx`
- `ui/providers/BottomDrawer/types.ts`
- `ui/providers/BottomDrawer/containers/LogViewer/hooks/useLogStream.ts`
- `ui/providers/monaco/bootstrap.mock.ts`
- `ui/providers/monaco/useSchemaRegistration.ts`
- `ui/providers/monaco/utils.ts`
- `ui/providers/monaco/languages/nginx/{conf.ts,directives.json,register.ts,suggestions.ts}`
- `ui/providers/PaneProvider.tsx`
- `ui/contexts/{BottomDrawerContext.tsx,PaneContext.tsx,PluginContext.tsx,RightDrawerContext.tsx,SidebarContext.ts}`
- `ui/hooks/header/{area.ts,main.ts}`
- `ui/hooks/resource/useResourceDefinition.tsx`
- `ui/hooks/{useBottomDrawer.ts,usePanes.ts,useRightDrawer.ts,useScript.ts,useWindow.ts}`
- `ui/features/extensions/sidebar/view/extension.ts`
- `ui/features/logger/{patchConsole.ts,useLogger.tsx}`
- `ui/features/telemetry/{faro.ts,tracing.ts}`
- `ui/events/index.ts`
- `ui/utils/{color.ts,index.ts,language.ts,resources.ts,sort.ts,time.ts,units.ts}`
- `ui/wdyr.ts`

### Superseded feature UI and tests

- `ui/pages/plugins/DevModeSection.tsx`
- `ui/pages/plugins/InstalledPluginCard.tsx`
- `ui/features/plugins/components/PluginLoadErrorPage.tsx`
- `ui/providers/BottomDrawer/containers/LogViewer/utils/{stripAnsi.ts,stripAnsi.spec.ts,stripAnsi.bench.ts}`

### Registered but unconsumed Redux state

- `ui/store/tabs/{helpers.ts,slice.ts,types.ts}`
- `ui/store/settings/{helpers.ts,slice.ts,types.ts}`
- `ui/store/settings/sections/{appearance.ts,clouds.ts,editor.ts,general.ts,notifications.ts,terminal.ts}`
- `ui/store/header/sections/{area.ts,main.ts}`

Reachable store files were narrowed in place rather than deleted.

## Dependency cleanup

The root manifest dropped 25 declarations: 16 runtime/type packages and 9 development packages. MUI, Emotion, and `@omniviewdev/ui` remain because reachable UI imports them.

## Verification evidence

All commands used Corepack pnpm 10 (`pnpm 10.34.7`).

- `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 install --frozen-lockfile`: passed; lockfile was current and the YAML worker bundle regenerated.
- `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 build`: failed after TypeScript at Vite bundling. `ui/providers/RightDrawerProvider.tsx` still imports deleted `ui/federation/LinkedResourceDrawer`. This is a cleanup regression versus the passing baseline.
- Knip (`--include files,dependencies,exports,types,duplicates`): no unused dependencies, but one unused file (`ui/layouts/core/main/Footer/index.tsx`), one unused export (`LOG_LEVELS`), 22 unused exported types, and duplicate `Icon|default` exports remain. These are retained pending caller/API review; they were not blindly deleted.
- Targeted retained-path selection included plugin consumer migration, telemetry, bottom-drawer provider, and route-provider tests. Because the package script already invokes `vitest run`, the appended `-- --run …` was treated as passthrough and Vitest ran the whole suite. Result: 40 passed files, 6 failed files; 792 passed tests, 5 failed tests; 12 unhandled errors.
- Full `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 test -- --run`: same result. Baseline was 43 passed files, 4 failed files, 11 failed tests, and 12 unhandled errors. New failed suites are caused by unresolved imports of deleted `ui/federation/LinkedResourceDrawer` and the absent-at-transform-time Monaco bootstrap; existing plugin-context and terminal failures remain.
- `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 lint`: 1,308 errors, down from the 1,520-error baseline. The Task 8 prose-only line in `ui/App.tsx` introduced no diagnostic. Reachable files changed by earlier cleanup still have diagnostics (including logger, plugin dev dependencies, plugin consumer migration, `useDevServer`, plugin filtering, log download, bottom-drawer provider, and header configuration), so a no-new-diagnostics claim cannot be established from aggregate output alone.
- `task dev` on the configured port could not start because `127.0.0.1:9245` was already in use. A second isolated attempt, `WAILS_VITE_PORT=9255 task dev`, failed during the Wails build because its internal plain `pnpm install` rejected the lockfile with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` (lockfile overrides did not match `package.json`). No usable Wails surface was launched, so `/`, `/plugins`, `/plugins/:id`, `/settings`, and plugin routes were not visually exercised. The failed processes exited; no Task 8 service remained running.

## Retained candidates and limitations

Knip findings are candidates, not deletion instructions. The remaining footer file, export, exported types, and duplicate icon export require confirmation against runtime/plugin API consumers. Dynamic plugin modules are externally loaded and cannot be proven unreachable from static local analysis. Generated `ui/providers/monaco/yaml.worker.bundle.js` and declaration bootstrap `ui/vite-env.d.ts` are intentionally preserved and excluded from deletion metrics.
