# C08: result lease wire and passive observer

Status: proposed for independent review and explicit user freeze; not approved and not implementation authorization. Owners: P14 host result leases and P15 runtime. Consumes [P01 query contracts](2026-10-24-resource-query-contracts.md) and [source-session contract §§5–6, 9](2026-10-17-source-session-contract.md). P01's later coordinator acceptance and numeric dependency decision govern where its historical status text differs. C04 owns source frames; P12 owns source interests and the read model; P13 owns compilation and execution. This contract does not change them.

## Transport and DTOs

Wails bound methods are `OpenQueryLease`, `ControlQueryLease`, and `CloseQueryLease`. Each request and response below is a JSON object. These are the exact wire field names and discriminants; generated TypeScript bindings must preserve them. `QuerySpec`, `ResourceReference`, `RepresentationBinding`, `BoundValue`, `AppError` are the accepted P01/P04 types, not new versions. AppError is `backend/pkg/apperror.AppError` including its existing code, recovery and request correlation; it is not a new error envelope. Scope, route, bindings and delivery remain inside the accepted `QuerySpec`. No client supplies a principal, access epoch, share key, provider cursor or checked program.

```ts
type UInt64Text = string; // canonical unsigned decimal, 0..18446744073709551615
type Token = string;      // opaque, nonempty; host-issued except requestId

type OpenQueryLeaseRequest = { requestId: Token; query: QuerySpec };
type OpenQueryLeaseResponse = { leaseId: Token; eventName: string };
type ControlQueryLeaseRequest = {
  leaseId: Token;
  control: { kind: "attach" } | { kind: "recover"; generation: Token }
         | { kind: "refresh" };
};
type ControlQueryLeaseResponse = { accepted: true };
type CloseQueryLeaseRequest = { leaseId: Token };
type CloseQueryLeaseResponse = { closed: true };

type ProjectedValue = { state: "absent" } | { state: "null" }
                    | { state: "value"; value: BoundValue };
type ResultRow = {
  key: Token; targetId: string; resource: ResourceReference;
  representation: RepresentationBinding;
  provenance: { source: Token; coverage: "complete" | "partial" | "unknown" };
  values: Record<string, ProjectedValue>;
};
type ResultMetadata = {
  coverage: "complete" | "partial" | "unknown";
  limitations: string[];
  freshness: "current" | "snapshot" | "stale";
  count: { kind: "unknown" } | { kind: "exact" | "estimate"; value: UInt64Text };
  continuation?: Token;
};
type ResultChange =
  | { kind: "enter"; index: number; row: ResultRow }
  | { kind: "update"; key: Token; row: ResultRow }
  | { kind: "leave"; key: Token }
  | { kind: "delete"; key: Token }
  | { kind: "move"; key: Token; index: number };
type ResultDataFrame = {
  lane: "data"; leaseId: Token; generation: Token; sequence: UInt64Text;
  payload: { kind: "open"; rows: ResultRow[]; metadata: ResultMetadata }
         | { kind: "changes"; changes: ResultChange[]; metadata: ResultMetadata };
};
type ResultControlFrame = {
  lane: "control"; leaseId: Token;
  payload: { kind: "reset"; generation: Token; nextGeneration: Token;
             reason: "gap" | "overflow" | "sourceInvalidated" | "bindingChanged" | "refresh" }
         | { kind: "control"; state: "complete" | "refreshing"; generation: Token }
         | { kind: "close"; reason: "closed" | "cancelled" | "failed" | "accessInvalidated";
             error?: AppError };
};
type QueryLeaseEvent = ResultDataFrame | ResultControlFrame;
```
The Go service DTO mapping below uses explicit variants. The tagged union structs are encoded/decoded by strict custom JSON codecs; `Kind` and `Lane` select exactly one non-nil variant. Generated TS is the discriminated union above, generated through a typed Wails binding adapter rather than the internal Go union representation.

