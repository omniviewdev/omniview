# Built-in Plugin Integration Plan

## Goal and scope

Ship reviewed first-party features with Omniview without maintaining a second feature framework. Containers is the first integration target. SSH/SFTP follows the same contracts; its protocol implementation is not part of the initial infrastructure change.

This work separates product distribution from backend execution, activation, and API privilege. A bundled plugin may run in a subprocess. A compiled-in plugin uses the same capability providers and host admission as an external plugin.

The current implementation covers infrastructure phases 1–4. The production catalog remains empty until the separately planned containers migration. Containers functionality, cross-plugin image inspection, signed release artifacts, and comparative performance measurements are not part of this infrastructure cutover.

## Workspace and dependency authority

- Use installed `omniview-dev`, not a source-built replacement or ad hoc worktree.
- Workspace: `builtin-plugin-research`, created by `omniview-dev workspace create` and verified with `workspace inspect`.
- Collection: `/Users/joshuapare/Repos/omniviewdev/workspaces`.
- Starting host revision: `ab0235ecc0c9c6c99458b306b10abe7bcfaefbd1`.
- The initial host pinned published SDK `v0.11.0`; refreshed main pins published `v0.14.3`. Candidate source tests use the immutable SDK revision in `e2e/source-cohort.json`, subject to cohort approval; this does not change release dependency policy.
- Use the candidate SDK commit recorded in `e2e/source-cohort.json` through the installed CLI. Its state, profile-contract, and SDK initialization boundaries are unchanged from the prior reviewed source-coordinator pin. Add containers through the CLI only when its migration is planned.
- All Go commands use `GOWORK=off`. Generate bindings only with `task bindings` when exported Wails surfaces change. Build runtime before Vite-plugin shims when frontend package contracts change.

## Architecture decisions

1. Keep one transport-neutral provider implementation per feature. Existing SDK capabilities remain authoritative.
2. Reuse existing capability controllers, invocation realms, resource admission, catalog/generation fencing, settings, and contribution registration.
3. Compile trusted providers into the host through an explicit host-owned catalog. Never accept an installed manifest's claim that code may execute in-process.
4. Resolve built-in frontend modules through an explicit static dynamic-import map, then use the existing validation and contribution pipeline.
5. Keep native clients, credentials, sockets, and connection pools in backend code. Frontend modules use public runtime clients.
6. Product releases own built-in versions. Built-ins can be disabled, but cannot be independently overwritten, updated, or uninstalled through marketplace flows.
7. Reserve built-in IDs before discovering external plugins. A collision fails explicitly rather than selecting a filesystem-order winner.
8. Register inexpensive metadata before activating code or connecting to external services. Shipping a feature does not authorize startup network activity.
9. Do not use Go shared-object plugins, reflection-based factories, global self-registration through `init`, hidden host imports, or a parallel internal SDK.
10. In-process code shares host memory and crash fate. Subprocess execution is crash isolation, not an operating-system permission sandbox.

## Starting seams and constraints

- `backend/pkg/plugin/types/backend.go`: shared backend and capability detection contracts.
- `backend/pkg/plugin/types/inprocess_backend.go`: direct provider dispensing exists, but shutdown has no resource owner and health callbacks execute under its state lock.
- `backend/pkg/plugin/loader.go`: production loading requires installed files and defaults to subprocess execution. `backendFactory` is a private test seam, not the production extension mechanism.
- `backend/pkg/plugin/resource/controller.go`: resource sources may expose `Close`; the resource controller already owns that cleanup.
- `backend/pkg/plugin/exec/controller.go`: exec stop closes its provider. An aggregate backend must not automatically close every dispensed capability again.
- SDK registration binds utility consumers to resource connection context. A direct provider map does not reproduce that binding by itself.
- `ui/features/plugins/adapters/importPlugin.ts`: production SystemJS and development Vite module loading are separate from backend execution.
- `ui/features/plugins/core/PluginService.ts`: common validation, extension registration, and contribution ordering must remain shared.
- `ui/features/plugins/react/PluginServiceProvider.tsx`: currently starts `loadAll`; lazy module activation requires explicit work rather than assuming bundling makes it lazy.
- `main.go`, `plugin_asset_handler.go`, and release workflows: host embeds its frontend; installed plugin assets come from profile storage. Built-in asset packaging needs an explicit production path.

