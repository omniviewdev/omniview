# Development control

The local control service exists only in a host built with the explicit `devcontrol` Go build tag. Normal/release builds contain the client and an inert `Start` returning `ErrDisabled`, but no listener, dispatcher, provider adapter, or native host bridge. Build through the repository Taskfile; binding generation remains `task bindings` only.

## Host integration

The integration owner starts the service after profile ownership, plugin manager, settings providers, and managed devserver configuration are established. A build-tagged host integration file imports `internal/devcontrol/host`; ordinary production files must not import that package.

```go
adapters := host.New(pluginManager, devServerManager, settingsProvider,
    pluginSettingsController, inspectCurrentDescriptor)
control, err := devcontrol.Start(ctx, devcontrol.Config{
    Descriptor: descriptor, // development identity + captured A06 host process
    Discovery: discoveryStore,
    Adapters: adapters,
})
```

`inspectCurrentDescriptor(context.Context) (devcontract.InstanceDescriptor, error)` must return the current safe host observation, not manufacture readiness from a PID or build completion. `control.Endpoint()` is the full authenticated endpoint URL. `control.Refresh(ctx, descriptor)` publishes changed endpoints/readiness without changing the captured workspace, instance, generation, process identity, or token. Call `control.Close(ctx)` before shutting down injected managers. Close stops accepting mutations, closes HTTP, cancels host-lifetime waits, waits for accepted manager calls within its deadline, and removes only this generation's private discovery. A returned shutdown deadline error means a non-context-aware manager call may still be finishing; do not pretend that mutation was cancelled.

The bridge consumes existing noninteractive plugin manager installation/uninstallation/link APIs. `StopDevPlugin` is the canonical stop boundary: it stops managed processes and backend/controllers while retaining installed metadata and source binding. Start/restart use managed start, canonical reload, and the producer's actual generation-specific `WaitReady`. Rebuild uses `RebuildPluginGeneration`, not a fire-and-forget trigger.

## Authentication and target identity

The listener binds only IPv4 `127.0.0.1` on an OS-assigned port. Every read and mutation requires the per-generation random bearer token. A06 stores that token separately in a private file; discovery contains only its path. No token is included in ordinary inspect, errors, logs, or descriptor JSON.

The service checks the direct loopback peer, exact `127.0.0.1:port` Host, and bearer authorization before decoding a request. All `Origin` headers are rejected, including same-origin and `null`; this is deliberately a non-browser client endpoint with no CORS policy or browser trust exception. Redirects and proxies are disabled in the client. Workspace UUID and host generation must match before operation dispatch. There is no anonymous health shortcut.

## Wire protocol

Send `POST /v1/control` with a `devcontract.Request` v1 envelope. Unknown envelope/parameter fields, extra JSON values, null parameter objects, unsupported operations, and mismatched targets are rejected. Request bodies are limited to 1 MiB, IDs to 128 bytes, and encoded results to 2 MiB. A response always includes protocol version, request ID when safely decoded, workspace ID, generation, and status.

| Operation | Parameters |
| --- | --- |
| `instance.inspect`, `plugin.list` | `{}` |
| `plugin.get`, `plugin.uninstall` | `{"id":"plugin-id"}` |
| `plugin.install-archive`, `plugin.dev.link` | `{"path":"/absolute/source-or-archive"}` |
| `plugin.install-version` | `{"id":"plugin-id","version":"version"}` |
| `plugin.dev.unlink`, `plugin.dev.start`, `plugin.dev.stop`, `plugin.dev.restart`, `plugin.dev.status` | `{"id":"plugin-id"}` |
| `plugin.dev.rebuild` | `{"id":"plugin-id","generation":"managed-plugin-generation"}` |
| `plugin.dev.logs` | `{"id":"plugin-id","cursor":0,"limit":100,"includeOutput":false}` |
| `plugin.dev.dependencies` | `{"id":"plugin-id","generation":"managed-plugin-generation","enabled":false}` |
| `settings.schema` | `{"scope":"host"}` or `{"scope":"plugin","pluginID":"plugin-id"}` |
| `settings.get` | same scope, optional `id`; omission returns all safe values |
| `settings.set` | scope plus `id` and JSON `value` |
| `settings.bulk` | scope plus `values` object keyed by setting ID |
| `operation.get` | `{"operationID":"id"}` |
| `operation.wait` | `{"operationID":"id","timeoutMS":30000}` |

