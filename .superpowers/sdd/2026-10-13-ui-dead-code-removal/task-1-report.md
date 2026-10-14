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
- `ui/federation/`

This deletes 44 tracked files and 5,539 lines. No replacement, compatibility shim, route migration, or behavior change was added.

## Acceptance checks

- All brief-listed paths are absent from the worktree.
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

## Result

The requested closed legacy subgraph is deleted, the active router and generated Monaco YAML worker remain untouched, and no live UI behavior was migrated or modified. Verification is recorded above with the repository prerequisite failures preserved verbatim.