```go
type Token string
type UInt64Text string
type OpenQueryLeaseRequest struct { RequestID Token `json:"requestId"`; Query QuerySpec `json:"query"` }
type OpenQueryLeaseResponse struct { LeaseID Token `json:"leaseId"`; EventName string `json:"eventName"` }
type ControlQueryLeaseRequest struct { LeaseID Token `json:"leaseId"`; Control QueryLeaseControl `json:"control"` }
type ControlQueryLeaseResponse struct { Accepted bool `json:"accepted"` }
type CloseQueryLeaseRequest struct { LeaseID Token `json:"leaseId"` }
type CloseQueryLeaseResponse struct { Closed bool `json:"closed"` }
type QueryLeaseControl struct { Kind string `json:"kind"`; Generation *Token `json:"generation,omitempty"` }
type ProjectedValue struct { State string `json:"state"`; Value *BoundValue `json:"value,omitempty"` }
type ResultProvenance struct { Source Token `json:"source"`; Coverage string `json:"coverage"` }
type ResultRow struct {
 Key Token `json:"key"`; TargetID string `json:"targetId"`; Resource ResourceReference `json:"resource"`
 Representation RepresentationBinding `json:"representation"`; Provenance ResultProvenance `json:"provenance"`
 Values map[string]ProjectedValue `json:"values"`
}
type ResultCount struct { Kind string `json:"kind"`; Value *UInt64Text `json:"value,omitempty"` }
type ResultMetadata struct {
 Coverage string `json:"coverage"`; Limitations []string `json:"limitations"`; Freshness string `json:"freshness"`
 Count ResultCount `json:"count"`; Continuation *Token `json:"continuation,omitempty"`
}
type ResultChange struct {
 Kind string `json:"kind"`; Index *int `json:"index,omitempty"`; Key *Token `json:"key,omitempty"`; Row *ResultRow `json:"row,omitempty"`
}
type ResultDataPayload struct { Kind string `json:"kind"`; Rows []ResultRow `json:"rows,omitempty"`; Changes []ResultChange `json:"changes,omitempty"`; Metadata ResultMetadata `json:"metadata"` }
type ResultDataFrame struct { Lane string `json:"lane"`; LeaseID Token `json:"leaseId"`; Generation Token `json:"generation"`; Sequence UInt64Text `json:"sequence"`; Payload ResultDataPayload `json:"payload"` }
type ResultControlPayload struct {
 Kind string `json:"kind"`; Generation *Token `json:"generation,omitempty"`; NextGeneration *Token `json:"nextGeneration,omitempty"`
 Reason *string `json:"reason,omitempty"`; State *string `json:"state,omitempty"`; Error *AppError `json:"error,omitempty"`
}
type ResultControlFrame struct { Lane string `json:"lane"`; LeaseID Token `json:"leaseId"`; Payload ResultControlPayload `json:"payload"` }
```

The custom codec emits `rows: []` for an empty open and `changes: []` for an empty changes frame, despite Go `omitempty`; absent variant fields never appear. All required booleans must be true. The generated event binding is `QueryLeaseEvent` above, including `ResultDataFrame` and `ResultControlFrame`; it must not expose the Go internal representation. `QueryLeaseControl` permits `generation` only for `recover`; `ResultChange` permits exactly the fields in the TS variant; `ResultControlPayload` permits exactly the fields in its TS variant.


Go DTOs use the exact JSON field names shown above. Go decoding rejects unknown fields, unknown discriminants, missing required fields, duplicate JSON members and invalid variant fields. All indices are nonnegative JSON integers bounded by the admitted window size, never int64 counters. Non-optional arrays and maps are non-nil, including empty ones.

The bridge is Wails JSON, not protobuf: C08 adds no protobuf message or RPC. P01/P45 protobuf messages remain the source of the existing domain types and C04 protobuf remains source-only. Any adapter must preserve the P01 domain mappings and tagged `BoundValue`. Every int64/uint64 anywhere in a query, typed value or result is a canonical decimal JSON string; signed values have no plus, leading zero or negative zero, and both signed/unsigned are range-checked. TS retains strings, never `number`; arithmetic may use `BigInt` locally but must serialize canonical strings. Result sequence starts at `"1"`, increases exactly once per data frame, and never wraps; rotate generation before exhaustion. Limits and indices are bounded safe JSON integers, not 64-bit wire values.

`key` is a host opaque row key incorporating target membership, canonical address and available incarnation. Equal addresses in distinct targets are distinct; unknown incarnation remains unknown. `values` keys are admitted projection IDs. Known missing, null and typed values remain distinct; unavailable fields are coverage/error, never fabricated absence. A row contains no unrequested full body. `source` is a host-issued opaque provenance identifier, not a provider checkpoint or authority. Metadata reflects qualified source/document limitations and never claims a partial or unknown source proves deletion. `count` is unknown unless host can justify exact or estimate; continuation is host-issued and follows P01 binding/expiry rules. `freshness: snapshot` denotes a completed snapshot-only result; stale must be visibly labeled, not promoted to current.

## Attachment, ordering, recovery

