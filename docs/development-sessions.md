# Development session primitives

`internal/devsession` supplies port assignments, process-ownership checks and private discovery for development workspaces. It is not another process manager. Host/plugin lifecycle integration must use the existing supervisor and independently establish actual application readiness.

## Shared port registry

Open one dedicated local-filesystem directory shared by **all** cooperating workspaces:

```go
registry, err := devsession.OpenRegistry(registryDirectory, devsession.RegistryOptions{})
```

The caller supplies the directory; the package does not select production state or read user settings. Canonical directory aliases share the same OS file lock. `leases.json` is private and replaced atomically under `leases.lock`.

A `ServiceKey` contains `WorkspaceID` (the immutable canonical UUID), `Role`, and optional `PluginID`. Slugs, plugin selection indexes and branch names are not service identities. The default managed range is **20000–44999**, inclusive. `RegistryOptions.MinPort` and `MaxPort` configure a new registry; reopening with a different explicit range fails. An unspecified range adopts the persisted range. Preferred ports are deterministic, but the locked registry and bind probes—not hashing—avoid cooperating collisions.

`Registry.Reserve(ctx, LeaseRequest)` records and returns the exact `Lease.Port`. The request includes the supervisor's captured `devcontract.ProcessIdentity`. Existing assignments survive release, reordered plugin selection, additional plugins and subsequent host generations. Released/stale assignments retain their preferred-port claims; they are not silently handed to other service keys. A depleted range produces an explicit conflict rather than expanding outside the range.

Persisted automatic (nonstrict) assignments must also remain inside the registry's managed range. A corrupt out-of-range automatic port is rejected before any allocation or registry mutation; strict pinned overrides may remain outside that range.

- Automatic policy searches predictably when the preferred port is occupied or assigned.
- `Strict: true` fails if the chosen sticky/deterministic port is unavailable.
- A nonzero `Override` is always strict and may be outside the managed range. Invalid ports and conflicts fail; there is no invisible increment.
- Another live generation cannot take over the same service key. A stale supervisor does not make its still-live recorded child safe to adopt.
- `List(ctx, workspaceID)` returns persisted assignments and ownership, including released/stale entries. It makes no readiness or liveness claim.

### A reservation is not a socket bind

The allocator briefly probes **TCP/IPv4 `127.0.0.1`**, then closes that probe socket. It does not reserve an OS socket, cover UDP/IPv6, or prove which process owns a listener. Launch the child with the exact returned port, matching host/address configuration, and strict bind behavior (for Vite, strict-port mode). Never let a child silently select the next port.

The explicit lifecycle is:

1. `Reserve` → `reserved`.
2. Start the owned child and capture its identity immediately. Independently verify the actual endpoint's workspace/generation and capability-specific readiness.
3. `ConfirmBound(ctx, key, generation, actualPort, process)` rejects a different port, foreign generation/workspace, wrong role or changed OS process. Its `bound` state is a caller acknowledgement, **not** a readiness probe or controller/RPC-ready claim.
4. If the child loses a bind race, reap that failed child, then call `BindFailed(ctx, key, generation, port)`.
5. `Reallocate(ctx, key, generation)` is permitted only after a recorded failure, never for strict/pinned leases. It skips failed ports and persists the new exact assignment. Attempts include the initial reservation and are capped by `MaxAttempts` (default eight, persisted per reservation).
6. After the existing supervisor has stopped/reaped its child, `Release(ctx, key, generation)` ends that generation's cooperating reservation and retains its sticky assignment. Release does not close sockets or signal anything. A wrong generation cannot release a newer lease.

Report `ErrPortConflict`, `ErrOwnership`, `ErrInvalidTransition` and `ErrAttemptsExhausted` explicitly (`errors.Is` works). Do not resolve conflicts by looking up and killing a port owner.

## Process ownership

`ProcessOwner` carries `WorkspaceID`, `Generation`, `Role` and `Source`; all are required. `Source` is the supervisor's resolved source/build identity. It must be recorded when launching the process, not reconstructed later from its filename. The package accepts only development workspace UUIDs; it is not a numeric-PID cleanup fallback for stable/nightly production instances.

- `CaptureProcess(pid, owner)` combines that trusted launch provenance with a kernel-sourced start identity and executable path, producing the shared `devcontract.ProcessIdentity` shape.
- `VerifyOwnedProcess(record, expectedOwner)` compares every provenance field and the live OS start/executable identity. Numeric PID, UID, a matching basename, and a successful health request are not sufficient.
- `TerminateOwnedProcess(record, expectedOwner)` verifies ownership and uses a process-stable OS handle where supported. It never signals a process group or discovers an owner from a port. Exited owned processes are idempotent; malformed/foreign records fail before termination.

