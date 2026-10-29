# Workspace upstream sync: implementation and acceptance evidence

This ledger distinguishes regression evidence from rendered application evidence. A passing compiler or unit suite does not close P01/P02. No production profile or real remote history is an acceptance target.

## Design

Repository `baseRef` remains selection authority. Optional `upstream.remote` and full `upstream.branch` express update policy independently. Explicit remote-qualified selections migrate deterministically; plain legacy branches offer explicit configuration choices without selecting a remote. Commit pins and tags remain pinned.

`PlanUpdate` fetches only selected configured branches, captures immutable SHAs, and reports ancestry, committed-tree equality, dirty paths, composition impact, and configuration fingerprint before downtime. `applyPlannedUpdate` consumes that exact plan without fetching another target. Source-only updates use an authenticated supervisor transaction and the existing build graph; composition changes use existing refresh/link recovery.

Source intent retains captured targets, changed paths, overlay bytes, launch configuration, and durable checkout/build progress. Dependency refresh retains its plan and verifies configuration against allowed old-to-target progress before resuming. Recovery never silently substitutes a newer target. Existing generated-output receipts remain authority; missing or foreign dependencies are not adopted.

Lock order:

```text
UUID foreground follow lease
  -> UUID refresh.lock (manual refresh, source update, recovery, follow)
     -> authenticated supervisor sourceMu
        -> cancel and join local graph watcher
        -> feedback hold and affected managed producer quiescence
        -> supervisor runMu / existing graph build lock
        -> owned lifecycle/root/output guards
```

No root lock spans a self-dependent supervisor stop. Public down revokes follow consent, joins in-flight transaction authority, then stops the supervisor. Idle revocation emits `consent_revoked` without the previous active-operation label, plan, pending cohort, or actionable commands; interrupted mutation retains recovery intent and diagnostics. Malformed or removed consent metadata fails closed with `follow_fence_invalid`, taking precedence over concurrent configuration consent revocation.

Follow schedules only the same update transaction. It hashes immutable target cohorts, suppresses repeated failed attempts, retains recovery diagnostics even when checkout already equals upstream, and backs off network errors up to five minutes. Saved mode, MCP, local watch, live frontend, explicit false booleans, and timeout survive omitted flags.

## Executed verification

All Go invocations used `GOWORK=off GOFLAGS=` and the SDK-aware `.local/hostmod/host.mod` produced by:

```sh
task host:prepare SDK_SOURCE=/Users/joshuapare/Repos/omniviewdev/workspaces/main-dev/workspaces/workspace-upstream-sync/plugin-sdk
```

- Focused suites: `go test -modfile=.local/hostmod/host.mod ./internal/devworkspace ./internal/devoutputs ./internal/devsession ./internal/devcontract ./internal/devsource ./cmd/omniview-dev -count=1` passed. Package times: 180.442s, 30.101s, 5.802s, 3.234s, 5.496s, 6.127s.
- Initial focused run exposed two new fixture-baseline errors. Tests now compare persisted link journals and explicitly clear migrated policy when modeling legacy manifests. No production assertion was disabled.
- Review-correction suites: `go test -modfile=.local/hostmod/host.mod ./internal/devworkspace ./cmd/omniview-dev -run 'Test(Follow|ApplyFollow|Refresh|SourceUpdate|SupervisorNonShutdown|DependencyCommand|WorkspaceEditApply|WorkspaceRestart)' -count=1` passed: 23.303s and 0.773s.
- Focused static analysis: `go vet -modfile=.local/hostmod/host.mod ./internal/devworkspace ./internal/devoutputs ./internal/devsession ./internal/devcontract ./internal/devsource ./cmd/omniview-dev` passed with no output.
- `task dev:cli:build SDK_SOURCE=.../plugin-sdk` produced a real native-independent CLI executable. No generated Wails bindings were needed or generated outside `task bindings`.
- Actual native pnpm protocol probe passed using `OMNIVIEW_PNPM_EXECUTABLE=/opt/homebrew/Cellar/pnpm/12.14.0/bin/pnpm A11_PROTOCOL_PROBE=1 A11_PROTOCOL_REPORT=.../.local/upstream-smoke/protocol.json go test -modfile=.local/hostmod/host.mod ./internal/devworkspace -run '^TestLinkPinnedProtocolProbe$' -count=1 -v`. Report records workspace/12.14.0, atomicDist, peers, and runtime true. An earlier invocation correctly rejected the `/opt/homebrew/opt/pnpm` alias; the canonical executable was then selected.

