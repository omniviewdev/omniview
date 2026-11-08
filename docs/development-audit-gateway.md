# Audit gateway allowlist

The host binds every exported method of its Go services to the page, and the page reaches them through one route, `POST /wails/runtime`. A remote, view-only audit browser must not get that whole surface: it would include a local shell, arbitrary file writes, plugin installation and the MCP relay token. The allowlist in `internal/auditgate` decides, per request, what such a browser may call. Everything not named in it is denied.

`internal/auditgate` is a standard-library-only package so the audit gateway can import it. It holds the table, the request evaluator and the event filter. It starts no listener and talks to no network. Nothing is exposed remotely by the package itself: its only use in the host today is the startup check described below. The HTTP core that enforces it is `internal/auditgate/gateway`, described [below](#the-gateway-core); it opens no listener of its own either.

## What is classified

`internal/auditgate/policy.json` is embedded in the binary and holds three tables. Every row has a `decision` (`allow` or `deny`) and a `reason`; there is no undecided state. The table is read with a strict JSON pass, so a repeated key or two keys that differ only in case make it fail to load.

| Table | Key | Meaning |
|---|---|---|
| `methods` | fully qualified name `PkgPath.Type.Method`, for example `main.AppService.GetInstanceInfo` | one row per Wails-bound Go method. Wails derives the ID from this name with FNV-1a 32, so the gateway can resolve `methodID` and `methodName` to the same row |
| `runtime` | Wails runtime object and method number | the non-bound calls of `POST /wails/runtime`. Only `Call`, `CancelCall`, three `Window` reads and three `System` reads are allowed; `Application.Quit`, `Browser.OpenURL`, `Events.Emit`, clipboard, dialogs and all other window control are denied by not being listed or by explicit rows |
| `events` | exact name, prefix or suffix | which backend events a remote client may receive |

The `wails` field records the Wails version whose object and method numbers the table was reviewed against.

## How a request is evaluated

`Policy.EvaluateRuntime` takes the method, the raw path, the raw query, the headers, the whole body and the two facts about the session that only the gateway knows (`ClientID` and `CallIDPrefix`), and returns a `Verdict`. It fails closed at every step:

1. POST to exactly `/wails/runtime`. Encoded, cleaned or differently cased paths are rejected, and `/wails/stream/*` is denied (the host registers no stream handler). Any query string is rejected, which also removes the empty-body fallback in which Wails reads `object`, `method` and `args` from the query.
2. A configured session: `ClientID` passes `ValidClientID` (`[A-Za-z0-9_-]{1,64}`) and `CallIDPrefix` passes `ValidCallIDPrefix` (below). A request of a session that fails either is denied.
3. No `x-wails-chunk-*` header: a chunked call cannot be inspected piece by piece. No `x-wails-window-*` header: those choose the window Wails runs the call as (see below). Header names are matched case-insensitively across every key of the header map.
4. A content type of `application/json` (optionally with `charset=utf-8`) and exactly one `x-wails-client-id` header, equal to `ClientID`. An absent, different or repeated header is denied.
5. The body must be non-empty and at most `MaxRuntimeBodyBytes` (1 MiB). Callers read at most that many bytes plus one.
6. Strict JSON: valid UTF-8, one value, depth at most 32, and no object at any depth with a repeated key or with two keys that Go's `encoding/json` would fold into one field (it matches keys case-insensitively and keeps the last duplicate).
7. The envelope is exactly `object`, `method` and optionally `args`, with plain integer numbers. Unknown objects are denied; unlisted methods of a known object are denied.
8. For `Call`, `args` carries `call-id`, an `args` array and exactly one of `methodName` or `methodID`. A body with both is rejected even when `methodName` is empty, because Wails silently prefers a non-empty `methodName` and falls back to `methodID`. Unknown names and IDs are denied; a denied method reports its resolved name.
9. For an allowed request, `Verdict.Forward` is a body rebuilt from the parsed values: fixed key order and spelling, the resolved method always as `methodName`, arguments compacted, and `CallIDPrefix` put in front of the `call-id` of every call and every `CancelCall`. The original bytes are never forwarded.

`CallIDPrefix` is required. It is one or more characters of `[A-Za-z0-9_-]` followed by one terminator from `/`, `:` and `.`, at most 32 bytes, for example `s1/`. Client call-ids cannot contain a terminator, so the call-ids of one session can never run into those of another: with `s1/` and `s12/` the forwarded IDs `s1/2x` and `s12/x` stay distinct, which the bare prefixes `s1` and `s12` would not keep. A prefix that fails `ValidCallIDPrefix` denies every request of the session.

`Verdict.Reason` is a stable code that never contains request text, and `Verdict.Subject` names the resolved method or runtime call only when it is a row of the table.

## Which window a call runs as

Wails picks the window a call runs as in this order: (1) the browser window that a connected `/wails/events?clientId=<id>` socket mapped to the request's `x-wails-client-id`; (2) the window named by `x-wails-window-name`, or the one whose number is in `x-wails-window-id`; (3) otherwise the first registered window, which is a real window object the host created, normally `main` (ID 1). `GetAll` walks a map, so with several windows open which one is first is arbitrary.

The host admits any window as the trusted UI and keys the call's owner (source views, metric sessions, activity subscriptions) by window kind and ID. A call that reaches (3) therefore runs as that window, normally `main`, with the same owner as the local desktop UI and as every other call that falls back. The host does not refuse (3): a window picked that way is the same object as one picked by header, and the repository's e2e harness relies on selecting `main` that way.

The evaluator rules out (2) by rejecting `x-wails-window-*`, and it requires the client ID of (1), but it cannot see whether a socket has mapped that ID, so it cannot tell (1) from (3). The page, not the gateway, chooses its client ID: the Wails runtime generates a random one at load and sends it in `x-wails-client-id` and in the `clientId` query parameter of its events socket. The gateway therefore binds an authenticated session to the IDs that appear on that session's own events sockets, denies a call whose header names an ID the session did not bind (which also keeps a remote client from borrowing the ID of the local desktop's or another session's browser window), and passes the bound ID as `RuntimeRequest.ClientID`.

What the gateway does with its upstream socket is a design choice with a cost on each side, to be settled with a real browser run:

- **Map the session**: open the upstream `/wails/events?clientId=<ID>` socket with the page's ID and forward calls only while it is connected. The session then has its own owner, apart from `main` and from other sessions. But `Window.Name()` then answers `browser-N`, which `resolveCurrentWindow()` (`ui/features/windows/identity.ts`) rejects because the window service does not know that name, so the UI would not boot unless the gateway answers that one call itself (`Verdict.Subject` is `Window.Name`; Wails returns the name as `text/plain`, and the UI needs `main`).
- **Do not map the session**: open the upstream socket without a `clientId`, or not at all. Every call then falls back to the first window and the UI boots, but all sessions share the owner of `main` with each other and with the local desktop UI: through IDs that broadcast events reveal (source views, activity subscriptions), one session can act on the state of the others.

Browser windows never report closing, so the host never retires their scopes. Each events-socket connection, which a page load or a reconnect makes, takes one of the 64 scope slots of the window realm (and one of the 64 metric sessions) until the host restarts. After 64 of them new windows get no scope: their realm-backed calls are denied, and so are those of native windows that were not admitted yet. This bounds the first design: keep one events socket per audit session, and expect a host that serves many sessions to need a restart now and then.

## Using it from the gateway

- Fill `RuntimeRequest.Path` from the raw request target (`r.RequestURI` cut at `?`), not from the decoded `r.URL.Path`, and read the body through `http.MaxBytesReader` with a limit of `MaxRuntimeBodyBytes+1`.
- Choose a `CallIDPrefix` per session and keep it for its lifetime; bind the session's client IDs as described above.
- On an allow, send a fresh upstream request: the fixed loopback URL, no query, `Content-Type: application/json`, the body `Verdict.Forward` and `x-wails-client-id` set to the bound ID. Forward no other header: not `x-wails-window-*`, not `x-wails-chunk-*`, not cookies or the audit credential.
- On a deny, answer with a fixed status and body, and log `Verdict.Reason` and `Verdict.Subject` only, never the request body.
- Event socket: accept the `clientId` query parameter only when it passes `ValidClientID` and no other live session uses it; run `FilterEventMessage` on every message from upstream with the message type the WebSocket library reports; drop every message from the client.
  - `coder/websocket` closes a connection with status 1009 when a message exceeds its read limit, which is 32768 bytes unless `Conn.SetReadLimit` raises it, while the host sends whole resource lists. Set the upstream read limit to at least `MaxEventMessageBytes`.
  - The host queues events for every socket without a bound and writes them without a deadline. A gateway that stops reading upstream, for example for a stalled remote client, makes the host's memory grow: read upstream continuously, and drop or close a downstream that falls behind.
- Other routes. `ClassifyPath` only classifies; the evaluator forwards nothing for a path other than `/wails/runtime`, so the gateway serves the rest from its own allowlist and answers 404 or 405 for everything else:

| Route | What the gateway does |
|---|---|
| `POST /wails/runtime` | `EvaluateRuntime` |
| `GET /wails/events` (WebSocket) | the socket proxy above |
| `GET /wails/runtime.js`, `/wails/transport.js`, `/wails/custom.js` | scripts the page needs: GET and HEAD from a fixed list |
| `GET /`, the embedded UI assets, `GET /_/plugins/<id>/(assets\|dist)/...` | GET and HEAD only, matched with the host's own path rules |
| `/wails/stream/ws`, `/wails/stream/poll`, `/wails/stream/send` | deny: the host registers no stream handler (`ReasonStream`) |
| `GET /wails/eventpayload/<id>` | deny: it only delivers large events to native webview windows |
| `GET /health` | optional probe: allow GET only if the gateway needs it |
| anything else, any other method | 404 or 405 |

## Events

`Policy.FilterEventMessage(kind, payload)` decides whether one message that the host sent on the event socket may be forwarded to the remote client. The payload must be a complete message: WebSocket libraries, `coder/websocket`'s `Conn.Read` included, reassemble fragmented frames and return whole messages, so the filter never sees a frame. Only a text message that holds the JSON of a Wails event, `{"name":...,"data":...,"sender":...}`, can pass. A binary message (the host never sends one), an unknown kind, or text of any other shape (invalid JSON or UTF-8, repeated or unknown keys, trailing data, a non-string name, more than `MaxEventMessageBytes`) is dropped. Dropping is the only negative outcome: the filter never closes the socket.

A matching deny rule wins over any allow rule, a name nothing matches is dropped, and an allowed message is forwarded unchanged. The terminal output and signals, MCP, action stream, menu and extension events are denied by explicit rules. Log events are allowed: the log viewer (`core/logs/`), the dev server (`plugin/devserver/log`), the plugin process log (`plugin/process/log`) and the UI log tail (`internal/log/update:`, the host emits `internal/log/update:ui`). Suffix rules cover names that embed plugin and connection IDs, which can contain slashes.

Some allowed events carry error text or host paths, text that the local UI can show too: `plugin/update_error` (the raw update error, which can include the registry URL and host paths), `plugin/crash` (the plugin's last error log line, filtered for token-like text but not for paths), `plugin/crash_recovery_failed` (recovery error text), `plugin/devserver/status` (absolute plugin source path, local server URLs, last build error), `plugin/devserver/error` (build errors with file paths), `source/STATE` and `resource/connection/metadata` (provider-asserted text) and `metric/observation` (error text). `plugin/install_error` and `plugin/dev_install_error` carry plugin metadata only. `plugin/state_write_error` carries a Go error with host paths and has no UI subscriber, so it stays denied; the `plugin/dev_reload_*` events have no emitter in the host today.

## Classify a new method

A bound method that is not in `policy.json` fails `go test .` (`TestEveryBoundMethodIsClassified`), and a development host refuses to start when it registers such a service.

1. Add the service to `boundServiceTypes` in `main.go` if it is new, then run `task bindings`.
2. Add one row per method to `internal/auditgate/policy.json`, keeping `methods` sorted by `fqn` (a test checks it). The name is the Go package path, the type and the method, with `main` as the package path of the root package. The `reason` states the main fact, such as what the method writes or why reading it is safe.
3. Decide. **Allow** only what a read-only inspection of the running app needs and that does not write persisted configuration, files, settings, plugins or credentials, start a shell, listener or install, control a native window or dialog, or hand out secret material the host itself holds, such as a token. An allowed row can still change live or in-memory state (starting or stopping a connection, opening a source view, subscribing to a stream, a log session), make the host call out (the marketplace, providers, metric backends) and return whatever secrets plugins, logs or provider data contain; say which in the row's `reason`. **Deny** everything else, and deny when unsure. `allow` never means free of side effects.
4. Run `go test . ./internal/auditgate/`. `TestDangerousMethodsStayDenied` pins the methods that would give a remote browser the OS user's authority; flipping one of them is a deliberate change to that list.

Removing or renaming a method leaves a stale row, which `TestEveryBoundMethodIsClassified` also reports.

## Classify a new event

Add a rule to `events` with `match` set to `exact`, `prefix` or `suffix`, a `decision` and a `reason`. Events the host registers by name appear in the generated `bindings/events/index.ts`, and `TestRegisteredEventNamesAreClassified` requires each to be matched by an explicit rule rather than the default drop. A deny rule always wins; an allow rule that a deny rule shadows is rejected when the table loads. Say in the `reason` when the payload carries error text, paths or secrets.

## Startup checks and registration sites

`main` checks, before it registers its services, that every method Wails would bind for them is classified (`verifyAuditPolicy`, which inspects the instances actually registered), and after the last registration that the registered types equal `boundServiceTypes()` (`verifyServiceTypes`; `*pluginlog.ServiceWrapper` may be absent because it is registered only when plugin logging is available). A failure stops the host only when it runs the development profile, the only profile an audit gateway can front. Every other profile logs a warning, "remote audit access is unavailable until the audit allowlist is fixed", and keeps running, so a stale allowlist never takes a production host down. The gateway must not rely on the host having stopped: it runs `Policy.Verify` itself and refuses to start on an error.

The tests cover the registration sites:

- `TestBoundServiceTypesDeclareEveryRegisteredService` compares only the number of `application.NewService` calls in `main.go` with the length of `boundServiceTypes()`; the exact comparison of types is the startup check above. A registered service with bound methods that `boundServiceTypes()` misses also fails `TestPolicyMatchesGeneratedBindings`.
- `controlhost.Register` registers `developmentControlLifecycle` from `internal/devcontrol/host` in the development profile, outside both startup checks, and `boundServiceTypes()` does not list it. `TestDevelopmentControlLifecycleSurfaceIsLifecycleOnly` parses its source and allows only Wails' four lifecycle method names and no embedded fields, and the `devcontrol`-tagged `TestDevelopmentControlLifecycleBindsNoUnclassifiedMethod` checks the compiled type; CI runs the tagged test through `task check:go-test-devcontrol` (`.github/workflows/pr-checks.yml`).
- `TestServiceRegistrationSitesAreKnown` fails when any other file registers a Wails service.
- Wails mounts a registered service that implements `http.Handler` at `ServiceOptions.Route`, which bypasses `/wails/runtime` and every check here. The host sets no route, and `TestHostSetsNoServiceRoute` fails on `NewServiceWithOptions` or a `ServiceOptions` literal with `Route`.

## Binding IDs, aliases and Wails upgrades

The gateway resolves `methodID` from the hash of the name. The host must therefore never set Wails `BindAliases` or call `RegisterBindingMethodID`; `TestNoBindingAliasesOrRegisteredIDs` fails if either appears, and `TestPolicyMatchesGeneratedBindings` compares the hash of every bound name with the IDs in the generated TypeScript bindings.

Runtime object and method numbers come from Wails, so a Wails upgrade fails `TestRuntimeNumberingMatchesPinnedWails` until someone re-checks `pkg/application/messageprocessor*.go` against the `runtime` table and updates the `wails` field.

## Host behavior the gateway relies on

- Plugin data reads create nothing: `data.Get` and `data.Keys` (and the denied `GetSnapshot`) read a plugin without a data directory as empty and neither create the directory nor cache a root for it (`appstate.PluginDataIfExists`). Before that, every novel plugin ID created a directory and leaked a file descriptor. `Set`, `Delete` and `CompareAndSwap` still create it, and stay denied.
- Window-keyed state is keyed by window kind and ID: the window realm's scopes, the metric sessions and the activity subscriptions. Native and browser windows are numbered separately from 1, so a browser window used to share its owner with the window of the same number, the first one being `main`.
- `DiagnosticsClient.ReadLog` returns at most the last 8 MiB of the log file, cut at a line boundary, and `StartTail` follows the file from its current end, so a remote viewer never receives more history than that cap.
- The UI log has at most one tail, process-wide. `StartTail` while it runs does nothing, and `StopTail` returns only once the tail's goroutines have exited and its file is closed, so a remote client that starts and stops the tail in a loop cannot grow the host's goroutines or file descriptors (a regression runs 200 cycles and compares both counts). The tail polls the file every 250 ms instead of using the library's process-wide inotify tracker, whose per-file bookkeeping a stop and restart on the same file can leave deaf.

## What is not covered

The allowlist limits which methods a client can call, not what an allowed method does.

- **The remote browser can read logs.** It can read the UI log (`ui.log`, which holds the client log lines the frontend writes; `ReadLog` serves it and `StartTail` follows it as `internal/log/update:ui` events), plugin process stderr (`pluginlog.GetLogs`, `SearchLogs`, `Subscribe` and the global `plugin/process/log` event), log viewer sessions (`logs.*`, `core/logs/*`) and dev server output. This was chosen on purpose, and logs can contain secrets such as tokens, credentials, hostnames and file paths. The host's own Go log is not served (`ReadLog("app")` is not implemented).
- **Allowed calls act with the owner's credentials.** `resource.Get` can return secret-bearing objects when the plugin serves them, connection starts can run plugin-side credential helpers, and plugin-data, settings and provider reads can contain whatever plugins put in them. The loopback Wails endpoint stays unauthenticated to local processes.
- **Events are a global broadcast.** A remote client receives the events of local sessions that the filter allows, including the error text and paths listed above. `metric/observation` is sent with the window's `EmitEvent`, which is not per window: the snapshot, with the opener's `client_token`, reaches every connected client.
- **IDs are capabilities.** The control methods of log viewer sessions, metric subscriptions and the plugin log stream check no owner: they take a session or subscription ID, or a plugin ID. The IDs are UUIDs, but `logs.ListSessions` lists every session and the IDs are in broadcast event names (`core/logs/lines/<id>`, `core/metrics/data/<id>`, `activity/change/<id>`, `resource/source-view/<id>`). A remote browser can therefore close or change the local user's log sessions (`CloseSession`, `SendCommand`, `UpdateSessionOptions`), end the local user's metric streams, and silence the plugin log stream (`pluginlog.Unsubscribe` decrements one global count). `DiagnosticsClient.StopTail` stops the single UI log tail for every viewer. This gives no more data than the log and metric reads already allow, but it can disturb the local user's viewers. Source views, activity subscriptions and observations are checked against the calling window's owner, which only helps as far as the gateway keeps sessions in separate windows (see above).
- **Isolation of sessions** from the local desktop UI and from each other depends on the gateway design chosen above, and the window realm has 64 slots.

## Decisions recorded in the table

- Logs are allowed, by explicit user decision and knowing that logs can hold secrets: the UI log (`DiagnosticsClient.ReadLog`, `StartTail`, `StopTail`), the plugin process log (`pluginlog.GetLogs`, `SearchLogs`, `Subscribe`, `Unsubscribe`), log viewer sessions (`logs.*`) and dev server output (`GetDevServerLogs`), with their events. Writing client log lines (`DiagnosticsClient.Log`, `Debug`, `Info`, `Warn`, `Error`) stays denied. `TestLogViewerAccessIsAllowedByDecision` pins this decision.
- Connections: `StartConnection` starts a saved connection's provider client (which can run credential helpers and starts watches), `StopConnection` tears a live connection down (a remote browser can disconnect the owner's session), `LoadConnections` re-runs the provider's native discovery, which the SDK says may mutate existing configurations, and replaces the host's cached connections of that plugin, and `RetryConnectionSources` and `RefreshConnectionMetadata` act on connections that are already active. All five are allowed by user decision. Creating, editing, importing, resetting or removing a connection profile is denied.
- Window state: `window.Service.GetState` and `ListStates` are denied. `GetState` creates a saved native window on the host desktop when it is handed the restore-gate name (initially `main`, which any caller can guess), with no window header needed, until the saved windows are used up; `ListStates` returns every window's saved UI state. The UI boots to its default state without either (a rejection is logged and ignored), whereas `List` is allowed because the UI cannot identify its window without it. `SaveState`, `Open` and `OpenSettings` stay denied.
- Allowed: source views, metric subscriptions and observations, plugin data `Get` and `Keys`, marketplace reads, `System.IsDarkMode`, `Environment` and `Capabilities`, the process, profiling and UI-inspection status reads, and the diagnostics snapshot, history, catalog and capture reads. Denied: `NativeQuery`, starting, cancelling or deleting a diagnostics capture, the settings window and window-state writes, activity writes, and every `mcprelay` method.
- Chunked request bodies are rejected. The Wails JS runtime sends a call in chunks when the JSON text is longer than 524,288 UTF-16 code units (`JSON.stringify(body).length > 512 * 1024`), so such a call fails in the audit browser. Denied activity writes make the UI's toasts fail there too.

## The gateway core

`internal/auditgate/gateway` is one audit's `http.Handler`: its peer and credential checks, its route table, the runtime proxy, the events tunnel, its credentials and pairing, and its lifecycle. It is a library. It opens no listener of its own, has no Tailscale dependency, starts no process and has no CLI, and nothing in the application calls it yet: the supervisor, the Tailscale adapter and the commands plug into the interfaces below in later work.

One `Gateway` is one audit generation. It never recovers: when it ends (stop, expiry, a failed target check, a clock step) the owner builds a new one with a new audit ID, realm and credentials.

### What the owner supplies

| Piece | Contract |
|---|---|
| `PeerIdentity` | `Resolve(ctx, remote netip.AddrPort) (Peer, error)`. Maps the accepted socket's remote address (never a header) to the node and the user that owns it: stable IDs, `Tagged` for tag-owned nodes. Return `ErrPeerAmbiguous` or any error rather than guess. The gateway bounds every lookup with a timeout, survives a lookup that panics, and treats every error, a missing ID, a tagged node, another owner, or (unless `AllowSelf`) the local node as a denial |
| `Config.LocalNodeID` | the node ID of this machine. Required unless `AllowSelf` is set: without it the gateway cannot tell the owner's own machine from another of the owner's devices, so `New` refuses to start |
| `Upstream` | `Address()` is the loopback Wails address, dialed for every upstream request and never replaced by anything a request says. `Verify(ctx)` proves the server there is still the exact host target; it runs when the audit starts and about once a second, and any error ends the audit. It should also prove that the process holding the port is the host (see [What the core does not do](#what-the-core-does-not-do)) |
| `GetCertificate` | the certificate for the configured name. It is called only when the client's SNI is exactly that name, compared as ASCII (Unicode case folding is not how DNS compares names), and on every handshake, so it must be cheap: return a cached certificate and renew it somewhere else |
| `SecretChannel` | where a freshly issued credential's secret goes (see [Pairing](#pairing)). `Deliver(ctx, credential)` hands it over. `Discard(ctx, credentialID)` removes whatever `Deliver` stored when the credential does not become active after all: delivery failed, or the credential was revoked, expired or lost its audit while its secret was being delivered. `FileChannel` writes a private file and implements both |
| `Config.Events` | optional sink for bounded diagnostics (see [Diagnostics](#diagnostics)). A sink that panics is recovered; one that blocks stalls the goroutine that emitted, so keep it quick |
| `Clock` | time as two readings, wall and monotonic, so a suspend can be tested. `SystemClock()` by default |

`Gateway.Serve(ln, getCertificate)` serves the audit on a listener the caller bound to the verified address, and closes it when the audit ends. Serving is HTTP/1.1 over TLS 1.3 only, with deadlines for the handshake and the headers (`ReadHeader`: net/http uses the smallest of its header, read and write timeouts for the handshake), the whole request (`Read`) and idle connections, 32 KiB of request headers, and no log output. Before any TLS work a connection is also counted: at most 128 at once, at most 16 from one address, and an address may open 20 at a burst and then one per 100 ms. A caller that serves the handler some other way must set the same limits, must keep what `Serve` does with the connection (it hands the handler the connection a response is written to, so that ending a session can cut a write that a client has stopped reading), and must close its listener when `Ended()` fires.

These shares only divide the work among peers. They do not stop a flood from many nodes, and before authentication any node that can reach the port can cost the gateway a TLS handshake. Restrict the audit's port to the owner's devices in the tailnet's access controls.

### Request order

`ServeHTTP` runs these steps for every request, before it looks at the path and before any byte reaches the upstream.

1. **Peer.** The peer is resolved from the socket address and judged. The answer is remembered for one second per connection, so a page load is not hundreds of lookups, and a live tunnel looks its peer up again every second without the cache.
2. **Authority.** The connection is TLS 1.3; the SNI and the `Host` header both equal the configured name (the port is part of `Host` unless it is 443; ASCII case is ignored, nothing else is); the request target is origin-form, which rules out `CONNECT`, absolute-form proxy targets (userinfo included) and `*`. An IP-literal or alias authority fails here.
3. **Credentials.** Exactly one `Authorization` header of the form `Basic base64(username:secret)`, where the username is 16 lower-case hex digits and the secret 43 base64url characters, so the header has one fixed length (86 bytes) and nothing else is parsed. The username picks a credential, the secret is checked against its keyed digest in constant time, and the credential must be active, unexpired and either unpinned or pinned to this peer's node.

Every failure in these steps returns the same response: status 401, the same `WWW-Authenticate: Basic realm="omniview-audit-<audit ID>"` challenge, the same fixed JSON body with `audit_unauthorized`. The peer check, the authority check and the credential check all run on every request even after one has failed, so the work does not show which factor failed, and a credential presented by a refused peer pins nothing. The comparison covers every slot of the credential table whatever the username (`TestVerificationDoesTheSameWorkForEveryOutcome`).

Every refused request counts against a failure allowance per remote address and one for the whole audit, the request with no `Authorization` header included (a flood of requests with no credentials would otherwise cost nothing). The first request of every page load has no header, so the allowance is a burst of 10 that earns one back every 2 seconds. A limited address gets 429 with the same body, and while it is limited even the right credential is refused, so the limiter reveals nothing. A request that authenticates is never counted. At most 32 requests may be in these steps at once and 4 from one address.

After authentication at most 64 HTTP requests run at once; one over the limit gets 503 `audit_unavailable` with reason `busy`.

### Credentials

- An audit has at most eight active credentials. A credential has a random 16-digit username, a 256-bit random secret, an expiry that never passes the audit's own, and a keyed digest (HMAC-SHA-256 with a per-audit random key over the audit ID, username and secret). The gateway never keeps the secret.
- The first node that authenticates with a credential pins it. Another node with the same username and secret is refused, and the pinned node ID is in `Status` and in one diagnostic event. This limits what a leaked password is worth to the other devices of the same owner; it is not proof of who held the device.
- A credential's deadline is checked against the clock at every use: when it authenticates, when a request or a tunnel begins, and when a delivered secret is activated. The timer that marks an expired credential runs once a second, and nothing relies on it having run.
- `Revoke` marks the credential revoked in memory, cancels every request and tunnel it is serving, and waits (bounded) for them to finish. A browser that cached the password is refused. The realm is fresh per audit, so a browser never offers credentials cached for an earlier audit. If closure cannot be confirmed in time `Revoke` returns `audit_shutdown_incomplete`: the credential is revoked and refused all the same, and the audit goes on. Only `Stop` ends the audit.
- Query-string and URL credentials do not exist: only the header is read, and static routes refuse any query.
- The `Authorization` header and the decoded password are Go strings, which the runtime cannot erase. The gateway keeps neither past the request and clears the buffers it owns, which is all a Go program can do.

### Pairing

A credential is created in exactly one way: a one-time pairing code redeemed once.

1. `NewPairing` returns a code of 16 symbols (80 bits) from a 32-symbol alphabet without look-alike characters, shown as `ABCD-EFGH-JKLM-NPQR`. It is valid for 5 minutes by default (30 seconds to 15 minutes, never past the audit), single-use, and at most four are outstanding. The gateway keeps only a keyed digest of it.
2. `Exchange(ctx, code, channel, opts)` checks the code against every offer in constant time, spends it, mints the credential and hands the secret to the `SecretChannel`. Wrong, expired, used and malformed codes are the same `ErrPairingInvalid`. Five failures allow 15 seconds each to be earned back, and while the allowance is spent the code is not examined at all (`ErrPairingRateLimited`). The eight-credential limit refuses the exchange without spending the code.
3. The secret exists only for that call: the channel must not log, return or keep it, and the gateway clears the slice when `Deliver` returns. `IssuedCredential` prints without its secret under every `fmt` verb. If delivery fails the code is spent and no credential exists, and the channel's `Discard` removes anything `Deliver` left. A credential that is revoked, expired or stopped while its secret is being delivered is never activated: `Exchange` returns `audit_not_found` and calls `Discard`. `Stop` does not wait for a delivery in progress, because a delivery is not a session.

The library does not decide how the code reaches whoever redeems it, or how the secret reaches the browser. There is deliberately no HTTP route for the exchange: every route is behind the credential check, and a pre-authentication route would be a new reviewed surface. The CLI will call `Exchange` locally with a `FileChannel`, which writes the password and nothing else (no newline) to `audit-<audit ID>-<credential ID>.secret` in a private directory: mode 0600 through the same private-file primitives as the control and supervisor tokens, created exclusively (an existing file is never replaced), in a directory that must already be private and not redirected. It needs a file system with hard links, which is how the file appears at once and complete. A crash between the write and the link leaves a `.audit-credential-*.tmp` file with the password in the same private directory; the owner's cleanup of that directory removes it. Deleting the file does not erase copies already made.

### Routes

`auditgate.ClassifyPath` and a closed table decide the route after authentication. Anything not listed is `403 audit_denied` with a bounded reason.

| Route | Rule |
|---|---|
| `POST /wails/runtime` | the runtime proxy below |
| `GET /wails/events` | the events tunnel below |
| `GET`/`HEAD` of `/`, `/health`, `/wails/custom.js`, `/wails/runtime.js`, `/wails/transport.js` | relayed |
| `GET`/`HEAD` of embedded UI files: single files at the top level and anything under `/assets/` or `/images/`, with a static-resource extension (`js mjs css png jpg jpeg gif webp svg ico woff woff2 ttf otf`) | relayed |
| `GET`/`HEAD` of `/_/plugins/<id>/(assets\|dist)/...` with the extensions the host's plugin asset handler serves | relayed |
| `/wails/stream/*` | denied: the host registers no stream handler |
| `/wails/eventpayload/*` | denied: used only to hand large events to a native webview; the browser socket carries them inline |
| everything else, including `/index.html`, `/@fs/...`, `/node_modules/...`, `/src/...` | denied |

Path matching is on the raw request target: an encoded, doubled-slash, dotted, dot-segment, hidden-file, trailing-slash, semicolon or differently cased spelling of an allowed path is not that path. Static routes take no query, no body and no upgrade, and only `GET` and `HEAD`. A static route's upstream request carries no header of the client's.

Browser context rules apply to every authenticated request. An unsafe method or an upgrade needs exactly one `Origin` equal to the audit's origin; a safe request may omit it, but one that carries it must match. If `Sec-Fetch-Site` is present it must be `same-origin` (`none` is accepted for reads, which is what typing the address sends); `cross-site`, `same-site` and lists are refused. There are no CORS headers, so cross-origin pages cannot read anything.

Every response carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. Nothing sends `Strict-Transport-Security`: it would pin the whole node name across ports. Of an upstream response only the status and a validated `Content-Type` are passed on; `Set-Cookie`, `WWW-Authenticate`, `Location`, CORS and every other header are dropped. A redirect or other interim or unexpected status from the upstream becomes a fixed 502 and is never followed. A body over its limit (32 MiB for runtime calls, 64 MiB for static files) is refused before it starts when the upstream declares it, and aborts the connection when it grows past the limit mid-stream, so a truncated body is never taken for a whole one.

A response write that a client has stopped reading is bounded by the response's own deadline and, sooner, by the end of its session: a revoke or a stop sets the write deadline to now and closes the connection, because once a write has failed `crypto/tls` would otherwise spend up to five seconds trying to send a `close_notify` into the full buffer of the dead peer.

### The runtime proxy

A call is forwarded only when all of these hold: it names a client ID that this credential bound to an open events socket; the allowlist approves the call; and what is sent upstream is the canonical body the evaluator built, with a host-issued client ID. In particular:

- The upstream request is built fresh. It carries `Content-Type: application/json`, `Origin` and `Host` of the loopback address, and the issued `x-wails-client-id`; no `x-wails-window-*` (a request carrying one is refused, since it would let a page run as the host's main window), no cookie, no `Authorization`, no forwarding or Tailscale header, no `Sec-Fetch-*`.
- The page's client ID is a label only, valid for `ValidClientID` and scoped to the credential. The page's runtime picks its own random client ID; the gateway registers a different one, issued by the gateway, with the host when it opens that page's events socket, and sends calls under it. A remote can therefore neither invent an ID the host will accept nor use an ID of another credential, another page or a local window. Two credentials may use the same label: the host only ever sees issued IDs, so the evaluator's "no other live session uses it" rule has nothing to guard.
- Order. The gateway reads the whole body first, evaluates it, and only then looks for the page's tunnel: a slow or large body cannot make a call wait on, or hold, a tunnel that may have ended by the time the body arrives. The call takes a hold on the tunnel at the moment it is dispatched, and its upstream request is tied to the tunnel's lifetime.
- The gateway never lets a call fall through to the host's "first window" fallback: a call whose client ID has no open socket is refused (`client_unbound`), including once its socket has closed. A call that arrives before its page's socket (the page's first calls race the socket) waits up to `BindWait` (2 seconds) for the socket, at most 8 at a time, and runs only after it is bound.
- Call IDs, and the call ID of a `CancelCall`, get a per-page prefix `<16 hex digits>.`. Call IDs cannot contain `.`, so two pages' IDs cannot collide and one page cannot cancel another's call.
- Refused calls count exactly in `Status().Denials`; their diagnostic events share the limit of the other refused-request events, so a page that is refused in a loop cannot flood the event sink.

### The events tunnel

`/wails/events` is terminated on both sides. The gateway opens its own socket to the host under the issued client ID, then accepts the page's. The page sends nothing on this socket (Wails ignores it), so the first data message from it ends the tunnel.

**The host maps the ID late.** Wails sends its `101 Switching Protocols` before it registers the window for the client ID, so a call sent right after the upgrade can still fall through to the first window. The gateway therefore does not mark the tunnel ready, and does not accept the page's socket, until the host has mapped the issued ID. It asks: one `Window.Name` call under the issued ID, with the header `X-Omniview-Audit-Probe`, repeated with a growing delay until the host answers `browser-N` or `MappingWait` (2 seconds) passes. A host that never maps the ID fails the page's socket with 502 and costs nothing of the socket budget. The probe is the one request the gateway makes on its own, and it is not a page call.

**Reading the host never stops.** The host queues events for each socket without a bound and writes them without a deadline, so a gateway that stops reading upstream, for example for a stalled page, makes the host's memory grow. The gateway reads the host without pause, whatever the page is doing. Every message is read whole (however many WebSocket frames carried it); binary messages and messages over 32 MiB are dropped without closing anything, and each text message passes `FilterEventMessage` before it is queued. Dropped events never take queue space. A page that cannot keep up is cut off instead of served late: the queue holds at most 16 MiB and 4096 messages, no event may wait in it longer than 30 seconds (`TunnelLag`), and no single write may take longer than 10 seconds (`TunnelWrite`). Each of these ends the tunnel as `slow_client`; the gateway goes on reading the host while it tears the tunnel down. Silently dropping an event the page should see would leave it stale with no sign, which is worse than a reconnect.

The page is pinged every 30 seconds and has 10 to answer, and the peer is looked up again every second. A write deadline and the ping deadline are timers of the gateway's own, not the WebSocket library's: when the library's deadline passes it closes the connection first, and the goroutine that reads the page then reports the page gone before the one that timed out reports why. The timer ends the tunnel with its cause first, and the close that follows is the gateway's.

How a tunnel ends decides the close status the page sees and the `tunnel_closed` code:

| Cause (`tunnel_closed` code) | Close status |
|---|---|
| `audit_ended`, `replaced` (the page reconnected), `upstream_gone`, `client_gone`, `ping_timeout`, any other | 1001 going away |
| `credential_revoked`, `credential_expired`, `peer_changed`, `unexpected_frame` | 1008 policy violation |
| `slow_client` | 1013 try again later |
| `internal_error` (a goroutine of the tunnel panicked) | 1011 internal error |

**Closing order.** The host forgets a client ID the moment its socket closes, and a call that arrives afterwards runs as the first window. So a tunnel ends in this order: it is unbound (no new call takes it), the queue is closed, the calls that hold it are cancelled and given up to `CallDrain` (2 seconds) to return, and only then are the sockets closed: each with a close handshake of up to `CloseGrace` (1 second), after which the connection is cut. A WebSocket peer that never answers a close would otherwise hold the close for the library's own five seconds, and one that vanished without a FIN for longer. A goroutine that panics ends the tunnel without ending the process, and goes on reading its socket so that the cut still has a read to cancel.

The host never retires the state of a browser window (realm scopes, metric and activity sessions live in tables of 64 to 128 entries that the owner's own windows share), and each events socket the host accepts is a new window. So the gateway keeps its use of them small and counts it:

- at most 2 open tunnels per credential and 4 for the audit;
- a page that reconnects under the same client ID replaces its old socket and does not count as an extra;
- a credential may open sockets at a burst of 3 and then one per 5 seconds (429 `client_churn`, with `Retry-After`), so a reconnect loop is slowed down, not served;
- the audit may open 16 sockets in its whole life (503 `client_budget`); a socket the upstream refused is not counted. The budget is the audit's, but what it spends is the host's: every audit adds up to 16 windows to the same tables of 64, which only a host restart clears, so the audits an owner can run against one host before restarting it are few.

After the budget is used the owner starts a new audit (and watches the host's own count). These numbers are in `Limits`. The Wails page script reconnects once a second after its socket closes, which meets the churn limit and then the budget quickly if the tunnel keeps ending; a page that is being cut off for a reason it cannot fix (a revoked credential) is refused at the next request, and one cut for `slow_client` needs the page to be fixed rather than reconnected.

### Lifecycle and clocks

- The audit lives 1 hour by default, 1 minute to 8 hours at most, and never extends itself on traffic.
- It ends at the earlier of its monotonic and its wall-clock deadline. Go's monotonic clock stops during a suspend on macOS and Linux, so the wall deadline is what ends an audit the machine slept through, and the monotonic deadline is what ends one whose wall clock was set back. A background timer checks both every second, so expiry does not wait for traffic; each request checks too.
- A wall clock seen to step back by more than two seconds ends the audit (`clock_jump`): time can no longer be trusted, and the owner starts a new one.
- The upstream is verified every second. A replaced host, a changed generation or an unreachable control plane ends the audit (`target_changed`, `target_unavailable`); a verification that never returns is cut off at its timeout, and one that panics is an unreachable control plane. `New` reports a failed first verification as what it was: `audit_target_changed`, `audit_timeout` or `audit_unavailable`.
- `Stop` refuses new work first, then cancels and waits for tunnels and in-flight requests, up to the context's deadline or 5 seconds. If closure cannot be confirmed it returns `audit_shutdown_incomplete`; the audit has ended all the same and refuses everything. With nothing left to close it returns at once, whatever the context says. `Ended()` closes the moment the audit stops accepting requests. The owner's daemon losing its identity (a lost node, a changed account) is the owner's to notice: it calls `Stop`.

### Codes and limits

| Code | Meaning |
|---|---|
| `audit_unauthorized` | every peer, authority and credential denial, and 429 for too many failed attempts. Always the same response |
| `audit_denied` | authenticated, but the route, origin rules or allowlist refuse; the body names a bounded `reason`. The plan lists no code for this; it is the one Wails-shaped answer for a refused call |
| `audit_unavailable` | authenticated, but over a limit (503, or 429 for reconnect churn) or the upstream failed or answered unacceptably (502) |
| `audit_timeout` | a bounded wait ran out, for instance the first verification of the upstream |
| `audit_target_changed`, `audit_shutdown_incomplete`, `invalid_audit_options`, `audit_not_found` | errors returned by the Go API; `CodeOf(err)` gives the code |

Remote responses never echo a username, origin, request target, TLS error, upstream error or credential. Bodies are shaped like Wails' own call errors (`message`, `kind`) so a refused call shows in the page as an ordinary failed call.

### Diagnostics

The package never logs. `Config.Events` receives bounded `Event` values: a kind, a fixed code, a timestamp, and opaque IDs (audit-scoped credential ID, node ID, and for policy denials the resolved method name). They never contain a header, URL, supplied username, secret or pairing code. The kinds are `denied`, `policy_denied`, `pairing_offered`, `pairing_redeemed`, `pairing_rejected`, `credential_issued`, `credential_pinned`, `credential_revoked`, `credential_expired`, `tunnel_opened`, `tunnel_closed` and `audit_ended`. Events for refused requests and refused calls share one limit, a burst of 32 and then ten a second; `Status().Denials` keeps exact counts by category. `Status()` is safe to call at any time: credentials with their state, expiry and pinned node, offers pending, open requests and tunnels, sockets opened, events forwarded and dropped.

### What the core does not do

- **It does not confine what an allowed call does.** See [What is not covered](#what-is-not-covered). An authenticated browser has the owner's authority over everything the table allows, and revoking a credential ends gateway access, not effects already caused.
- **It cannot make the page boot.** The page's first step asks Wails for its window's name and then looks that name up in the window service, which knows only the host's own windows, not the `browser-N` window an events socket creates. The gateway relays what the host answers and refuses every shortcut that would make this succeed (answering `Window.Name` itself, a window-name header, an unmapped client ID falling to the first window), so the page needs a host-side server-mode window identity before it runs end to end through the gateway.
- **A call can still run as the first window in one narrow case.** The gateway closes its socket to the host only after the calls that hold it have been cancelled and have returned, which leaves a call whose bytes the host has received but not yet started. If the tunnel ends in that instant the host may resolve the call's client ID after it was unmapped. Closing it for good needs the host to refuse unmapped client IDs in server mode, which belongs with the window identity above.
- **Browser behavior is unverified.** That a real browser sends its cached Basic credentials on the WebSocket handshake, and that its handshake carries the `Origin` and `Sec-Fetch-Site` values the rules above expect, has been exercised only with Go clients. The acceptance test the plan requires must run in real browsers.
- **A swapped upstream goes unnoticed for up to a verification interval.** The upstream is verified about once a second, and each verification may take its timeout. A host that is replaced between two verifications is served until the next one fails: about three seconds with the defaults. The loopback port gives no kernel-level proof of who listens on it; if the host dies and another local process binds the port, authenticated remote traffic reaches it until the next verification. `Upstream.Verify` should check the socket's owner, and the owner's adapter should do so before it trusts a new dial.
- **It does not protect against other users of the host.** The loopback Wails endpoint is unauthenticated to local processes, and a local process that dials the tailnet address resolves to the local node; `AllowSelf` is off by default, and the credential is then the only barrier for it.
- **It does not isolate itself.** The core is a library, and where it runs is the owner's decision. Inside the supervisor or the host it shares their memory and environment, and the supervisor token's file path is in the host's environment, which child processes inherit, terminals included. The allowlist denies the terminal, so a remote browser cannot reach one, but a parser bug in the core would sit next to that token. Run the gateway in a small child process of its own, and keep audit control off the supervisor endpoint, when it is exposed.
- **It does not know Tailscale.** Owner, node and tag semantics, the `WhoIs` self case, certificate acquisition and Serve interception belong to the adapter that implements `PeerIdentity` and supplies `GetCertificate`. The pre-authentication limits above divide the work among peers; keeping everyone else off the port is the tailnet's access controls.
- **Nothing is exposed.** No code outside this package and its tests calls it, and no listener, command or supervisor path starts it.

### Tests

`GOWORK=off go test ./internal/auditgate/gateway/` runs unit tests, white-box tests of the credential table, limiter, clock and parsers, and integration tests that serve the gateway over real TLS on a loopback port in front of a fake Wails server (`fakewails_test.go`). The fake reproduces the behavior the gateway depends on from the pinned Wails sources and the host's request policy: its Host guard, its origin rules, its lenient JSON decoder, its window choice (client ID, then `x-wails-window-name`, then the first window), the late mapping of the client ID after the upgrade, and an events broadcaster that creates one never-retired window per connection. Every denied request is checked against the fake's request counter. The tests that depend on a socket write blocking send 64 MiB, well past the buffers of any system they run on. Fuzz targets cover the `Authorization` parser, the route classifier and the pairing-code reader: `go test ./internal/auditgate/gateway/ -run '^$' -fuzz FuzzParseBasic -fuzztime 30s`, and likewise `FuzzClassifyRoute` and `FuzzNormalizePairingCode`.