Persist captured records privately, including the original generation, executable, source and role. A host crash must not cause a restarted host to relabel an old process as its new generation. A mismatched start identity means PID reuse or a changed process: refuse termination. Inaccessible identity is an error, not proof that a lease is stale. These records attest trusted supervisor provenance; this is not a sandbox against another process running as the same user.

Liveness and termination authorization are deliberately different checks. An existing process with the same kernel start identity remains live even if its executable changed—for example Linux appends ` (deleted)` to `/proc/<pid>/exe` after unlinking a running binary. That generation retains its lease/discovery ownership, while the full executable mismatch still refuses verification/termination. Only a disappeared process or a positively different start identity is stale; an unstable/inaccessible inspection fails closed.

| Platform | Captured identity | Detached termination |
| --- | --- | --- |
| Linux | `/proc` start ticks plus kernel boot UUID, and `/proc/<pid>/exe`, with start rechecked during capture | Pins a pidfd, re-verifies identity, then delivers `SIGTERM` through that fd. Requires pidfd support (normally Linux 5.3+). Signal delivery is not an exit/readiness wait; the existing supervisor owns graceful shutdown, waits and policy. |
| macOS | Kernel `kern.proc.pid` start timeval and `kern.procargs2` executable path; no `ps`, basename or argv-zero substitute | **Fails closed with `ErrUnsupportedIdentity`.** The current pure-Go implementation has no supported PID-stable detached signal handle. Verification followed by a numeric-PID signal is deliberately not provided. Running children remain the existing supervisor's responsibility; crash leftovers need an ownership-aware external/native mechanism, not a blind kill. |
| Windows | Process-handle creation FILETIME and `QueryFullProcessImageName`, with handle liveness | Opens a process handle, verifies that same handle's identity, then calls `TerminateProcess`. This is forceful, not a POSIX graceful signal. |
| Other targets | Not implemented | `ErrUnsupportedIdentity`; no PID-only fallback. |

Permission failures remain failures. Process identity checks and termination need platform-runner evidence; source implementation alone is not a platform validation claim.

On macOS, canonical `down`/`restart` arm a retained kqueue `NOTE_EXIT` observation while the exact supervisor identity is still live, recheck ownership after registration, then use the existing authenticated stop owner. Darwin can deactivate the userspace task before publishing its zombie state (`P_WEXIT`): `kern.procargs2` then returns `EINVAL` even though `kern.proc.pid` still exposes the same start identity. Completion therefore waits for the retained kernel exit event instead of re-querying the executable during teardown. Neither `EINVAL` nor `P_WEXIT` alone is treated as completed exit. The authenticated response still depends on the supervisor's actual child group-empty/reap/writer-finish proofs; the observation grants no signal authority, and a changed durable supervisor record is refused. Linux and Windows retain their existing completion paths.

On Windows, a process may exit after handle identity verification but before `TerminateProcess`. An access-denied result is idempotent only when a zero-time wait confirms that exact pinned handle is signaled. An unsignaled or unreadable handle retains the original error; permission failures for a live process are not suppressed.

## Managed backend publisher retirement

The Go watcher registers initial setup/build and debounced rebuild publishers through one lifecycle admission gate. Stop seals that gate, cancels work, and waits for the event loop plus admitted compilation/publication/status/staging cleanup. A bounded timeout is an error, not a stopped acknowledgement: the manager retains ownership, and stop may be retried after the existing publisher retires.

Build serialization is acquired before publisher admission and retained through synchronous reload and error reporting. Mutable publication retires before the reloader is called, so a reloader may stop its own watcher without waiting on itself. Queued builds are not admitted while waiting for serialization. Consequently an older failed reload cannot overtake a newer successful build and poison its readiness. Reload-error notification requires fresh admission through the sealed lifecycle gate; stopped generations cannot receive late status writes.


## Discovery and tokens

`OpenDiscoveryStore(runtimeDirectory)` owns a dedicated profile runtime directory. `GenerateToken()` produces a bearer-token byte slice with 256 bits of randomness. Keep that value out of stdout, JSON responses, logs, baselines and inspect output.