## Actual CLI/runtime observations

Disposable remotes, registered sources, workspaces, and custom runtime profiles live under `.local/upstream-smoke`. Host baseline is `01d9c8dcf391e4cf58927319fe8e7bb0bf328851`; SDK baseline remains `5b3ef764d1cf738835a723a749a0cb6c45f85e44`; reviewed Kubernetes source is `6281e1671ec1391b744c09555e2e24c531fdd163`.

- Actual check against genuine host/plugin/SDK sources returned `up_to_date` without startup or install.
- Actual browser startup without accepted protocol proof refused `link_evidence_required`.
- Actual browser startup with accepted proof performed the owned native install and refused real peer incompatibility: plugin base-ui lock resolved 0.7.1 while runtime 0.7.4 requires ~0.7.2. The strict peer rule was not disabled. Public diagnostics retain no raw command output; private `0600` evidence identifies the mismatch.
- Canonical down retired the failed supervisor. Recovery attempted the real owned install again and retained the same specific peer failure rather than adopting arbitrary outputs.
- A sibling workspace exists with a separate UUID and source/profile binding.
- A compatible local UI upstream (base-ui 0.7.2) was discovered from the actual configured remote-tracking ref, cloned into test-owned remotes, and selected for full-composition runtime acceptance.
- Parent independently exercised a separate disposable local-remote workspace: check fetched without changing marker; apply advanced marker and retained plan; repeated update returned `up_to_date`; dirty source blocked with preserved authored bytes and paths. Observe SIGINT preserved bytes. Parent's idle down exit-code observation led to graceful consent-revocation handling.

## Forty-case ledger

“Regression” means real local Git/filesystem/process regression evidence, not rendered-runtime proof. Partial rows identify the remaining observation required, not a skipped or fabricated pass.