The envelope generation targets the host; rebuild and dependency-watch parameter generations target the managed plugin. Obtain the latter from dev status. `plugin.dev.dependencies` requires an explicit `enabled` boolean and invokes the canonical generation-checked backend watcher, so the workspace supervisor can transfer dependency-invalidation ownership without a second watcher or a no-op acknowledgment. Wait for the returned operation to succeed before claiming ownership; stale/stopped instances fail. Installed plugin operations target the manager's installed records, never marketplace publisher listings. Archive inputs remain caller-owned. There is no arbitrary filesystem-read, shell, Go-method, bound-method, or cancellation endpoint.

Mutations return `accepted` and an operation ID, then progress through `running` to `succeeded`, `failed`, or host-shutdown `cancelled`. Completion means the underlying manager/provider returned, and development startup/rebuild/link also completed actual capability-aware readiness. Wait accepts 1–30000 milliseconds, with omitted/zero selecting 30000; a wait timeout returns the current operation status and timeout error without cancelling the mutation. Operations use the host lifetime, not the HTTP request lifetime. At most 1024 operations are retained; completed operations may be evicted when capacity is required, while active operations are never evicted.

The native-free `NewClient(endpoint, token, workspaceID, generation)` client provides `Call`, bounded `Wait`, and `Close` for idle connection cleanup. It checks response identity/request correlation and reconstructs local exit codes omitted from JSON. Interrupted waits preserve the operation ID/current known status. Exit codes are success 0, usage 2, missing target 3, conflict 4, runtime/dependency failure 5, unauthorized 6, and timeout 7.

## Transactional plugin inventory

An accepted operation is not a committed installation change. Archive inputs remain caller-owned, and a failed uninstall retains non-running inventory and its recovery evidence rather than announcing success.

Before uninstall unloads or moves an installation, the manager durably records its original metadata/source binding and profile, plugins-directory, staging-directory and installation identities in a private profile-local recovery marker. Pre-disposal rollback uses an atomic directory-only no-replace rename: a replacement at the canonical plugin path is never overwritten or adopted. Startup excludes unresolved recovery paths from migration/loading; installation, managed-source selection and loading refuse pending or malformed recovery proof. Retry through the canonical manager operation; do not delete the marker/stage or edit the installed-state JSON to force a retry.

Recursive disposal begins only after a cleanup-started phase is published through the validated existing marker file descriptor and synced. A failed publication prevents deletion. Once disposal intent has been attempted, incomplete artifacts remain Failed/staged rather than being rolled back as a complete installation. Persisted disposal intent survives restart: retry may clean only the owned stage and refuses every canonical entry, even one with the original inode identity.

Successful durable uninstall emits the payload-free `plugin/inventory_changed` event. The running frontend invalidates the plugin-query prefix, including navigation/settings consumers, without a window reload. `plugin/init_complete` remains an initialization event; unrelated settings changes are not an inventory refresh mechanism. Failure emits no success notification.

## Settings and output safety

Host settings use the actual SDK provider schema and write methods. JSON values are decoded to the declared scalar type before provider validation (for example an integer is an `int`, not a `float64` or `json.Number`). Provider validation, hooks, and persistence remain authoritative; control has no separate settings store.

The single core category-change callback owns persistence, telemetry side effects and value-free `settings/changed` invalidation. Open runtime settings state and category queries refetch backend values after CLI changes; no window reload is required and setting values are not broadcast or logged by the settings context. Instance-local event transports do not update a sibling profile.

Plugin settings reads use A05's `RedactedPluginSettings` via the injected native bridge. Unknown persisted fallback metadata is not evidence of a public value. Sensitive/unknown values, defaults, options, and file-selection defaults remain hidden. The API has no secret reveal mode. Raw provider/build errors and details are not echoed; only bounded safe codes, fixed messages, and nonsecret categories are returned.

Log reads are bounded to at most 500 entries (default 100) from the producer's existing 5000-entry ring. The cursor is an offset into the current snapshot, **not** a stable streaming sequence; ring rollover can change positions. `nextCursor` advances within that snapshot and `truncated` reports remaining entries or clipped message text.

By default logs expose actual timestamps/source/level but hide unstructured message text, which has no authoritative secret classification. A deliberate `includeOutput: true` request returns actual message text, clipped to 2048 bytes per entry and the overall result limit. The CLI exposes this only as `--unsafe-output` and warns on stderr. **Arbitrary plugin/build output may contain secrets**; opt-in output is not claimed secret-safe and is never copied to server telemetry or diagnostics by control itself.

## Verification boundary

Authored regressions include a real HTTP client changing a typed SDK-provider setting with hooks and bbolt persistence; invalid validation preserving stored values; denied token/target/Host/origin/peer requests before provider effects; authenticated reads; wait timeout/interruption preserving eventual completion; private discovery publication and generation-owned cleanup; and disabled-build refusal to listen. These tests must be run by the integration owner along with the actual native host/client smoke test. Source authoring alone is not evidence that a host was launched or that checks passed.
