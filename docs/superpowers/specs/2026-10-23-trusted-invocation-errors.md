# C02: host invocation, resource errors and current action ownership

Contract version: R4, review snapshot 59B5. Coordinator freeze approved after independent contract and trust/security reviews found no remaining Important/Critical design findings. This is approval of the contract, not a claim that implementation or production acceptance has passed. Packet: P04, host issue83.

## Provenance and scope

`backend/pkg/invocation` issues native-only principal scopes with origin `host` or `trusted-ui`, opaque owner UUID and reserved generation `initial`. Neither owner nor generation nor a trusted actor is accepted from a Wails DTO. Plugin/connection/resource/handle IDs select routes or objects; they confer no authority. SDK request/requester labels are diagnostic only.

The registered resource and graph wrappers share one host-created trusted-UI realm. Wails-facing exec, logs, metrics and network controllers use that same realm through the existing resource service wrapper for connection lookups; raw native consumers retain Host provenance. Current shared-origin plugins intentionally have that realm's authority: this is not distinct-plugin authentication, ABAC, consent, isolation or a hostile-plugin sandbox. Native lifecycle callers explicitly use host-issued context. Controller methods authoritatively admit their own operation and target before provider access, subscriptions, graph reads, observation or handles. Admission is not wrapper-only. Request cancellation/deadline and tracing propagate through context-first methods; request correlation is host generated.

Targets retain provider/access route, optional connection, opaque type/object/action and provider-specific scope. Invocation core requires no Kubernetes GVK/namespace/UID. The existing namespace adapter represents its exact selection as a JSON string under `namespace-selection`; this is current access-route input, not canonical identity or C01 scope equality.

Generation `initial` reserves an ownership/sharing slot; it does not detect permission changes or implement revocation. Existing resource events, subscriptions and route-keyed registry state remain shared within the trusted realm. Graph root admission is not per-node authorization. Restrictive future graph/cache/output policy must integrate those surfaces before claiming isolation.

The manager consumes a lifecycle-only controller interface. Other capabilities' public services remain unchanged; resource context-free service aliases are removed rather than retained as shims.

## Error-capable discovery and SDK correlation

SDK/host `GetResourceGroups` and `GetResourceTypes` return `(map,error)`; `HasResourceType` returns `(bool,error)`. Failed transport/discovery is never an empty successful inventory. No-RPC operations return structured UNSUPPORTED rather than fabricated absence. Private in-memory type-manager methods need not acquire fallible signatures where no failure exists.

Existing SDK Session fields carry request ID/requester through diagnostic gRPC metadata. Incoming labels accept at most one value and at most 256 UTF-8 bytes per field. Malformed metadata is INVALID_REQUEST. `resolveCRUD` copies Session immutably while replacing its resolved connection, retaining correlation and configuration through the actual registered resourcer. No host trust token crosses to providers.

CRUD/action-result envelopes reuse their existing ResourceError fields. Every non-envelope resource RPC, including stream termination, uses typed common ResourceError gRPC status details and code-appropriate status. Clients decode typed details; absent details retain actual transport status with safe text, preserving the distinction between plugin transport loss and provider-declared outage. No classification from arbitrary message strings/JSON. Known unsupported operations are typed at their source. Context cancellation/deadline are expected cancellation/timeout, never generic internal failures.

## One public error model

Extend the existing AppError with optional `code`, `requestId`, `recovery`, `location`. Location uses zero-based half-open UTF-8 byte offsets: `{start,end,unit:"utf8-byte"}` with nonnegative ordered offsets. This does not implement CEL/editor position conversion. Correlation and locations remain host-owned.

| Code | URI | Status | Recovery |
| --- | --- | ---: | --- |
| INVALID_REQUEST | omniview:validation |400|correctRequest|
| UNSUPPORTED | omniview:not-implemented |501|refreshContract|
| FORBIDDEN | omniview:resource/forbidden |403|none|
| UNAUTHORIZED | omniview:resource/unauthorized |401|none|
| NOT_FOUND | omniview:resource/not-found |404|none|
| CONFLICT / ALREADY_EXISTS | omniview:resource/conflict |409|refreshContract|
| CANCELLED | omniview:cancelled |499|none|
| TIMEOUT | omniview:resource/timeout |408|none|
| UNAVAILABLE / CONNECTION_ERROR | omniview:connection/failed |503|reconnect|
| CERTIFICATE_ERROR | omniview:connection/failed |502|reconnect|
| RESOURCE_LIMIT | omniview:resource/limit |429|correctRequest|
| CONTINUATION_EXPIRED | omniview:resource/continuation-expired |410|restartQuery|
| RESET_REQUIRED | omniview:resource/reset-required |409|restartQuery|
| PARTIAL_RESULT | omniview:resource/partial |422|none|
| PROVIDER_ERROR | omniview:resource/provider-error |502|none|
| INTERNAL / unknown | omniview:internal |500|none|

