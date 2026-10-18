# Selected-source build and watch graph

`internal/devworkspace.BuildGraph` serializes producers for one resolved feature workspace. `NewBuildGraph` validates selected source roots, SDK module replacements, the completed native pnpm12 composition receipt, source/configuration freshness and package exports. It never substitutes canonical checkouts or published SDK APIs for selected local sources.

## Bootstrap ownership

`Manager.NewBuildGraph(ctx, name, BuildOptions)` resolves selected manifest directories and the installed overlay. `ExpectedSDKRevision` is an independently reviewed fixed-capability baseline, not an arbitrary base. Required `VerifySDKSource(ctx,directory,reviewedRevision)` returns `devsource.Identity`; inject real `devsource.Verify` or an explicit workspace-only options adapter. Required `HostBuild` receives `HostBuildRequest.SDKSource` and compiles the actual selected native/server host without a competing bindings/frontend writer. Optional `Bindings(ctx,hostDirectory,outputDirectory)` uses the exclusively allocated sibling output; its real Task default passes `BINDINGS_OUTPUT_DIRECTORY` and `GO_BUILD_CACHE_DIRECTORY`, never raw Wails generation. Required `GoBuildCacheDirectory` is the prepared owned UUID profile runtime `go-build` directory outside source; the constructor rejects missing, redirected or source-tree caches.

`graph.Bootstrap(ctx)` serializes these output owners:

1. Host bindings, through the Taskfile entry point.
2. Selected base-ui, then ai-ui/editors.
3. Selected providers/runtime, then Vite-plugin shim generation, export checking and distribution.
4. Selected plugin frontends/backends, host frontend and host backend.

The graph owns selected local nodes only. Generated aggregate pnpm files live at the registered feature root above independent Git repositories; source package manifests/workspace configs/lockfiles remain standalone inputs. One native12 install boundary and validated `PNPM_CONFIG_WORKSPACE_DIR` govern all managed package commands. Exact-file SDK replacement rewriting preserves unrelated module directives and existing replace blocks. Mixed manager pins, malformed sums, edited aggregate files or stale source fingerprints fail before publication/readiness.

`BuildOptions.Generation` is the current owned supervisor generation. Plugin `.local/build/<id>` output uses A16's capability and exclusively writes `GeneratedTree.Directory/plugin`. Proven terminal compiler failures record controlled partial output; ownership/disposal uncertainty retains the durable pending stage without publication or attestation. Successful output is inspected at `GeneratedTree.Destination/plugin`. Unknown final data is never adopted. Build/watch operation locks use external private UUID paths from `GeneratedLockPath`, not unrecorded source lock files.

Before and after backend compilation, effective `GOWORK=off go list -m -json github.com/omniviewdev/plugin-sdk` source must equal the selected directory and its `devsource.Identity` must remain identical. The shared native-free verifier requires the reviewed baseline to be an ancestor of HEAD and hashes current tracked plus untracked nonignored source bytes. Ordinary dirty SDK API edits are supported immediately, without commits/review per edit. Default verification additionally requires exact reviewed bytes for `pkg/state/root.go`, `pkg/utils/store.go`, and `pkg/sdk/plugin.go`. Intentional isolation-core development uses explicit workspace-only `--allow-isolation-source-changes`, mapped to `VerifyWithOptions(..., VerifyOptions{AllowIsolationCoreChanges:true})` and A08's workspace-scoped child environment opt-in; never silently enable it. Fresh plugin binaries must include the SDK dependency before `instance.RecordBuiltArtifactSource` binds exact rebuilt binary bytes, reviewed baseline and current source digest. Source digests are local builder evidence, not sandboxing or arbitrary-binary source-inclusion proof.

The custom-profile containment validator `pkg/state/custom.go` is also protected by exact reviewed-baseline bytes. Select a reviewed fixed SDK commit containing that validator; a prior baseline missing it is not accepted. Explicit workspace isolation-source opt-in applies to this file too.

## Launch and watch adapters

Before the first Vite child launch, merge `graph.ViteEnvironment()` into its explicit profile child environment. It contains `OMNIVIEW_VITE_ALLOWED_ROOTS` as JSON of canonical selected repository directories. Host Vite requires its actual `WAILS_VITE_PORT`; managed plugin Vite requires `OMNIVIEW_VITE_PORT` matching its leased listener. Both configure explicit HMR client ports; roots are strict filesystem allowances, not wildcard CORS or all-filesystem access. Plugin configuration conflicts with the owned port/HMR endpoint fail rather than silently using fallback discovery. Plugin React/runtime shared-module shim routing remains unchanged.