## Code organization

Keep transport primitives in `backend/pkg/plugin/types`. Do not put feature logic there.

Keep discovery, lifecycle orchestration, provenance, and installer policy in `backend/pkg/plugin`. Add narrowly scoped files for catalog loading rather than expanding the subprocess loader with feature-specific cases.

Place trusted feature composition under `internal/builtinplugins`. That package will construct catalog entries and inject explicit services; it must not become a generic service locator. Feature provider packages must not import the application entrypoint or plugin manager.

Keep frontend source selection in the existing plugin adapters. Validation, normalization, registries, and contributions belong to the current plugin core. Do not add a second registry for built-ins.

Keep SDK connection binding in the SDK's composition boundary if published interfaces cannot express it. Do not duplicate SDK registration internals inside the host.

New types require a concrete owner and consumer. Avoid generic policy frameworks and speculative extension points.

## Phase 1 — In-process lifetime primitive

**Scope:** backend configuration, caller migration, behavior regressions, and runtime smoke. No production discovery or feature activation.

- [x] Replace mutable public health customization with constructor configuration containing providers, optional health check, and optional aggregate shutdown.
- [x] Migrate every constructor caller and health customization. Do not retain an overload, alias, deprecated constructor, or mutable callback shim.
- [x] Take ownership of the capability map through a construction-time snapshot. Provider objects remain borrowed by controllers under SDK contracts.
- [x] Reject dispensing and report unhealthy as soon as shutdown begins.
- [x] Invoke configured aggregate shutdown exactly once, outside the backend state lock. Concurrent `Stop`/`Kill` callers wait for the same shutdown result.
- [x] Report exited only after shutdown completes. Preserve shutdown errors for subsequent `Stop` callers.
- [x] Run custom health checks outside the lock and recheck stopping state before reporting health.
- [x] Document that shutdown owns only aggregate resources not already owned by capability controllers. Do not infer ownership from `Close` method presence.
- [x] Prove shutdown releases a real stream/worker; prove concurrent stop, callback error retention, and health during shutdown.

**Acceptance:** a backend with a real blocking resource can be stopped without lock inversion or duplicate disposal. Stopped backends never report healthy. All current consumers compile under the new constructor contract.

**Ownership restriction:** shutdown must not recursively call `Stop` or `Kill` on the same backend. Observational methods are allowed from callbacks. Callback configuration is immutable after construction.

### Phase 1 verification

- Before the fix, `GOWORK=off go test ./backend/pkg/plugin/types -run '^TestInProcessBackend_StoppedOverridesHealthCheck$' -count=1` failed because a stopped backend's custom health check returned true.
- After the fix, `GOWORK=off go test -race ./backend/pkg/plugin/types -count=1` passed.
- `GOWORK=off go test ./... -count=1` passed: 48 packages passed and 11 packages had no tests. This verifies the constructor migration across current host consumers.
- A throwaway executable, run with `GOWORK=off go run -race`, drained a real `io.Pipe` and exercised eight concurrent stop callers followed by `Kill`. Observed output: `stream drained: 4096 bytes; shutdowns: 1; stop callers: 8; healthy: false; exited: true`. The executable was removed afterward.
- No application UI, production built-in discovery, or containers runtime was exercised by this prerequisite.

## Phase 2 — Shared production lifecycle and direct composition

**Depends on:** phase 1 and an audit of actual SDK/controller close ownership.

- [x] Trace all startup, rollback, stop, unload, reload, crash, and app-shutdown paths.
- [x] Define a close-ownership table for resource, exec, logs, metrics, networking, settings, and tools. Shared native clients need one owner, not one close per capability.
- [x] Drain all required cleanup after individual errors; preserve errors without skipping unrelated resources. Audit current early returns and backend-before-controller shutdown ordering.
- [x] Fence admission and cancel provider generations before releasing native clients. Make stop/reload idempotent without stale readiness or reused providers.
- [x] Bind utility capabilities to the same real connection context and admitted source generation as resource providers. Use existing SDK composition contracts; no SDK edit was needed.
- [x] Exercise direct and gRPC implementations through shared real file-log, PTY/file-exec, metric-sampling, and admitted catalog-pin scenarios. Preserve failed-startup and archive-rollback coverage.

