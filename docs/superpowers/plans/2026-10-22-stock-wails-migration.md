# Stock Wails Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and run Omniview's multi-instance development workflow against unmodified Wails, with no framework fork or patch bootstrap.

**Architecture:** Stable application identity selects native storage; an Omniview-owned public Apple API bridge performs guarded default-store cleanup. Linux uses stock application/program identity and host-only startup XDG roots. Stock server guards combine with existing application asset middleware. SDK source selection is independent of framework resolution.

**Tech Stack:** Go 1.26, Wails v3, Apple WebKit, GTK3/GTK4, WebView2, pnpm 12.14.0, Task, Playwright.

**Spec:** `docs/development-native-toolchain.md` and the user-approved migration order. **Latest user clarification supersedes the earlier data-transition design: this feature is unreleased and unused; no legacy data transition is needed.**

## Global Constraints

- Work only in owned feature worktrees under `/Users/joshuapare/Repos/omniviewdev/workspaces/agentic-workspaces`.
- Pin `github.com/wailsapp/wails/v3` to `v3.0.0-beta.34.0.20261022002616-a90f7e7f50bf`, commit `a90f7e7f50bf3d7db5552fcaf9eeec6fd3d4e626`, checksum `h1:/0b9vjQizjTw/xxQz4fCzH5BNaG9Bk4aRelbav8VnB8=`. Match frontend runtime to upstream package version `3.0.0-beta.34`.
- No Wails source edits/fork/cache patch, patched dependency fallback, push, merge, or publication.
- No legacy transition commands, markers, migration guards, startup reservations, retained-store deletion, compatibility aliases, or historical runtime fixtures. Remove code made obsolete by this scope correction.
- Keep ordinary profile/UUID/state/process/bundle/generated-output ownership safeguards. Production single-instance behavior and baseline settings/plugin isolation remain unchanged.
- Every Go command uses `GOWORK=off GOFLAGS=`; pnpm is 12.14.0. Bindings only through `task bindings`; runtime builds before Vite-plugin shims.
- Preserve exact selected SDK replacement and source verification. Effective Wails authority comes from trusted root module/checksum files, verified against the actual full Go graph; alternate pins/replacements refuse.
- Parent owns `main.go`, `internal/devworkspace/launch.go`, root module/npm pins, binding generation and integration verification. Other slices provide interfaces/snippets for shared entrypoints.
- Agents skip builds/tests/lint/formatters/commits mid-flight. Parent runs checks. Permanent tests cover plausible consumer-visible boundaries, not source strings/wiring/default copies. Exported changes require LSP references where indexable.

## Task 1: Standard module selection and build tooling

**Files:** `scripts/hostmod/**`, `scripts/internal/hostmodtest/**`, `scripts/devcli/**`, `Taskfile.yml`, `build/**/Taskfile.yml`, relevant CI workflows and installer. Parent integrates launch.go.

**Interfaces:** `scripts/hostmod/main.go` accepts explicit root/input modfile/SDK/private output/format arguments; JSON contains an absolute `modfile` only. Output is `host.mod`, `host.sum`, ownership marker; no framework source tree or patch hash. Task uses `host:prepare` and `HOST_MOD_OUTPUT_DIRECTORY`.

- [x] Prepare SDK-aware private effective module files without changing source go.mod or materializing Wails.
- [x] Preserve/rebase unrelated safe replacements; reject contradictory SDK mappings, including version-specific overrides; verify actual selected SDK directory.
- [x] Verify full Go graph Wails path/version/checksums/no replacement against root authority. Do not let lazy graph lookup miss transitive upgrades.
- [x] Cache keys cover trusted root authority, selected inputs/helper and effective files; tampered immutable templates/executables refuse before reuse.
- [x] Update Task/CI/generator/install consumers to the root-pinned CLI, not ambient wails3. Remove obsolete patch implementation/exporter/tests/payload.
- [x] Add deterministic offline module-proxy/MVS and output/cache ownership regressions. Restore permissions only on fixture-owned cache directories during cleanup.