`graph.Watch(ctx, WatchHooks)` is blocking and cancellation-owned. All hooks are required:

- `Managed`: A08's generation-safe `SetDependencyWatching(id, generation, enabled)` and `RebuildPluginGeneration(ctx, id, generation)`.
- `Generations(ctx)`: current owned managed backend generations, refreshed after a host restart.
- `WaitPluginReady(ctx,id,generation)`: adapter to A08 `WaitReady`; no successful compile/PID/log-only substitute.
- `HostRebuildAndWait(ctx, HostBuildRequest)`: owned supervisor compiles/restarts the intended host and waits for actual readiness. Return a map of plugin IDs already rebuilt and ready by this restart so the graph does not rebuild them twice. The graph still checks their exact current generation readiness.
- `RefreshConsumers(ctx, WatchChange)`: real Vite endpoint/shim refresh, including restarting plugin Vite when new runtime exports require module reload, waiting for actual readiness and requesting the browser's full reload. It must not be a no-op.

Set A08's startup dependency-watching default off before managed starts; `Watch` also disables it for active generations. A08 retains plugin source watchers. The graph recursively covers selected host/UI/effective SDK including new directories and settings/log/proto, and observes selection/dependency manifests. Bindings (also without local host-package selection), canonical YAML worker, shims/dist/build, manager/cache/stage directories and exact Vite config loader stamps cannot enqueue self-build loops. The stamp predicate is shared with `devoutputs.IsViteConfigTemporaryFile`. Debounced JS changes rebuild ordered closure; SDK changes invoke actual owned supervisor/readiness hooks once per generation. No fake source stamp exists.

`BuildOptions.OnEvent` reports building/ready/error and graph invalidation. Compile errors leave the watcher active for correction; changed module/selection manifests return invalidation requiring an explicit stopped relink/rebootstrap, not hidden installs. Parent operation state must retain the last error until a subsequent real successful rebuild/readiness event. Watch/build file locks reject duplicate graph writers; external Task/Wails/package-watch commands must not write the same outputs concurrently.

## Parent-only live smoke

Prepared script: `internal/devworkspace/testdata/buildgraph-live-smoke.mjs`. It must run only after parent verification and real disposable host/two-plugin launch; it has not been executed as part of source authoring.

Provide `A15_LIVE_SMOKE_CONFIG` naming JSON with:

- `workspaceFile`: disposable temporary workspace manifest (host/UI/SDK and at least two plugins).
- `stateRoot`: its disposable profile state directory.
- `runtimeRoot`: actual resolved UUID-owned runtime directory, independently of custom state placement; artifact lookup never derives it from state dirname.
- `observe`: argv of a real parent operation/browser observer. The script appends phase and marker arguments; no shell evaluation occurs.
- `siblingFiles`: explicit sibling output/state canary files whose byte hashes must remain unchanged.
- Optional `timeoutMS` (default 180000).

Create `<workspace>/.local/a15-disposable` containing exactly the workspace UUID as deliberate mutation consent. All mutated roots must be under the canonical OS temporary directory.

The observer must return JSON with `phase: "ready"` only for actual graph/process/browser readiness. For `live-exports`, require `reactSingleton:true`, `runtimeSingleton:true`, `host:{component:true,css:true,runtime:true}` and every selected plugin in `plugins:[{id,component:true,css:true,runtime:true}]`. Observe actual rendered Button `data-a15-live`, computed `--a15-live-smoke`, and shared `A15LiveRuntimeExport` in host/plugin browser/native contexts. `syntax-error` requires `phase:"error",typecheckFailed:true` from real operation state. `sdk-live` requires actual ready state, `host:{rebuilt:true,sourceDigest}` and each `plugins:[{id,rebuilt:true,sourceDigest}]`; source digests must match new trusted artifact records and differ from the pre-edit source snapshot while retaining the reviewed baseline. Baseline/recovery/restoration phases require actual ready state.

