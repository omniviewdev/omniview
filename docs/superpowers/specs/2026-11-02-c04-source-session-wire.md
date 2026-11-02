# C04 source-session wire contract

Status: proposed for independent review and explicit user freeze; not approved or implemented. P05 owns this contract. Source semantics in [the accepted source-session contract](2026-10-17-source-session-contract.md) §§3–6 and 9 and the P45 finite acquisition contract remain binding. Host baseline `ff593e5c580b95130ddbacccdde2720f2307079b`; SDK candidate `0a5b64ed8c2de209fbb02ecce9feba3afd88f28c`. This is not evidence of production conformance.

## Ownership and admission

The host resolves an access route and catalog-backed `ReadTarget` under the trusted invocation principal, access epoch and catalog revision. `connectionId` is a route, never a principal. It verifies representation and schema binding, source selection and native-query capability before opening. An SDK provider must independently enforce its catalog and access checks. Neither source payload nor client-supplied identifiers confer authorization. A bound session never changes route, principal, access epoch, catalog revision, selection, representation or acquisition; changes terminate it and require a newly admitted generation. On access invalidation, discard protected data immediately.

P05 owns transport and validation. P12 owns source-interest lifetime, bounded staging, membership/provenance and publication. Its adapter consumes immutable `resourcev2.SourceOpen` and validated `resourcev2.SourceFrame`; it also rejects stale tokens, sequences, phases and bindings itself. P13 owns evaluation. P14 owns result generation and P15 its passive consumer. Source generation/sequence are never result generation/sequence. C05 owns schema identity and structural admission; C04's per-document coverage is not catalog schema coverage.

A source acquisition is the single finite P45 acquisition path extended with an optional following phase. Do not add a parallel List transport. Snapshot-only adapters may consume the existing P45 `Enumerate`/`NativeQuery` page operations internally, preserving page cursors, descriptors, error semantics and access admission. The host consumes those pages only through this session path for migrated reads. Event-capable adapters must establish and prove their own native cutover; pages and separately subscribed advisory events cannot be stitched by the host. P45 Get/mutations/actions remain separate operations.

## Wire and domain mapping

Add `proto/resource/v2/source_session.proto`, package `omniview.resource.v2`, Go package `github.com/omniviewdev/plugin-sdk/proto/resource/v2;resourcepb`. Add `service SourceSessions { rpc Open(SourceOpen) returns (stream SourceFrame); }`. One RPC is one generation. Go domain DTOs are in `github.com/omniviewdev/plugin-sdk/pkg/resource/v2` as `SourceOpen`, `SourceFrame`, `SourceObservation`, `SourceChange`, `RepresentationBinding`, `JsonDocument`, `DocumentCoverage`, `SourceCoverage` and nested types. Proto types use those same names prefixed `resourcepb.`. The SDK client/server converts and validates domain DTOs; host uses the same Go domain types. This stream is internal SDK↔host, not a Wails surface. If diagnostic TS representations are generated, use the JSON names and unions below, and `string` for all decimal integer text; no runtime source frame is exposed to P15. Wails result DTOs are exclusively C08.

The following schema is normative; fields are proto3 field numbers, not Go struct offsets. Required means semantically required even where proto3 has no `required`. Existing `ResourceAddress`, `QueryScope`, `SchemaDocumentReference` and `Value` come from `domain.proto`; their existing raw-wire and semantic validation applies. JSON names follow lowerCamelCase.

