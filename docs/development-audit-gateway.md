# Audit gateway allowlist

The host binds every exported method of its Go services to the page, and the page reaches them through one route, `POST /wails/runtime`. A remote, view-only audit browser must not get that whole surface: it would include a local shell, arbitrary file writes, plugin installation and the MCP relay token. The allowlist in `internal/auditgate` decides, per request, what such a browser may call. Everything not named in it is denied.

`internal/auditgate` is a standard-library-only package so the audit gateway can import it. It holds the table, the request evaluator and the event filter. It starts no listener and talks to no network; the gateway that uses it is a separate piece of work.

## What is classified

`internal/auditgate/policy.json` is embedded in the binary and holds three tables. Every row has a `decision` (`allow` or `deny`) and a `reason`; there is no undecided state.

| Table | Key | Meaning |
|---|---|---|
| `methods` | fully qualified name `PkgPath.Type.Method`, for example `main.AppService.GetInstanceInfo` | one row per Wails-bound Go method. Wails derives the ID from this name with FNV-1a 32, so the gateway can resolve `methodID` and `methodName` to the same row |
| `runtime` | Wails runtime object and method number | the non-bound calls of `POST /wails/runtime`. Only `Call`, `CancelCall`, three `Window` reads and three `System` reads are allowed; `Application.Quit`, `Browser.OpenURL`, `Events.Emit`, clipboard, dialogs and all other window control are denied by not being listed or by explicit rows |
| `events` | exact name, prefix or suffix | which backend events a remote client may receive |

The `wails` field records the Wails version whose object and method numbers the table was reviewed against.

## How a request is evaluated

`Policy.EvaluateRuntime` takes the method, the raw path, the raw query, the headers and the whole body, and returns a `Verdict`. It fails closed at every step:

1. POST to exactly `/wails/runtime`. Encoded, cleaned or differently cased paths are rejected, and `/wails/stream/*` is denied (the host registers no stream handler). Any query string is rejected, which also removes the empty-body fallback in which Wails reads `object`, `method` and `args` from the query.
2. Any `x-wails-chunk-*` header is rejected: a chunked call cannot be inspected piece by piece. The content type must be `application/json` and `x-wails-client-id`, when present, must match `[A-Za-z0-9_-]{1,64}`.
3. The body must be non-empty and at most `MaxRuntimeBodyBytes` (1 MiB). Callers read at most that many bytes plus one.
4. Strict JSON: valid UTF-8, one value, depth at most 32, and no object at any depth with a repeated key or with two keys that Go's `encoding/json` would fold into one field (it matches keys case-insensitively and keeps the last duplicate).
5. The envelope is exactly `object`, `method` and optionally `args`, with plain integer numbers. Unknown objects are denied; unlisted methods of a known object are denied.
6. For `Call`, `args` carries `call-id`, an `args` array and exactly one of `methodName` or `methodID`. A body with both is rejected even when `methodName` is empty, because Wails silently prefers a non-empty `methodName` and falls back to `methodID`. Unknown names and IDs are denied; a denied method reports its resolved name.
7. For an allowed request, `Verdict.Forward` is a body rebuilt from the parsed values: fixed key order and spelling, the resolved method always as `methodName`, arguments compacted. The original bytes are never forwarded. `RuntimeRequest.CallIDPrefix` lets the gateway scope call IDs (and `CancelCall` IDs) to a session.

`Verdict.Reason` is a stable code that never contains request text. `Verdict.ClientID` is the validated client ID the gateway should pass upstream; the gateway builds its own upstream request and must not forward the other headers, in particular `x-wails-window-*`.

## Using it from the gateway

- Fill `RuntimeRequest.Path` from the raw request target (`r.RequestURI` cut at `?`), not from the decoded `r.URL.Path`, and read the body through `http.MaxBytesReader` with a limit of `MaxRuntimeBodyBytes+1`.
- On an allow, send a fresh upstream request: the fixed loopback URL, no query, `Content-Type: application/json`, the body `Verdict.Forward`, and `x-wails-client-id: Verdict.ClientID` when it is not empty. Forward no other header: not `x-wails-window-*`, not `x-wails-chunk-*`, not cookies or the audit credential.
- On a deny, answer with a fixed status and body, and log `Verdict.Reason` and `Verdict.Subject` only, never the request body.
- The host admits calls per window. A call that reaches Wails without a window is refused by the invocation realm, so the page must open `/wails/events?clientId=...` first and keep using that client ID, which Wails maps to its server-mode browser window.
- For the event socket, accept the `clientId` query parameter only when `ValidClientID` allows it, run `FilterEventFrame` on every upstream text frame, and drop binary frames and every client-to-server frame.

## Events

`Policy.FilterEventFrame` decides whether one `/wails/events` text frame, `{"name":...,"data":...,"sender":...}`, may be sent to the remote client. Anything that is not exactly that shape (invalid JSON or UTF-8, repeated or unknown keys, trailing data, a non-string name) is dropped, never forwarded and never a reason to close the socket. A matching deny rule wins over any allow rule, a name nothing matches is dropped, and an allowed frame is forwarded unchanged. The terminal output and signals, MCP, action stream, menu and extension events are denied by explicit rules. Log events are allowed: the log viewer (`core/logs/`), the dev server (`plugin/devserver/log`), the plugin process log (`plugin/process/log`) and the host log tail (`internal/log/update`). Suffix rules cover names that embed plugin and connection IDs, which can contain slashes.