**Verification:** SDK-aware `go test ./scripts/hostmod ./scripts/devcli/... ./scripts/internal/hostmodtest -count=1`; actual `task host:prepare`; inspect effective Wails/SDK Go metadata; cached CLI invocation and focused re-review.

## Task 2: Stock native configuration and cleanup

**Files:** native config/removal/bridge files, `internal/instance` environment/profile code, Darwin native snapshot/history lifecycle, supervisor host environment, backend child launchers and focused boundary tests. No transition files or CLI commands.

**Interfaces:** `configureNativeProfile(*application.Options, instance.Profile) error`; `prepareProfileRuntime(instance.Profile) error`; `Profile.ChildEnvironment` propagates malformed restoration errors. Server runtime preparation creates runtime/temp resources without native roots.

- [x] Mac uses the immutable real bundle's default persistent store; Windows keeps stock user-data folder; Linux sets valid stable program/application identity.
- [x] Application-owned Apple cleanup dispatches default-store removal onto the main queue after ApplicationStarted. Dispatch completion asynchronously to avoid shutdown/timer main-thread deadlocks. Keep guards, exact bundle verification, inherited OFDs and deadlines.
- [x] Keep Darwin-only native-use receipts and complete original-bundle cleanup snapshots; no storage-strategy/version migration or old-binary fallback logic.
- [x] Linux overrides XDG data/cache before host exec only; restore original absent/empty/populated values for plugin/tool/terminal children. Preserve HOME/config/runtime/session variables. Reject malformed/duplicate restoration metadata, redirected roots, and incomplete direct startup environment.
- [x] Delete superseded legacy transition/decision/history inference/reservation/retained UUID code and tests. Preserve relevant async callback and environment boundary regressions.

**Verification:** affected Go/native/server tests, actual named Omniview instances and authenticated MCP, localStorage/IndexedDB/settings isolation and restart, display rename, duplicate-root refusal, guarded Alpha deletion with Beta intact. Exercise GTK3/GTK4 native engine mechanisms and state precise sandbox/desktop limits; cross-compilation is not native proof.

## Task 3: Stock server boundary and application policy

**Files:** `development_server_request_policy*`, focused tests; parent main.go composition.

**Interface:** `developmentServerMiddleware(instance.Profile) application.Middleware` is nil for native/production and wraps Assets.Middleware, never ServerOptions.

- [x] Compose policy -> boot identity -> plugin/default dispatch -> stock runtime/asset chain, with nil guard.
- [x] Preserve required document/RPC framing/provenance. Outer health/custom.js/events/stream routes use stock Host/Origin guards; no false asset interception claims.
- [x] MCP/control authentication remains separate. No allow-all origins, forwarded-authority trust, or proxy bypass.
- [x] Keep real-listener mutation/unchanged-state security tests; remove incidental and pretend-WebSocket cases.

**Verification:** server-tag tests, actual binding mutation/read, denied-origin unchanged state, hostile Host, real event/stream traffic and rejection, actual browser surface and plugin assets; scoped review.

## Task 4: Parent integration and bindings

**Files:** root Go/npm manifests/lockfiles, main.go, launch.go, generated bindings/shims and developer guides.

- [x] Pin stock dependencies; tidy SDK-aware graph and synchronize root metadata without committing SDK local replacement.
- [x] Integrate module helper and native/server interfaces, without any transition or reservation callsites.
- [x] Run `task bindings`; build runtime then Vite plugin, and build host frontend/native/server surfaces.
- [x] Remove executable old-patch references. Replace obsolete developer instructions with the single stock path; distinguish historical evidence from current verification.

## Task 5: Verify, review, and deliver

- [x] Run Go/native/server tests, affected race/vet/format checks, frontend tests/lint and binding checks against the selected SDK graph.
- [x] Use committed disposable snapshots of current sources for managed native and browser/plugin smokes; do not mutate real source branches or rely on stale HEAD.
- [x] Run actual two-native-instance identity, state, restart, rename, duplicate and cleanup scenarios. No historical migration fixture or legacy data tests.
- [x] Run managed browser lifecycle and real two-plugin live/optimized consumer scenarios with browser visual evidence, preserving existing deadlines and exposing errors.
- [x] Review integrated correctness/security/maintainability, fix findings, recheck affected behavior.
- [x] Retire only owned probes/containers/fixtures through verified lifecycle; leave unrelated user state and the quarantined historical supervisor untouched.
- [x] Deliver exact exercised evidence and platform limits. No merge/push/publication.

