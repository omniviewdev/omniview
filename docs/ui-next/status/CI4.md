# Status: CI4 (the seam check in CI)

- Agent: SeamCi. Branch `ci/ci4-seam-check`, worktree `~/Repos/omniviewdev/worktrees/ci-ci4-seam`, one commit on `origin/main` `9052c470` (rebased after #618 merged; built and measured on `ec6cbc7f`). Experiments and proofs ran on `wip/ci4-seam-*` branches and on throwaway draft pull requests (#620, #621, #622, all closed, branches deleted); the work itself has no other pull request.
- Files: `.github/workflows/ui-next-seam.yml` (new), this file. `scripts/ci/changes.mjs` is **not** touched: the job is gated by its own file-level `paths:`, as the kit probes and the Pods workflows are, so no class output was needed.
- PR #618 (PU1) merged as `a9eb87e3` while this was in review: the check is scenarios a to n. Everything below was measured on `ec6cbc7f` (a to m) and on `ec6cbc7f` with #618's diff applied (a to n); the pull request's own run is on the merged tree.

## What it does

`UI next seam check` runs `ui-next/plugins/e2e/seam.check.mjs`, the only check that drives the real Go host with a browser, on a pull request whose paths can change its result. Two matrix jobs, `Seam webkit` and `Seam chromium`, run at the same time, each in the CI image pinned by digest (`.github/ci/image.lock`; the step "The image is not stale" runs `scripts/ci/check-image.mjs check --manifest /opt/ci/manifest.json`, as the kit probes do), with `permissions: packages: read`, the credentials block and `--init`:

| Step | What |
|---|---|
| `pnpm install --frozen-lockfile`, `task packages` | the kit, runtime, providers and Vite plugin the frontend and the fixture import; the tracked shim `task packages` rewrites is checked out again |
| `OMNIVIEW_UI=next task build:server` with `GOWORK=off GOFLAGS= GOTOOLCHAIN=local` | the host as agents build it for the seam: frontend, Wails bindings, `bin/Omniview-server`. The image holds GTK 4 and WebKitGTK, which the bindings need on Linux, so this is the task itself and not the Pods workflow's split build |
| `The seam (<engine>)` | `ENGINES=<engine> node ui-next/plugins/e2e/seam.check.mjs`, from a clean environment: the step sets nothing but `ENGINES` (the check starts the host with a minimal environment of its own, builds the fixture plugins itself, and sets the Go settings its fixture process needs itself) |
| `The seam's negative controls (<engine>)` | every control of the check in that engine, one after the other, all of them even when one fails; the list is read from the check (the keys of `const CONTROLS = {…}`, plus `process` when the file has `PROCESS_CONTROLS`, which #618 adds), so a control added to the check is run with no change here. A control exits 0 when the assertion it is named for saw the perturbation. The job summary has a table of every control with its seconds |
| `Seam check` (aggregator, stable name) | needs both engines, `if: !cancelled()`; green only when `needs.seam.result` is `success`; otherwise it names each job that did not succeed with its URL and repeats the annotation the failed step wrote (the token reads annotations with `checks: read`) |

A failure of the seam step writes one annotation: the scenario letter (the last `// <letter>.` marker or doc comment above the line of the failing scenario function in `seam.check.mjs`), the function and its line, and the assertion (an `Error`'s first line, or for a Playwright timeout its first line and the first thing its call log waited for).

The ten controls, run in both engines: `double-close`, `new-view`, `failed-ended`, `close-twice`, `page-error` (scenario k), `second-stream`, `scope-lone`, `scope-kept`, `same-name` (scenario m), and `process` (scenario n; its nine perturbations `pid-pattern`, `frame-text`, `rail-fine`, `page-drawn`, `tool-stays`, `session-live`, `rail-moved-on`, `rail-stuck`, `two-pages` serve one kill).

## Triggers

`pull_request` and `push` to `main` on the same paths, and `workflow_dispatch`; `concurrency` per pull request or ref, cancelling the run in progress. Paths (`!**/*.md` last: Markdown is never an input): `ui-next/**`, `packages/**` (the kit, the runtime's curated entry the fixture imports, and the providers and Vite plugin `vite.config.ts` and `task packages` build), `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `vite.config.ts`, `index.html`, `public/**`, `patches/**`, `tsconfig*.json`, and the Go host `build:server` compiles. That list was derived with `GOWORK=off go list -deps -tags production,server .`: the root package (`*.go`), `backend/` (`pkg`, `window`, `menus`, `extensiondiagnostics`, `diagnostics`), `internal/` (29 packages), `go.mod`, `go.sum`; plus `pkg/**` (not compiled today; the Pods workflow lists it and when unsure it is included), `scripts/hostmod/**` (the host module bootstrap the build runs), `Taskfile.yml`, `build/Taskfile.yml`, `.github/ci/image.lock` (a new image moves the browsers) and the workflow itself. `docs/ui-next/**`, `README.md` and the rest of `docs/` never start it.

It is not a required check, for the reason `ui-next-pods.yml` gives (a path-filtered check that does not run blocks a merge); the lead makes `Seam check` required once it has been green for a while.

## Measured

Every number is from the jobs API (`started_at` to `completed_at`), on the idle part of the pool unless said; dispatch runs of the workflow file on `wip/ci4-seam-*` refs (a dispatch of one ref cancels the run in progress: each run had its own ref).

**The shape of the job** (scenarios a to m; the same host build and seam in each; "wall" is the longest job):

| Layout | Jobs | Wall | Runner time | Slots |
|---|---|--:|--:|--:|
| A. one job per engine, seam then controls in it (**chosen**) | 2 + aggregator | 390 to 478 s (8.0 min worst) | 871 s (14.5 min) | 2 |
| B. one job, both engines, then the controls of both | 1 + aggregator | 592 s (9.9 min) | 597 s | 1 |
| C. a job for each of seam and controls, in each engine | 4 + aggregator | 389 s (6.5 min) | 1,155 s | 4 |
| D. as A with the Go module and build caches restored | 2 + aggregator | 387 to 397 s | 788 s | 2 |

Chosen A: B is 1.5 to 2 minutes slower for 3.5 fewer runner-minutes and, with scenario n (#618: about +60 s in the seam and +56 s in the controls of each engine), would be 13.7 minutes, longer than the kit probes' 8 to 11 and so the new critical path of a pull request; C saves 1.5 minutes over A for 5 more runner-minutes and two more slots of the 20, which the plan runs at once. D: the cache of `GOMODCACHE` and `GOCACHE` is 512 MiB (the repository's caches were 10.4 GiB of 10), and the host build went from 95 to 99 s to 86 to 88 s: not worth it, so there is no cache. The host build is 90 to 150 s (the bindings are 75 s of it: 259 module downloads and the Wails CLI), which is where the runs differ.

**Two green runs of the final workflow file** (dispatch on `wip/ci4-seam-3a` run 44873283606 and `wip/ci4-seam-3b` run 44873285462; scenarios a to m), seconds per step:

| Step | 3a webkit | 3a chromium | 3b webkit | 3b chromium |
|---|--:|--:|--:|--:|
| Initialize containers (the pull) | 52 | 29 | 48 | 29 |
| checkout | 3 | 5 | 3 | 5 |
| image guard | 0 | 0 | 0 | 0 |
| `pnpm install` | 5 | 3 | 5 | 3 |
| `task packages` | 31 | 24 | 26 | 22 |
| `task build:server` | 132 | 97 | 113 | 94 |
| the seam | 75 | 68 | 73 | 67 |
| the negative controls (9) | 162 | 153 | 158 | 150 |
| **job** | **466** | **386** | **431** | **377** |

`Seam check`: 3 s each (queued 46 and 75 s behind a full pool). Runner time 855 s and 811 s; billed (each job rounded up) 16 minutes each. Per control: 14 to 22 s (host start, one scenario). The three earlier runs of the first draft (matrix of two jobs, same steps): 478 and 390 s, 483 and 460 s, 393 and 474 s: the spread is the host build, not the seam.

**With #618 applied** (`main` plus the diff of #618): the first draft of the workflow, `wip/ci4-seam-pu1-1`, run 44870435446: the seam 136 s (webkit) and 137 s (chromium), the controls 212 and 213 s, jobs 514 and 559 s. The final file, `wip/ci4-seam-pu1-2`, run 44873999883: `controls: double-close … same-name process` read from the check, the seam 136 and 130 s, the controls 212 and 209 s (`process` 57 s, `detected`), jobs 507 and 503 s, `Seam check` success, 1,013 s of runner time (18 minutes billed). `timeout-minutes: 20` is 2.1 times the longest job measured with #618 (559 s), and 2.5 times the longest of a to m (483 s).

## Linux: what the seam found on a runner

It has never run on Linux before; **no scenario differs.** Scenarios a to m pass in WebKit and Chromium in the first run, with no change to the check, and every control of k and m is detected in both engines. The check's own platform handling is right on Linux: the key chord is read from `navigator.platform` (`Control` there, scenario f and the palette chords), the shell's chords say `Ctrl+Alt+W` and `Ctrl+Alt+J` there, and the state root is under `$HOME` of a temporary directory. Nothing is marked expected-fail, so the job is green only where the check is.

- **Scenario n (#618) works inside the container**: the pid is read from the host's `processinfo.GetSnapshot` (through `/proc`) with its executable, `SIGKILL` reaches it, the binary made unexecutable (mode 0) is refused by `execve` even for root, so the host's recovery fails as the check needs, and the host's health check finds the process gone. Both engines: `process <pid> killed; the window was told [{"pluginID":"fixture-a-ok","cause":"crashed"},{"pluginID":"fixture-a-ok","cause":"reloaded"}] and then ["Running"]`, and the nine controls of `SEAM_CONTROL=process` are detected. `--init` (tini as PID 1) reaps the killed process. The fixture's Go process builds in the container (`go build ./ui-next/plugins/fixture/process` inside the host's module, with the module cache the host build warmed).
- **Observation, not a finding**: Chromium logs `other requests that answered 4xx while the page ran: 422 /wails/runtime` (`activity.FrontendService.Attach`, `Heartbeat` and `Unsubscribe`, "activity session unavailable") in every run; WebKit says `none`. The check prints these and does not assert on them (it asserts the plugin-with-no-bundle 400 and that the fixture's own call succeeded); it is the activity session of a page that was just reloaded. Whether it also happens on macOS was not run. Left alone.
- Not run: Windows, and macOS (the check runs on the workstation, as before).

## Proofs

| Proof | Where | Result |
|---|---|---|
| 2 green runs with per-step durations | table above | 3a: 466 and 386 s; 3b: 431 and 377 s; `Seam check` success both |
| a break of one scenario turns `Seam check` red naming the scenario | throwaway PR #622 (base `wip/ci4-seam-3a`, head removes `items: itemsPage` from the fixture's pages), run 44873291670 | the seam step failed in both engines after 42 and 43 s, the controls skipped, `Seam check` failure: `##[error]Seam chromium - scenario a (checkHealthy at line 216): locator.click: Timeout 30000ms exceeded.  - waiting for getByRole('region', { name: 'Plugins you can open' }).getByRole('button', { name: 'Seam Fixture', exact: true })` and the same for WebKit (an earlier try, #620, found the annotation named the stack's tail and not the assertion for a Playwright timeout: fixed, then re-proved here) |
| a documentation-only PR does not start the workflow | throwaway PR #621 (`docs/ui-next/status/CI4-proof.md`) | its head had two runs: `PR Checks` and `PR Validation` (5 jobs: `Changed paths` 10 and 13 s, `Repo guard`, `UI checks`, `e2e-tests`); no `UI next seam check` |
| `check-image.mjs check`, `check-tracked-outputs.mjs` | local | ok (the seven `mutable-pin` warnings are the other workflows') |
| `actionlint`, `yamllint` | local | clean |

## Where it sits against the 20 concurrent jobs

A push that changes only the new UI (class `new-ui`, the head of #622's runs) starts **20 jobs now, 23 with the seam**: `PR Checks` 8 (`Changed paths`, `Repo guard`, the 5 UI jobs, `UI checks`; 5 host jobs skipped), `PR Validation` 3 (`Changed paths`, `build-artifacts (windows/amd64)`, `e2e-tests`), Kit probes 8 (7 shards and the aggregator), Pods 1, and the seam's 3 (two engines and `Seam check`). The jobs that hold a slot for minutes are 14 before (5 UI jobs, the Windows build, 7 shards, Pods) and **16 with the seam**; the other 4 of the 20 (`Changed paths` twice, `Repo guard`, and the gates and aggregators that start last) hold one for 3 to 15 s. So one new-UI push alone fits under 20; a second PR's push does not, and the queue grows by 2 long jobs per push (the seam is the second-longest group after the Kit probes: its jobs end at 6.5 to 8 minutes, or 9.3 with #618, against 8 to 11.6 for the shards). A push that changes Go (class `all`, from #606's listing 23 jobs, plus the profile and Pods) starts the seam too: about 26 jobs. Runner time per run: 13.5 to 14.5 minutes (16 billed), 18 minutes with #618; for comparison a new-UI push was 66 runner-minutes in D1's measurement (Kit probes 53), so the seam adds about a fifth.

Where a slot is worth saving: the seam builds the host in each engine job (95 s, 75 s of it the Wails bindings); a build job that uploads `bin/Omniview-server` for both engines would save one build of runner time and cost one job and the transfer, at no gain in wall time. Not done.

## What #618's merge changed here

Nothing in this workflow: `process` is added to the controls by the `PROCESS_CONTROLS` test, the timeout holds (20 minutes against 9.3), and the failure annotation names scenario n through `checkProcess`. The final file ran green with #618 applied (above).

## Not verified

- The job on `main` itself (a `push` run is the first thing that happens after the merge); the first run after the merge pulls the image like any other.
- A pool that is saturated: the proofs ran with a queue of 2 to 4 s for the seam jobs and 17 to 94 s for `Seam check` (aggregators wait for a slot behind the others).
- Whether the activity-session 422 of Chromium is Linux-only (above).
- A pull of the image that hangs: bounded only by `timeout-minutes`, as in B1.
- CodeRabbit: see the pull request.

## Dev tools

None kept in the tree. Throwaway, outside it: `/tmp/ci4/jobs.py` (a run's jobs and steps from the jobs API in seconds), the three layout variants (`wip/ci4-seam-e2`, `-e3`, `-e4`, deleted) and the proof branches.

## Log

- 2026-11-21: worktree from `origin/main` `ec6cbc7f`; first draft green on the first run (a to m, both engines, 478 and 390 s); layouts B, C and D measured; the workflow run with #618's diff applied (scenario n and its nine controls pass in both engines on Linux, in the container).
- 2026-11-21: failure naming (scenario letter, function and line, assertion) added after the first break proof (#620) named the stack's tail; proofs on #622 (red naming scenario a) and #621 (docs only, no workflow); two green runs of the final file.