| Case | Evidence and limit |
| --- | --- |
| G01 | Regression: controlled remote fetch sees newer target while canonical checkout stays unchanged; independent real CLI check/apply smoke. |
| G02 | Regression: unchanged checks preserve manifest/journal; independent repeated CLI update returns up_to_date. |
| G03 | Captured cohort transaction and source advancement regressions; rendered simultaneous host/plugin acceptance remains separate P01. |
| G04 | Pin/tag classification regressions and unselected composition boundaries; no implicit pin advancement. |
| G05 | Ahead-only ancestry regression preserves local history. |
| G06 | Divergence regression blocks before mutation and preserves checkout. |
| G07 | Equal-tree divergent regression reports equality without history replacement. |
| G08 | Staged/unstaged/untracked/ignored-path and rename/whitespace regressions; independent authored-byte CLI refusal. |
| G09 | Deleted branch/missing remote regressions and real local-remote outage scheduler coverage; public errors sanitized. |
| G10 | Legacy plain-branch migration and explicit multi-remote configuration-choice regression. |
| G11 | Captured HEAD/configuration revalidation and moving-upstream recovery regressions. |
| G12 | Committed plugin identity-change refusal regression. |
| D01 | Real native source-only apply-follow rendered changed host code while retaining exact host PID/start identity, native generation, and unrelated Kubernetes generation; no install path selected. |
| D02 | Actual dependency-changing update detected authoritative UI manifest/lock policy changes, completed owned refresh, and rendered a newly imported UI export in host and plugin. |
| D03 | Exact managed SDK overlay remains linked without manual stash in source transaction regression. |
| D04 | Existing three-way recovery tests preserve non-overlapping edits and reject conflicts; source overlay regression. |
| D05 | Exact owned-path validation refuses changed distributions; existing generated/link recovery preserves changed evidence. |
| D06 | Existing interrupted-install ownership recovery tests; actual recovery executes installer but compatibility fixture initially fails peers. |
| D07 | Missing receipt does not create authority; redirected intent, changed-output and existing identity/writer tests refuse mutation. |
| D08 | Actual managed install fails strict peer mismatch. Native pnpm protocol probe exercises peer rejection. No peer relaxation. |
| R01 | CLI supplied-flag regressions plus actual native+MCP source-only follow preserve UUID/profile/mode/endpoints and host/plugin identities. |
| R02 | Real source-only stopped transaction and CLI regressions need no saved launch/protocol and never start an app. |
| R03 | Real ready retained supervisor/host and local Git fetch failure preserve exact process identities, served cohort, source/index/manifest, and reachable host response before downtime. |
| R04 | Captured target/HEAD-before-marker recovery regression; no build before complete source cohort. |
| R05 | Parameterized actual transitions interrupt and recover all five source phases and all six refresh phases, with real Git/native installation, authored-byte canaries, exact targets, and repeated terminal recovery checks. |
| R06 | Source retained-intent/new-request refusal, changed launch policy, refresh target/configuration progress regressions. |
| R07 | Real native dependency install/audit and artifact-producing subprocess complete before injected authenticated plugin RPC/controller/Vite readiness failures; each retains its exact failed stage and old served cohort. |
| F01 | Real foreground observe CLI and local-remote observe regressions preserve source. |
| F02 | Real native follow applied `13bac845`, then coalesced two pushes during its build directly to `37f9e19f`; both transactions completed ready and the exact final marker rendered. |
| F03 | Real dirty-source scheduler regression preserves authored bytes, then revalidates before applying after explicit user repair. |
| F04 | Real local-remote outage/recovery with injected scheduling verifies exponential backoff and reset. |
| F05 | Actual second foreground follower refused `follow_owned`; UUID lease and retained-supervisor regressions cover local/manual ownership. |
| F06 | Real active-checkout cancellation and public down fence dispose/join retained child, preserve captured intent, prevent stale relaunch, and recover exact target; actual idle Ctrl-C/down also passed. |
| F07 | Actual running failed-intent follower reported `blocked_recovery`; no polling rebuild occurred. Ctrl-C exited zero. Regression also covers checkout-current retained failure. |
| F08 | Actual follower subprocess SIGKILL after a persisted source boundary retains exact intent across a newer upstream push; resumed follow blocks on recovery and repeated recovery remains safe. |
| S01 | Sibling host/plugin/SDK HEADs, manifest/ownership/profile SHA-256 values, absent node_modules, and absent supervisor remained unchanged across real updates. No claim of a concurrently rendered sibling is made. |
| S02 | Fetched SDK target verifies reviewed ancestry/protected blobs before checkout; protected-change refusal tests pass. |
| S03 | Public dependency errors redact credential-bearing output; private evidence test asserts 0600. Fetch diagnostics remain sanitized. |
| P01 | Successful native and browser source-only changed-path updates rendered exact host/plugin markers; actual host PID/start identity and unrelated plugin generation stayed unchanged. |
| P02 | Real native dependency refresh rendered the new imported export in both consumers; actual plugin shim imports matched host React and runtime function identities. |

## Platform scope

Executed on macOS arm64 with real native pnpm 12.14.0, authenticated native WebView DOM, and managed Chromium. Native DOM/identity evidence is not OS pixel/input evidence. No Linux or Windows runtime claim is made. Only disposable local remotes received test commits; no implementation branch push, PR, or merge was performed. Parent owns publication.

## Broader suite result

`GOWORK=off GOFLAGS= go test -modfile=.local/hostmod/host.mod ./internal/dev... ./cmd/omniview-dev -count=1` passed in 192.61s. Results: devbaseline 5.332s; devcompose 6.355s; devcontract 5.109s; devcontrol 0.221s; devoutputs 35.080s; devsession 6.803s; devsource 7.137s; devworkspace 190.473s; CLI 8.416s. `internal/devcontrol/host` has no test files.