The script makes real Button/CSS/runtime-export mutations, waits for actual JS/CSS/runtime/shim bytes and real browser observations, checks sibling canaries, introduces a genuine TypeScript syntax error and requires truthful failure/recovery, then adds an ordinary SDK API method and requires successful intended host/two-plugin rebuild/reload with fresh exact-source attestation. No commit is required for that live SDK edit. It restores exact source bytes in `finally` and waits for actual recovery. The script never supplies synthetic readiness or hides compiler failures.

Managed plugin HMR listener `server.hmr.port`, if explicitly configured, must match the owned HTTP lease just like `clientPort`; conflicting separate WebSocket listeners are rejected before startup. Parent validation must establish an actual WebSocket connection/reconnect, not infer HMR readiness from fetching `/@vite/client`.

## Nested package-manager pinning

The graph's `PNPMCommand(ctx,pin,args...)` returns an argv-safe Node launcher through a ledger-owned `.local/toolchains/pnpm-12.14.0/pnpm.cjs`. It validates and directly spawns the actual native **12.14.0** executable—not Node/Corepack. Set canonical `OMNIVIEW_PNPM_EXECUTABLE` when PATH exposes another manager or a shell wrapper. Wrong versions fail without fallback. The launcher clears inherited workspace-dir aliases, assigns the validated feature root, preserves actual consumer cwd/argv, and uses private aliases for nested `pnpm`; no global installation or package script changes.

Parent-only real nested probe: `A15_PINNED_PNPM_PROBE=1 GOWORK=off GOFLAGS= go test ./internal/devworkspace -run '^TestPinnedPNPMNestedScriptProbe$' -count=1 -v`, with the effective SDK/native module selection and explicit native executable when needed. It exercises actual native12 scripts, inherited wrong-manager/root markers, nested child configs, spaced paths/arguments and the authoritative feature-root context. Historical pnpm10 results do not authorize managed12 composition.

Graph build/watch operation locks use `devsession.AcquirePrivateLock` on their external UUID paths, retaining a stable no-follow private inode through operation completion. Acquisition has a bounded contention context; an acquired lock is closed only when its operation/watcher ends. Lock paths are not atomically replaced or adopted through symlinks.

Typed bridge Node overrides are authoritative only through the validated supervisor path: exact selected `workspaceRoot`/`version` accompany the command, and the owned wrapper uses the selected Node for package scripts through private aliases. Native pnpm itself remains native. Invalid paths, mismatched context or stale receipts fail without fallback; this is not an ambient global Node-selection knob.

Private `node`/`node.cmd` aliases in the same recorded toolchain ensure bare `node` and POSIX env-node shebangs use the explicit executable even when its basename is not node. They directly forward fixed argv to that selected absolute executable; default selection uses embedded actual resolved Node, never recursively searches the private alias PATH. Parent behavior coverage uses an actual copied/renamed Node runtime and observes process.execPath and spaced arguments, separately from the real pinned-manager nested probe.

## Controlled repository outputs

Managed installation/build/Vite commands establish native-free `internal/devoutputs` capabilities BEFORE starting their actual processes. The external private UUID journal is `<collection>/.omniview-dev/repository-outputs/<uuid>`; it records selected source roots, exact directory identities, before/after bytes and durable publication/restoration progress. Existing ignored `dist`, `node_modules` or cache data without independent ownership is refused, never adopted by a posthoc tree hash.

`BeginCompositionInstall(ctx,resolvedWorkspace,plan)` preflights aggregate and selected package modules/cache scopes before the single install. Every retained consumer lifetime blocks shared-store replacement, including packages omitted by a new negative glob and interrupted writers known only from persisted receipts. Unknown outputs and foreign roots refuse admission. Installs suppress scripts and audit peers recursively before builds/readiness. Only terminal process/descendant proof permits `Writer.Finish`; uncertainty stays pending. Plugin startup consumes `devcompose.Installed`; second plugin installs are rejected.

`BeginVite(ctx,resolvedWorkspace,consumerRoot)` covers typechecker/config-loader/Vite process lifetime and returns authoritative `OMNIVIEW_VITE_CACHE_DIRECTORY`. Optimizer cache is UUID-owned external storage; exact `.vite-temp` and `.tmp` children and Vite5 root loader stamps are separately controlled. An immutable modules snapshot excludes a cache subtree only with its matching independent journal record. Shared consumer cache writers remain live until the last actual process finishes, not until a transport request returns.