`Publish(ctx, descriptor, token)` consumes `devcontract.InstanceDescriptor` and returns `devcontract.Discovery`. The descriptor must identify a development workspace/profile, contain a complete captured process identity, and agree on workspace/generation. Discovery includes **only `tokenFile`**, never the token value. The generation-specific token is written first; a same-directory private temporary file is synced and atomically replaces `discovery.json` afterward. Within a generation, refreshes cannot silently change the process or token. A new generation can replace only a provably stale host.

`Read(ctx, workspaceID, generation)` requires an explicit workspace. Empty generation selects its current descriptor; nonempty generation must match exactly. There is no production fallback. Reading a descriptor does not prove it is alive: verify the captured process and the endpoint's workspace/generation before sending mutations. A missing or publicly accessible token makes discovery invalid, rather than making a live generation available for takeover.

`Remove(ctx, workspaceID, generation)` removes only the matching generation's discovery and exact contained token path. Wrong-generation cleanup cannot delete a replacement host's files. Absent discovery is idempotent. A new host does not sweep other generations' token files: interrupted publication or missed old-generation cleanup can leave private orphan files, which must never be imported into a baseline. The prior generation can be explicitly removed before publishing a replacement when its ownership is known.

On Linux/macOS directories are owner-only `0700`, files `0600`, and foreign owners/nonregular files are rejected. Windows paths receive a protected current-user-only DACL (with private child inheritance on the runtime directory); reads reject a foreign owner or additional access entries. ACL failures fail closed, including filesystems without the required security support. Windows publication uses same-directory `MoveFileEx` replacement with write-through; Unix publication syncs the containing directory after rename. Use a local filesystem with working locks and atomic same-directory replacement; network filesystem semantics are not promised.

Temporary siblings are never authoritative discovery. An interrupted write leaves a complete old/new published file, not an advertised partial JSON document. A failure after rename/directory-sync may leave a complete new publication, so error handling deliberately does not delete its token. These runtime registries, process records, discovery files and tokens are excluded from workspace baselines.

## Shared private metadata files

Workspace orchestration uses the same native-free private-file primitives rather than duplicating Unix-mode checks that do not validate Windows DACLs:

```go
func EnsurePrivateDirectory(path string) (canonical string, err error)
func ValidatePrivateFile(path string) error
func ReadPrivateJSON(path string, value any) error
func WritePrivateJSON(path string, value any) error
func WritePrivateFile(path string, content []byte) error
func AcquirePrivateLock(ctx context.Context, directory, name string) (*flock.Flock, error)
```

Create/canonicalize the dedicated development runtime directory with `EnsurePrivateDirectory` first. `ReadPrivateJSON` validates owner/ACL/regular-file status and decodes exactly one document, rejecting unknown fields and trailing documents. `WritePrivateJSON` preserves `json.Encoder` bytes, including the final newline, for exact-byte ledgers. `WritePrivateFile` writes exact raw bytes—appropriate for supervisor/MCP tokens, not a JSON-encoded token string—and can initialize an empty owned log with `nil`. Both writers use the same private temporary-file, sync and atomic replacement implementation as discovery; failed encoding preserves the prior published file. Existing public/foreign/nonregular targets are rejected, not adopted or repaired.

These helpers do not infer workspace/generation, validate record provenance, select production roots or coordinate multiple files. Their consumers must check their record's workspace/generation and retain their existing transaction locks. Cross-workspace JSON payloads are neither rewritten nor merged. No compatibility aliases for the former private helper names remain.

`ValidatePrivateFile` is a point-in-time pathname check, not a retained-handle authorization. For incremental compiler/host logs, initialize a new file using `WritePrivateFile(path, nil)` so current-user ownership and DACL are explicit even on elevated Windows, then validate and open the append handle with no-follow/SameFile checks. Append through that retained owned handle; do not validate a pathname and blindly reopen it later. Never replace an existing active flock file just to initialize permissions. Private directories are the inter-user boundary, not a sandbox against malicious same-user processes.

Use `AcquirePrivateLock` for supervisor, operation, build/watch and other lifetime locks in an already ensured directory. The name must be one portable leaf filename, without traversal. It opens/creates without following a leaf symlink/reparse point, sets private permissions/ACL on the retained creation handle, acquires the flock, and verifies that the opened handle, locked handle and current pathname identify the same regular-file inode. Windows creates the inode with an explicit current-user owner and protected DACL and disallows replacement while that initial handle remains open; Unix uses `O_NOFOLLOW` and handle-based chmod. Keep and close the returned flock for the intended lifetime. Do **not** initialize even an apparently absent lock with an atomic writer: a competing creator may already hold the inode you would replace.