## Changed files

- CLI: `cmd/omniview-dev/{workspace_commands.go,workspace_commands_test.go,command_help_test.go}`.
- Schema: `internal/devcontract/workspace.go`.
- Output/trust: `internal/devoutputs/{owned_paths.go,owned_paths_test.go}`, `internal/devsource/{upstream.go,upstream_test.go}`.
- Planner/config/status: `internal/devworkspace/{upstream.go,upstream_test.go,upstream_configuration.go,upstream_configuration_test.go,upstream_status.go,upstream_status_test.go,manifest.go,status.go,repository_selection.go}`.
- Transactions/runtime: `internal/devworkspace/{refresh.go,refresh_test.go,source_update.go,source_update_test.go,follow.go,follow_test.go,dependency_diagnostics_test.go,links.go,lifecycle.go,reconfigure.go,worktrees.go,launch.go,supervisor.go,supervisor_runtime.go,supervisor_retention_test.go,watch.go,vite_feedback_test.go}`.
- Guides: `docs/development-{workspaces,worktree-lifecycle,package-linking,watch-graph}.md` and this ledger.

## Actual compatible runtime and final safety corrections

The host+UI+reviewed-SDK+Kubernetes composition reached authenticated browser readiness in 233.48s. Workspace UUID: `e18df77a-865b-4c78-b4d3-e0a0d1039d4e`; initial generation: `8bf1cdee-fa57-481b-a4ee-509846e39469`; actual host PID: `530`; browser endpoint: `http://127.0.0.1:21837/`. Genuine Kubernetes plugin reported ready build, Vite, RPC, and controller stages, generation `2e8dc9bd-988d-49b4-9636-6cc148e53327`. Managed Chromium rendered the actual host and Kubernetes route. This closes baseline browser rendering only, not changed-path or dependency-change acceptance.

An actual live check exposed normal Vite cache receipts as active writers. Read-only path inspection now distinguishes narrow inode-checked mutable cache/loader boundaries from immutable dependency stores and active installers. It neither records live cache bytes nor grants stopped/cleanup authority. A real Writer regression proves live observation succeeds, stopped validation still refuses live writers, and externally changed immutable modules still refuse observation.

`go test -modfile=.local/hostmod/host.mod ./internal/devoutputs -run '^TestValidatedOwnedPaths' -count=1` passed in 0.639s. Final diagnostic/follow/configuration additions passed their focused suite in 12.647s; accompanying focused vet passed.

Actual foreground observe against the genuine disposable sibling reported an available update without changing source. Explicit down fenced it and the follower exited zero. Parent independently exercised the latest CLI's apply follower: it emitted applying/applied, advanced a stopped local-remote workspace, and SIGINT exited zero; idle down also exited zero.

## Continuation integration evidence

The live publisher removes tracked `dist/.gitkeep` while replacing distribution contents. The planner now exempts unstaged `.D` only below independently validated `owned_output` boundaries. The regression `TestUpstreamOwnedPublicationDeletionKeepsAuthoredDeletionsVisible` reproduces tracked placeholder replacement and keeps staged deletion, unknown-boundary deletion, and missing managed-overlay deletion visible.

`task dev:cli:build SDK_SOURCE=/Users/joshuapare/Repos/omniviewdev/workspaces/main-dev/workspaces/workspace-upstream-sync/plugin-sdk` produced CLI cache binary `472d6e11ec87cb82d34b9551f8e406451276b4398d88de2127bb731e9e5a908f/omniview-dev`.

The lint loader succeeds with `env GOWORK=off GOFLAGS= golangci-lint run ./internal/dev... ./cmd/omniview-dev`, without module overrides or policy changes. The full run reports existing and changed findings. The changed-line invocation `env GOWORK=off GOFLAGS= golangci-lint run --new-from-rev=HEAD ./internal/dev... ./cmd/omniview-dev` initially reports 193 findings; this is not a passing lint claim.

