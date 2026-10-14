# Task 3 Report: Unreachable providers, contexts, hooks, and utilities

## Scope completed

Deleted the 40 confirmed unreachable brief-listed files, including both requested directory trees. The test-only Monaco bootstrap mock was initially deleted with the list, then restored during review after the Vite test alias proved it remains reachable:

- Removed the obsolete provider stack (`AppContainerProvider`, `WindowProvider`, the legacy `RightDrawer`, header tab bar, plugin provider, legacy bottom-drawer types, and the unused log-stream hook).
- Removed the unused Monaco schema-registration hook, model utilities, and the complete uncalled Nginx language registration tree. Preserved the test-only Monaco bootstrap mock used by Vite's Vitest alias.
- Removed the five unreachable context modules and seven unreachable hook modules, including the complete `ui/hooks/header/` tree.
- Removed the unused resource-definition hook, extension sidebar registration, logger helpers, telemetry setup modules, event barrel, utility modules/barrel, and WDYR setup.

The resulting source cleanup is 40 deleted files and 10,508 removed lines, with no live source additions or modifications.

## Preserved active surfaces

Confirmed the following required files remain present and unchanged:

- `ui/App.tsx`, including the active application providers.
- `ui/providers/monaco/bootstrap.ts`, including the active Monaco bootstrap.
- `ui/providers/monaco/yaml.worker.bundle.js`, the generated YAML worker imported by the bootstrap.
- `ui/vite-env.d.ts`, the Vite environment declaration.

No UI migration, redesign, replacement implementation, source-structure test, dependency update, or unrelated source edit was added.

## Verification

### Scope and retention check

The initial `git status --short` and `git diff --stat` reported the 41 brief-listed source-file deletions, no modified source files, and no untracked files before this report was created. Explicit file checks confirmed `ui/App.tsx`, `ui/providers/monaco/bootstrap.ts`, `ui/providers/monaco/yaml.worker.bundle.js`, and `ui/vite-env.d.ts` remain. Review subsequently restored the reachable test-only bootstrap mock, leaving 40 source-file deletions.

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

It then reported the repository's existing set of unused-file findings. None of the 40 deleted Task 3 paths appeared in the output.

## Review fix: Vitest Monaco bootstrap alias

### Root cause

The initial reachability analysis omitted a test-only configuration edge. When `process.env.VITEST` is set, `vite.config.ts:58-60` resolves `@/providers/monaco/bootstrap` to `ui/providers/monaco/bootstrap.mock.ts`. Deleting the mock therefore caused Monaco schema-registry suites to fail during transform before tests could run.

### Exact restoration

Restored `ui/providers/monaco/bootstrap.mock.ts` byte-for-byte from cleanup base `94485ccebb6b589f548077df1bcaa3e4837fc870`. The mock has no local imports, so no other deleted Monaco helper or Nginx language file was restored. No source-structure test was added.

### Targeted Vitest command

Command:

```text
COREPACK_ENABLE_PROJECT_SPEC=0 corepack pnpm@10 exec vitest run ui/providers/monaco/schemaRegistry.spec.ts ui/providers/monaco/__tests__/schemaRegistry.test.ts
```

Result: **blocked before Vitest execution** (exit code 254).

```text
undefined
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found
```

The exact direct invocation was used, without the package script's duplicate `--run`. The current worktree does not have an executable Vitest dependency available, consistent with the earlier frozen-install blocker.

## Outcome

The confirmed dead Task 3 provider/context/hook/utility surface and uncalled Nginx registration data are removed. The test-only Monaco bootstrap mock required by Vite, active App provider composition, active Monaco bootstrap, generated YAML worker, and Vite declaration remain intact. Verification blockers are repository prerequisites outside this deletion-only task.
