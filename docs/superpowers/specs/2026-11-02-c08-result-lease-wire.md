# C08: result lease wire and passive observer

Status: proposed for independent review and explicit user freeze; not approved and not implementation authorization. Owners: P14 host result leases and P15 runtime. Consumes [P01 query contracts](2026-10-24-resource-query-contracts.md) and [source-session contract §§5–6, 9](2026-10-17-source-session-contract.md). P01's later coordinator acceptance and numeric dependency decision govern where its historical status text differs. C04 owns source frames; P12 owns source interests and the read model; P13 owns compilation and execution. This contract does not change them.

## Transport and DTOs

Wails bound methods are `OpenQueryLease`, `ControlQueryLease`, and `CloseQueryLease`. Each request and response below is a JSON object. Generated method bindings are used; `QueryLeaseEvent` is a hand-maintained discriminated TS union in runtime `resource/v2`, because Wails generates custom JSON marshalers as `any`. P13 owns `query.QuerySpec` and `query.Target` and their runtime `resource/v2/query.ts` mirrors. `BoundValue` means SDK `resourcev2.Value` in its tagged JSON encoding; `ResourceReference` means SDK `resourcev2.ResourceReference`; `RepresentationBinding` is SDK `resourcev2.RepresentationBinding{Representation resourcev2.Representation}` with JSON field `representation`, including ID, revision and full `SchemaBinding` ([C04 candidate d25cd7f7](https://github.com/omniviewdev/omniview/blob/d25cd7f7cdf777510fbf1b458338a0ef5d84f954/docs/superpowers/specs/2026-11-02-c04-source-session-wire.md)). `AppError` is `backend/pkg/apperror.AppError`. Scope, route, bindings and delivery remain in `QuerySpec`. No client supplies a principal, access epoch, share key, provider cursor or checked program.

P15 owns the sole TypeScript `QuerySpec` mirror in `resource/v2/query.ts`; the typed Wails adapter consumes it rather than generating another query shape. `Target.representation` is P13's `RepresentationSelector {id, revision}`; the host resolves it to the C04 `RepresentationBinding` returned on result rows.

```ts
type UInt64Text = string; // canonical unsigned decimal, 0..18446744073709551615
type Token = string;      // opaque, nonempty; host-issued except requestId

type OpenQueryLeaseRequest = { requestId: Token; query: QuerySpec };
type OpenQueryLeaseResponse = { leaseId: Token };
type ControlQueryLeaseRequest = {
  leaseId: Token;
  control: { kind: "attach" } | { kind: "recover"; generation: Token }
         | { kind: "drain" };
};
type ControlQueryLeaseResponse =
  | { kind: "attach"; generation: Token }
  | { kind: "recover"; accepted: true }
  | { kind: "drain"; event: QueryLeaseEvent | null };
type CloseQueryLeaseRequest = { leaseId: Token };
type CloseQueryLeaseResponse = { closed: true };

type ProjectedValue = { state: "absent" } | { state: "null" }
                    | { state: "value"; value: BoundValue };
type ResultRow = {
  key: Token; targetId: string; resource: ResourceReference;
  representation: RepresentationBinding;
  provenance: { source: Token; coverage: "complete" | "partial" | "unknown"; stale: boolean };
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
             reason: "gap" | "overflow" | "sourceInvalidated" | "bindingChanged" }
         | { kind: "control"; state: "complete"; generation: Token }
         | { kind: "close"; reason: "closed" | "cancelled" | "failed" | "accessInvalidated";
             error?: AppError };
};
type QueryLeaseEvent = ResultDataFrame | ResultControlFrame;
type QueryLeaseDoorbell = { leaseId: Token };
```
The Go service DTO mapping below uses explicit variants and strict JSON codecs. Generated Wails method bindings are retained; the result frame union is hand-maintained in TypeScript and tested against cross-language golden JSON behavioral fixtures, not asserted to be generated.

```go
type Token string
type UInt64Text string
type OpenQueryLeaseRequest struct { RequestID Token `json:"requestId"`; Query QuerySpec `json:"query"` }
type OpenQueryLeaseResponse struct { LeaseID Token `json:"leaseId"` }
type ControlQueryLeaseRequest struct { LeaseID Token `json:"leaseId"`; Control QueryLeaseControl `json:"control"` }
type ControlQueryLeaseResponse struct { Kind string `json:"kind"`; Generation *Token `json:"generation,omitempty"`; Accepted *bool `json:"accepted,omitempty"`; Event *QueryLeaseEvent `json:"event,omitempty"` }
type CloseQueryLeaseRequest struct { LeaseID Token `json:"leaseId"` }
type CloseQueryLeaseResponse struct { Closed bool `json:"closed"` }
type QueryLeaseControl struct { Kind string `json:"kind"`; Generation *Token `json:"generation,omitempty"` }
type ProjectedValue struct { State string `json:"state"`; Value *BoundValue `json:"value,omitempty"` }
type ResultProvenance struct { Source Token `json:"source"`; Coverage string `json:"coverage"`; Stale bool `json:"stale"` }
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
type QueryLeaseDoorbell struct { LeaseID Token `json:"leaseId"` }
```

The custom codec emits `rows: []` for an empty open and `changes: []` for an empty changes frame, despite Go `omitempty`; absent variant fields never appear. A drain response always emits `event`, explicitly null when empty, despite Go `omitempty`. Required `accepted` and `closed` booleans are true. `QueryLeaseControl` permits `generation` only for `recover`; `ResultChange` permits exactly the fields in its TS variant; `ResultControlPayload` permits exactly its variant fields. Go `QueryLeaseEvent` is a strict tagged union of `ResultDataFrame` and `ResultControlFrame`, encoded as the selected frame, not a wrapper.


Go DTOs use the exact JSON field names shown above. Go decoding rejects unknown fields, unknown discriminants, missing required fields, duplicate JSON members and invalid variant fields. All indices are nonnegative JSON integers bounded by the admitted window size, never int64 counters. Non-optional arrays and maps are non-nil, including empty ones.

The bridge is Wails JSON, not protobuf: C08 adds no protobuf message or RPC. P01/P45 protobuf messages remain the source of the existing domain types and C04 protobuf remains source-only. Any adapter must preserve the P01 domain mappings and tagged `BoundValue`. Every int64/uint64 anywhere in a query, typed value or result is a canonical decimal JSON string; signed values have no plus, leading zero or negative zero, and both signed/unsigned are range-checked. TS retains strings, never `number`; arithmetic may use `BigInt` locally but must serialize canonical strings. Result sequence starts at `"1"`, increases exactly once per data frame, and never wraps; rotate generation before exhaustion. Limits and indices are bounded safe JSON integers, not 64-bit wire values.

`key` is a host opaque row key incorporating target membership, canonical address and available incarnation. Equal addresses in distinct targets are distinct; unknown incarnation remains unknown. `values` keys are admitted projection IDs. Known missing, null and typed values remain distinct; unavailable fields are coverage/error, never fabricated absence. A row contains no unrequested full body. `source` is a host-issued opaque provenance identifier, not a provider checkpoint or authority. Metadata reflects qualified source/document limitations and never claims a partial or unknown source proves deletion. `count` is unknown unless host can justify exact or estimate; continuation is host-issued and follows P01 binding/expiry rules. `freshness: snapshot` denotes a completed snapshot-only result; stale must be visibly labeled, not promoted to current.
Aggregate target coverage as unknown if any target is unknown, else partial if any target is partial, else complete. Aggregate freshness as stale if any target is stale or unsynchronized, else snapshot if all are snapshot-only, else current. Preserve per-row stale provenance and aggregate limitations across targets. A P13 target source-attempt/epoch change invalidates the affected result generation with `sourceInvalidated`; access-epoch invalidation clears protected rows terminally. Do not compare watermarks from different targets as a global order.

## Attachment, ordering, recovery

1. Open authorizes and reserves a lease without emitting an event. It returns an opaque lease ID. The caller registers one constant `resource.queryLease.ready` doorbell listener before attach, then attaches. The service records the owning window from trusted Wails context `WindowKey`; Control and Close from another window are denied. Target doorbells only to that window, never broadcast. Close all its leases on `WindowClosing` and on each `WindowRuntimeReady` (including reload), releasing pending reservations, queues, executions and interests. Attach is idempotent; serialize it with close. Open cancellation or listener-registration failure releases the reservation. Unattached reservations expire after 30 seconds.
2. Attach returns the host-issued initial result generation. It obtains an atomic P13 initial window and update boundary; enqueue one `open` data frame, including empty rows, at sequence 1. Only that generation is initially accepted. Changes cannot precede open. `once` enqueues `complete` after its open and immediately releases execution, staging and source interest; its bounded delivery state survives only until drained, close, window teardown or the 30-second inactive deadline. `follow` requires admitted bounded update capability. Snapshot-only sources use `once` with explicit freshness and manual reopen, never invented watch or polling. C04 uses P45 finite pages for snapshots, including older providers with P45 support; live updates require `sourceSessionsV1`.
3. Frames in one generation apply in sequence order. A `changes` frame is one atomic transaction: apply array entries in order to a private bounded window and publish once after validation. `enter` inserts at index 0..length; `update` replaces an existing row with the same key; `move` removes an existing key then inserts at index 0..remaining length. `leave` denotes no longer matching or out of window. `delete` denotes P13-provided `sourceMembershipRemoved`, from a source remove or complete replacement retirement; it is not proof of infrastructure deletion. P13 provides departure reason per key; absent evidence cannot be promoted to `delete`. Keys are unique. Empty change arrays may carry metadata only. Invalid operations, duplicates, out-of-order data or sequence gaps invalidate the entire frame and trigger consumer-local recovery. The host computes ordering and preserves each atomic source batch without intermediate visible windows.
4. Reset is a control-lane barrier, not a data sequence member. It names the retired `generation` and one freshly host-issued `nextGeneration`. It bypasses queued data. Once drained, discard old-generation frames and staging; only sequence-1 `open` bearing the announced generation establishes replacement. Attach announces the first generation before any drain is allowed. The host returns reset before any replacement open. If a drain response is lost, the client terminates and reopens rather than guessing or replaying. A gap triggers `recover` naming the observed generation; the host responds with reset and fresh snapshot, not replay.
5. Recovery is single-flight per lease. Duplicate `recover` for the currently retiring generation is idempotent and does not allocate another generation. If a second source invalidation occurs while a replacement is pending, the host retires that pending generation and emits another ordered reset from it to a new generation. Clients retain the newest valid reset chain even if its predecessor open never arrived; duplicate resets with the same pair are idempotent. A reset for a retired generation that is not the current chain head is ignored. The host never emits a replacement open for a superseded generation. A recovery request naming an already retired generation returns accepted without changing the current chain. The data lane never revives retired generations. Recovery reattaches to maintained P13 state and does not reopen a healthy shared source; if source continuity itself failed, P12 decides source recovery independently.
6. On ordinary reset, the client may display only explicitly stale old rows while replacement is pending, without mixing generations. On access invalidation, it immediately clears all protected rows and continuations, rejects late data and closes terminally. Closing or cancellation retires the lease; late callbacks cannot mutate it. No public resume token, delta replay, durable log or custom acknowledgement protocol is implied.

Manual refresh closes the prior lease and opens a fresh `once` lease. There is no refresh control or background poller. Open and attach fail via canonical AppError for denied access, invalid query, unsupported guarantees, exhausted budget or provider failure; denial is never partial success. `CONTINUATION_EXPIRED` and `RESET_REQUIRED` retain P01 meaning. Cross-window control and close are denied; unknown leases return canonical not-found/invalid-request AppError. Close is idempotent for an already closed lease belonging to the same window runtime. Cancellation is normal; close cancels pending work and releases reservations. Asynchronous failure queues one terminal close with safe AppError; completion is not an error.

## Bounds, isolation, lifetime

Per lease, admit at most 512 rows per window, 256 KiB per encoded data frame, 64 pending frames and 1 MiB pending encoded data. Batch at most 128 changes and flush within 16 ms when nonempty; split only at atomic transaction boundaries. An oversized atomic transition fails with a resource-limit AppError. Enforce limits before allocation using encoded UTF-8 JSON bytes. A reserved control slot is independent of the data queue; reset and terminal close take priority over queued data, while normal `complete` follows the last data frame. Serialize chained resets and never overwrite an undelivered reset; if control cannot drain by the 30-second inactive deadline, close the lease and free resources.

Wails `Emit` queues to an unbounded mailbox and must never carry frames. The host owns the only pending frame queues. Emit only `{leaseId}` as a targeted `resource.queryLease.ready` doorbell, at most one outstanding doorbell per lease, coalesced until a `drain` call. The per-window lease count is bounded by the host admission limit, including completed-but-undrained leases. `drain` atomically clears the outstanding doorbell flag and returns at most one control or data frame, or null. If more remains, emit at most one new doorbell; the consumer drains again. Permit only one in-flight drain per lease; reject concurrent drains. A drain response is at most one bounded frame and is removed from the host queue only as part of that call. A stalled or disconnected window cannot accumulate doorbells or repeated response payloads; after 30 seconds without a successful drain while data/control is pending, close its lease and release resources. Window teardown also releases immediately. Loss or timeout of a drain response requires local invalidation and reopening, not retry of that drain. Terminal notification remains available in the reserved host lane even when data is full, but no disconnected renderer is guaranteed to receive it.

On either byte or item saturation, discard that consumer's pending data, send overflow reset and resnapshot from maintained execution under a new result generation. Healthy consumers continue, and the shared source is not reopened for a result-only overflow. Repeated recovery is bounded and fails terminally if a client cannot accept a bounded snapshot; there is no unbounded retry. Coalescing is allowed only when equivalent within one result generation and incarnation, preserving recreation, window membership, ordering, projection and reset boundaries.

The host computes the opaque sharing identity after authorization from effective compiled query/profile/environment, target and scope, access route, representation/schema, typed binding values, order, projection, delivery/coverage guarantees and trusted access epoch. It never logs sensitive bindings or accepts a client hash. Different access epochs, credentials or incompatible scope/bindings cannot share execution or data; equivalent authorized requests may share P13 work. Each lease owns independent result generation, queue and attachment. P12 owns the shared source-interest registry for query, graph, search and utility interests. Each execution holds its own admitted interest, released only at final execution reference, finite completion, failure or cancellation; closing one lease cannot stop other leases or independent interests. Source session generation/sequence and result generation/sequence are unrelated opaque namespaces; provider revisions are not ordering tokens. Loss of source continuity invalidates affected results but does not make one result generation equal to a source generation.

The proposed P12 candidate is [revision 5478f5be](https://github.com/omniviewdev/omniview/blob/5478f5bef0e7ac5da1504cc85c4f7e1d2576036d/docs/superpowers/specs/2026-11-02-p12-read-model.md); P13 candidate [28a1c2d8](https://github.com/omniviewdev/omniview/blob/28a1c2d817efabc8f75c9a3e39b270baab1b18da/docs/superpowers/specs/2026-11-02-p13-compiler.md) pins it and C05 e6064dad. Both require independent re-review. P12 owns independent interests, view and coalesced invalidations; P13 owns `Initial`, `Current`, coalesced `Changes`, `Done`, `Refresh` and `Close`. Its windows provide per-target source attempt/epoch and departure causes. P14 derives result frames and owns its queues; it does not define another evaluator. Implementation pins independently reviewed revisions.

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