## Verification record

Executed on macOS27 arm64 with pnpm 12.14.0; Go commands used the SDK-aware `.local/hostmod/host.mod`, `GOWORK=off` and empty `GOFLAGS`.

| Boundary | Exercised result |
| --- | --- |
| Effective module graph | Exact stock `a90f7e7f50bf` version/checksums, no Wails replacement; exact selected local SDK directory. |
| Build entrypoints | Actual `task host:prepare` and cached `task dev:cli:build`; Task-only bindings; runtime then Vite-plugin/shim and host frontend builds; explicit stock server binary build. |
| Complete Go suites | Native and server: 38 packages passed each; 11 packages with no tests each. |
| Race, static analysis, formatting | Native/server root package, instance and module/cache/bootstrap race checks passed; native/server full-tree vet and affected gofmt checks passed. |
| Frontend checks | Root lint passed; 933 host UI tests, 157 runtime tests and 32 Vite-plugin tests passed. Real supervisor authority enabled; no Vite test skips. |
| Native pnpm protocol | Actual 12.14.0 peer/runtime/atomic-output probe passed. Actual host launch also verified the corrected initial multi-document marker preserves source pins under strict peers. |
| Actual macOS native host | Two named Omniview instances: actual shell/binding identity, independent localStorage/IndexedDB/settings, restart/new generation, stopped rename, duplicate refusal and Alpha deletion with live Beta intact. Both profiles/state roots retired. |
| Actual browser surface | Stock server host with Kubernetes and Workspace Probe ready; named title/chip, host-confirmed ownership details and real probe interaction captured in Chromium screenshots. Owned browser/profile retired. |
| Browser lifecycle/consumers | Eight scenarios passed across split runs: optimized/live two-plugin consumers, identity, real events, UI save/profile isolation/first-paint themes, stale-target rejection, custom-root authority and restart persistence. The combined command hit its outer cutoff; remaining scenarios passed separately with unchanged UI deadlines. Strict E2E TypeScript checking passed. |
| Linux engine mechanisms | Linux arm64/Xvfb, Go 1.26.9, WebKit 2.54.0: GTK3 passed sandbox-enabled; container prohibited GTK4 bubblewrap user namespaces. Explicit test-container-only sandbox-disabled GTK3/GTK4 runs passed storage/restart/purge/placement/sentinel assertions. Containers and owned image retired. |
| Scoped reviews | Module provenance/SDK MVS corrections and clean native/server integration reviewed without new actionable findings. Review source conclusions are separate from execution evidence. |

Observed integration fixes: native pnpm rejected an implicit-first-document seed and freshly selected incompatible OpenTelemetry peers; preserve the initial stream marker rather than relax peers. The synthetic plugin's Vite/Node type cohort was aligned with the SDK fixture rather than adding production overrides or casts. Concurrent real-network Go fixtures now use distinct workspace identities. An incidental first-upstream-HMR-message assertion was deleted; actual managed HMR/security and ordinary reconnect checks remain.

The theme test waits for the actual rendered theme and profile-scoped persisted paint hint before its unchanged first-RAF assertion. Actual UI observation confirmed the DOM can show Solarized while the cache still holds Void; after persistence, reload painted Solarized with the correct UUID. No application workaround, mocked storage/response or UI timeout increase was used.

Final remaining-scenario command exited successfully: four passed in 15.9 minutes including teardown. Its private arena was removed by the guarded fixture lifecycle; no owned browser or application instance remains running.

Limits: native MCP/binding checks are not native pixels or user-input automation. The current host run did not launch the user's production singleton channel. No cookie-persistence, older-macOS, Windows runtime, full Linux Omniview, Wayland, GPU or production sandbox claim follows from these checks.

