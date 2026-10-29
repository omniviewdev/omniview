# Development instance profiles

## Identity and startup order

A named workspace is selected by its canonical `workspace.json` (`OMNIVIEW_WORKSPACE_FILE` for a launched host), not its display name or frontend/build optimization flags. `internal/instance.Resolve` validates the manifest, context conflicts, canonical state path and channel before creating state. `ResolveEnvironment` applies host build/environment channel selection; `instance.buildChannel` can be stamped with `local`, `stable` or `nightly`. `version.Development` is not consulted. Existing nightly version/root stamps retain nightly classification; a source `-dev` build without a workspace fails rather than defaulting to production.

For a local macOS production app, run `task darwin:package RELEASE=true DEV=false`. Release tasks stamp the stable production channel and `version.Development=false`, even when the source version remains `0.0.0-dev`; the app uses `~/.omniview`. `DEV=false` alone only changes optimization and does not select a production profile. Use `task dev` with a named workspace for development isolation. Published nightly builds retain their explicit nightly channel stamps.

Default roots:

| Kind/channel | State | Runtime | Webview |
| --- | --- | --- | --- |
| Production/stable | `~/.omniview` | inside selected state root | unchanged platform default |
| Production/nightly | `~/.omniview-nightly` | inside selected state root | unchanged platform default |
| Development/local | `~/.omniview-dev/profiles/<workspaceUUID>/state` | sibling `runtime` | sibling `webview` |

Production selection also rejects overlap with durable custom-development **containers**, including historical claims retained after rebinding. Registry claims remain authoritative even when an external owner marker is missing: overlapping production paths fail closed, but an unrelated missing marker does not block production startup. Existing foreign, redirected or malformed ownership evidence still fails closed without repair. Development binding resolution still requires its matching owner marker. Existing endpoint/ancestor identity checks catch physical aliases without treating distinct case-sensitive custom siblings as the same directory.

Custom-profile admission uses the same filesystem-aware overlap predicate for retained claims and protected boundaries. Case aliases of an existing ancestor cannot admit nested containers, while genuinely distinct case-sensitive siblings remain permitted. Binding/claim files publish with atomic replacement: Unix syncs the parent directory; Windows uses write-through `MoveFileEx` replacement rather than POSIX directory `Sync`. Windows runtime durability still requires platform evidence.

Production overrides reserve ASCII case variants of the other channel's default label and `.omniview-dev/profiles` under the configured HOME, including paths that do not exist yet. This is an explicit portable namespace policy, not a claim that the filesystem is case-insensitive. The owning channel's own default label remains permitted; near-prefix siblings and unrelated custom paths are not case-folded. A physically identical HOME alias receives the same protection, while a genuinely different case-sensitive HOME directory remains distinct.

Environment state selection takes precedence over the legacy state-root ldflag. The explicit root is canonicalized and validated, including programmatic `appstate.WithRoot`. A workspace cannot use production, nightly, another workspace's profile, a conflicting manifest, or a relative root. Shared ancestor aliases are canonicalized; profile identity boundaries remain enforced by the common workspace contract. An explicit state selection must equal the resolver's selected root: default `<UUID>/state`, or a deliberately established custom binding. Custom setup uses `devcontract.SetCustomProfile` while stopped and records matching schema-1 UUID/state identity in workspace `.local/profile.json`, the dedicated container's `.omniview-profile.json`, and the global `~/.omniview-dev/custom-profiles.json` claim registry. Resolution only validates these existing records and never claims a directory implicitly. The custom container must be absent/empty and outside protected production/default-profile/source boundaries; its state child remains absent for baseline publication. Runtime, webview, and artifact namespaces remain under the default UUID profile independently of custom state placement.

Startup performs native-storage validation before creating the state root. Every profile retains its canonical-root nonblocking flock. Wails production singleton IDs are channel-scoped (`com.omniview.stable`, `com.omniview.nightly`); Wails decides duplicate channels before writable settings, settings migration, telemetry, or plugin startup. A duplicate canonical root is rejected earlier by flock. It is not a focus/activation promise. Controllers remain registered before bootstrap, so plugin initialization receives initialized controllers.