Native prerequisites are present: `xcrun --find clang` resolves Xcode's clang and `xcrun --show-sdk-path` resolves the macOS SDK. No unsupported-platform excuse applies to native acceptance on this machine.

Canonical `workspace restart runtime-ui --root .local/upstream-smoke/collection --json` on the current CLI completed in 276.33s. Generation `62f5c984-fb73-4404-9c73-852cef3d29b9` authenticated host PID `95865`, browser `http://127.0.0.1:21837/`, and Kubernetes generation `83e5f5c5-8509-4986-a54c-c534d5e6a0d1`. Check-only then reported host target `ad81b2afdf938da7e9dc9e0eff8343f273e6f264` and plugin target `3f75efa0b07c16b1744204116e6e86ea5d3b7071`, both behind, with `dependencyChanged:false`. The tracked publication deletion no longer blocked planning.

The first running apply rendered both `Upstream sync host marker` and `Upstream sync plugin marker` in managed Chromium. It nevertheless failed readiness in 87.40s: composition source hashes included `workspace.json`, and advancing recorded base commits invalidated its old receipt. This is failed acceptance, not success inferred from pixels. Served cohort evidence retained the prior revisions.

Source-only transactions now rebase only the composition's workspace-manifest hash and recorded manifest after proving exact captured old/target metadata. All other hashes remain unchanged; mandatory `CheckInputs` still validates actual dependency inputs. Recovery handles a retained build-phase intent. Canonical down followed by exact `workspace recover` completed in 1.95s; recovery remained stopped.

The post-deletion broad command `env GOWORK=off GOFLAGS= go test -modfile=.local/hostmod/host.mod ./internal/dev... ./cmd/omniview-dev -count=1` passed in 287.62s. This run preceded subsequent lint-only refactors and composition receipt correction; it does not substitute for their final barrier.

The next live host-only update exposed the graph's cached composition authority. Its persisted receipt had advanced, but readiness still checked the old in-memory workspace hash. The graph now adopts only an exactly validated metadata-only rebased plan before rebuilding; topology, build options, dependency hashes, and installed-file checks remain unchanged. A cached-plan regression exercises this distinction.

Independent review added final-cohort HEAD and ownership-marker validation before build-phase receipt rebasing or recovery, including when no link journal exists. A local commit beyond the captured target or a changed ownership marker now blocks recovery without dropping the retained intent.

Final integration barrier passed: `env GOWORK=off GOFLAGS= golangci-lint run --new-from-rev=HEAD ./internal/dev... ./cmd/omniview-dev` reported `0 issues`; the chained `env GOWORK=off GOFLAGS= go test -modfile=.local/hostmod/host.mod ./internal/dev... ./cmd/omniview-dev -count=1` passed every package, total 333.38s, devworkspace 324.597s. `env GOWORK=off GOFLAGS= go vet -modfile=.local/hostmod/host.mod ./internal/dev... ./cmd/omniview-dev` passed without output in 1.85s. An earlier fixture run failed an absolute-key assertion; the corrected regression uses the actual relative `workspace.json` authority key.

Actual apply-follow on the running workspace reported the retained operation as `blocked_recovery` rather than restarting the failed cohort. A second follower refused `follow_owned`. Ctrl-C stopped the first follower after 24.5s with exit zero; Chromium still rendered both changed host/plugin markers afterward.

Native startup with `workspace up runtime-ui --root .local/upstream-smoke/collection --mode native --mcp --json` completed in 376.54s including prior down/recover. Actual native host PID `75313`, start identity `darwin:1793234515:269101`, generation `7d27de83-0271-49a6-9638-fa3c78c80408`, and MCP `http://127.0.0.1:30463/mcp` authenticated the intended visible `main` window. No browser endpoint was advertised. Native WebView DOM initially rendered the host marker and then the genuine Kubernetes route.