The serial graph prepares same-depth exclusive sibling stages using `Prepare` with `Distribution`, `Bindings`, `Shims`, or `YAMLWorker`. It runs actual compiler commands with:

- `OMNIVIEW_BUILD_OUTPUT_DIRECTORY`: Vite/declaration outDir or argv-safe package-local tsup CLI out-dir.
- `OMNIVIEW_SHIMS_OUTPUT_DIRECTORY` and read-only `OMNIVIEW_SHIMS_SOURCE_DIRECTORY`: generate/check new shims while preserving the established previous-export behavior.
- `OMNIVIEW_YAML_WORKER_OUTPUT_FILE`: real esbuild output; host build resolver imports this staged worker, not stale tracked output.
- `OMNIVIEW_VITE_CACHE_DIRECTORY`: host/runtime/UI/plugin actual optimizer cacheDir. Explicit conflicting plugin cache/output paths fail rather than silently escaping controlled scope.

UI composite build info and selected Kubernetes node-project build info use controlled `node_modules/.tmp`; type checking is not disabled. `Publish` preflights destinations/HEAD and captures all after-images before source renames, then records resumable progress. Empty/missing declared literal distribution exports, host index.html or exact worker fail before publication. Runtime build still precedes shim generation/check and Vite-plugin output; there is no second output watcher.

Finite producer commands reuse the supervisor's actual retained process-group/job lifecycle with separate stdout/stderr. A mere parent exit is not proof its descendants stopped. `errOwnedCommandUncertain` preserves durable pending intent and forbids Finish/Abort/publication/attestation; ordinary context cancellation is handled only after actual tree stop. Adapter callbacks share this contract.

The main lifecycle owner invokes `RestoreRepositoryOutputs(ctx,w)` only under stopped profile/lifecycle guards before source-changing Edit/Remove. It restores CURRENT committed source, refuses user changes/unknown additions/foreign roots, resumes known interrupted publication/cleanup and retires fully restored journal bindings before slug/root relocation. Unknown producer-writing lifetimes remain an explicit refusal. Normal dirty/ignored-source checks are not weakened. Manual standalone Task/package builds are user-origin changes, not retroactively managed outputs; use the controlled workspace launcher for managed acceptance.

Parent checks use the effective SDK/native module selection: core ownership/source/workspace suites, Vite-plugin tests, `node --test scripts/producer-paths.test.mjs`, the real pinned-manager probe, controlled bootstrap and canonical removal/relocation, and actual websocket HMR/browser source edits. The permanent producer-path test runs real esbuild into a disposable spaced destination and verifies tracked worker bytes remain unchanged. Parent standalone pnpm12.14.0 builds passed for providers, runtime, Vite-plugin shims, host UI and all three UI libraries; these do not substitute for managed A16 graph/output-ownership acceptance.

Selected Kubernetes `server.cors:true` predates these changes and is preserved. Parent clarified that the approved no-wildcard requirement applies to the authenticated control service, not this existing developer asset server. No wildcard was introduced here, and no restrictive asset CORS or security sandbox is claimed: allowed developer assets retain cross-origin exposure. Filesystem allowances and authenticated control/RPC boundaries are separate protections; no guessed native-origin or additional origin-list protocol is introduced.

Metadata ownership checks reject canonical redirection before opening locks or changing permissions. Existing metadata ancestors/leaves are validated read-only; only exclusively created directories receive initial private permissions/ACLs. Shared live Vite-cache admission and non-last completion validate stable root identity rather than traversing mutable payload; only the last actual stopped writer captures content. This avoids stranding a stopped writer's token on another legitimate producer's incomplete cache output while preserving foreign-root and final-content refusal.

Failed source batches remain pending until the complete producer/backend/plugin/readiness transaction succeeds; a later runtime-only repair cannot discard an earlier SDK/backend obligation or emit false graph-ready. New `.pnpmfile.mjs` inputs invalidate the composition just like other policy hooks.

Failed/canceled Stop retains actual child handles, leases, discovery and the supervisor for retry. Bridge disposal/finalization errors are errors, not terminal exit acknowledgements. Finite commands without a separate persistent owner remain joined to their retained `Cmd` until disposal is proven, even after cancellation. Darwin and Linux keep the leader unreaped while proving no live group members; signal delivery alone is insufficient. Linux refuses filtered/uncertain `/proc` views rather than infer death.
