# Task 3 Report: Unreachable providers, contexts, hooks, and utilities

## Scope completed

Deleted all 41 brief-listed files, including both requested directory trees:

- Removed the obsolete provider stack (`AppContainerProvider`, `WindowProvider`, the legacy `RightDrawer`, header tab bar, plugin provider, legacy bottom-drawer types, and the unused log-stream hook).
- Removed the legacy Monaco mock, schema-registration hook, model utilities, and the complete uncalled Nginx language registration tree.
- Removed the five unreachable context modules and seven unreachable hook modules, including the complete `ui/hooks/header/` tree.
- Removed the unused resource-definition hook, extension sidebar registration, logger helpers, telemetry setup modules, event barrel, utility modules/barrel, and WDYR setup.

The resulting source diff is 41 deleted files and 10,526 removed lines, with no source additions or modifications.

## Preserved active surfaces

Confirmed the following required files remain present and unchanged:

- `ui/App.tsx`, including the active application providers.
- `ui/providers/monaco/bootstrap.ts`, including the active Monaco bootstrap.
- `ui/providers/monaco/yaml.worker.bundle.js`, the generated YAML worker imported by the bootstrap.
- `ui/vite-env.d.ts`, the Vite environment declaration.

No UI migration, redesign, replacement implementation, source-structure test, dependency update, or unrelated source edit was added.

## Verification

### Scope and retention check

`git status --short` and `git diff --stat` reported exactly 41 source-file deletions, no modified source files, and no untracked files before this report was created. Explicit file checks confirmed `ui/App.tsx`, `ui/providers/monaco/bootstrap.ts`, `ui/providers/monaco/yaml.worker.bundle.js`, and `ui/vite-env.d.ts` remain.

### `pnpm build`

Result: **blocked before TypeScript/Vite execution** (exit code 1).

The workspace dependency-status check attempted a frozen pnpm install and rejected the existing repository configuration because the current `overrides` configuration does not match the lockfile:

```text
[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] Cannot proceed with the frozen installation. The current "overrides" configuration doesn't match the value found in the lockfile

Update your lockfile using "pnpm install --no-frozen-lockfile"
```

No lockfile or dependency configuration was changed because those files are outside this deletion task.

### `pnpm dlx knip --include files`

Result: **analysis completed with pre-existing workspace errors and exited 2**.

Knip could not load three plugin Vite configurations because their local `@omniviewdev/vite-plugin/dist/index.cjs` modules are absent:

- `plugins/containers/ui/vite.config.ts`
- `plugins/testui/ui/vite.config.ts`
- `plugins/aws/ui/vite.config.ts`

It then reported the repository's existing set of unused-file findings. None of the 41 deleted Task 3 paths appeared in the output.

## Outcome

The exact Task 3 dead provider/context/hook/utility surface and uncalled Nginx registration data are removed. The active App provider composition, Monaco bootstrap, generated YAML worker, and Vite declaration remain intact. Verification blockers are repository prerequisites outside this deletion-only task.