`workspace follow runtime-ui --root .local/upstream-smoke/collection --interval 5s --apply --repo omniview --json` applied `13bac845ecb560de125c16d4c807c2846a840230`. While that transaction ran, two upstream pushes published `1efccee6` and `37f9e19f8cba4a76e477995c088e878362d976bf`. The follower applied the final successor directly, skipping the intermediate cohort. Final inspection reported `launchPhase:ready`, served host commit `37f9e19f`, unchanged host PID/start identity/generation, and unchanged Kubernetes generation `9956afec-5c29-4a5e-8bec-bb82c253c61b`, with all four plugin stages ready. Native exact-window DOM rendered `Upstream follow native marker final` and `Upstream sync plugin marker`. Ctrl-C exited zero without stopping the app.

Dependency acceptance changed the selected UI package's `@base-ui/react` policy from a range to exact `1.2.0`, updated its authoritative source lockfile, and exported `upstreamDependencyMarker`. Both host and plugin imported the new export. This changes dependency authority and imported package behavior; it does not claim a resolved third-party version upgrade.

Actual check reported `dependencyChanged:true`. Actual apply completed the owned refresh in 271.16s, preserved native+MCP configuration and reviewed SDK, and reached generation `cd60d390-3f5e-4dd4-bbd1-1c6ca6c9f3b4`, host PID `33932`, Kubernetes generation `006b0efd-c7e2-46d6-9891-bf05a2b071f9`, with every plugin stage ready. Served revisions were host `c55da3b54080a6897b4af1b6d33d35a936d0e040`, plugin `73e5a46054d12cfbbcebd0352e50dffd092764ad`, and UI `9a7f83df61c305348aee9cbcfd2610d159e88e5a`.

Authenticated native `main` window DOM rendered `Upstream imported dependency behavior` in both consumers. Dynamic imports of the actual plugin-loaded `react.mjs` and `_omniviewdev__runtime.mjs` shim URLs proved `react.useState === window.__OMNIVIEW_SHARED__.react.useState` and `runtime.usePluginContext === window.__OMNIVIEW_SHARED__["@omniviewdev/runtime"].usePluginContext`, both true. The shared base-ui module exposed the new marker. No duplicate React/runtime implementation was substituted.

Final browser source-only acceptance completed in 96.27s. Host `577b5ebc9f4da2635ee8f5e526c208198075a4f7` and plugin `74265e0e3a568d36c69e47767a2543e9ea749e59` reached ready, and managed Chromium rendered `Upstream imported dependency behavior browser changed` in both consumers. Host PID `18466`, start identity `darwin:1793235203:446381`, generation `544cb5af-3f04-435a-977f-7008a3b681e2`, and Kubernetes generation `e08d2f61-1ae7-4f99-a179-1a03dca4306a` remained unchanged.

Sibling canaries remained unchanged: host `01d9c8dcf391e4cf58927319fe8e7bb0bf328851`, plugin `32968cc8a5d8fe691a08fae7072d2bf43eef3bad`, SDK `5b3ef764d1cf738835a723a749a0cb6c45f85e44`; manifest SHA-256 `b3c5391525e9fbbf789d461ad491dd9e3eef54a63c35beadfe614037ebcd7185`, ownership `176704eb44ce99127386594da9f997a721911d56d4d2cb5e47dfb68050e07daa`, profile `8a39934e8916886f26d18793f46c2684e4c2320814cfa22067a51454bef45fad`. Its node_modules and supervisor remained absent.

Final running apply-follower reported `up_to_date`. Canonical down fenced it, and it exited zero. Canonical down retired `runtime-ui`, the earlier failed `runtime`, and `sibling` in 2.53s; all returned no running instance. The browser tab closed, and only test-owned `.local/upstream-smoke` scaffolding was removed afterward.

The follow-on deterministic safety fixtures below close the earlier matrix gaps. They exercise actual transaction/process behavior, not source-text assertions or another rendered application run. Native OS pixels/input, Linux, and Windows remain outside the exercised platform evidence.