Development startup additionally takes the stable parent guard at `~/.omniview-dev/locks/<workspaceUUID>.lock` before creating/opening the profile state and acquiring its root flock. This guard lives outside the purgable profile. Startup releases it only after the root flock is held; purge and baseline seed use the same parent-before-root order, so removing/recreating a profile cannot replace an active lock inode and admit a second writer. Guard contention/errors fail closed. Production retains its existing root/channel guards.

Default UUID profiles carry the shared durable `.workspace-owner.json` marker (`schemaVersion: 1`, matching `workspaceID`). `devcontract.EnsureDefaultProfileOwnership` may establish it only for an absent/empty canonical UUID directory while the caller holds the stable UUID guard, before state or transient children make that directory nonempty. Existing nonempty unmarked directories, foreign IDs and redirected markers fail closed; there is no legacy-directory adoption. `ValidateDefaultProfileOwnership` only reads and returns a missing-path error for absent ownership. Runtime preparation validates an existing owner rather than claiming one. Artifact-before-start writers take the UUID guard and ensure ownership before creating evidence; artifact launch validates ownership under the selected root's live flock. Purge can use the same durable proof even when state is custom-bound, while an absent default profile remains absent until a writer explicitly establishes it.

After these guards, development temporary files and startup reports are routed under `runtime/tmp` and `runtime/startup-report.json`; diagnostics/logs already receive the selected state service. HOME and credentials are never rewritten.

## Native/browser state

Named macOS native development uses WebKit's default persistent store under a stable workspace-specific `CFBundleIdentifier`. Display-name changes do not change that identity. No Wails UUID-store option, startup-only macOS14 requirement, or legacy transition layer remains. Server builds do not select native storage.

Native removal uses an Omniview-owned public Apple API bridge after the native main loop starts. It clears only the verified workspace application's default store. Managed removal retains UUID and selected/default state guards through preflight, native completion and filesystem retirement. The helper validates inherited lock descriptors against expected inodes and retains their actual flock. Cleanup uses a verified complete same-ID bundle and dispatches completion off the native main queue.

Windows receives the profile `webview` directory through stock WebView2 configuration. Linux uses stable UUID-derived program/application identity and pre-start host-only `webview/data` and `webview/cache` XDG roots. Child launchers restore the original data/cache environment, preserving absent and empty values as well as explicit selections; HOME/config/runtime/session variables are unchanged. Native preflight is application-owned and uses only stock Wails APIs.

Runtime and webview roots derive independently from the canonical UUID profile boundary, never from a remapped state parent. Without an explicit validated custom binding, workspace state must remain the exact `<UUID>/state` leaf; aliases into its own profile root/runtime/webview are rejected. The actual Linux `data` and `cache` directories, along with runtime/tmp and the webview root, are checked for aliases/non-directory paths during resolution before native preparation, then all revalidated before any runtime directory creation. Owned runtime/native directories are private (`0700`). Artifact APIs revalidate explicit workspace/selected-state identity and use the default UUID runtime even when application state is custom-bound.

Named server builds combine stock Wails Host/runtime/WebSocket guards with application asset middleware. Asset/RPC requests require loopback authority with the actual listener port, exact TLS-aware Origin when supplied, and no cross-site/same-site Fetch Metadata; normalized runtime requests also require the generated client's nonsecret client-ID header. Application responses prohibit framing. Outer health/custom.js/event/stream routes use stock protections, not the asset middleware. This is browser provenance defense, not local-client authentication. MCP/control keep separate authentication. Native `wails://localhost` requests do not use HTTP provenance policy, and forwarding headers/wildcard origins are not trusted.

## Frontend authority

The outer asset middleware injects safely HTML-escaped JSON immediately after `<head>`, before cached-theme scripts, for embedded HTML and the proxied Vite shell:

```js
window.__OMNIVIEW_INSTANCE__ = {
  schemaVersion: 1,
  instanceID: '<workspace UUID, stable, or nightly>',
  displayName: '<display name>',
  generation: '<current host generation>',
  kind: 'development' // or production
};
```

The source HTML is not rewritten. Identity-bearing HTML is served `no-store`; websocket upgrades, Wails IPC, plugin assets and non-HTML assets bypass the HTML modifier. `AppService.GetInstanceInfo()` exposes a detached `InstanceDescriptor` snapshot; tokens and provider error detail maps are not exposed. Runtime kind is authoritative even for optimized development builds. The native development window title is `Omniview — DEV · <displayName>`.

Boot generation is public target identity, not a credential or persistence namespace: browser storage stays keyed by stable instance UUID. Authenticated native readiness reads this immutable boot object without importing another `/wails/runtime.js`, which can initialize a second runtime and replace the app's event dispatcher.

## Child process and binary compatibility contract

The resolved injected state root is always passed explicitly, including roots chosen with ldflags or a programmatic state constructor. Child environments replace stale inherited state/workspace/instance/generation values and carry `OMNIVIEW_STATE_DIR`, `OMNIVIEW_WORKSPACE_FILE` when selected, `OMNIVIEW_WORKSPACE_ID`, `OMNIVIEW_INSTANCE_ID`, `OMNIVIEW_GENERATION`, `OMNIVIEW_PLUGIN_ID` and `GOWORK=off`. Loader ownership injection does not depend on a telemetry callback. Other managed process launchers consume `Profile.ChildEnvironment` through the managed lifecycle integration.

Plugin children never inherit the private outer process-bridge/supervisor capability environment or source-bound package-manager command map.

Old installed executables are not made safe by a host or SDK source update. Workspace backend launch requires independent host-owned trusted build evidence under `runtime/artifacts`, not a `plugin.yaml` capability assertion. The trusted builder verifies the selected effective SDK directory and reviewed isolation-capable ancestor, snapshots actual tracked/untracked nonignored source, rebuilds, and requires the same source identity afterward before calling `instance.RecordBuiltArtifactSource`. Dirty source edits remain supported without committing before HMR. The managed startup adapter receives the independently reviewed revision through `OMNIVIEW_EXPECTED_SDK_REVISION`; an empty/unverified selection remains fail-closed. A source hash identifies a snapshot; it does not alone prove that an executable includes that source.

`PreparePluginArtifact` creates a private executable snapshot and verifies its artifact digest, expected reviewed SDK revision, and expected SDK source SHA256 before execution. Schema-2 trusted records retain those independently expected identities; empty/mismatched source evidence and legacy schema-1 records cannot downgrade to commit-only trust. Installation replacement cannot replace the executable snapshot between verification and launch. `ExternalBackend` owns cleanup until process exit; failed connections kill/wait before cleanup, and cleanup is idempotent. Missing evidence, altered bytes, legacy metadata, or mismatched identities block launch without running unknown binaries to query RPC capabilities. UI-only plugins do not require a backend executable.

This is isolation of application-owned paths, not credential, process, plugin-code, or remote-cluster sandboxing. Same-user processes can still access the filesystem. Imported baselines must exclude runtime records, executables, locks, PID files, tokens, caches, logs and browser/native profiles; copied numeric PIDs are not proof of ownership.

## Verification status

Stock migration verification passed the complete native/server Go suites, affected race checks, native/server vet and formatting checks. Bindings were generated only through `task bindings`; runtime, shim and host frontend builds, root lint, UI/runtime tests and real Vite feedback checks passed.

Actual macOS27 arm64 named instances exercised boot identity/bindings, independent localStorage/IndexedDB/settings, restart, stopped rename, duplicate refusal and guarded cleanup with the peer still live. This is native MCP/binding evidence, not native pixel or user-input proof. Production singleton configuration remains unchanged; the current host smoke did not launch the user's stable channel.

Detailed browser/plugin integration evidence and platform limits are tracked in the [stock migration plan](superpowers/plans/2026-10-22-stock-wails-migration.md) and its verification record.