PERMISSION_DENIED normalizes to FORBIDDEN; INVALID_INPUT/FILTER_UNKNOWN_FIELD/FILTER_INVALID_OPERATOR normalize to INVALID_REQUEST. Existing wire numbers 1–14 remain unchanged; additive codes 15–22 are INVALID_REQUEST, UNSUPPORTED, CANCELLED, RESOURCE_LIMIT, CONTINUATION_EXPIRED, RESET_REQUIRED, PARTIAL_RESULT, PROVIDER_ERROR respectively.

Sanitize by provenance/classification, not Go error identity. Provider-created AppError cannot bypass redaction. Denial/internal/unknown/raw errors receive fixed host-safe title/detail; provider actions, suggestions, instance, location and correlation are not copied. Other recognized structured non-sensitive errors may carry bounded provider-declared public-safe diagnostics. Retain raw causes internally. No arbitrary raw diagnostic fallback reaches runtime. The shared runtime parser handles actual Wails wrappers, structured objects, JSON, typed SDK fallback and actual CancelError/AbortError while preserving canonical meaning.

A result+error pair is rejected before observation. Current finite APIs fail closed on PARTIAL_RESULT: no truthful allowPartial/coverage DTO exists yet. Partial coverage never overrides admission or denial.

The runtime retains its declared ES2020 library target. Classification lookup accepts only the table's own keys, not inherited prototype properties, using the standard target-compatible ownership check rather than raising the package target.

## Concrete ready before current action handle

Provider/ActionResourcer StreamAction retains its method signature but requires exactly one concrete-provider `ready` event before progress/output/completion. Ready means authoritative native establishment succeeded, not method entry, headers or elapsed time. Error events carry typed Error; StreamActionEvent field5 transports common ResourceError. Untyped raw error data is discarded/classified safely.

Before ready, denial/error/cancellation/missing-ready completion fails the open request with no public handle, registry handle or cache. Startup is bounded by caller cancellation/deadline and 30 s. The producer owns its independent lifetime before it starts; open cancellation/startup timeout are bridged atomically through commit, not reparented afterward.

Current Deployment/DaemonSet/StatefulSet restart providers emit ready only after native Patch and Watch both succeed. A Patch followed by Watch denial can fail establishment without a host handle; the Patch is not rolled back. Native cancellation remains cooperative, not forced termination of arbitrary provider code. Known unsupported node/Helm streaming branches are typed UNSUPPORTED. No progress-as-ready compatibility inference is allowed; providers must rebuild for the compatible cohort.

## Listener-first attachment and bounded retention

Current action service methods are context-first StreamAction, AttachStreamAction and CancelStreamAction. Open returns an opaque host UUID only after ready. Attach/Cancel verify owner+generation before disclosing stored target/status, then admit the stored target/operation. Unknown and foreign handles are indistinguishable safe denials, allocate nothing and cannot cancel another owner. Repeated owning Attach reconciles latest state without restarting work or extending budget. Repeated Cancel after removal is not privileged idempotency.

Request cancellation before commit aborts establishment. Once the handle commits, later cancellation of the open request does not replace its successful result; accepted work remains owner-attachable and is released by owning cancellation, expiry or teardown. The native-file transfer regression covers this boundary without a timing race.

Snapshots contain monotonic sequence, host-owned sanitized event and terminal flag. Runtime installs the exact Wails listener before Attach; no event is emitted before attachment. Latest/terminal state is retained across fast completion. Events and Attach response pass through one sequence reducer, so stale Attach responses cannot revert terminal state. No old action-payload alias or query-lease framework remains. Unmount/scope replacement cancels pending Wails calls, releases accepted handles and removes only its own listener. Cancellation is represented as cancellation, not successful completion/internal failure.