```proto
message JsonDocument { string encoding = 1; string text = 2; }
message RepresentationBinding {
  string representation_id = 1;
  SchemaDocumentReference schema = 2; // optional; both id and revision required when present
}
message FieldPathMember { string name = 1; }
message FieldPathIndex { uint32 index = 1; }
message FieldPathSegment { oneof segment { FieldPathMember member = 1; FieldPathIndex index = 2; } }
message DocumentFieldPath { repeated FieldPathSegment segments = 1; }
message DocumentCoverage { string kind = 1; repeated DocumentFieldPath known_absent = 2; }
message SourceCoverage { string enumeration = 1; string consistency = 2; repeated string limitations = 3; }
message SourceObservation {
  ResourceAddress address = 1; RepresentationBinding representation = 2;
  JsonDocument document = 3; DocumentCoverage document_coverage = 4;
  optional string incarnation = 5; optional string source_revision = 6;
  optional string display_name = 7;
}
message SourceChange {
  oneof change { SourceObservation upsert = 1; SourceRemove remove = 2; }
}
message SourceRemove {
  ResourceAddress address = 1; optional string incarnation = 2;
  optional string source_revision = 3;
}
message EnumerateAcquisition {}
message NativeQueryAcquisition { string format = 1; JsonDocument request = 2; }
message SourceLimits { uint32 max_frame_bytes = 1; uint32 max_batch_items = 2; }
message SourceOpen {
  string request_id = 1; string session_id = 2; string generation = 3;
  string connection_id = 4; string provider = 5; string authority = 6;
  string type = 7; QueryScope scope = 8; RepresentationBinding representation = 9;
  string mode = 10; oneof acquisition {
    EnumerateAcquisition enumerate = 11; NativeQueryAcquisition native_query = 12;
  }
  SourceLimits limits = 13;
}
message SourceBegin { string mode = 1; }
message SourceSnapshot { repeated SourceObservation observations = 1; }
message SourceSnapshotEnd { SourceCoverage coverage = 1; string continuity = 2; }
message SourceChanges { repeated SourceChange changes = 1; SourceCoverage coverage = 2; }
message SourceReset { string reason = 1; string message = 2; }
message SourceError { string code = 1; string message = 2; string request_id = 3; }
message SourceFrame {
  string session_id = 1; string generation = 2; string sequence = 3;
  oneof payload { SourceBegin begin = 4; SourceSnapshot snapshot = 5;
    SourceSnapshotEnd snapshot_end = 6; SourceChanges changes = 7;
    SourceReset reset = 8; SourceError failed = 9; }
}
```

`QueryScope` maps to the existing repeated `ScopeConstraint` proto and Go `QueryScope`, not a proto map. Each declared dimension occurs exactly once in normalized catalog order. `any` matches all values; `one_of` is a non-nil list of distinct values and an empty list matches nothing. Unknown/duplicate dimensions, absent selections, invalid exact address scopes and unresolved defaults fail. A Go `ScopeConstraint.Values` pointer distinguishes empty `oneOf` from `any`. Address scope is exact identity, not selection. Validate every observation/remove against admitted provider, authority, type and scope.

`RepresentationBinding.representationId` must match the admitted catalog representation. Schema reference is absent or the exact admitted document ID and revision; do not substitute the representation revision for the schema revision. Every observation repeats the binding. An incompatible change resets/replans. C05 owns how its catalog binds these identifiers; pending C05 freeze is not assumed approved.

`JsonDocument.encoding` is exactly `json`; `text` is valid UTF-8 JSON with no duplicate object keys, bounded nesting, and preserved number lexemes. Reject non-JSON, NaN/infinity and malformed or duplicate-key JSON. Never decode through protobuf `Struct`/float64. Native `format` equals P45 native-query descriptor `language`; `request.text` is the existing SDK `Value` JSON encoding, parsed using the existing lossless tagged `Value` codec, then admitted by `ValidateNativeQueryInput`. It is not arbitrary untyped CEL or a new native execution descriptor. The source adapter converts it to the existing P45 `NativeQueryRequest`; pagination remains internal to this acquisition. `enumerate` invokes P45 enumeration. Source JSON bodies and native query values are distinct encodings and validators.

