# Status: INV3 (the metric and graph registries had the 64-slot defect; a window refused for lack of a slot was refused in silence: backend catalog B-86 and B-89)

- Agent: SlotLimits. Host Go, two changes: one retirement signal from the window realm that the per-window registries subscribe to (metric done here, graph handed over: below), and a refusal for lack of a slot that is logged once for each window and carries its own error code.
- Worktree: host (this file, the change) `~/Repos/omniviewdev/worktrees/inv3-registry-slots`; throwaway worktrees of the proof, read-only afterwards: `~/Repos/omniviewdev/worktrees/inv3-proof` (the change, the counters and the graph patch applied: binary B and A), `~/Repos/omniviewdev/worktrees/inv3-proof-base` (`origin/main` and the counters: binary U), `~/Repos/omniviewdev/worktrees/inv3-plugin-k8s` (the Kubernetes plugin at the CI's pin `fb7e5719`, `hack/package.sh 0.21.2 darwin_arm64`).
- Branch: `fix/inv3-registry-slots` (one commit on `origin/main` `e4c31a78`, rebased from `20679a1b` where everything above was run; the PR is the pull request of that branch). Files: `backend/pkg/invocation/window_realm.go`, `invocation.go`, `window_realm_limit_test.go`; `backend/pkg/plugin/metric/finite_service.go`, `service_wrapper.go`, `finite_session_retire_test.go`; `main.go` (one line: the realm gets the host's logger); `docs/development-audit-gateway.md` (the paragraph the change made untrue); this file and the tools beside it in `docs/ui-next/status/INV3/`. **Not edited: `backend/pkg/plugin/resource/**`** (the connection-lifecycle track's): the graph registry lives there, its patch and tests are in `INV3/graph-retire.patch.txt`.

## What was found

INV2 (#639) made the window realm free the slot of a server-mode page that closed. It named two other 64-entry registries as other owners' code. Both have the same defect, for the same reason: they are released by `window.OnWindowEvent(WindowClosing)`, which a browser window never fires.

| Registry | Where (at `20679a1b`) | Defect |
|---|---|---|
| Metric frontend sessions (and, with them, the metric observations of the owner) | `backend/pkg/plugin/metric/finite_service.go:38-55` (`len(s.sessions) >= 64`, release at `:49`) | a page that opened one metric view kept its entry for ever: **the 65th page of a host's life, and every later one, was refused `RESOURCE_LIMIT "Metric frontend session limit exceeded."`** |
| Graph observation windows (and, with them, the graph observations) | `backend/pkg/plugin/resource/graph_observation.go:118-146` (`len(s.windows) >= 64`, release at `:138`) | the same, `RESOURCE_LIMIT "Graph frontend session limit reached."`. **In `backend/pkg/plugin/resource/**`: not edited here** |

Both are reproduced on the real host before the change (binary U, `origin/main` and read-only counters): the loop opens a page, a list, a Deployment's detail page, one metric and one graph observation, closes the page; **round 65: both refused** (`metricSessions` 64, `graphWindows` 64, the realm at 2).

### The retirement signal

How a NATIVE window's close already reaches a registry: `WindowRealm.ScopeForWindow` registers one `WindowClosing` callback for each window it admits; it removes the scope, remembers the window as closed for a minute and calls the constructor's `onRetire(owner)` (`RetireSourceOwner`, `main.go:543`), outside the lock. INV2's sweep calls the same `onRetire` for a page. Metric and graph registered a second, private `WindowClosing` callback of their own: that is the one a page never fires.

Now the realm has ONE announcement, `announce(key, scope)`, called by the close event and by the sweep alike: the source owner is retired first, then every subscriber of `WindowRealm.OnRetire(func(WindowIdentity))` hears of the window, outside the lock, with the window already refused. A registry keyed by window drops its entry in its subscriber and never listens to a window's own event. Server mode and native behave the same because there is only one path.

- Metric: `ServiceWrapper` subscribes the first time it makes a session (under the lock it makes sessions under, so a retirement cannot fall between a scope and its session); `retireWindow` deletes the session, cancels its lifetime and tells the controller (`RetireMetricsSession`: the owner's observations and tombstones). Its own `WindowClosing` callback is gone. The registry now asks the realm for the scope before it counts its own 64, so a refusal for lack of a slot is the realm's (and is logged).
- Graph: the same change, written and tested in a throwaway tree, is `INV3/graph-retire.patch.txt` (two source files and the test file). It is **not applied here**: see "Decisions".

### Every other per-window table of the host

(Read from the code at `20679a1b`; `released?` = when the realm retires the window.)

| Table | Where | Limit | Released on retirement? |
|---|---|---|---|
| Realm scopes (and the closed-window memory) | `invocation/window_realm.go` | 64 live, 1,024 remembered closed (a minute) | it IS the retirement |
| Source interests, sessions, views, connection interests | `plugin/resource/source_coordinator.go:624-661` (`RetireSourceOwner`) | 4,096 | **yes**, both modes (INV2, through `onRetire`) |
| Source `retiredOwners` | `source_coordinator.go:129,630` | none | **no**: an owner string is added for each retirement and never removed (INV2; in `resource/**`, not touched) |
| Metric frontend sessions and the observations they own | `plugin/metric/finite_service.go`, `finite_observation.go:334-355` | 64 | **yes, since this change** |
| Graph windows and their observations | `plugin/resource/graph_observation.go:118-146` | 64 | **no in server mode** (native: its own close event). Patch ready; `resource/**` |
| Activity frontend sessions | `backend/pkg/activity/frontend.go:16-18,44,68-83,137` | 128 | **not by retirement**: a producer lease of 30 s without a heartbeat (swept every 5 s) frees a closed page's sessions within about 35 s; the session records its window only to check callers. A full table answers a plain `errors.New("activity session limit reached")`: no code, no log (same shape as B-89; 128 sessions in 35 s is about four page loads a second with the activity view) |
| Logs sessions (SDK) | `plugin/logs/controller.go:721-744` (`ListSessions` proxies the plugins' clients) | none | **no** (B-88, INV2): no owner; +1 for each page closed with a Logs tab open |
| Exec and terminal sessions | `plugin/exec/controller.go:668-694` (plugin sessions and the local terminal manager) | none | **no**: not owned by a window |
| Port-forward sessions | `plugin/networker/controller.go:381-448` (the plugin's) | none | **no**: not owned by a window |
| Legacy metric `Subscribe` streams | `plugin/metric/controller.go:113,599-681` (keyed by subscription id) | none | **no**: released by `Unsubscribe` or the plugin's stop, not by the window |
| Extension diagnostics runtimes | `backend/extensiondiagnostics/broker.go:20,122-140` (keyed by window NAME) | 64 | not by the signal, **self-pruned**: each entry carries an `alive` closure (Wails' `GetBrowserWindow` for a page) run at every register and list |
| Palette and notice state | none in the host's Go (`backend`, `internal` hold no palette or notice table; the palette and toasts are frontend state) | | n/a |
| Window states | `backend/window` (`windows.json`, saved per window) | | not a realm table; untouched |

## B-89: what the page and the log now get

Before: a window the realm had no slot for got an empty principal, `Boundary.Admit` refused it as `Forbidden("Access denied", "This operation requires a host-issued invocation.")`, normalised to the generic `The operation is not permitted.`, code `FORBIDDEN`: the text of a permission refusal, and nothing in any log.

Now (`window_realm.go`, `invocation.go`):

- **Code.** A window refused for lack of a slot is answered with the existing class `RESOURCE_LIMIT` (`apperror.TypeResourceLimit`, 429, title `Resource limit`, the class's own sentence `The operation exceeds a host resource limit.`, recovery `correctRequest`). The frontend already has the code (`parseAppError.ts:20`). The text is the class's and fixed: no limit, no count, no registry name reaches the page. A permission refusal stays `FORBIDDEN`. Every service that admits through the boundary gets it from `realm.Context`; a service that asks for a scope (metric) gets `AdmitWindow`'s error, `errors.Is(err, invocation.ErrWindowLimit)`. A window the realm RETIRED (closed) is not a limit: `ErrWindowUnavailable`, as before.
- **The agent path** (the MCP relay) never passes through the window realm (`relayGraph` gets a nil realm, `main.go:559`; the relay dispatches under its own scopes) and answers an agent with its own fixed strings (`internal/mcprelay/server.go:988-1002`, E0-1): nothing of this reaches it, and the error carries no free text anyway.
- **Log.** One `WARN` line, `window realm refused a window: no free slot`, through the host logger (`log.Named("window-realm")`, the one the redacting core fronts: `main.go:543`), fields `registry` (`window-realm`; `window-realm-closed` for the 1,024 closed-window memory), `limit`, `count`, `window` (its id), `page` (server-mode page or native window), and `suppressed` when lines were dropped. **One line for each refused WINDOW, not for each call**: the window is remembered; it is named again once a minute while it stays refused, no faster. The memory is bounded (1,024 windows; past it a refusal is counted and the count is written on the next line). Nothing is logged for a window that is served, for a caller with no window, or for a permission refusal.

## Log

- 2026-11-21: read `AGENTS.md`, `decisions.md`, `TRACKER.md`, INV2's status and proposal, the audit gateway document; searched `docs/**` for the symptom (INV2 only; B-86 and B-89 are not in `backend-catalog.md` yet). Worktree `inv3-registry-slots` from `origin/main` `20679a1b`.
- 2026-11-21: found both registries (table above) and read how a native window's close reaches a registry (the realm's own `WindowClosing` callback). The graph registry is in `backend/pkg/plugin/resource/**`, the connection-lifecycle track's: **stopped for it** (not edited), as assigned.
- 2026-11-21: the realm got `OnRetire`, `AdmitWindow`, the limit code and the log (options `WithLogger` and `WithPageSweep` so a test of another package can close a page without a browser). Tests written first. The metric tests were run against the UNCHANGED metric registry: red, 3 of the 4 (`…ReleasedWhenAServerModePageCloses` and `…OfARetiredWindowIsNotRecreated`: the session is still there after 10 s; `…LimitIsForLivePages…`: the refusal is a `ResourceOperationError`, not the limit code); the fourth, the native window's close, is a guard and passes before and after. The realm's tests are red against the code with each piece of the change removed in turn (the mutations below).
- 2026-11-21: the metric registry changed; the graph registry changed and tested in a throwaway tree (`inv3-proof`): its three tests are red against the unmodified graph code (`the graph window of page 1 outlived its page`, `…not the limit code`, `…is not recreated`) and green with the patch.
- 2026-11-21: the real host, three binaries built `-tags production,server` from the same `OMNIVIEW_UI=next` frontend with read-only counters (`counters.patch.txt`): U (`origin/main`), A (this change), B (this change and the graph patch); the Kubernetes plugin at the CI's pin on a kind cluster; `uptime` at the starts: load average 21 to 29 (Other agents share the machine; counts are exact, timings are for comparison only).
- 2026-11-21: Go lint of the changed lines (`/private/tmp/gl215/golangci-lint` v2.15.0, the CI's `--new-from-patch`): first run 7 findings (an `exhaustruct`, import groups, a shadow, a `testifylint`), fixed; second run `0 issues`.

## Result

Surface: the real server build (`OMNIVIEW_UI=next task build:server` for the CI form; the proof binaries `-tags production,server`, as the task builds it), the Kubernetes plugin at the CI's pin on a kind cluster (`inv3-registry-slots`, kind v0.30.0, node v1.35.0, the host's slice fixture), Chromium through Playwright, macOS 27.0.1 arm64. **Not** the native window and **not** a page with real Metrics or Graph views (the new UI has none): the loop's page calls `OpenMetricsObservation` and `OpenGraphObservation` as such a page would, with a request the service rejects AFTER it has made the window's slot (the slot is what is counted; each service makes it before it reads the request).

| # | Check | Result |
|---|---|---|
| 1 | The defect on the real host, binary U (`origin/main`), loop: page, Deployments list, one Deployment's detail page, one metric and one graph observation, close; stopped 3 rounds after the first refusal | rounds 1 to 64 served; **round 65: both registries refuse** (`RESOURCE_LIMIT`: `Metric frontend session limit exceeded.` and `Graph frontend session limit reached.`), `metricSessions` 64, `graphWindows` 64, realm scopes 2, source sessions 2 |
| 2 | Binary A (this change, graph not patched), the same loop | round 65: **metric served** (sessions at most 2), **graph refused**, `graphWindows` 64: what is left until the resource track applies the patch |
| 3 | Binary B (this change and the graph patch), **300 rounds**, list + detail + metric + graph | **0 of 300 refused** (no page, detail, `ListConnections` or view refusal); rows 211 ms median (U: 211, A: 212), detail 13 ms median; at most: realm scopes 3, metric sessions 2, graph windows 2, source sessions 5; host goroutines 80 to 92 (baseline 77), plugin 55 to 88; host RSS 118 to 155 MB without drift (U and A: 116 to 132) |
| 4 | Binary B, 9 s after the last page closed (`final` line of `rounds.jsonl`) | **counters back to baseline**: realm scopes 1 (the main window), metric sessions 0 (baseline 0), graph windows 0 (0), graph observations 0, `retiredOwners` 300 (one for each page); host goroutines 78 (77), host files 32 (35), plugin files 22 (22). Source sessions, views and interests are 1 each, flat since round 1 (the baseline had 0): [INFERENCE] a call a page made before its events socket registered is attributed to the main window, which nothing retires; it does not grow |
| 5 | B-89 on the real host, `refuse.mjs`: 68 pages open, the pages past the limit call `ListConnections` five times each. Binary U | pages 1 to 63 served; **pages 64 to 68: every call `422 FORBIDDEN` "Access denied"**, `0` log lines |
| 6 | The same, binary B | pages 64 to 68: **every call `422`, code `RESOURCE_LIMIT`**, `{"type":"omniview:resource/limit","title":"Resource limit","status":429,"detail":"The operation exceeds a host resource limit.","code":"RESOURCE_LIMIT"}`; **5 log lines for 25 refused calls**, each `WARN window realm refused a window: no free slot {"registry": "window-realm", "limit": 64, "count": 64, "window": 64, "page": true}` (window 64 to 68); all closed: scopes 1, sessions 0, `realmRefused` memory 5; a new page: `200` |
| 7 | Tests of the changed packages, `go test ./backend/pkg/invocation/ ./backend/pkg/plugin/metric/ -race -count=3` | green (the first run, before the lint fixes: invocation 4.2 s, metric 228 s) ; final run: `invocation` 3.7 s, `metric` 225.5 s, all three counts; `backend/pkg/plugin/...` with `-race -count=1` also green (resource 118 s, metric 78 s) |
| 8 | Mutations (rule 28), each caught by the test named for it (table below) | 17 of 17 caught; the assertions of two removed, the same fault passes undetected |
| 9 | Go lint of the changed lines, CI's form | `0 issues` |
| 10 | The CI Go set (`task check:go-build`, `check:go-vet`, `check:go-test`, `check:go-test-devcontrol`, `check:fmt-check`) | `check:go-build`, `check:go-vet`, `check:go-test-devcontrol` and `check:fmt-check` **exit 0** (also `go vet -tags server` on the two changed packages). **`check:go-test` fails in one package, `internal/devworkspace`, in both of my whole-module runs** (the first: the package, 176 s; the second: `TestWatchRecoveryCannotDeclareReadyWithUnrebuiltSDKBackend`, a 15 s wait, 15.3 s) at a load average of 16 to 25; every other package passes. It passes alone (the package, 103 s; the test `-count=3`, 6 s) and does not import `backend/pkg/invocation` or the metric package (`go list -deps`); it did **not** fail on `origin/main` in one run under a lighter load (136 s). A flake of a package this change does not touch: [INFERENCE], not proven on `main`; the CI run will say |
| 11 | The seam, `env -i`, `OMNIVIEW_UI=next`, `ENGINES=<engine> node ui-next/plugins/e2e/seam.check.mjs`, load average 11 to 23 at the starts | **both exit 0**: `PASS chromium: contribute (sidebar entry, page, no route), …` and `PASS webkit: …`. The scenarios and negative controls of the CI job were not run: only the seam itself |
| 12 | The host's own cluster check (`scripts/ui-next-pods/pods-cluster.check.mjs`, unmodified, parity mode) against this change's build on the same cluster | **9 of 9** (`node --test scripts/ui-next-pods/pods-cluster.check.mjs`, parity; the host built from the final tree with `OMNIVIEW_UI=next task build:server`; load average 16 at the start). No `window realm refused` line in that host's log. The three control modes were not run |

Mutations (each is a one-line fault in the new code; the tests that go red):

| Fault | Caught by |
|---|---|
| the boundary ignores the realm's refusal (the old `FORBIDDEN`) | `…RefusesTheNextWindowWithALimitCodeNotAPermissionDenial`, `…RefusesTheNextNativeWindowWithTheSameCode`, `…WithoutALoggerStillRefusesWithTheCode` |
| no line is written | `…LogsOnceForEachRefusedWindow…`, `…RemembersAtMost…`, `…ServesARefusedWindowOnceASlotIsFree`, `…Native…`, `…RacingRefusedWindowsLogOncePerWindow` |
| every call writes a line (refused windows are not remembered) | `…LogsOnce…`, `…Racing…` |
| a line is never written again after a minute | `…LogsOnce…` and `…RemembersAtMost…`, **each only by its after-a-minute assertions: with those removed the fault passes undetected (exit 0)** |
| the memory of refused windows is unbounded | `…RemembersAtMost…` |
| a wrong count in the line | `…LogsOnce…` |
| a window that is served stays in the refused memory | `…ServesARefusedWindowOnceASlotIsFree` |
| subscribers are never told | `…TellsEverySubscriberWhenAPageIsRetiredByTheSweep`, `…WhenANativeWindowCloses`, `…SignalsRetirementOutsideItsLock`, `…SubscribersRunAfterTheSourceOwnerIsRetired` |
| subscribers hear before the source owner | `…SubscribersRunAfterTheSourceOwnerIsRetired` |
| a native close does not announce | `…TellsEverySubscriberWhenANativeWindowCloses` |
| the sweep does not announce | `…WhenAPageIsRetiredByTheSweep` and two more |
| subscribers are called under the realm's lock | `…SignalsRetirementOutsideItsLock` (a subscriber that asks the realm deadlocks it) |
| metric: the session stays in the table | all four metric tests |
| metric: the controller is not told | `…ReleasedWhenAServerModePageCloses`, `…ReleasedWhenANativeWindowCloses`, **each only by its count of retired lifetimes: with those assertions removed the fault passes undetected (exit 0)** |
| metric: the lifetime is not cancelled | the same two |
| metric: the registry is never subscribed | all four |
| metric: the limit error is replaced by the old `CANCELLED` | `…LimitIsForLivePagesAndAnswersWithALimitCode` |

## Not verified

- The **native window and WKWebView**: the native path is the realm's own close event, which this change moved to the same announcement (tested with a fake window whose callbacks fire; not run natively). A native window is refused with the same code and log (tested).
- A page with **real Metrics and Graph views**: the new UI has none. The loop's page calls `OpenMetricsObservation` and `OpenGraphObservation` with a request each service rejects after it has made the slot, so the slots are real, the observations themselves (collection, attach) are not. The tests of the registries never open an observation either.
- **What the frontend does with the new answer**: `parseAppError.ts` already maps `RESOURCE_LIMIT` (429, recovery `correctRequest`); the page's `useConnections` turns a failure into an empty list and a notification: what that notification says now was not looked at on screen. `correctRequest` is a misleading recovery for a limit the user cannot correct by editing a request (decision below).
- **The graph change on `main`**: it is not in this PR. It is tested in a throwaway tree (unit tests red/green, and binary B on the real host, row 3 and 4); the resource track's existing graph tests were not run against it.
- `GOOS=windows` and `linux` builds were not made (the change is platform-independent Go); `go vet` ran for the default build flavour (`task check:go-vet`) and for `-tags server` on the two changed packages.
- The metric registry's own 64 (`maxMetricFrontendSessions`) is now unreachable behind the realm's (a session needs a scope); it is kept as the registry's own bound and has no test.

## Backend catalog (for the lead to add to `docs/ui-next/backend-catalog.md`)

| Class | Where | What | Evidence | Interim |
|---|---|---|---|---|
| **B-86 closed for metric by this PR** | `backend/pkg/plugin/metric/finite_service.go` | the metric sessions are released by the realm's one retirement signal | the tests, row 1, 2, 3, 4 | none needed |
| **B-86 open for graph** (TANGENTIAL; the new UI has no Graph tab yet: do it before it lands) | `backend/pkg/plugin/resource/graph_observation.go:118-146`, `graph_service.go:19,29` | the graph windows (64) are released only by `WindowClosing`: a server-mode page keeps its slot until the host restarts. The change is ready: `docs/ui-next/status/INV3/graph-retire.patch.txt` (the registry subscribes to `WindowRealm.OnRetire`, asks the realm for the scope under its own lock so a retirement cannot fall between them, keeps its own 64 behind the realm's, no private `WindowClosing`; three tests) | row 1 (U), row 2 (A), row 3 and 4 (B); the patch's tests red on the unmodified graph code | none |
| **B-89 closed by this PR** | `backend/pkg/invocation/window_realm.go`, `invocation.go` | a window refused for lack of a slot is answered `RESOURCE_LIMIT` (not `FORBIDDEN`) and logged once for each window | rows 5, 6; tests | none needed |
| TANGENTIAL (same shape as B-89) | `backend/pkg/activity/frontend.go:137` | a full activity table (128) answers a plain `errors.New("activity session limit reached")`: no code, no log. It frees by lease (35 s), not by retirement | code | none |
| TANGENTIAL (B-88, unchanged) | the SDK's log sessions: `plugin/logs/controller.go:721-744` | not owned by a window, not released by the realm | INV2 | the host's own check closes the tab first |
| TANGENTIAL | `plugin/exec/controller.go:668-694`, `plugin/networker/controller.go:381-448`, `plugin/metric/controller.go:113,599-681` | exec and terminal sessions, port forwards and the legacy metric `Subscribe` streams have no window owner and are not released with the window | code (table above) | none |
| TANGENTIAL (INV2, unchanged) | `plugin/resource/source_coordinator.go:129,630` | `retiredOwners` never pruned (36 bytes for each retired window: 300 after this loop) | row 4 | none |
| TANGENTIAL | the window realm: `retiredWindow`/`announce` | the realm has two ways to hear of a retirement: the constructor's `onRetire(owner string)` (the source coordinator) and `OnRetire(func(WindowIdentity))` for the registries keyed by window. They are called from one place, in a fixed order; folding the source coordinator into the second needs a signature change in six test files and `main.go` | code | none |

## Decisions for the lead

1. **Graph (`backend/pkg/plugin/resource/**`)**: not edited, as assigned. Hand `INV3/graph-retire.patch.txt` to the resource track (it applies to `origin/main` `20679a1b` for the two source files and adds one test file), or tell me to land it in its own PR when that track is done. Until it lands, a page that opens a graph view leaves a slot in the graph registry: the 65th such page of a host's life is refused `RESOURCE_LIMIT "Graph frontend session limit reached."` (binary A, row 2).
2. **The code is the existing `RESOURCE_LIMIT`** (the frontend knows it; 429 class). Its recovery word is `correctRequest`, which is wrong for a window limit (closing another window helps, correcting the request does not). A new code or a new `recovery` for a window-limit class needs the frontend parser (`parseAppError.ts`) and the class table together: not done here.
3. **The seam has no scenario that opens 65 pages** (INV2 proposed one: about 70 s an engine, with a negative control). The registries' tests now hold the fix; the cost of an end-to-end guard is yours to decide.

## Dev tools

In `docs/ui-next/status/INV3/` (`.txt`, drop the suffix; they import one another and INV2's): `lib.mjs` and `loop.mjs` (INV2's, changed: `VIEWS=1` opens a metric and a graph observation in each page and counts slot refusals by their text; a final sample after the last page closed; `INV3_COUNTERS` passed to the host), `refuse.mjs` (68 pages open at once, the pages past the limit call five times each: status, code, and the host's log lines; then all closed, one more), `run.sh` (the loop from a clean environment, `env -i`), `counters.patch.txt` (the read-only counters of the proof binaries: realm scopes, metric sessions, graph windows, source sessions; never committed), `graph-retire.patch.txt` (the graph registry's change and its tests, for the resource track).
