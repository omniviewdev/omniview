# UI next: read this first

Applies to everything under `ui-next/`, `packages/kit/` and `docs/ui-next/`, and to the build and CI files that carry them. The root `CLAUDE.md` still applies (`task bindings` only, `GOWORK=off`, no Claude attribution in commits or PRs); its UI section describes the old shell.

## Goal

Replace the host's old UI (`ui/`) with a new one built to the design mock: a new library, `@omniviewdev/kit` (`packages/kit`), and a new shell in `ui-next/`.
Users get it once, in a single flip. Until then `main` stays one complete, shippable product.
Progress is counted in slices that run on real data in the real host (first: the Kubernetes Pods list), not in components.

## The rule

`main` ships exactly one product. The new UI lives in `ui-next/` and `packages/kit` and is built only when `OMNIVIEW_UI=next`; the stable and nightly builds never contain it (`scripts/ui-flavour.test.mjs` asserts that the stable output holds no `ui-next` file or page text). It reaches users only through the `feature-ui-next` release channel (`channels.md`). No second stack is ever admitted to the stable build. The only legal moves are: continue, flip, abandon.

## Where things are

| Path | What |
|---|---|
| `ui-next/` | New shell: `index.html`, `main.tsx`, `App.tsx` (a themed frame built from the kit), `global.css` (the host's document reset, layer `ov.reset`), `App.module.css` (the frame, layer `ov.shell`), `parts/PartsPage.tsx` (every kit part in every state it has an example for, mounted on the frame). |
| `ui-next/shell/` | The window frame (row 1a.5): `Shell` (top row with one tab, plugin frame, sidebar tree, scope lane, page island, status bar), `core/` (framework-free tree and region rules), `registration.ts` (the seed of the contribution contract), `probes/` (the mock's rectangles against the shell, in both engines; run by hand). Plugin-agnostic: see its `README.md`. |
| `packages/kit/` | New library `@omniviewdev/kit` (row N11a): token manifest and generator, nine themes, theme provider, `Text` and `Stack`, the guards, the API report. See "The kit" below. |
| `ui/` | Old shell. Fixes only after the calibration gate. Never imported from the new tree. |
| `docs/ui-next/` | `AGENTS.md` (this file), `TRACKER.md` (rows, PRs, log: source of truth), `decisions.md` (R1–R20, owner decisions), `channels.md` (release-channel guide), `status/` (one file per in-flight row), `baseline/` (numbers, rows N8 and N12). |
| `vite.config.ts` | The flavour switch (`OMNIVIEW_UI`, lines 28–42). |
| `.github/workflows/` | `feature-channel.yaml`, `desktop-build.yml`, `mirror-ui-next.yaml`: how the channel is built. |

## Commands

Run from the worktree root. All were run on 2026-11-16 at `origin/main` 4006e74b, macOS arm64; measured results in parentheses.

```sh
# once per worktree
pnpm install --frozen-lockfile              # 3 s with a warm store
task packages                               # providers, runtime, vite-plugin, kit (15 s); CI runs it first. ui-next imports the BUILT kit
git checkout -- packages/omniviewdev-vite-plugin/shims/_omniviewdev__runtime__models.mjs   # task packages dirties this tracked shim (drift on main)

# build the new tree: dist/ holds index.html and assets/ only (1 s)
OMNIVIEW_UI=next pnpm build
OMNIVIEW_UI=next OMNIVIEW_BUILD_OUTPUT_DIRECTORY=/tmp/ui-next-dist pnpm exec vite build   # same, elsewhere

# the kit (packages/kit); ui-next consumes its dist/, so rebuild it after a change
pnpm --filter @omniviewdev/kit run build                # generate, vite build, declarations, dist check (1 s); `OMNIVIEW_UI=next task common:build:frontend` runs it itself
pnpm --filter @omniviewdev/kit run generate             # after editing tokens/manifest.ts or tokens/themes.ts; commit src/generated/*
pnpm --filter @omniviewdev/kit run api:update           # after changing src/index.ts or src/examples.ts; commit api/kit.api.md and api/kit-examples.api.md
pnpm --filter @omniviewdev/kit run verify               # generate:check, tsc, stylelint, tests, build, API report (3 s)
node packages/kit/probes/kit-probe.mjs                  # the parts against the mock in WebKit and Chromium at both viewports (builds ui-next, serves it; needs Playwright browsers; run by hand, CI does not)

# run the new tree
OMNIVIEW_UI=next pnpm dev                   # Vite only: http://127.0.0.1:9245/ (strict port); no Go host, no Wails runtime, no plugins
OMNIVIEW_UI=next task build:server          # frontend, then bin/Omniview-server (30 s): the real Go host
HOME="$(mktemp -d)" OMNIVIEW_CHANNEL=feature-ui-next bin/Omniview-server   # http://localhost:34115/, state root $HOME/.omniview-feature-ui-next

# test
pnpm test ui-next                           # vitest on ui-next/**/*.{spec,test}.{ts,tsx} (5 tests); needs the kit built
pnpm test                                   # what CI runs (146 files, 1,746 tests, 30 s)
pnpm --filter @omniviewdev/kit run test    # the kit's own vitest, Vite 8 (140 tests); CI step "Kit contracts"

# typecheck: what CI runs; `pnpm build` runs tsc on a root config that checks nothing
pnpm exec tsc -p tsconfig.app.json --noEmit && pnpm exec tsc -p tsconfig.test.json --noEmit && pnpm --filter @omniviewdev/kit run typecheck   # task check:ui-typecheck (3 s)

# lint
pnpm exec eslint ui-next packages/kit --report-unused-disable-directives && pnpm lint:ui-policy && pnpm lint:css   # new trees only (5 s)
pnpm lint                                   # what CI runs (20 s; 0 errors, 8 warnings already on main, none in the new trees)

# guards CI runs on the build
node --test scripts/react-compiler.test.mjs scripts/ui-flavour.test.mjs   # ui-flavour's first test needs a stable `pnpm build` in dist/ first
```

Go commands run as `GOWORK=off GOTOOLCHAIN=local go ...`; Wails bindings are generated only through `task bindings`. Building one flavour replaces `dist/`: the other flavour's output is gone. Both TypeScript projects, eslint, the React Compiler admission test and vitest cover `ui-next/`; the kit has its own tsconfig, vitest and build (Vite 8, plugin-react 6) and is covered by `task packages`, `task check:ui-typecheck`, `pnpm lint` and the CI step "Kit contracts". The root vitest does not run kit tests. The kit commands were run on 2026-11-16 on the head of PR #507.

Not verified: `OMNIVIEW_UI=next task dev` (the managed dev workspace, `docs/development-workspaces.md`). Its build-reuse records may not key on the variable, so it may reuse the other flavour's output; check before relying on it. The native window, WKWebView and Windows were never launched with the new tree.

## Working rules

1. **Build through real screens.** A component exists because a screen from the mock that is being built needs it. No component before its screen.
2. **One token scale.** No second scale, no aliases, no shims. A key is renamed when its meaning changes; the old name is not kept.
3. **Closed props.** No `className`, no `style`. Layout goes through typed props. The one escape hatch is plugin CSS Modules in the dedicated plugin layer.
4. **No custom-property writes at the root.**
5. **Failing test first.** Commit the red test, then the fix.
6. **Worktrees.** Work in a `git worktree` from `origin/main`, never in the owner's checkout (default `~/Repos/omniviewdev/worktrees/<branch>`). Leave it in place and record its path in your status file.
7. **One owner per file.** If another agent owns a file you need changed, ask them or the lead; do not edit it.
8. **Verify on the real surface.** Component tests and screenshots do not prove a screen. Run it in the real host with real data and say which surface you ran (browser server mode or native WKWebView) and what you did not run. Skill `omniview-instance-verification` applies. `omniview-ui-implementation` is written to preserve the old screens; here the mock, not the old screens, is the reference.
9. **Never weaken** consent, plugin pinning, epoch fencing or call binding.
10. **No cross-tree imports.** `ui-next/` and `packages/kit` do not import `ui/`, nor the reverse. The lint boundary is not written yet (R17), so reviewers enforce it. The test setup, `ui/test-setup.ts`, and the `@` alias (`ui/`) are still shared.
11. **Small changes.** No drive-by refactors. Run only the targeted checks for what you touch.
12. **Progress protocol.** Before a row: write `docs/ui-next/status/<row>.md` with goal, worktree path, branch. After every meaningful step: append one dated line (done, next, blocker). On finish: PR URL, exit-test result, what was not verified. A dead session leaves this file as the resume point. Agents never edit `TRACKER.md`; the lead updates it from the status files.
13. **Pull requests.** One row, one PR, ready for review (not draft), against `main`. Description: what, why (tracker row), how verified, what was not verified. Wait for CI and report the checks. Do not merge: the lead merges green PRs.
14. **Do not undo existing optimisation.** Before replacing or rewriting any existing table, log viewer, terminal, editor, data hook or startup path, read `docs/ui-next/optimisations.md` and keep or re-express every item on its "must not regress" list; if the file does not cover what you are touching, stop and add it first (tracker row N17).
15. **The host and the kit are plugin-agnostic.** No plugin-specific code or vocabulary outside a marked scaffolding directory (`ui-next/k8s/`, `ui-next/pods/`: temporary, moved into the Kubernetes plugin and deleted from the host before the calibration gate; decision A13, row N19). `kit/scaffold-boundary` and the vocabulary guard in `packages/kit/eslint` enforce it.

## The kit

- **Tokens.** One manifest (`packages/kit/tokens/manifest.ts`, `themes.ts`: 78 colour roles x 9 themes, the closed scales) generates `src/generated/tokens.css` and `tokenNames.ts`; both are committed and CI fails when they are stale. Names: colours `--ov-<mock role>` (`--int-bg-island` is `--ov-bg-island`), spacing `--ov-spacing-<px>` (never `--ov-space-N`: the old library used that with other values), radii `--ov-radius-<role>`, type `--ov-fs-N` and `--ov-lh-N`. TypeScript refers to a token only through `tokenVar('--ov-…')`, which type-checks the name. Theme ids are the nine the host persists (`high-contrast-dark`, not the mock's `hc-dark`).
- **Layers**, declared once in `src/styles/layers.css`: `ov.tokens, ov.reset, ov.base, ov.plugin, ov.components, ov.shell`. Kit parts write `ov.components`; the host entry writes `ov.reset` and `ov.shell`; plugin CSS belongs in `ov.plugin`, below the components. Every rule sits in a layer; `scripts/check-dist.ts` fails the kit build otherwise.
- **A part** has closed props: variants and typed layout props become `data-ov-*` attributes that its CSS Module reads, `data-*` is the only pass-through, no `className`, no `style`. The public surface is `src/index.ts`; its report is `api/kit.api.md` (CI fails when they differ).
- **Examples (interim rule).** Every new kit part ships with a typed example file, `<Part>.examples.tsx`: named examples covering its states, each a component without props written as a consumer writes it (imports from `@omniviewdev/kit`, never a relative path). `src/examples.ts` collects them (one line per part) and the build emits them as a separate entry, `@omniviewdev/kit/examples`: development and documentation only. It is never in the root entry or its API report (the root entry is the plugin-facing API, shared with plugins as a singleton at run time), it is on no plugin shared-module list, and only `ui-next/parts/**`, the kit's tests and the future workshop may import it (a lint rule, proven by a probe in `packages/kit/eslint/guards.test.mjs`; its own report is `api/kit-examples.api.md`). The `ui-next` parts page renders every example of the entry, the part's tests use them (its a11y matrix has one row per example), and the workshop and docs site (tracker row N20) are generated from these files.
- **Guards**, each with negative-control tests: ESLint rules in `packages/kit/eslint` (wired in `eslint.config.cjs`: no static inline `style`, closed props, no old UI library, no `setProperty` or root style write, tokens named through `tokenVar`), stylelint in `packages/kit/stylelint.config.mjs` (closed scales, no hex, an undefined token is an error), the dist check, the API report. Change a rule together with its test.
- **Not built yet:** font delivery (the frame uses the system font), a first-paint theme script, motion, shadows, z-index, a watch loop for the kit.

## Specification

Design specification: private repository `omniviewdev/design-lab`, tag `spec-baseline-2026-11-16` (commit `108d7049536e52d8d2f48c9a9b8d8cd94886fe81`). The mock is `app/OmniviewNativeLab/frontend/mock`, git tree `c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0`. Read it with `gh api repos/omniviewdev/design-lab/contents/<path>?ref=spec-baseline-2026-11-16` or a clone at the tag.

The mock is the acceptance reference: a screen is done when it matches it. The tag is a snapshot, not a freeze: the errata pass (row N10) is pending, with 40 known disagreements between the written chapters and the mock (11 need the owner) and known mock defects. When you hit one, write it in your status file and ask the lead; do not choose silently.

## Out of scope

- New features in the old shell after the calibration gate (R2); upgrading it (R18).
- Importing or changing the old `ui` repository: frozen, archived at the flip.
- The marketplace web UI; the AWS and Containers plugin UIs (rebuilt after the flip, R19).
- A new window kind, a two-bundle plugin archive, or any second stack in the stable build (R1).
- Containing hostile plugin code: plugins stay trusted code in the host realm (R10).
- AI surfaces (no design yet); Module Federation; a types-only plugin contract (after the flip).

## Traps found while verifying this file

- `task packages` rewrites a tracked shim (command above); every frontend build deletes tracked `dist/.gitkeep` (`git checkout -- dist/.gitkeep`). Do not commit either.
- The React Compiler skips code it cannot handle without failing the build. `pnpm lint` reports it as `Compilation Skipped` warnings; a new one in new-tree code is a defect to fix or report.
- A channel host built from `ui-next/` has no Updates or plugin pages (the old shell is not in the bundle), so plugins reach it only through the automatic sync described in `channels.md`.
- `CI=true` is set in some agent shells and makes pnpm freeze the lockfile; use `CI= pnpm install` when you change a dependency. The kit pins vitest 5.0.5 because 5.1.0 fails `strictPeerDependencies` against the root's `@vitest/ui`.
- `ui-next` imports `dist/` of the kit: typecheck, `pnpm test ui-next` and the `next` build fail with a resolution error until `task packages` (or the kit build) has run.