`DocumentCoverage.kind` is `complete` or `partial`. Complete requires empty `knownAbsent`; partial allows zero or more typed paths. A member segment includes its literal key, an index is a zero-based uint32; paths cannot be empty, duplicate, or simultaneously present and known absent. Absence not asserted by a partial document is unknown. `SourceCoverage.enumeration` is `exhausted`, `partial` or `unknown`; consistency is `pointInTime`, `bestEffort` or `unknown`. Limitations are bounded explanatory strings. Enumeration is relative to this exact acquisition and access context. C05/P45 `Coverage {kind, paths, reason}` uses limitation subtrees, not known-absent facts. No lossless conversion is claimed: pass both representations separately to catalog admission, or reject conservatively until C05/P13 define a compatible input. Never map known-absent paths to limitation paths.

`mode` is `snapshot` or `snapshotAndUpdates`; continuity is `notApplicable` for snapshot, `gapFree` or `bestEffort` for updates. `SourceChange` is exactly one upsert observation or remove address plus optional opaque tokens. A remove is acquisition-membership removal, not necessarily object deletion. An incarnation-qualified remove cannot delete a known different incarnation. A batch is applied atomically in order. Duplicate snapshot addresses replace earlier staged observations without implying provider recency. Coverage-only changes may have zero operations but must supply coverage; empty no-information batches are invalid.

Host creates opaque nonempty requestId, sessionId and generation; a fresh attempt always gets a fresh generation, even if sessionId remains. Provider echoes sessionId and generation exactly. `sourceRevision` and incarnation are optional provider-issued opaque strings; never compare revisions as numbers, timestamps or lexicographic order, and never use them as host generations, portable resume tokens or proof of freshness. Sequence is canonical unsigned decimal text in `[1,18446744073709551615]`, no sign, whitespace or leading zeros; it begins at `1`, advances exactly one for every frame and never wraps. Validate before arithmetic. `JsonDocument.text` retains int64/uint64 numeric lexemes; any TS diagnostics preserve decimal strings and never use JS `number` for those values.

## State machine and errors

| State | Input | Result |
| --- | --- | --- |
| Opening | admitted begin, sequence 1, matching mode/binding | Snapshotting |
| Opening | admission failure before begin | terminal RPC error |
| Snapshotting | snapshot | Snapshotting; stage atomically |
| Snapshotting | snapshotEnd, snapshot, notApplicable | Finished; successful terminal |
| Snapshotting | snapshotEnd, snapshotAndUpdates, gapFree/bestEffort | Following |
| Following | changes or coverage progress | Following; atomically apply |
| Snapshotting or Following | reset | ResetRequired, terminal |
| Opening, Snapshotting or Following | failed | Failed, terminal; before begin use RPC error instead |
| Any active state | cancellation/deadline | Closed, terminal local cancellation |
| Finished, ResetRequired, Failed or Closed | any subsequent frame | reject as late; never mutate current state |

Every other state/payload combination, invalid binding, malformed frame, noncanonical sequence, duplicate, gap, mismatch, sequence overflow, or unexpected EOF invalidates the generation. EOF only after snapshot-mode snapshotEnd is normal. Receiver may stop immediately after that boundary; it must not wait indefinitely for EOF. A stream close after updates snapshotEnd is unexpected unless locally cancelled. Reset reasons are `continuityLost`, `overflow`, `bindingChanged`, `sourceInvalidated`; reset has a bounded sanitized message. Explicit reset is best effort: transport closure or local validation must produce the same invalidation without relying on delivery of a reset frame. A changed guarantee or lost coverage that invalidates admission resets; no silent promotion or downgrade.

SourceError codes: `invalid`, `unsupported`, `denied`, `unavailable`, `limit`, `internal`; requestId must match open. Map existing `INVALID_REQUEST`→`invalid`, `UNSUPPORTED`→`unsupported`, `FORBIDDEN`/authorization denial→`denied`, transport/unavailable→`unavailable`, resource exhaustion→`limit`, all other sanitized failures→`internal`. Cancellation/deadline is a separate local terminal outcome, not `internal`. Pre-begin rejection uses equivalent existing gRPC status and SDK `ResourceOperationError`; after begin use `failed` if deliverable, otherwise close with status. Never expose credentials or raw provider errors. Invalid framing/phase triggers local invalidation rather than trusting a peer error. Release all reservations and reject late callbacks on every terminal path.

