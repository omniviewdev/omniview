# Development instance profiles

## Identity and startup order

A named workspace is selected by its canonical `workspace.json` (`OMNIVIEW_WORKSPACE_FILE` for a launched host), not its display name or frontend/build optimization flags. `internal/instance.Resolve` validates the manifest, context conflicts, canonical state path and channel before creating state. `ResolveEnvironment` applies host build/environment channel selection; `instance.buildChannel` can be stamped with `local`, `stable` or `nightly`. `version.Development` is not consulted. Existing nightly version/root stamps retain nightly classification; a source `-dev` build without a workspace fails rather than defaulting to production.

Default roots:

| Kind/channel | State | Runtime | Webview |
| --- | --- | --- | --- |
| Production/stable | `~/.omniview` | inside selected state root | unchanged platform default |
| Production/nightly | `~/.omniview-nightly` | inside selected state root | unchanged platform default |
| Development/local | `~/.omniview-dev/profiles/<workspaceUUID>/state` | sibling `runtime` | sibling `webview` |

Production selection also rejects overlap with durable custom-development **containers**, including historical claims retained after rebinding. Registry records and external owner markers must validate; missing, foreign, redirected or malformed ownership evidence fails closed without repair. Existing endpoint/ancestor identity checks catch physical aliases without treating distinct case-sensitive custom siblings as the same directory.

Production overrides reserve ASCII case variants of the other channel's default label and `.omniview-dev/profiles` under the configured HOME, including paths that do not exist yet. This is an explicit portable namespace policy, not a claim that the filesystem is case-insensitive. The owning channel's own default label remains permitted; near-prefix siblings and unrelated custom paths are not case-folded. A physically identical HOME alias receives the same protection, while a genuinely different case-sensitive HOME directory remains distinct.

Environment state selection takes precedence over the legacy state-root ldflag. The explicit root is canonicalized and validated, including programmatic `appstate.WithRoot`. A workspace cannot use production, nightly, another workspace's profile, a conflicting manifest, or a relative root. Shared ancestor aliases are canonicalized; profile identity boundaries remain enforced by the common workspace contract. An explicit state selection must equal the resolver's selected root: default `<UUID>/state`, or a deliberately established custom binding. Custom setup uses `devcontract.SetCustomProfile` while stopped and records matching schema-1 UUID/state identity in workspace `.local/profile.json`, the dedicated container's `.omniview-profile.json`, and the global `~/.omniview-dev/custom-profiles.json` claim registry. Resolution only validates these existing records and never claims a directory implicitly. The custom container must be absent/empty and outside protected production/default-profile/source boundaries; its state child remains absent for baseline publication. Runtime, webview, and artifact namespaces remain under the default UUID profile independently of custom state placement.

Startup performs native-storage validation before creating the state root. Every profile retains its canonical-root nonblocking flock. Wails production singleton IDs are channel-scoped (`com.omniview.stable`, `com.omniview.nightly`); Wails decides duplicate channels before writable settings, settings migration, telemetry, or plugin startup. A duplicate canonical root is rejected earlier by flock. It is not a focus/activation promise. Controllers remain registered before bootstrap, so plugin initialization receives initialized controllers.

Development startup additionally takes the stable parent guard at `~/.omniview-dev/locks/<workspaceUUID>.lock` before creating/opening the profile state and acquiring its root flock. This guard lives outside the purgable profile. Startup releases it only after the root flock is held; purge and baseline seed use the same parent-before-root order, so removing/recreating a profile cannot replace an active lock inode and admit a second writer. Guard contention/errors fail closed. Production retains its existing root/channel guards.

Default UUID profiles carry the shared durable `.workspace-owner.json` marker (`schemaVersion: 1`, matching `workspaceID`). `devcontract.EnsureDefaultProfileOwnership` may establish it only for an absent/empty canonical UUID directory while the caller holds the stable UUID guard, before state or transient children make that directory nonempty. Existing nonempty unmarked directories, foreign IDs and redirected markers fail closed; there is no legacy-directory adoption. `ValidateDefaultProfileOwnership` only reads and returns a missing-path error for absent ownership. Runtime preparation validates an existing owner rather than claiming one. Artifact-before-start writers take the UUID guard and ensure ownership before creating evidence; artifact launch validates ownership under the selected root's live flock. Purge can use the same durable proof even when state is custom-bound, while an absent default profile remains absent until a writer explicitly establishes it.

After these guards, development temporary files and startup reports are routed under `runtime/tmp` and `runtime/startup-report.json`; diagnostics/logs already receive the selected state service. HOME and credentials are never rewritten.

## Native/browser state

Named macOS native development uses the workspace UUID as the explicit persistent `WKWebsiteDataStore` identifier and requires macOS 14+. Older native systems fail with a browser/server-mode instruction rather than using shared/default or ephemeral storage. Production support/default stores are unchanged. Server-tag builds bypass native availability checks.

Native removal waits for the exact UUID WebKit deletion callback while an active native main loop exists. The patched wrapper initializes only a public nonpersistent datastore before deletion; it never initializes or removes the default production store. Managed removal retains the UUID guard and each existing selected/default state lock through refusal preflight, native deletion and filesystem retirement. The helper validates inherited private owned lock descriptors against the expected inodes and retains their actual flock; closing its duplicates never explicitly unlocks the parent's shared open file descriptions.

Windows receives the profile `webview` directory; Linux receives distinct `webview/data` and `webview/cache` paths. Native preflight calls the patched Wails `ValidateWebviewStorageOptions`; OS-specific persistence and packaged identity still require the parent integration's platform smoke evidence.

Runtime and webview roots derive independently from the canonical UUID profile boundary, never from a remapped state parent. Without an explicit validated custom binding, workspace state must remain the exact `<UUID>/state` leaf; aliases into its own profile root/runtime/webview are rejected. The actual Linux `data` and `cache` directories, along with runtime/tmp and the webview root, are checked for aliases/non-directory paths during resolution before native preparation, then all revalidated before any runtime directory creation. Owned runtime/native directories are private (`0700`). Artifact APIs revalidate explicit workspace/selected-state identity and use the default UUID runtime even when application state is custom-bound.

Named development server builds protect the complete HTTP mux, including public Wails RPC, events and WebSocket routes. Requests must target a loopback literal or `localhost` with the actual loopback listener's explicit port; supplied `Origin` must exactly match the TLS-aware request scheme and authority. Both `Sec-Fetch-Site: cross-site` and `same-site` are rejected even without `Origin`: another localhost port is not trusted. Runtime dispatch (`/wails/runtime`, including decoded and normalized path variants) additionally requires the nonempty `x-wails-client-id` header already sent by generated Wails clients, closing legacy browser subresource GETs without Origin or Fetch Metadata. Scripts/assets and WebSocket paths do not require that header. Protected responses set `X-Frame-Options: DENY`. This is CSRF/DNS-rebinding defense, not authentication: a local nonbrowser client can still call public Wails APIs by supplying any nonsecret client ID. The separate private control/MCP API remains authenticated. Production profiles and native `wails://localhost` behavior are unchanged; no forwarding headers or wildcard origins are trusted.

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

Fixture regression tests cover channels, local no-production fallback, names/UUID roots, conflicting selections, canonical alias locking, explicit child environment independent of telemetry, trusted artifact digests/snapshots, safe boot serialization/order for embedded/proxied HTML, and idempotent backend cleanup. This implementation packet did not run builds, tests, formatters, native apps, plugins, or production-state probes; the integration owner runs verification after the source-edit barrier and generates bindings with `task bindings` only.