Runtime acceptance used CLI cache binary `dd5b34e472c01054179ddb24869501cfaab4dac44e86a304d1fed9f2606f757d/omniview-dev`. Final `task dev:cli:build SDK_SOURCE=/Users/joshuapare/Repos/omniviewdev/workspaces/main-dev/workspaces/workspace-upstream-sync/plugin-sdk` passed in 2.55s and produced `ec8a20283ea7b116cea0857c98a4572095a14447a77c55ce493199179d64bf22/omniview-dev`, including final lint-only constant cleanup. No runtime was relaunched after canonical retirement.

## Final deterministic safety closure

`TestSourceDurablePhaseRecovery` passed every declared source boundary: prepared, checkout, overlays, build, complete. `TestRefreshDurablePhaseRecovery` passed stop, retire, update, install, start, verify using actual native pnpm installation and authenticated retained-supervisor continuity. No late phase was skipped. Recovery is interrupted again through remaining writes; exact captured targets, authored bytes, ownership markers, and final intent retirement are asserted.

`Manager.Recover` now distinguishes an existing transaction from a genuinely completed recovery. Only a successful recovery creates its private terminal receipt. Repeated terminal calls require unchanged source, launch/journal metadata, validated outputs and runtime state. Missing proof still invokes existing refresh/recovery behavior; malformed/redirected/foreign metadata, pending publication, unfinished links, changed source and failed initial bootstrap do not become no-op successes.

`TestActiveFollowCancellationAndDownRetainCapturedCohort` and `TestActiveFollowerCrashRetainsExactIntent` passed active mutation cancellation, public down fencing, retained-child disposal/join and actual follower-process SIGKILL. A later upstream push does not replace the captured recovery target.

`TestSourceUpdateSuccessfulBuildCannotCommitFailedPluginReadiness` passed RPC, controllers and Vite cases in 11.97s. It uses actual native `Link`, peer audit, and a real artifact-producing subprocess through the build graph before authenticated readiness failure. The update remains failed with exact plugin stage and prior served cohort. Earlier fixture failures were corrected rather than bypassing composition/lock ownership checks.

Old retained supervisors are detected through authenticated additive source-update capability evidence. Fresh apply refuses before intent/source mutation; existing intent recovery remains preserved with `supervisor_upgrade_required` and canonical saved-option restart guidance. The CLI never upgrades an executable automatically.

Final tagged safety gate passed after fixing the preflight fixture's actual retained-host cleanup. Its supervisor now stops/reaps its host, closes and joins HTTP serving, and the parent verifies the host identity is gone. Diagnostics use a private file. The earlier full run's `Test I/O incomplete` was a real leaked helper, not a reason to increase Go's drain timeout; the three verified test-owned orphans were removed.

Exact final commands:

```sh
env GOWORK=off GOFLAGS= go test -modfile=.local/hostmod/host.mod -tags devcontrol ./internal/devworkspace -run '^TestUpstreamFetchFailureKeepsReadyRetainedCohortReachable$' -count=1 -v
env GOWORK=off GOFLAGS= go test -modfile=.local/hostmod/host.mod -tags devcontrol ./internal/dev... ./cmd/omniview-dev -count=1
env GOWORK=off GOFLAGS= golangci-lint run --build-tags=devcontrol --new-from-rev=HEAD ./internal/dev... ./cmd/omniview-dev
env GOWORK=off GOFLAGS= go vet -modfile=.local/hostmod/host.mod -tags devcontrol ./internal/dev... ./cmd/omniview-dev
```

The focused ready-runtime preflight test passed in 1.60s. The complete tagged dev/CLI suite passed all ten packages and drained normally; combined command time was 243.24s, devworkspace 235.892s. Changed-line tagged lint reported `0 issues`; tagged vet passed without output, combined static-gate time 5.41s. Native linking emitted existing macOS deployment-target warnings; no warning policy was changed. Final full-suite evidence: `artifact://353`; final static evidence: `bg_74`.