## Negotiation, resource bounds and cancellation

Add feature trait `sourceSessionsV1` to the existing `FeatureSet` negotiation, detected only from an actual installed session provider and advertised by the transport. Check the trait and the qualified catalog operation/selection and representation independently. A plugin whose SDK lacks the trait is explicitly `unsupported` for both session modes; no fabricated snapshot, advisory watch stitching or silent downgrade. P45 standalone Get/mutation/action and other unaffected finite API operations remain available. Updates mode requires a declared supported update capability and real provider session implementation; snapshot-only providers must reject updates, not quietly return snapshot. Exact capability, adapter guarantee and native descriptor validation remain catalog-bound.

All limits apply per generation and are checked before retaining/allocating the corresponding untrusted data. Defaults and hard ceilings are identical initially: uncompressed serialized protobuf `SourceFrame` 4 MiB; batch 256 observations or changes; pending data 8 MiB and 512 items, counting both queued and in-flight serialized bytes and observations/operations; snapshot staging 64 MiB and 30,000 observations, accounting owned serialized body plus envelope and indexes. P12 may choose a lower configured staging budget; these are hard maximums, not a completeness promise. SourceOpen requests positive `maxFrameBytes` and `maxBatchItems` no larger than these ceilings; provider must obey the smaller requested limits. Zero, overflow or above-cap values fail admission. Bound SourceOpen to 256 KiB, including native request and all text; bound individual text fields to 64 KiB except JSON text, which is bounded by frame/open limits; limit nesting to 64 and paths/limitations to 256 per message. Count all batches before materializing their repeated elements and reject atomically if oversized. Reserve against byte/item/staging budgets before copy, decode allocation, enqueue or stage; include in-flight entries until released. A single observation larger than available frame or staging budget fails `limit` rather than truncating. Retained read-model memory is separately bounded by P12, not hidden in the staging allowance.

For gRPC enforce both compressed wire-message and decompressed-message ceilings before protobuf materialization: compressed message ≤ 4 MiB and uncompressed frame ≤ negotiated maxFrameBytes, with a bounded streaming decompressor that stops at limit + 1 output byte. Disable compression if the actual gRPC stack cannot enforce the decompressed bound before allocation. Reject oversized announced lengths before allocation; apply raw protobuf scan with bounded recursion and field/item counts before generated decoding, rejecting unknown fields, duplicate singular fields, repeated oneof selections and malformed lengths. A receive-side negotiated limit smaller than the transport ceiling is enforced by that scan. The producer also enforces its own startup/native buffers under the same pending byte/item ceilings; if it cannot pause without loss, reset/close instead of dropping. No decompression ratio or declared length is trusted as a substitute for an output cap.

Data queue and terminal control are independent: cancellation, fatal status and stream closure use the RPC context/transport, never an item enqueued behind data. A terminal frame is opportunistic; the receiver synthesizes local reset/failure on close. Stop accepting work immediately on cancel/overflow. Open admission and first begin have a 30-second deadline; an individual blocked send/receive or shutdown drain has a 5-second deadline. On timeout cancel the RPC and release host reservations, queues, staging and interests immediately; provider must cancel its native work and close its handle within 5 seconds. A noncooperative remote process cannot be forced to release its own memory; detach it from host state, close the transport and mark the provider unhealthy. Long-lived idle following streams are not cancelled merely for no events: the 5-second bound applies only to blocked actual operations. A pending open cancelled before callback completion must release its reservation; a late callback/decoded frame is discarded and its transport closed. No unbounded retry, heartbeat, ack protocol or mandatory poller is introduced.

## Source guarantees and recovery