1. Open authorizes and reserves a lease but emits no events. It returns an opaque lease ID and unguessable per-lease event name `resource.queryLease.<leaseId>`. The caller registers its listener first, then sends `attach`. Attach is idempotent for this lease; the host serializes attach with close. Open cancellation before its response releases the reservation; a caller that receives a response must close it even if attach fails. A failed listener registration closes the lease. Orphan reservations expire after 30 seconds.
2. Attach obtains an atomic P13 initial window and update boundary; it emits one `open` data frame, including empty rows, at sequence 1. Changes cannot precede open. `once` emits `complete` after its open; finite execution, staging, source interest and queues are released without requiring a client close. The client retains the last permitted snapshot until close/invalidation. `follow` requires the admitted bounded update capability; a snapshot-only provider is supported by `once` with explicit snapshot freshness/manual refresh, not an invented watch or poller.
3. Frames in one generation are applied in data sequence order. A `changes` frame is one atomic transaction: apply each change in array order to a private bounded window and publish once after all validate. `enter` inserts at index 0..length; `update` replaces the row at an existing key and its row key must match; `leave` removes a window member without asserting source deletion; `delete` removes a member only when host has actual deletion evidence; `move` removes the existing key then inserts at index 0..remaining length. Keys must be unique. Empty change arrays may carry metadata only. Any invalid operation, duplicate/out-of-order data, or missing sequence invalidates the entire frame and triggers consumer-local recovery. Reordering is host-computed; never inferred by the client. One host source batch becomes one atomic published result transition, with no intermediate visible windows.
4. Reset is a control-lane barrier, not a data sequence member. It names the retired `generation` and exactly one freshly host-issued `nextGeneration`. It can bypass missing queued data and arrive before, after, or concurrently with old data. Once observed, discard all old-generation frames and staged state; only sequence 1 `open` bearing the announced generation can establish the replacement. The host serializes control and data emission for that lease so an announced generation's open is not emitted before its reset notification is dispatched. If the bridge loses that notification, an unannounced generation is rejected and the client requests `recover` rather than guessing. A gap triggers `recover` naming the generation observed; the host responds with reset and fresh snapshot, not replay.
5. Recovery is single-flight per lease. Duplicate `recover` for the currently retiring generation is idempotent and does not allocate another generation. If a second source invalidation occurs while a replacement is pending, the host retires that pending generation and emits another ordered reset from it to a new generation. Clients retain the newest valid reset chain even if its predecessor open never arrived; duplicate resets with the same pair are idempotent. A reset for a retired generation that is not the current chain head is ignored. The host never emits a replacement open for a superseded generation. A recovery request naming an already retired generation returns accepted without changing the current chain. The data lane never revives retired generations. Recovery reattaches to maintained P13 state and does not reopen a healthy shared source; if source continuity itself failed, P12 decides source recovery independently.
6. On ordinary reset, the client may display only explicitly stale old rows while replacement is pending, without mixing generations. On access invalidation, it immediately clears all protected rows and continuations, rejects late data and closes terminally. Closing or cancellation retires the lease; late callbacks cannot mutate it. No public resume token, delta replay, durable log or custom acknowledgement protocol is implied.

`refresh` is explicit for snapshot-only data. It requests a fresh admitted snapshot and sends `refreshing`, then a `refresh` reset and replacement open; it does not establish a watcher. Repeated refresh while one is pending is idempotent. If the lease has already completed and released execution, refresh requires a new open; the UI may issue a new `once` query. Unsupported refresh is `UNSUPPORTED`. Open/attach/refresh fail via canonical AppError on denied access, invalid query, unsupported guarantees, exhausted budget or provider failure; authorization denial is never partial success. `CONTINUATION_EXPIRED` and `RESET_REQUIRED` retain P01 meaning. Control on unknown/closed lease fails with canonical not-found/invalid-request AppError, except close is idempotent for an already closed lease owned by that caller. Request cancellation is a normal terminal outcome; close cancels a pending attach/recovery, releases reservations and sends at most one terminal `close`. Failed asynchronous work sends `close` with safe AppError. A successful `complete` is not an error.

## Bounds, isolation, lifetime

Per lease, admit at most 512 rows per window, 256 KiB per encoded data frame, 64 pending frames and 1 MiB pending encoded data. Batch at most 128 changes and flush within 16 ms when nonempty; split only at atomic transaction boundaries. If one atomic window or transition exceeds a frame limit, terminate with a canonical resource-limit AppError, never emit half a transaction. Limits are independently enforced before queue allocation, with UTF-8 encoded JSON bytes measured; stricter deployment limits may reject an open explicitly. A bounded single reserved control slot per lease is independent of the data queue. Serialize reset dispatch: if another invalidation arrives before the slot drains, defer issuing its next generation until the previous reset is dispatched; terminal close has priority. The transport must dispatch controls without waiting for a full data queue; if dispatch is impossible it closes/invalidates the lease and releases host resources. Client transport disconnection is equivalent to local terminal invalidation; delivery of a final event cannot be guaranteed to a disconnected process. Time-bound blocked transport writes and cleanup; no stalled renderer may retain a source indefinitely.