Production bounds: 10 s pending attachment, 30 s terminal retention, 10 minute absolute accepted lifetime, 32 pending+retained actions per realm and 64 total, 64 KiB encoded snapshot. Current native restart limit remains 5 minutes. Host timers/quota enforce cleanup even after browser/window loss; completed Wails calls are not presumed window-tracked. Service/plugin teardown cancels pending/accepted work and removes timers/records. Remote abort remains cooperative; in-flight bridge delivery is not durable across browser destruction. An owning live caller can reconcile while the handle is retained.

The private action adapter fences actual dispatch against completed owning cancellation and plugin/service teardown with a per-handle delivery lock; the registry lock is not held during emission. Closing handles remain discoverable until that fence finishes so overlapping teardown observes the same work. Wails supports synchronous Go event hooks, but this adapter has no registered action hook that synchronously cancels/stops its own registry; adding one requires revisiting the fence, not assuming Wails is universally nonreentrant. Remote frontend cancellation cannot synchronously reenter Go emission. Already-enqueued frontend deliveries cannot be retracted; disposed runtime actions ignore them. Attachment expiry rechecks unattached eligibility under lock, independently of terminal retention expiry.

## Generation, consumption and acceptance

SDK protobuf generation follows `make proto` (`buf generate`) using a reviewed pinned generator; host Wails bindings use only `task bindings`. The integration coordinator owns generation at the settled verification barrier. No mid-flight builds/tests/formatters/generation are acceptance evidence.

SDK changes and host/provider consumption are separable commits. Local-source SDK+host proof is integration evidence only. The reviewed SDK must become publicly reachable first; resolve its actual merged commit to a canonical module version and pin host/Kubernetes before mainline verification/merge. Unchanged host SDKv0.6.0 does not establish the corrected transport/readiness semantics. No invented version/tag or synthetic readiness shim.

The coordinated consumer source pins public SDK commit `8e78f72556c5221037889659c8ac28ad1246d35d` (SDK PR14) as Go-resolved version `v0.6.1-0.20261025021152-8e78f72556c5` in host and Kubernetes. This identifies the consumed contract, not completed consumer acceptance. Standalone committed consumer tests/builds without any local SDK replacement and integrated Wails/runtime proof remain required.

Required actual acceptance: registered resourcer→gRPC→host correlation/error propagation; truthful discovery failures/unsupported; pre-ready denial no handles/cache; foreign attach/cancel secrecy; poisoned-field redaction; result+denial no observation; pending open/attach cancellation, ready lifetime surviving open completion, fast terminal reconciliation, bounded snapshots/expiry/quota/shutdown and useful CRUD/actions/subscriptions/graph plus logs/exec/metrics/settings/navigation. Cross-language tests consume actual Go error JSON, not only independent handwritten envelopes. Browser proof must cross the actual generated Wails transport in the selected isolated source cohort. Clock-driven expiry tests do not imply an elapsed10minute runtime run.

## Verified consumer cohort

- Public SDK: `8e78f72556c5221037889659c8ac28ad1246d35d`, Go-resolved `v0.6.1-0.20261025021152-8e78f72556c5`. Host and both verification-plugin modules passed readonly public-module checks with no SDK replacement; Kubernetes consumer [PR32](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/32) is merged at `a7c00be5b15e50164f12f0d6ee0915d1b0112692`.
- Functional host receipt: `38d5c59dc6322776cabf00f3e8e8c911e8e41ae5`, UI `c437aca20d853aa6f65f0fa437ada3e0bcfc82f9`, Kubernetes `a7c00be5`, private verification plugin `9914cc3d`. Isolated workspace `986f185a-373d-417a-8d2f-4b1a016612bc`, generation `a473bde0-ee83-4059-a92b-0b0111d1a6ab`; actual source heads were recorded separately from descriptor base refs.
- All-host `GOWORK=off go test ./... -count=1` and race verification passed against the genuine public SDK. Both verification plugins and the native host built as Mach-O arm64. One native `task bindings` processed 612 packages, 17 services, 175 methods, 29 enums, 130 models and 35 events with no generated delta.
- The actual pinned native12 protocol probe passed recursive peer/singleton/live-export/atomic-dist checks. Canonical workspace bootstrap built runtime before Vite shims; both selected frontend plugins rendered ready. No global links or competing member installs were used.
- Fresh `TestC02ErrorTransportCorpus` exercised nine registered-SDK→gRPC→host cases. Its actual Go JSON fed 49 passing runtime error/lifecycle tests with `--no-cache --configLoader runner`; all 35 inventoried managed dependency entries remained identical, with no added paths.
- Fifteen actual generated-Wails transport cases passed: useful CRUD/graph/correlation, denied and pending opens, owned attachment/cancellation, fast terminal reconciliation and expiry. Unexpected pageerrors/console errors were zero; native preparing/active counts returned to zero. Real unattached expiry was 10,044.5 ms. Canonical down/unlink passed and the owned browser closed.