`gapFree` requires adapter evidence that its initial enumeration and subsequent native updates form a coherent handoff without silent loss or known stale overwrite. Frame sequence only detects loss in this transport. An adapter without such evidence declares `bestEffort` and records limitations; it must not claim point-in-time merely from exhaustion. Revisions are opaque. Snapshot-only source freshness is the time of its last successful explicit acquisition, not a live guarantee; refresh creates a new generation. Partial/unknown replacement preserves unseen prior members only as separately stale with their original provenance. Only an exhausted validated replacement can retire unseen members within that exact selection. Reset invalidates dependent results; result lease recovery is independently generated and must not reopen the source merely because one result consumer is slow. Cancellation of one interest does not end a source with remaining compatible interests. Sharing requires equal compatible selection/native request, access context, representation/schema and guarantees; no cross-principal body sharing.

## Cutover and behavior-sized PRs

Remove SDK `ResourceUpdates` RPCs and update message transport, `ListenForEvents`, `WatchEventSink`, `StartConnectionWatch`, `StopConnectionWatch`, `EnsureResourceWatch`, `StopResourceWatch`, `RestartResourceWatch`, `HasWatch`, `IsResourceWatchRunning`, `GetWatchState` and advisory watch registration/feature once callers migrate. Replace acquisition with `SourceSessions.Open`, context cancellation and source-interest state; replace any retained status UI with honest session/interest status, not invented watch guarantees. Preserve native clients/informers as provider internals. Remove host Wails `SubscribeResource`, `UnsubscribeResource`, `StartConnectionWatch`, `StopConnectionWatch`, `EnsureResourceWatch`, `StopResourceWatch`, `RestartResourceWatch`, `IsResourceWatchRunning`, `HasWatch`, `GetWatchState` and callers where present; source lifecycle becomes host interest acquisition/release. Remove `pluginID/connection/type/ADD|UPDATE|DELETE` event emission/listeners, replaced by internal validated source frames and ultimately C08 result lease events. Regenerate Wails bindings; runtime callers move to a minimal real session-backed mechanism until P15 replaces it, not a legacy API shim. P10 migrates Kubernetes; Proxmox/Flux backends retain pinned SDK and receive explicit unsupported behavior for sessions. Inventory all actual symbols/callers at implementation; this list is a minimum, not permission to retain an unlisted old path.

After explicit C04 approval, use pinned candidate branches and independent review before expensive CI. Each slice is real behavior and executable at its boundary; no empty DTO-only or stub PR:

1. **SDK finite source transport and codec** (SDK owner): real negotiated gRPC snapshot acquisition over P45 enumeration/native-query pages, validation and bounds. Acceptance: real child-process finite empty/paginated runs, explicit snapshotEnd/EOF, invalid/oversized rejection and cancellation. Existing unrelated operations continue.
2. **SDK update sessions and conformance** (SDK source owner, stacked on slice 1): real native handoff and following changes, bounded queues/control. Acceptance: P44 event profile proves supported guarantee, gap/duplicate/overflow/late frame and stalled cancellation; unsupported legacy SDK is rejected.
3. **Host source coordinator and runtime cutover** (host owner, pinned SDK slices 1–2): trusted admission, validated ingress, cancellation, existing registry/sink integration and removal of superseded host paths and runtime callers. Acceptance: real gRPC finite/event, isolation and shared interest, reset/reopen, teardown and no old listener events. Coordinate exact P12 ingress; avoid duplicating P12 staging ownership.
4. **Kubernetes adapter** (P10 owner, pinned SDK/host): shared informer demand, proven cutover or bestEffort, no duplicate initial ADD, native selectors and explicit capability errors. Acceptance: real adapter race/multiplicity and homelab cohort proof; its independent PR and required CI remain P10 gates.

The coordinator records exact candidate SHAs, cross-repo pins, independent review, required CI and user-only merge order. No implementation begins before user freeze. This publication alone is not user acceptance or packet completion.
