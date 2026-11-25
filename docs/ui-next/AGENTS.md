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
| `ui-next/shell/` | The window frame (rows 1a.5, S1a, S1b): `Shell` (top row with Back and Forward and the tab strip, plugin frame, sidebar tree, scope lane, page host with keep-alive, status bar), `core/` (framework-free tree, region, chord and tab-model rules), `tabs/` (the strip and the page host), `registration.ts` (the seed of the contribution contract), `probes/` (the mock's rectangles against the shell, in both engines; CI runs them). Plugin-agnostic: see its `README.md`. |
| `packages/kit/` | New library `@omniviewdev/kit` (row N11a): token manifest and generator, nine themes, theme provider, `Text` and `Stack`, the guards, the API report. See "The kit" below. |
| `ui/` | Old shell. Fixes only after the calibration gate. Never imported from the new tree. |
| `docs/ui-next/` | `AGENTS.md` (this file), `TRACKER.md` (rows, PRs, log: source of truth), `decisions.md` (R1–R20, owner decisions), `backend-catalog.md` (what the UI work found to belong in the plugin SDK, a plugin backend or the host's Go side), `channels.md` (release-channel guide), `status/` (one file per in-flight row), `baseline/` (numbers, rows N8 and N12). |
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
node packages/kit/probes/kit-probe.mjs                  # the parts against the mock in WebKit and Chromium at both viewports (builds ui-next, serves it; needs Playwright browsers; CI runs it with the table, fonts and tooltip probes)
node ui-next/shell/probes/shell-probe.mjs               # the shell frame against the mock (builds its own fixtures; CI runs it)
node ui-next/shell/probes/strip-probe.mjs               # the tab strip, page host and load at 1440x900 and 1280x800 (CI runs it)
node ui-next/shell/probes/rail-probe.mjs                # the rail against the mock's two rails (geometry, paint in six states) at 1440x900 and 1280x800 (CI runs it); `mock-rail-measure.mjs` re-measures the mock
# FONT_DELAY_MS=40 in front of any probe holds every font file back, as a runner does: run all of them with it before reporting ready

# run the new tree
OMNIVIEW_UI=next pnpm dev                   # Vite only: http://127.0.0.1:9245/ (strict port); no Go host, no Wails runtime, no plugins: the window shows the plugin screen (empty here); the kit's parts page is /?screen=parts
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
15. **The host and the kit are plugin-agnostic.** No plugin-specific code or vocabulary anywhere in `ui-next/` (except the fixture plugin) or `packages/kit/` (except the guard and the mock recordings); the vocabulary guard enforces it. The host contains no plugin code: a plugin reaches it as an installed bundle (decision A13; row N19 is closed).
16. **Automated review.** Before reporting a PR ready, check for automated review comments (CodeRabbit). If it reviewed, read every comment, fix or answer each in the PR, and report how many there were and what you did. If it was rate-limited or skipped, say so and move on.
17. **Run the same commands CI runs before reporting ready**: the full root `pnpm test` (not a subset), `pnpm lint`, both tsc projects and the kit's (`task check:ui-typecheck`), the kit's `verify`, the kit, table, fonts, tooltip, shell, strip, rail and detail probes with `FONT_DELAY_MS=40`, and the seam check. A step you did not run is the one that fails on the PR.
18. **Dev tools.** A dev utility you wrote or used (a script, a probe, a recipe, a fixture) is recorded under a "Dev tools" heading in your status file (row N21).
19. **Every control is a Tab stop** (decision A14): buttons, icon buttons, chips and links are Tab stops whatever the macOS keyboard setting says. Where VS Code and JetBrains agree, follow them.
20. **Plugins keep the new UI in their `ui/` project on `feature/ui-next`**, with no double pathway (decision A16): no `OMNIVIEW_UI` switch and no sibling directory in the plugin repository.
21. **Test viewports are 1440 x 900 and 1280 x 800** (decision A15: the native window's minimum). 1030 x 720 is retired; the probes' references move with row N23.
22. **Backend catalog.** When the proper fix or a large gain is in the plugin SDK, a plugin backend or the host Go side, do not work around it silently: record it under "Backend catalog" in your status file with class BLOCKER / TANGENTIAL / WIRE, location (file:line), evidence and the interim the UI uses; the lead adds it to `docs/ui-next/backend-catalog.md`. BLOCKER: the UI cannot behave properly without it. TANGENTIAL: an independent gain or fix. WIRE: it changes the plugin protocol.
23. **Save work on a `wip/<branch>` branch with no open PR, and push to a PR branch once per CI answer.** Every push starts about 16 jobs, and on 2026-11-20 about 15 agents queued 47 PR runs on a plan that runs 20 jobs at once (the oldest waited 87 minutes); `status/F3.md` and `N24-B1.md` kept their experiments on `wip/` branches.
24. **NEVER cancel a run of the commit you ask the lead to merge.** A run cancelled before its jobs start leaves no check at all, so PRs #563 and #566 merged with no `PR Validation` result and the gate counted 9 of 9 green.
25. **A new probe or control goes into the unit directory `scripts/ci/probe-units/` (one file for each probe: its units, each with the `seconds` it takes on the runner) and into `scripts/ci/probe-units.manifest.json`, never into a workflow step.** `check` fails CI for a probe script that no unit runs and for a probe or control the manifest lists that no unit runs, so a pull request that drops one edits the manifest, where a reviewer reads it; the probes run LOCALLY before a push and in CI only at night and on request, every probe and every control in both engines, never on a pull request or a push to main (rule 39, `status/N30.md`); a plan job packs the units into the fewest shards of at most 432 s listed at run time (no pull request names a shard); a unit that takes more than its seconds plus the larger of a quarter of them and 60 s, or a shard that takes more than 614 s, fails with the number to change; and `Kit probes` fails unless every unit and control of the table ran once and passed (`status/N25.md`, which replaced the shard table of `status/N24-K1.md` to `N24-K3.md`)). A unit of controls says where its controls plant their fault (`plants`): `'page'` when each perturbs the loaded page or what the probe reads of it, so that the processes of a shard share one build of the fixtures (`BUILD_CACHE`, set by the runner and never by a unit), or `'build'` when one plants it in the source or at build time, which gets no shared build; a probe builds only through `sharedBuild` (`packages/kit/probes/build-cache.mjs`), whose build never sees the control (`status/N27.md`). After a unit's first CI run, set its `seconds` with `node scripts/ci/probe-seconds.mjs --write` (the 95th percentile of the runner's recent runs, rounded up to 5 s): a value from a laptop or from one runner sample fails other pull requests' drift check.
26. **Run the kit's `verify` (`pnpm --filter @omniviewdev/kit run verify`) before pushing any change under `ui-next/` or `packages/kit/`.** It holds the plugin-vocabulary guard of decision A13 (`packages/kit/eslint/vocabulary.test.mjs`), which failed the first push of the form field model (#562, `status/FM1.md`) and of P1b-3a (#549, `status/P1b-3a.md`).
27. **Check `uptime` before a timing-sensitive probe or bench and record the load in the status file.** Other agents share the machine (load average 5 to 12 in `status/1a.3c.md`, 100 to 140 in `status/F2.md`), and a timing taken under load proves a budget neither held nor missed.
28. **A negative control must trip the assertion it is named for, and the same fault must pass undetected when that assertion is removed.** A control that fails for another reason proves nothing; `status/N24-D1.md` removed each control in turn and required the test named for it to turn red (71 of 71).
29. **The review of a PR's proof tools is settled before the code they prove is merged.** CodeRabbit found four faults in the proof tools of K2b-1 (#552, `status/K2b-1.md`) and five in Q1's (#583, `status/Q1.md`) after plugin #266 and #270 had merged, and the K2a tools still carry the faults K2b-1's fixed.
30. **The host cluster check (`scripts/ui-next-pods/`, run by `.github/workflows/ui-next-pods.yml`) is part of "the commands CI runs" (rule 17) for any change to list pages, session tabs or the sidebar.** Session restore changed what a fresh window shows and that check failed on it in CI (`status/S3a.md`, section 2b), and the sidebar counts are held to `kubectl` there (#600).
31. **Go lint blocks on changed lines, so reproduce it before pushing Go.** CI lints only the lines a patch adds or changes (the 11,799-issue backlog is not reported) and a finding turns the check red; `status/N24-L2.md`, "Reproduce the CI lint locally", has the one command (golangci-lint v2.15.0, change committed first).
32. **CI classifies a PR by path (`scripts/ci/changes.mjs`, `status/N24-D1.md`): keep a docs-only PR docs-only and a new-UI-only PR new-UI-only.** One path outside the class (a Go input, `.github/`, a script) runs the whole suite instead of the 5 jobs of a docs PR; Markdown under `docs/`, `README.md` and anything under `docs/ui-next/status/` is docs.
33. **Search `docs/**` for a symptom before you investigate it.** The "host stops answering" that K2b-2 and K2c-1 met was the 64-window limit of server mode, which `docs/development-audit-gateway.md` already named and nobody had tied to B-44 (`status/INV2.md`).
34. **Never put a backtick inside a double-quoted shell string.** The shell runs the text between backticks as a command, and the lead's merge gate ran one by accident; put text that carries backticks (a PR body, a commit message, a comment) in a single-quoted string or a quoted heredoc.
35. **Start probes and the seam from a clean environment: no `ENGINES`, `VIEWPORTS`, `NEGATIVE_CONTROL`, `REPORT` or `DIST` left over from an earlier run, the kit built with `OMNIVIEW_UI=next`, and `uptime` recorded (rule 27).** Two agents measured with a stale `ENGINES` and `VIEWPORTS` and reported a run they had not meant; CI's seam step sets nothing but `ENGINES` (`status/CI4.md`) and `status/INV2.md` ran it under `env -i`.
36. **A change to locking, the plugin channel, uninstall or update, or file handling gets an independent review by a fresh agent before it is merged.** The review of #613 found that its first version failed plugin updates 25 of 25 times under a concurrent lookup, which CI had not shown, and the one of #634 ran its own stress before the merge (the lead's notes, `reviews/cred-613.md` and `reviews/win-634.md`).
37. **The seam check runs in CI (`.github/workflows/ui-next-seam.yml`: every phase and every negative control, in both engines, packed into the fewest jobs of at most 420 s of work from `scripts/ci/seam-units.mjs`) and fails on any runtime 4xx or 5xx that is not on its allow-list with a reason written beside it.** A scenario or a control added to `seam.check.mjs` is added to a unit there (`node scripts/ci/seam-shards.mjs check` fails, naming it, until it is; `Seam check` fails for one that did not run), and after a unit's first CI run its `seconds` are set to the ones the shard's summary prints (`status/N29.md`). **The seam runs in CI at night and on request, never on a pull request or a push to main (rule 39): the author runs it locally for the scenarios the change touches (`status/N30.md`).** It is the only check that drives the real Go host with a browser; until INV1 it printed an unexpected 422 and passed (`status/CI4.md`, `status/INV1.md`).
39. **A pull request runs only what the IDE needs to build and pass its unit tests; the rest runs at night, and you run it before you push (owner's order, 2026-11-25, `status/N30.md`).** CI on a pull request (`PR Checks`): Go build, vet, tests, bindings freshness, lint; the UI build, type-check, lint, kit contracts and component tests; the C02 corpus and runtime contract; the CI script unit tests. Everything else runs at night (`schedule`, 02:47 to 04:37 UTC) and on request (`workflow_dispatch`) and is on the `ci-main-red` list: the seam, the kit probes, the Pods cluster check, the application suite (e2e), the Linux, macOS and Windows builds, the Windows connection-profile tests, the release packaging contracts, the benchmarks and the profile. Nothing on a pull request waits on them. **Before you push, run what your change touches, one command each, and put the command and its result in the pull request's description:** the probe units your change touches and their controls, in WebKit and Chromium (`task local:probes -- <unit>,<unit>` or `-- --changed`); the seam scenarios you touched, in both engines (`task local:seam -- <unit>,<unit>`, the units of `scripts/ci/seam-units.mjs`); the Pods cluster check when the plugin pin (`KUBERNETES_PLUGIN_REF` in `ui-next-pods.yml`) or `scripts/ui-next-pods/` changes (`gh workflow run ui-next-pods.yml --ref <your branch>`: it needs a kind cluster, so it runs in CI on request); and, when `packages/omniviewdev-runtime` changes, the type-check of the shipped Kubernetes plugin UI against the runtime you built (it caught a real break on #723; no wrapper yet: build with `task packages`, then run the plugin's `ui` tsc against this tree). **The merger reruns the same units on the merged tree** (`task local:probes -- --changed`). A step you did not run is one nobody ran: say so in the pull request.
38. **A finished step has its PR; a `wip/<branch>` is for work in progress.** Finished work left on `wip/` gets no CI answer, no review and no merge, so the step reads as open while the code is done; `wip/n24-k2-a` to `-c` stayed behind after N24-K2 merged (rule 23 says where unfinished work is saved and when to push).

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