**Acceptance:** stop/reload closes streams and shared clients once; stale operations cannot publish after generation retirement; an error in one cleanup step does not skip others. No direct path bypasses authority, reference, scope, or catalog checks.

## Phase 3 — Trusted catalog, discovery, and product policy

**Depends on:** phase 2.

- [x] Introduce a host-owned catalog with validated metadata and a backend factory per trusted entry. Use existing metadata and capability types wherever possible.
- [x] Merge catalog and installed discovery through one inventory/lifecycle flow. Keep subprocess creation separate from direct backend construction.
- [x] Make origin and update ownership explicit in runtime records and frontend inventory. Do not expose native factories through Wails.
- [x] Reserve IDs before external discovery. Deny marketplace install/update/uninstall paths targeting product-owned IDs before product-owned state changes.
- [x] Persist enable/disable preference without persisting executable factories or converting built-ins into installed files.
- [x] Keep built-ins visible while disabled or failed; report actual state and actionable errors.
- [x] Reject external-ID collisions explicitly and retain external files. Concrete containers-version/settings migration is deferred to phase 5; no implicit deletion or duplicate selection is allowed.

Built-in metadata uses the SDK's validated connection-sharing declarations. Catalog snapshots own the complete `exports` and `requires` pointer/slice graph. Required owners use the same dependency admission and explicit-load promotion as external plugins; discovery does not activate them.

Reserved-ID archive recovery blocks both the built-in ID and its validated staging directory without blocking unrelated startup. Failed preference writes reconcile runtime enablement against the persisted result if restoring the previous preference fails. Enablement changes retain unresolved collision diagnostics.

Required-owner admission failures publish failed inventory with the original cause before returning. Disabled built-in rows hide phase indicators even while provider teardown still exposes the previous phase. Marketplace queries remain fail-closed until native inventory establishes product ownership; marketplace listings cannot establish native origin.

**Acceptance:** empty-profile and offline starts discover product-owned descriptors without plugin installation. Disabling releases resources. External collisions and replacement attempts fail deterministically. App updates preserve settings and enablement.

## Phase 4 — Frontend resolution and activation

**Depends on:** phase 3 inventory contract.

- [x] Add explicit built-in module descriptors and static lazy import mappings. Preserve Vite development loading for selected external sources.
- [x] Feed all resolved modules through existing export validation, contribution normalization, extension-point ordering, and cleanup.
- [x] Separate discoverable metadata from executable module activation. Navigation and explicit plugin-service loads activate built-ins; no general activation-event framework was added.
- [x] Deduplicate concurrent activation and fence late completions after disable/replacement.
- [x] Keep React and runtime singletons shared. No new shared dependencies were added.
- [x] Show built-in ownership and correct disabled/failed states in the actual plugin UI. Remove unsupported update/uninstall actions rather than letting them fail late.

**Acceptance:** actual packaged UI opens built-in pages and actions through the normal registry. Disabled plugins leave no routes or active contributions. Feature modules stay out of the initial evaluated path until needed. Verify the real UI in Chromium or native WebView.

### Infrastructure verification

- Generated bindings through `task bindings`; the installed CLI also regenerated them through that Task while building the real host with `server,devcontrol` tags.
- Built runtime before regenerating/verifying Vite-plugin shims, then built providers. Migrated both flat and namespace `PluginInfo` exports to the host DTO.
- Passed the actual application source check with `node_modules/.bin/tsc6 -p tsconfig.app.json --noEmit --incremental false`.
- Passed 418 frontend tests across plugin core/adapters/React startup and the new-tab launcher. Removed implementation-only listener-count and normalized-ID assertions rather than repinning them.
- Passed race coverage for the manager/types packages and the direct log, exec, metric, and network packages. Real SDK cases exercise admitted file logs, PTY/file operations, metric sampling, catalog pins, stream cancellation, and shutdown ownership.
- Passed native-free control tests with `CGO_ENABLED=0` and host control tests with `-tags devcontrol`. The real CLI host build exposed and drove migration of the tagged inventory interfaces.
- Launched the real host through installed `omniview-dev`. A temporary compiled UI plugin stayed unevaluated before navigation, evaluated once on demand, and read native inventory with `phase: "Running"` and `origin: "builtin"`. The management surface showed product ownership, no Update/Uninstall controls, working Disable, and re-enable without eager module evaluation. A dedicated Chromium screenshot captured the real management surface.
- The held-import cancellation scenario passed deterministic service tests. Its browser attempt was interrupted by a browser-automation transport hang; do not claim that browser scenario passed.
- Removed the temporary catalog/module, source files, and smoke-only profile preference after the runtime exercise. The shipping catalog is empty.