## Classify a new method

A bound method that is not in `policy.json` fails `go test .` (`TestEveryBoundMethodIsClassified`), and the host refuses to start when it registers such a service.

1. Add the service to `boundServiceTypes` in `main.go` if it is new, then run `task bindings`.
2. Add one row per method to `internal/auditgate/policy.json`, keeping `methods` sorted by `fqn` (a test checks it). The name is the Go package path, the type and the method, with `main` as the package path of the root package. The `reason` states the main fact, such as what the method writes or why reading it is safe.
3. Decide with these rules. **Allow** only what a read-only inspection of the running app needs and that neither changes persisted or remote state, starts a process, shell, listener or install, controls a native window or dialog, nor returns secret material. **Deny** everything else, and deny when unsure. `allow` means a named read that runs with the owner's credentials against live systems; it does not mean provably free of side effects, and plugin-defined data can still hold secrets.
4. Run `go test . ./internal/auditgate/`. `TestDangerousMethodsStayDenied` pins the methods that would give a remote browser the OS user's authority; flipping one of them is a deliberate change to that list.

Removing or renaming a method leaves a stale row, which `TestEveryBoundMethodIsClassified` also reports.

## Classify a new event

Add a rule to `events` with `match` set to `exact`, `prefix` or `suffix`, a `decision` and a `reason`. Events the host registers by name appear in the generated `bindings/events/index.ts`, and `TestRegisteredEventNamesAreClassified` requires each to be matched by an explicit rule rather than the default drop. A deny rule always wins; an allow rule that a deny rule shadows is rejected when the table loads.

## Services registered outside main

Wails binds methods of every registered service, so every registration site must be covered. `main` registers the services in `boundServiceTypes` and checks them with `verifyAuditPolicy` before `RegisterService`. A development build with the `devcontrol` tag also registers a lifecycle service from `internal/devcontrol/host`; its tagged test requires that it binds no unclassified method. `TestServiceRegistrationSitesAreKnown` fails when any other file registers a Wails service, and `TestBoundServiceTypesDeclareEveryRegisteredService` fails when `main.go` registers a service that `boundServiceTypes` does not list.

## Binding IDs, aliases and Wails upgrades

The gateway resolves `methodID` from the hash of the name. The host must therefore never set Wails `BindAliases` or call `RegisterBindingMethodID`; `TestNoBindingAliasesOrRegisteredIDs` fails if either appears, and `TestPolicyMatchesGeneratedBindings` compares the hash of every bound name with the IDs in the generated TypeScript bindings.

Runtime object and method numbers come from Wails, so a Wails upgrade fails `TestRuntimeNumberingMatchesPinnedWails` until someone re-checks `pkg/application/messageprocessor*.go` against the `runtime` table and updates the `wails` field.

## What is not covered

The allowlist limits which methods a client can call, not what an allowed method does. **The remote browser can read host and plugin logs.** The host log file and its tail, plugin process stderr, log viewer sessions and dev server output are allowed on purpose, and they can contain secrets such as tokens, credentials, hostnames and file paths. Allowed calls also act with the owner's credentials: `resource.Get` can return secret-bearing objects when the plugin serves them, connection starts can run plugin-side credential helpers, and plugin-data and settings reads can contain whatever plugins put in them. The loopback Wails endpoint stays unauthenticated to local processes. Event frames are a global broadcast, so a remote client receives the events of local sessions that the filter allows.

## Decisions recorded in the table

- Logs are allowed, by explicit user decision and knowing that logs can hold secrets. The remote browser can read the host log (`DiagnosticsClient.ReadLog`, `StartTail`, `StopTail`, `internal/log/update` events), the plugin process log (`pluginlog.GetLogs`, `SearchLogs`, `Subscribe`, `Unsubscribe`, `plugin/process/log` events), log viewer sessions (`logs.*`, `core/logs/*` events) and dev server output (`GetDevServerLogs`, `plugin/devserver/log`). Writing client log lines into the host log (`DiagnosticsClient.Log`, `Debug`, `Info`, `Warn`, `Error`) stays denied. `TestLogViewerAccessIsAllowedByDecision` pins this decision.
- Connections: `StartConnection`, `StopConnection`, `LoadConnections`, `RetryConnectionSources` and `RefreshConnectionMetadata` are allowed for existing saved connections. Creating, editing, importing, resetting or removing a connection profile is denied.
- Allowed: source views, metric subscriptions and observations, plugin data `Get` and `Keys`, marketplace reads, `System.IsDarkMode`, `Environment` and `Capabilities`, the process, profiling and UI-inspection status reads, and the diagnostics snapshot, history, catalog and capture reads. Denied: `NativeQuery`, starting, cancelling or deleting a diagnostics capture, the settings window and window-state writes, activity writes, and every `mcprelay` method.
- Chunked request bodies are rejected, so a request over 512 KiB of JSON text fails in the audit browser.