Additional closure files are `upstream_preflight_retention_test.go`, `upstream_phase_recovery_test.go`, `follow_active_recovery_test.go`, `source_update_readiness_test.go`, and `source_update_compatibility{,_test}.go` under `internal/devworkspace`. These supplement the native/browser application evidence above rather than replacing it.

Final post-closure CLI build passed in 2.06s and resolves to cache binary `df14ff943261d8f1cd3776b15fadab868cbe202298c6d7cb6b66d09bda1728d2/omniview-dev`. The implementation branch remains `feature/workspace-upstream-sync-b5b392df`; no disposable runtime remains running and no implementation branch was pushed.

## Parent integration and publication gate

Integrated upstream `afde0a73` (parallel build nodes and unchanged-node reuse) before publication. The watch merge preserves the source transaction's existing-lock path and calls the updated executor with explicit non-reuse semantics for changed-source rebuilds.

Final independent review found and resolved two additional consumer issues: terminal recovery now observes legitimate live cache writers without granting installer/module adoption, and follow retains an old supervisor's typed restart guidance across repeated observations. The live-cache regression creates a committed package consumer before exercising actual output writers; no production ownership assertion was relaxed.

The post-merge gate passed in 294.61s:

```sh
env GOWORK=off GOFLAGS= golangci-lint run --build-tags=devcontrol --new-from-rev=origin/main ./internal/dev... ./cmd/omniview-dev
env GOWORK=off GOFLAGS= go test -tags=devcontrol -modfile=.local/hostmod/host.mod ./internal/dev... ./cmd/omniview-dev -count=1
env GOWORK=off GOFLAGS= go vet -tags=devcontrol -modfile=.local/hostmod/host.mod ./internal/devworkspace ./internal/devoutputs ./internal/devsession ./internal/devcontract ./internal/devsource ./cmd/omniview-dev
task --silent dev:cli:build SDK_SOURCE=/Users/joshuapare/Repos/omniviewdev/workspaces/main-dev/workspaces/workspace-upstream-sync/plugin-sdk
```

Changed-code lint reported zero issues; all ten tested packages passed; vet passed. The resulting executable is cache binary `926375c9b23d9762b8279446d9f5b6e34360cf5929b38cca88861ca434cf9c1f/omniview-dev`.

Parent then exercised that exact executable against a separate disposable local bare remote. Check-only fetched a changed commit while retaining the old source marker. One-shot apply advanced to the new marker, retained plan diagnostics, and did not start an instance. A repeated update returned `up_to_date`. Canonical remove retired the test-owned workspace, branch, and profile. Native/browser rendered acceptance above predates this upstream integration; the final executable received this additional real CLI smoke and the full integrated test/static gate.

## Linear rebase and CI provisioning correction

Rebased the PR onto `afde0a73` without retaining the merge commit. The rebased source tree exactly matched the backed-up pre-rebase tree (`84e6b8733313877573ad07d91ac6f4ac12cfabdf`), preserving upstream parallel execution and bootstrap reuse. Watch/source updates continue to use the affected closure without consulting bootstrap reuse records.

The first Linux Go-check job failed `TestRefreshDurablePhaseRecovery` because its job had Node and Go but no native pnpm executable. The job now provisions native pnpm 12.14.0 using the same pinned `pnpm/setup` action as the existing workflows, with automatic dependency installation disabled. No recovery cases are skipped or weakened. Running the Go recovery integration suite locally requires that native executable on PATH or through canonical `OMNIVIEW_PNPM_EXECUTABLE`.

Post-rebase verification passed unchanged-node reuse, changed dependency closure, externally replaced outputs, toolchain invalidation, independent-node parallelism, failure fencing, CSS/no-backend behavior, runtime-before-shims ordering, source-only backend preservation, and all six refresh recovery phases. `task check:go-test` then passed the entire repository Go suite using the SDK-aware modfile, followed by tagged changed-code lint with zero issues. Combined verification took 442.73s. Linux CI is the authoritative verification of the workflow provisioning change.