- After fixture removal, the final optimized frontend and tagged host build reached `ready` through the installed CLI. Native `plugin list` returned `[]`. Chromium rendered Home with no smoke launcher or evaluated smoke module; smoke-only restored tabs were closed.

**Verification limits:** the broad Go suite is not green. Observed failures include `TestSelectedUIStartupUsesCanonicalLifecycleAndActualHTTPBeforeReady` rejecting process-group disposal with `operation not permitted`, `TestSelectedSDKAPIRealCompileRPCAndRecovery` missing host/settings RPC readiness, and CLI process-control fixtures timing out. The broad run was canceled after these failures. No test retries, longer per-test deadlines, or weaker process-ownership checks were added. The final optimized browser also reported aborted `/__omniview_development_status` requests and an Unavailable development badge while native control inventory remained reachable. Actual feature UI proof used the managed live frontend; signed desktop artifacts, containers/Kubernetes interaction, and comparative performance remain phase 5/6 work.

### Pull request integration

- PR [#352](https://github.com/omniviewdev/omniview/pull/352) integrates current `main`, including native terminals and the extension contribution inspector.
- Independent review found and fixed two concurrency boundaries: enablement persistence now publishes inventory under the same state transaction, and timed-out native activation cannot evaluate frontend code later. Both regression checks passed.
- On the integrated SDK `v0.12.1` tree, all six affected manager/native-provider packages passed `-race`. The local devserver and CLI suites also passed. The broad macOS run still timed out in the Git fixture for `TestSelectedFetchUsesGlobalCredentialHelperOnly`; it is not reported as a green full local run.
- CI on `0d1aadb9` passed Go checks, binding freshness, all three platform builds, render benchmarks, and whole-app/production profiling. UI lint and marketplace navigation exposed additional frontend fixes before merge.
- Marketplace-only listings must not wait for a successful installed-plugin detail lookup. Public marketplace queries use the authoritative installed inventory to exclude built-ins while allowing uninstalled listings.
- Queued exec frames retain their originating stream identity. Retirement fences UI emission and close-signal index changes, so an old stream cannot publish into or remove a replacement session.
- A built-in collision or reserved-ID uninstall recovery remains a per-ID failure. Unrelated plugins still complete startup and initialization notification. Trusted catalog metadata, user preference, external files, and recovery evidence remain intact.
- Resolve reserved recovery explicitly with the app stopped: inspect the reported marker and owned staged files, then relocate them together through an approved migration. Activation stays blocked until the conflicting external directory and recovery marker are resolved; startup never deletes them automatically.
- The later `main` source-coordinator cutover was merged without restoring its removed watch/subscription tests. New source-readiness and C02 constructor callers use the immutable backend configuration. All seven affected manager, type, resource, and utility packages passed `-race` against the new SDK pin.
- The latest rebase includes published SDK `v0.14.3`, connection-owner broker admission, and post-bootstrap readiness. Candidate tests select the independently approved SDK revision; no approval-variable or isolation-gate change is required.
- On the refreshed tree, the complete frontend suite passed 1,418 tests with three existing skips; application typechecking passed, and lint finished with zero errors and 11 warnings. The installed CLI launched the approved candidate SDK's optimized host to `ready`, native inventory returned `[]`, and Chromium rendered plugin management and marketplace version selection without installing a plugin.

## Phase 5 — Containers vertical integration

**Depends on:** phases 2–4 and CLI-selected containers sources.

- [ ] Inventory actual containers backend, settings, resource-v2 support, utility capabilities, and UI dependencies. The host's current `plugins/containers` directory declares UI only; it is not evidence of a production backend.
- [ ] Adapt one provider implementation to both direct and standalone composition. Do not fork protocol logic.
- [ ] Supply narrow backend services explicitly. Keep engine sockets, native credentials, and connection pools out of browser state.
- [ ] Exercise resource listing, watch updates, logs, terminal exec, disconnect/reconnect, configuration changes, and disable/re-enable against a real disposable engine.
- [ ] Verify startup does not connect to an engine merely because the plugin ships with the app.

**Acceptance:** containers works from a fresh offline installation without downloading a plugin. Resource and utility operations preserve existing host admission and generation behavior. External Kubernetes behavior remains unchanged.

## Phase 6 — Packaging, performance, and release gate

**Depends on:** complete containers integration.

- [ ] Include provider code and frontend chunks in macOS, Linux, and Windows product artifacts. Include required notices and licenses.
- [ ] Make built-in versions traceable to the product/source revision. Verify signatures and bundle contents through existing release machinery.
- [ ] Measure the same real provider through direct and subprocess adapters: cold startup, activation, first connection, enumeration, watches/logs, terminal latency, allocations, CPU, and memory.
- [ ] Include inactive-plugin baseline and repeated enable/disable/reconnect cycles. Retain exact workload, versions, and observed limitations; do not claim zero-copy or a speedup from architecture alone.
- [ ] Verify packaged offline behavior and upgrade from a profile containing the previous external containers plugin.
- [ ] Update plugin-development documentation with composition, lifecycle ownership, provenance, and distribution rules. Remove obsolete examples touched by the cutover.

**Acceptance:** supported production artifacts contain a working containers feature; no startup downloads, duplicate runtime singletons, orphan workers, or stale routes. Report measured results before choosing direct execution for further features.

## Phase 7 — SSH/SFTP contract application

**Depends on:** validated common system, not containers-specific shortcuts.

- [ ] Define connection configuration, credential/agent usage, host-key verification, shell sessions, and filesystem capabilities against concrete UX requirements.
- [ ] Reuse existing exec/network/resource capabilities where they fit. Add a narrow filesystem contract only for behavior not expressible by current interfaces.
- [ ] Keep file-transfer bytes out of generic UI resource payloads; specify streaming, cancellation, backpressure, and connection lifetime.
- [ ] Verify hostile host keys, authentication failures, disconnects, canceled transfers, and path semantics with a disposable SSH/SFTP server.

**Acceptance:** SSH/SFTP uses the same catalog, lifecycle, activation, and release policy with no private plugin-manager dependency. Host-key verification and secret handling remain explicit security gates.

## Verification policy

Run checks after integrated edits, not repeatedly during implementation. For phase 1, run targeted Go tests and race coverage, then a throwaway executable that releases a real stream through configured shutdown. Remove the executable afterward. No UI or full-app runtime claim follows from that smoke.

For production phases, launch using installed `omniview-dev` in the selected workspace and exercise actual user-visible operations. Tests alone do not establish application integration. Update this plan with observed results and completed checkboxes only.

## Research basis

- Grafana core SDK handlers and direct adapter: https://github.com/grafana/grafana/blob/01f74f769f0e047658e9927dfe1e7c33bdd73900/pkg/plugins/backendplugin/coreplugin/core_plugin.go
- Grafana core registration: https://github.com/grafana/grafana/blob/01f74f769f0e047658e9927dfe1e7c33bdd73900/pkg/services/pluginsintegration/coreplugin/coreplugins.go
- Grafana built-in frontend imports: https://github.com/grafana/grafana/blob/01f74f769f0e047658e9927dfe1e7c33bdd73900/public/app/features/plugins/built_in_plugins.ts
- VS Code extension hosts: https://code.visualstudio.com/api/advanced-topics/extension-host
- VS Code activation: https://code.visualstudio.com/api/references/activation-events
- Theia extension/module distinction: https://theia-ide.org/docs/extensions/
- IntelliJ scoped, lazy services: https://plugins.jetbrains.com/docs/intellij/plugin-services.html
- Go shared-object plugin limitations: https://go.dev/src/plugin/plugin.go