On either byte or item saturation, discard that consumer's pending data, send overflow reset and resnapshot from maintained execution under a new result generation. Healthy consumers continue, and the shared source is not reopened for a result-only overflow. Repeated recovery is bounded and fails terminally if a client cannot accept a bounded snapshot; there is no unbounded retry. Coalescing is allowed only when equivalent within one result generation and incarnation, preserving recreation, window membership, ordering, projection and reset boundaries.

The host computes the opaque sharing identity after authorization from effective compiled query/profile/environment, target and scope, access route, representation/schema, typed binding values, order, projection, delivery/coverage guarantees and trusted access epoch. It never logs sensitive bindings or accepts a client hash. Different access epochs, credentials or incompatible scope/bindings cannot share execution or data; equivalent authorized requests may share P13 work. Each lease owns independent result generation, queue and attachment. P12 owns the shared source-interest registry for query, graph, search and utility interests. Each execution holds its own admitted interest, released only at final execution reference, finite completion, failure or cancellation; closing one lease cannot stop other leases or independent interests. Source session generation/sequence and result generation/sequence are unrelated opaque namespaces; provider revisions are not ordering tokens. Loss of source continuity invalidates affected results but does not make one result generation equal to a source generation.

The proposed P12 candidate is [revision 6bc1deac](https://github.com/omniviewdev/omniview/blob/6bc1deac/docs/superpowers/specs/2026-11-02-p12-read-model.md), pending independent approval. Its `Manager.Acquire` returns an independent `Interest`; `View`, coalesced no-miss `Changes`, `Refresh` and `Close` remain P12-owned. The proposed P13 execution offers `Initial(ctx)`, `Changes()` of atomic ordered replacement windows, separate buffered `Done()` and `Close()`; P14 derives wire transitions and owns its own queues. These are candidate dependencies, not a second evaluator or approval of either interface. Implementation pins the exact independently reviewed revisions.

## Passive observer and migration

P15 subscribes before attach, validates frames and applies host keys, rows, order, metadata and removals atomically. It keeps only bounded window state, never mutates previous snapshots or incoming objects, and ignores retired-generation frames. Gap, reset, reconnect, duplicate/invalid frames and access invalidation follow the rules above. It never hashes queries, derives membership, filters, sorts, diffs source objects, plans, groups or reconciles a domain inventory. Detail/editor operations request full bodies via `Get`; mutation/action paths remain functional. Migrate runtime hooks, host table/drawer/search and connection consumers, and Kubernetes, Proxmox and Flux UI consumers to the generated API. Remove superseded event batcher, per-type subscriptions and legacy listeners as their last consumers migrate; no compatibility shim. Preserve P03 identity and independent plugin backend SDK pins.

## Candidate implementation slices and gates

Each slice is a real, independently reviewed behavior PR with tests and executable smoke; no placeholder wiring. Candidate branches pin exact reviewed predecessor revisions. Dependent code starts only after C08 user approval and independent approval of consumed P12/P13 interfaces. Required CI runs on the independently reviewed final head; user alone merges.

1. **Scheduler/sharing:** authorized compiled-execution sharing, lease refcounts, P12 interests, finite completion and cancellation; prove scope/binding/epoch isolation and independent graph interest.
2. **Window delivery/recovery:** actual host window-to-frame conversion, budgets, atomic transactions, terminal lane and consumer-local reset; prove saturation and overlapping recovery with real execution interfaces.
3. **Passive observer:** generated bindings and bounded atomic application, exact integers, generation/reset and immutable inputs; exercise actual contract transport, not a fake production fallback.
4. **Consumer migrations:** migrate cohesive host/runtime and plugin call sites with real query leases and preserved operations; remove old paths only after their final caller migrates.
5. **Actual path integration:** SDK source → P12 → P13 → P14 → Wails → P15, real finite/event sources, teardown and visible UI; pin candidate cohort and capture native/CI evidence. Integration is not a substitute for the earlier slices' real behavior.

Final acceptance additionally requires independent correctness and security review, required CI, 1/2/10 readers and 1/30/300 update bursts, byte/item saturation, access isolation, 300/3000/30000 scaling, native detail/edit/action smoke and cleanup accounting. Prototype evidence in source-session §9 is not proof of this path. User freeze and merge remain separate decisions.
