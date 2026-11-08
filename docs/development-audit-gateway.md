# Audit gateway allowlist

The host binds every exported method of its Go services to the page, and the page reaches them through one route, `POST /wails/runtime`. A remote, view-only audit browser must not get that whole surface: it would include a local shell, arbitrary file writes, plugin installation and the MCP relay token. The allowlist in `internal/auditgate` decides, per request, what such a browser may call. Everything not named in it is denied.

`internal/auditgate` is a standard-library-only package so the audit gateway can import it. It holds the table, the request evaluator and the event filter. It starts no listener and talks to no network; the gateway that uses it is a separate piece of work. Nothing is exposed remotely by the package itself: its only use in the host today is the startup check described below.

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