These are named-cohort functional receipts, not full Kubernetes cluster, native WebView/pixel, performance or elapsed-ten-minute lifetime proof. The stock custom-runtime HEAD abort was retained in network evidence, not filtered. Mainline CI/merge acceptance remains tracked in [P04](https://github.com/omniviewdev/omniview/issues/83); C01/C03–C09 and the coordinated release gate are not completed by this receipt.

## Useful workflow verification

- Successful native capability regressions use registered resource SDK/gRPC connection discovery and actual capability transports. [Exec](../../../backend/pkg/plugin/exec/controller_native_success_test.go) exercises real PTY/private-file effects, replay and process/descriptor/session cleanup; its POSIX fixture is scoped to Darwin/Linux. [Logs](../../../backend/pkg/plugin/logs/controller_native_success_test.go) exercises native file contents, connection-versus-request routing, pause/resume and descriptor/session/RPC cleanup. [Metrics](../../../backend/pkg/plugin/metric/controller_native_success_test.go) consumes transported process metadata and native runtime samples through the actual query lifecycle. Default package normal/race checks passed; these are native consumer-boundary proofs, not extra Wails capability-dispatch claims.
- The [subscription regression](../../../backend/pkg/plugin/resource/subscription_c02_integration_test.go) crosses native file/registered SDK/gRPC boundaries and verifies refcount release/remount, indexing while forwarding is released and native watcher shutdown. Private verification-plugin tests exercise native ADD/UPDATE/DELETE and cancellation.
- Live workflow confirmation used host `9a307209da6b5990589583549ed5a779349e947f`, private plugin `87e50684b7667d31fdeff89a40fe88d4431cb4c4` and the same public SDK/UI/Kubernetes pins above. Actual workspace 986f185a generation `1e6e369a-1a0b-43d5-aad9-9f3750fc2d81` rendered native create/rename/delete events, release/remount and scoped navigation. Actual host refcounts were `1,0,1,0,1,0`; the shared upstream watch intentionally remained synced until teardown.
- A setting saved as 1 in the preceding host/plugin generation was freshly read as 1 after process replacement, establishing durability. The new generation saved/read 2 and navigation remount freshly read 2; this does not claim a second process-restart proof for 2. Observed page/console errors were zero; all 35 inventoried dependency entries were unchanged. Canonical down/unlink passed and the browser closed.

Current resource cache batching retains its next-frame fast path but also schedules one cancelable timer for already-delivered authoritative events. The first flush cancels the other schedule and drains once; disposal cancels both. Data progress therefore does not require paint callbacks while the event loop can run timers. This is not refetching, optimistic data, another query engine or durable delivery when the whole browser is frozen/destroyed. Withheld-frame fake-clock regressions were failing before the correction; all 33 batcher cases passed afterward. The failing live generation and its exact delivered-event/buffer/cache diagnostics remain separate from the repaired receipt.

## Repository-owned transport verification

`GOWORK=off task check:c02-transport C02_ERROR_CORPUS=/absolute/private/c02-errors.json` generates fresh registered SDK→gRPC→host errors and passes that same file to the actual runtime parser. The output's parent directory must exist. Empty or relative output paths fail before Go bootstrap; the reader also requires an absolute path. In managed features, supply the selected `SDK_SOURCE` and explicit private `HOST_MOD_OUTPUT_DIRECTORY` / `GO_BUILD_CACHE_DIRECTORY` using the [package-linking procedure](../../development-package-linking.md); do not substitute a member install or edit managed receipts.

CI reuses its existing Go producer and UI dependency installation. The consumer takes the exact artifact name and filename from the producer job's output, not its own attempt counter; each producer attempt retains its separate artifact. The reader checks all nine normative error codes, meaning/type/status and sensitive-error redaction. Missing CI input and unreadable files fail; optional standalone non-CI omission is explicitly skipped. A changed wire meaning fails the actual parser assertion. These checks do not add another application E2E suite.
