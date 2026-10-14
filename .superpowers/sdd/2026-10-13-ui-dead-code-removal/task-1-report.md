# Task 1 implementation report

## Scope

Removed the unreachable legacy route, connection/resource-page, and local support surfaces listed in `task-1-brief.md`:

- `ui/routes.tsx`
- `ui/providers/PaneProvider.tsx`
- `ui/pages/[plugin]/`
- `ui/pages/connecting/index.tsx`
- `ui/pages/dashboard/index.tsx`
- `ui/layouts/core/main/PluginContainer/index.tsx`
- `ui/layouts/core/resource/`
- `ui/components/tables/Resources/`
- `ui/pkg/router/`
- `ui/pkg/navigation/`
- `ui/federation/index.tsx`
- `ui/federation/ResourceSidebarComponent.tsx`

No replacement, compatibility shim, route migration, or behavior change was added. `ui/federation/LinkedResourceDrawer.tsx` was retained after cumulative verification proved it is part of the active right-drawer dependency graph.

## Acceptance checks

- All brief-listed paths are absent except `ui/federation/LinkedResourceDrawer.tsx`, whose active import from `ui/providers/RightDrawerProvider.tsx` was proven by cumulative build verification.
- `git diff --exit-code -- ui/features/router/routes.tsx` exited successfully with no diff; the active route definition is unchanged.
- `git diff --name-only -- ui/providers/monaco/yaml.worker.bundle.js` produced no output; the generated YAML worker bundle is unchanged.

## Verification

### `pnpm build`

Result: **blocked before TypeScript/Vite execution** (exit code 1).

The workspace's pnpm dependency-status check attempted a frozen install and rejected the existing repository configuration because the current `overrides` configuration does not match the lockfile:

```text
[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] Cannot proceed with the frozen installation. The current "overrides" configuration doesn't match the value found in the lockfile

Update your lockfile using "pnpm install --no-frozen-lockfile"
```

No lockfile or dependency configuration was changed because those files are outside this deletion task.

### `pnpm dlx knip --include files`

Result: **analysis completed with pre-existing workspace errors and exited 2**.

Knip reported that these three plugin Vite configurations could not load the absent built package `@omniviewdev/vite-plugin/dist/index.cjs`:

- `plugins/containers/ui/vite.config.ts`
- `plugins/testui/ui/vite.config.ts`
- `plugins/aws/ui/vite.config.ts`

It then produced its file analysis (`Unused files (211)`). None of the deleted paths appeared in the Knip results, confirming that no deleted file remains for Knip to report or reference. The reported unused-file inventory is outside Task 1's scope.

## Fix round 1: restore active federation dependency

### Root cause

The initial static reachability conclusion incorrectly classified the entire `ui/federation/` tree as closed. Active `ui/providers/RightDrawerProvider.tsx` imports `createLinkedResourceDrawer` directly from `@/federation/LinkedResourceDrawer`, so deleting that module broke the active TypeScript graph.

### Restored dependency closure

Restored byte-for-byte from base commit `94485ccebb6b589f548077df1bcaa3e4837fc870`:

- `ui/federation/LinkedResourceDrawer.tsx`

That file's complete local import closure is already retained: its only local import is `@/components/errors/ErrorFallback`; all other imports are package dependencies (`react`, `react-error-boundary`, `@omniviewdev/ui/layout`, `@omniviewdev/ui/buttons`, `@omniviewdev/runtime`, `react-icons/lu`, `yaml`, and `@monaco-editor/react`). It imports neither of the other deleted federation modules. A UI-tree reference search found `RightDrawerProvider.tsx` as the only `@/federation` import and found no references to the deleted legacy federation files.

Still deleted as proven unused:

- `ui/federation/index.tsx`
- `ui/federation/ResourceSidebarComponent.tsx`

### Required follow-up build

Command: `COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 build`

Result: **blocked during `bundle:yaml-worker` before TypeScript/Vite execution** (exit code 1).

```text
> pnpm run bundle:yaml-worker && tsc && vite build

$ esbuild node_modules/monaco-yaml/yaml.worker.js --bundle --format=esm --outfile=ui/providers/monaco/yaml.worker.bundle.js --platform=browser
sh: esbuild: command not found
[ELIFECYCLE] Command failed.
ELIFECYCLE Command failed with exit code 1.
```

The command bypassed the earlier project package-manager mismatch as requested, but the worktree dependency installation does not provide the `esbuild` executable. No second build was run.

## Result

The unreachable legacy subgraphs and two unused federation files are deleted. The minimum live federation module required by the active right-drawer provider is restored byte-for-byte. The active router and generated Monaco YAML worker remain untouched, and no live UI behavior was migrated or modified. Verification and repository prerequisite failures are recorded above.
