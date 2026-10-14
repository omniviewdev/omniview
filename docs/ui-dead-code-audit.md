# UI Dead-Code Audit

## Scope and method

This audit compares base `94485ccebb6b589f548077df1bcaa3e4837fc870` with implementation head `f7ee9423554d6cbe37e576f2da2a50bc0539e5b0`. The production roots were `ui/main.tsx`, the active router, and the Vite/Vitest entries. Deletions were limited to closed, unreachable UI subgraphs and their orphaned dependencies; reachable MUI, Emotion, and `@omniviewdev/ui` code remains.

Reproduce the file inventory with:

```sh
git diff --diff-filter=D --name-only 94485ccebb6b589f548077df1bcaa3e4837fc870..f7ee9423554d6cbe37e576f2da2a50bc0539e5b0 -- ui
```

## Metrics

| Measure | Result |
| --- | ---: |
| Deleted UI files | 148 |
| Net TypeScript/TSX line reduction | 13,714 (13,743 removed, 29 added) |
| Deleted bytes (sum of deleted Git blobs) | 3,577,834 |
| Deleted files importing MUI directly | 41 |
| Lines in deleted direct-MUI files | 6,271 |
| Root manifest dependencies + devDependencies | 87 → 62 (25 removed) |

Reproduce the source-line metric with:

```sh
git diff --shortstat 94485ccebb6b589f548077df1bcaa3e4837fc870..f7ee9423554d6cbe37e576f2da2a50bc0539e5b0 -- 'ui/**/*.ts' 'ui/**/*.tsx'
```

This reports `156 files changed, 29 insertions(+), 13743 deletions(-)`, a net reduction of 13,714 lines.

The broader Git diff reports 21,785 deleted text lines because it also counts non-TypeScript data, notably the uncalled Nginx directives JSON. Metrics exclude modifications to reachable files and lockfile churn.

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
- `ui/federation/ResourceSidebarComponent.tsx`
- `ui/federation/index.tsx`

### Standalone components and assets

- `ui/components/ColorSchemeToggle.tsx`
- `ui/components/development/InfoPanel.tsx`
- `ui/components/displays/CodeEditor.tsx`
- `ui/components/displays/Loading.tsx`
- `ui/components/displays/Footer/index.tsx`
- `ui/layouts/core/main/Footer/index.tsx`
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
- `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 build`: passed. TypeScript and Vite completed, transforming 17,213 modules. Vite retained its existing ineffective-dynamic-import warning for `devSharedDeps.ts`.
- Knip (`--include files,dependencies,exports,types,duplicates`): the only finding is `ui/providers/monaco/bootstrap.mock.ts`. It is intentionally retained because `vite.config.ts` aliases `@/providers/monaco/bootstrap` to it whenever `process.env.VITEST` is set (lines 58–60), a configuration edge Knip does not recognize.
- Targeted direct Vitest covered both Monaco schema-registry suites, plugin consumer migration, router, bottom-drawer provider, and telemetry: 9 passed files and 1 failed file; 67 passed tests and 1 failed test. The existing `schemaRegistry.test.ts` flush assertion did not observe `monacoYaml.update`.
- Full `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 test -- --run`: 42 passed files, 4 failed files; 827 passed tests, 11 failed tests; 12 unhandled errors. The failed suites are `PluginContextProvider.spec.tsx`, `schemaRegistry.test.ts`, `Terminal.test.tsx`, and `BottomDrawer.test.tsx`, matching the four-file/11-test/12-error baseline. The passed-file count is one below the 43-file baseline because the passing `stripAnsi.spec.ts` was intentionally deleted with its unused implementation.
- `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 lint`: 1,310 errors, down from the 1,520-error baseline. Diagnostics remain in 18 files modified by this cleanup: `App.tsx`, connection-state types, logger, plugin dev shared dependencies, plugin renderer and surface boundary, plugin consumer test and core types, `useDevServer`, header context area, plugin filter/list items, log-source hook/types/download/ANSI parser, bottom-drawer provider, and header configuration. The Task 8 prose-only line itself has no diagnostic; the red baseline prevents a whole-suite green claim.
- Wails smoke used `task dev` with an external temporary `pnpm` shim that executed `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10`. The native build, Vite server, and Wails application started and connected. A real Chromium session visited `/`, `/plugins`, `/plugins/aws`, `/settings`, and `/_plugin/aws`; every URL loaded an `Omniview` document but remained on the `Omniview / The IDE for / DEVELOPMENT MODE` splash. Browser page-error capture was empty, while the console saturated with repeated `[bridgeSink] DiagnosticsClient.Log failed: [object Object]` messages. The Wails log also recorded the installed AWS plugin repeatedly crashing because `omniview.sdk.resource.v1.ResourcePlugin` was unimplemented and exhausting its crash budget. The browser and managed Wails service were stopped afterward.

## Retained candidates and limitations

Knip's sole retained candidate, `ui/providers/monaco/bootstrap.mock.ts`, is active through the Vitest alias in `vite.config.ts`. Dynamic plugin modules are externally loaded and cannot be proven unreachable from static local analysis. Generated `ui/providers/monaco/yaml.worker.bundle.js` and declaration bootstrap `ui/vite-env.d.ts` are intentionally preserved and excluded from deletion metrics. `ui/federation/LinkedResourceDrawer.tsx` is also preserved because the active `RightDrawerProvider` imports it.
