# C04 source-session wire contract

Status: proposed for independent review and explicit user freeze; not
approved or implemented. P05 owns this contract. Source semantics in
[the accepted source-session
contract](2026-10-17-source-session-contract.md) §§3–6 and 9 and P45
remain binding. The earlier source §3 described `JsonDocument` as a
proposed shape; later accepted [P01
§8.3](2026-10-24-resource-query-contracts.md) requires canonical
recursive tagged values preserving native scalar intent. This C04
proposal explicitly asks the user to reconcile and supersede the older
raw-JSON body shape with P45 tagged `Value`, preserving timestamp and
int64/uint64/double without inference. Host baseline
`ff593e5c580b95130ddbacccdde2720f2307079b`; SDK candidate
`0a5b64ed8c2de209fbb02ecce9feba3afd88f28c`. This is not evidence of
production conformance.

## What this contract does

A source session acquires observations for one admitted selection. The
host opens it, receives an initial snapshot and its boundary, and either
finishes or follows later changes. A finite snapshot uses existing P45
page calls. A live session needs a provider capable of the
snapshot-to-updates handoff.

P05 defines the validated transport and admission. P12 manages source
interests, staging and publication. P13 evaluates queries; P14 and P15
produce and consume result leases. A source generation identifies one
acquisition attempt. It is not a result generation and its sequence
never orders result frames.

A source frame has required session, generation, sequence and exactly
one payload. An observation requires an address, representation
reference, document and coverage. Incarnation, source revision and
display name are optional. The optional tokens are provider
observations, not permissions.

## Ownership and admission

The host resolves an access route and catalog-backed `ReadTarget` under
the trusted invocation principal, access epoch and catalog revision.
`connectionId` is a route, never a principal. It verifies representation
and schema binding, source selection and native-query capability before
opening. An SDK provider must independently enforce its catalog and
access checks. Neither source payload nor client-supplied identifiers
confer authorization. A bound session never changes route, principal,
access epoch, catalog revision, selection, representation or
acquisition; changes terminate it and require a newly admitted
generation. On access invalidation, discard protected data immediately.

P05 owns transport, validation and host admission `SourceBinder`; P12
alone owns the source coordinator, registry/sink integration,
source-interest lifetime, bounded staging, membership/provenance and
publication. The binder resolves an admitted `resourcev2.ReadTarget`
under the trusted invocation principal and access epoch into P12's
binding; it is not an alternate coordinator. P12 consumes immutable
`resourcev2.SourceOpen` and validated `resourcev2.SourceFrame`; it also
rejects stale tokens, sequences, phases and bindings itself. P12 issues
session and generation tokens as host coordinator. P13 owns evaluation.
P14 owns result generation and P15 its passive consumer. Source
generation/sequence are never result generation/sequence.

Finite acquisition uses only existing P45 `Enumerate`/`NativeQuery` RPC
pages. The host source adapter converts them into C04 frames, preserving
cursors, coverage, descriptors, error semantics and access admission,
and feeds the same validator, limits and P12 ingress. No second finite
List transport exists. `SourceSessions.Open` is used only for
snapshot-and-updates; the provider must establish and prove its native
cutover. Never stitch P45 pages to separately subscribed advisory
events. P45 Get/mutations/actions remain separate operations.

## Wire and domain mapping

Add `proto/resource/v2/source_session.proto`, package
`omniview.resource.v2`, Go package
`github.com/omniviewdev/plugin-sdk/proto/resource/v2;resourcepb`. Add
`service SourceSessions { rpc Open(SourceOpen) returns (stream
SourceFrame); }`; this RPC accepts only `snapshotAndUpdates`. One stream
is one generation. Go domain DTOs are in
`github.com/omniviewdev/plugin-sdk/pkg/resource/v2` as `SourceOpen`,
`SourceFrame`, `SourceObservation`, `SourceChange`,
`RepresentationBinding`, `DocumentCoverage`, `SourceCoverage` and nested
types; proto names correspond under `resourcepb`. `JsonDocument` is
deliberately removed from the wire: P45 tagged `Value` replaces it,
preserving timestamp, signed/unsigned integer and double kinds. The SDK
client/server converts and validates domain DTOs; host uses the same Go
domain types. P12's transport port is `SourceOpener.Open(ctx,
SourceOpen) (SourceStream, error)`, with `SourceStream.Recv(ctx)
(SourceFrame, error)` and `Close() error`; finite opens use host P45
paging, updates opens use the RPC. This stream is internal SDK↔host, not
a Wails surface. TS diagnostic mirrors use tagged SDK values and decimal
strings, never JS numbers for int64/uint64. C08 exclusively owns Wails
result DTOs.

The P12 transport port is shown below. The host binder admits the
selection under the invocation principal and access epoch before opening it.
The binder is not a second source coordinator.

```go
type SourceOpener interface {
    Open(
        context.Context,
        resourcev2.SourceOpen,
    ) (SourceStream, error)
}

type SourceStream interface {
    Recv(context.Context) (resourcev2.SourceFrame, error)
    Close() error
}
```

The following schema is normative; fields are proto3 field numbers, not
Go struct offsets. Required means semantically required even where
proto3 has no `required`. Existing `ResourceAddress`, `QueryScope`,
`Representation`, `Coverage` and `Value` come from `domain.proto`; their
existing raw-wire and semantic validation applies. JSON names follow
lowerCamelCase.

```proto
message RepresentationBinding {
  Representation representation = 1;
}
message RepresentationRef {
  string id = 1;
  string revision = 2;
  optional string schema_revision = 3;
}
message FieldPathMember {
  string name = 1;
}
message FieldPathIndex {
  uint32 index = 1;
}
message FieldPathSegment {
  oneof segment {
    FieldPathMember member = 1;
    FieldPathIndex index = 2;
  }
}
message DocumentFieldPath {
  repeated FieldPathSegment segments = 1;
}
message DocumentCoverage {
  repeated DocumentFieldPath known_absent = 1;
}
message SourceCoverage {
  string enumeration = 1;
  string consistency = 2;
  repeated string limitations = 3;
}
message SourceObservation {
  ResourceAddress address = 1;
  RepresentationRef representation = 2;
  Value document = 3;
  Coverage coverage = 4;
  optional string incarnation = 5;
  optional string source_revision = 6;
  optional string display_name = 7;
  DocumentCoverage document_coverage = 8;
}
message SourceChange {
  oneof change {
    SourceObservation upsert = 1;
    SourceRemove remove = 2;
  }
}
message SourceRemove {
  ResourceAddress address = 1;
  optional string incarnation = 2;
  optional string source_revision = 3;
}
message EnumerateAcquisition {
}
message NativeQueryAcquisition {
  string format = 1;
  Value request = 2;
}
message SourceLimits {
  uint32 max_frame_bytes = 1;
  uint32 max_batch_items = 2;
}
message SourceOpen {
  string request_id = 1;
  string session_id = 2;
  string generation = 3;
  string connection_id = 4;
  string provider = 5;
  string authority = 6;
  string type = 7;
  QueryScope scope = 8;
  RepresentationBinding representation = 9;
  string mode = 10;
  oneof acquisition {
    EnumerateAcquisition enumerate = 11;
    NativeQueryAcquisition native_query = 12;
  }
  SourceLimits limits = 13;
}
message SourceBegin {
  string mode = 1;
}
message SourceSnapshot {
  repeated SourceObservation observations = 1;
}
message SourceSnapshotEnd {
  SourceCoverage coverage = 1;
  string continuity = 2;
}
message SourceChanges {
  repeated SourceChange changes = 1;
  SourceCoverage coverage = 2;
}
message SourceReset {
  string reason = 1;
  string message = 2;
}
message SourceError {
  string code = 1;
  string message = 2;
  string request_id = 3;
}
message SourceFrame {
  string session_id = 1;
  string generation = 2;
  string sequence = 3;
  oneof payload {
    SourceBegin begin = 4;
    SourceSnapshot snapshot = 5;
    SourceSnapshotEnd snapshot_end = 6;
    SourceChanges changes = 7;
    SourceReset reset = 8;
    SourceError failed = 9;
  }
}
```

`QueryScope` maps to the existing repeated `ScopeConstraint` proto and
Go `QueryScope`, not a proto map. Each declared dimension occurs exactly
once in normalized catalog order. `any` matches all values; `one_of` is
a non-nil list of distinct values and an empty list matches nothing.
Unknown/duplicate dimensions, absent selections, invalid exact address
scopes and unresolved defaults fail. A Go `ScopeConstraint.Values`
pointer distinguishes empty `oneOf` from `any`. Address scope is exact
identity, not selection. Validate every observation/remove against
admitted provider, authority, type and scope.

`SourceOpen.representation` holds the exact admitted P45
`Representation`, including ID, representation revision and full
`SchemaBinding` state, revision, inline document or document reference,
once per generation. Each observation carries only `RepresentationRef`,
matching the binding's ID, representation revision and optional schema
revision exactly, including presence. The catalog revision and access
binding remain fixed for the generation; a mismatch is invalid and
triggers bindingChanged reset. The host P45 page adapter compares each
`Record.Representation` in full with the admitted binding transiently
before emitting its compact reference, never retaining per-record schema
copies. P12 retains only the reference per row; P13/C05 resolve schema
once per binding from the catalog. Any catalog or binding change
terminates and replans.

The SDK Go shapes use the existing `resourcev2.Representation`:

```go
type RepresentationBinding struct {
    Representation Representation `json:"representation"`
}

type RepresentationRef struct {
    ID             string  `json:"id"`
    Revision       string  `json:"revision"`
    SchemaRevision *string `json:"schemaRevision,omitempty"`
}
```

The TypeScript diagnostic mirror is:

```typescript
type RepresentationRef = {
  id: string;
  revision: string;
  schemaRevision?: string;
};
```

The compact reference never embeds schema bytes.

The body is existing tagged P45 `Value` with a map root, preserving
native timestamp and exact integer/double kinds without protobuf Struct
or an untyped JSON roundtrip. `JsonDocument` is not transported; this
intentionally revises the earlier accepted raw-JSON proposal and
requires explicit freeze approval. Native `format` equals P45 descriptor
`language`; `request` is its tagged `Value`, admitted by
`ValidateNativeQueryInput`, not arbitrary client code. Pagination
remains internal to finite acquisition.

`coverage` carries the original P45 per-record `Coverage` kind,
limitation paths and reason unchanged to C05 `Admit`; this preserves
useful scoped partial coverage. `documentCoverage.knownAbsent`
separately carries typed absence facts, never converted into limitation
paths. Member segments hold literal keys and indexes are zero-based
uint32; paths cannot be empty, duplicate, or simultaneously present and
known absent. Under partial or unknown coverage, unasserted absence is
unknown at or below a limitation path; empty limitation paths limit the
whole body. Elsewhere absence is known. P12/P13 retain these original
facts for presence/absence and evaluation; P13's coverage policy rejects
execution requiring unavailable facts. `SourceCoverage.enumeration` is
`exhausted`, `partial` or `unknown`; consistency is `pointInTime`,
`bestEffort` or `unknown`. Enumeration is relative to this exact
acquisition and access context.

`mode` is `snapshot` or `snapshotAndUpdates`; continuity is
`notApplicable` for snapshot, `gapFree` or `bestEffort` for updates.
`SourceChange` is exactly one upsert observation or remove address plus
optional opaque tokens. A remove is acquisition-membership removal, not
necessarily object deletion. An incarnation-qualified remove cannot
delete a known different incarnation. A batch is applied atomically in
order. Duplicate snapshot addresses replace earlier staged observations
without implying provider recency. Coverage-only changes may have zero
operations but must supply coverage; empty no-information batches are
invalid.

Host creates opaque nonempty requestId, sessionId and generation; a
fresh attempt always gets a fresh generation, even if sessionId remains.
Provider echoes sessionId and generation exactly. `sourceRevision` and
incarnation are optional provider-issued opaque strings; never compare
revisions as numbers, timestamps or lexicographic order, and never use
them as host generations, portable resume tokens or proof of freshness.
Sequence is canonical unsigned decimal text in
`[1,18446744073709551615]`, no sign, whitespace or leading zeros; it
begins at `1`, advances exactly one for every frame and never wraps.
Validate before arithmetic. Tagged Value's int64/uint64 remain decimal
strings in JSON/TS and never JS numbers.

## State machine and errors

- Opening: admitted begin, sequence 1, matching mode/binding.
  Snapshotting.
- Opening: admission failure before begin. terminal RPC error.
- Snapshotting: snapshot. Snapshotting; stage atomically.
- Snapshotting: snapshotEnd, snapshot, notApplicable. Finished;
  successful terminal.
- Snapshotting: snapshotEnd, snapshotAndUpdates, gapFree/bestEffort.
  Following.
- Following: changes or coverage progress. Following; atomically apply.
- Snapshotting or Following: reset. ResetRequired, terminal.
- Snapshotting or Following: failed. Failed, terminal; pre-begin failure
  uses RPC error, not a sequence-1 failed frame.
- Any active state: cancellation/deadline. Closed, terminal local
  cancellation.
- Finished, ResetRequired, Failed or Closed: any subsequent frame.
  reject as late; never mutate current state.

Every other state/payload combination, invalid binding, malformed frame,
noncanonical sequence, duplicate, gap, mismatch, sequence overflow, or
unexpected EOF invalidates the generation. EOF only after snapshot-mode
snapshotEnd is normal. Receiver may stop immediately after that
boundary; it must not wait indefinitely for EOF. A stream close after
updates snapshotEnd is unexpected unless locally cancelled. Reset
reasons are `continuityLost`, `overflow`, `bindingChanged`,
`sourceInvalidated`; reset has a bounded sanitized message. Explicit
reset is best effort: transport closure or local validation must produce
the same invalidation without relying on delivery of a reset frame. A
changed guarantee or lost coverage that invalidates admission resets; no
silent promotion or downgrade.

SourceError codes: `invalid`, `unsupported`, `denied`, `unavailable`,
`limit`, `internal`; requestId must match open. Map existing
`INVALID_REQUEST`→`invalid`, `UNSUPPORTED`→`unsupported`,
`FORBIDDEN`/authorization denial→`denied`,
transport/unavailable→`unavailable`, resource exhaustion→`limit`, all
other sanitized failures→`internal`. Cancellation/deadline is a separate
local terminal outcome, not `internal`. Pre-begin rejection uses
equivalent existing gRPC status and SDK `ResourceOperationError`; after
begin use `failed` if deliverable, otherwise close with status. Never
expose credentials or raw provider errors. Invalid framing/phase
triggers local invalidation rather than trusting a peer error. Release
all reservations and reject late callbacks on every terminal path.

## Negotiation, resource bounds and cancellation

Add feature trait `sourceSessionsV1` to the existing `FeatureSet`
negotiation, detected only from an actual installed session provider and
advertised by the transport. Check the trait and qualified catalog
operation/selection and representation independently. Old SDK providers
without the trait support snapshot when their P45 finite capability
permits; updates mode returns `unsupported`, never silently downgrades
or stitches advisory watches. Proxmox's existing 10-second polling is
removed: its supported snapshot becomes once plus explicit manual
refresh. Updates mode requires a declared supported update capability
and real provider session implementation. Exact capability, adapter
guarantee and native descriptor validation remain catalog-bound.

All limits apply per generation and are checked before
retaining/allocating corresponding untrusted data. Default and hard
ceilings: uncompressed serialized protobuf frame 4 MiB; batch 256
observations or changes; pending 8 MiB and 512 items including queued
and in-flight serialized bytes and operations. Snapshot staging defaults
to 128 MiB and 65,536 observations; configurable hard ceilings are 256
MiB and 65,536 observations, counting owned body, envelope and indexes.
P12 may configure lower limits; these limits do not promise
completeness. SourceOpen requests positive frame and batch limits no
larger than these ceilings. Bound SourceOpen to 256 KiB and individual
text fields to 64 KiB except tagged document values bounded by
frame/open limits; limit nesting to 64 and paths/limitations to 256 per
message. Count batches before materializing repeated elements; reserve
bytes/items/staging before copy, decode allocation, enqueue or stage.
Oversized observations fail `limit` rather than truncate. P12 retained
read-model memory is separately bounded.

For gRPC enforce both compressed wire-message and decompressed-message
ceilings before protobuf materialization: compressed message ≤ 4 MiB and
uncompressed frame ≤ negotiated maxFrameBytes, with a bounded streaming
decompressor that stops at limit + 1 output byte. Disable compression if
the actual gRPC stack cannot enforce the decompressed bound before
allocation. Reject oversized announced lengths before allocation; apply
raw protobuf scan with bounded recursion and field/item counts before
generated decoding, rejecting unknown fields, duplicate singular fields,
repeated oneof selections and malformed lengths. A receive-side
negotiated limit smaller than the transport ceiling is enforced by that
scan. The producer also enforces its own startup/native buffers under
the same pending byte/item ceilings; if it cannot pause without loss,
reset/close instead of dropping. No decompression ratio or declared
length is trusted as a substitute for an output cap.

Data queue and terminal control are independent: cancellation, fatal
status and stream closure use the RPC context/transport, never an item
enqueued behind data. A terminal frame is opportunistic; the receiver
synthesizes local reset/failure on close. Stop accepting work
immediately on cancel/overflow. Open admission and first begin have a
30-second deadline. A send blocked by flow control, partially received
frame, or shutdown drain has a 5-second deadline; a healthy wait between
complete frames is not a partially received frame. Snapshot progress has
a separate configurable deadline, default 5 minutes; following may
remain idle indefinitely. On timeout cancel the RPC and release host
reservations, queues, staging and interests immediately; provider must
cancel native work and close its handle within 5 seconds. A
noncooperative remote process cannot be forced to release its own
memory; detach it from host state, close the transport and mark the
provider unhealthy. Pending-open cancellation releases its reservation;
late callbacks/frames are discarded and their transport closed. No
unbounded retry, heartbeat, ack protocol or mandatory poller is
introduced.

## Source guarantees and recovery

`gapFree` requires adapter evidence that its initial enumeration and
subsequent native updates form a coherent handoff without silent loss or
known stale overwrite. Frame sequence only detects loss in this
transport. An adapter without such evidence declares `bestEffort` and
records limitations; it must not claim point-in-time merely from
exhaustion. Revisions are opaque. Snapshot-only source freshness is the
time of its last successful explicit acquisition, not a live guarantee;
refresh creates a new generation. Partial/unknown replacement preserves
unseen prior members only as separately stale with their original
provenance. Only an exhausted validated replacement can retire unseen
members within that exact selection. Reset invalidates dependent
results; result lease recovery is independently generated and must not
reopen the source merely because one result consumer is slow.
Cancellation of one interest does not end a source with remaining
compatible interests. Sharing requires equal compatible selection/native
request, access context, representation/schema and guarantees; no
cross-principal body sharing.

## Cutover and behavior-sized PRs

Remove SDK `ResourceUpdates` RPCs and update message transport,
`ListenForEvents`, `WatchEventSink`, `StartConnectionWatch`,
`StopConnectionWatch`, `EnsureResourceWatch`, `StopResourceWatch`,
`RestartResourceWatch`, `HasWatch`, `IsResourceWatchRunning`,
`GetWatchState` and advisory watch registration/feature once callers
migrate. Replace live acquisition with `SourceSessions.Open` and finite
acquisition with existing P45 pages through the P12 source coordinator.
P05 retains P45 host `Enumerate` only for currently unmigrated finite
callers; P15 owns removal of the public host `Enumerate` Wails entry
point and its last migrated callers, while the internal P45 page
transport remains. Replace status UI with honest session/interest
status. Preserve native clients/informers as provider internals. Remove
host Wails `SubscribeResource`, `UnsubscribeResource`,
`StartConnectionWatch`, `StopConnectionWatch`, `EnsureResourceWatch`,
`StopResourceWatch`, `RestartResourceWatch`, `IsResourceWatchRunning`,
`HasWatch`, `GetWatchState` and callers where present; source lifecycle
becomes host interest acquisition/release. Remove
`pluginID/connection/type/ADD|UPDATE|DELETE` events, replaced by
validated source frames and C08 result events. Regenerate bindings;
runtime callers move to a real session-backed mechanism until P15
replaces it, not a legacy shim. P10 migrates Kubernetes; Proxmox/Flux
backends retain pinned SDK, supporting finite acquisition where P45
capabilities exist but refusing updates. Inventory all actual
symbols/callers at implementation.

After explicit C04 approval, use pinned candidate branches and
independent review before expensive CI. Each slice is real behavior and
executable at its boundary; no empty DTO-only or stub PR:

1. **SDK live session transport and codec** (SDK owner): real negotiated
   gRPC snapshot-and-updates with bounded codec and cancellation.
   Acceptance: real child-process event sessions, invalid/oversized
   rejection and terminal cleanup; existing finite P45 operations
   continue.
2. **Host admission and finite adapter** (P05 host owner):
   `SourceBinder`, P45-page-to-frame adapter and shared validator via
   the P12 `SourceOpener` port. Acceptance: real child-process
   empty/paginated finite acquisitions, snapshotEnd, bounds and
   cancellation; old SDK finite capability works without a session
   trait.
3. **P12 coordinator and runtime cutover** (P12 coordinator owner,
   pinned P05 candidates): validated ingress, staging and registry/sink
   integration, source interests and removal of superseded host paths
   and runtime callers. Acceptance: real gRPC finite/event, isolation
   and shared interest, reset/reopen, teardown and no old listener
   events. P05 owns transport, never a parallel scheduler.
4. **Kubernetes adapter** (P10 owner, pinned SDK/host): shared informer
   demand, proven cutover or bestEffort, no duplicate initial ADD,
   native selectors and explicit capability errors. Acceptance: real
   adapter race/multiplicity and homelab cohort proof; its independent
   PR and required CI remain P10 gates.

The coordinator records exact candidate SHAs, cross-repo pins,
independent review, required CI and user-only merge order. No
implementation begins before user freeze. This publication alone is not
user acceptance or packet completion.

## Inline reference: existing P45 messages

These definitions are copied from the pinned P45 protocol. They are
existing messages, not new C04 types. Proto field numbers and oneof
selections are normative. Required semantic messages and selections must
be present; optional fields retain presence. Unknown fields, duplicate
singular fields and repeated oneof selections are rejected before
generated decoding. Repeated entries stay ordered; duplicate scope
dimensions and map keys are invalid.

```proto
message ScopeEntry {
  string dimension = 1;
  string value = 2;
}

message ResourceAddress {
  string provider = 1;
  string authority = 2;
  string type = 3;
  repeated ScopeEntry scope = 4;
  string id = 5;
}

message AccessRoute {
  string connection = 1;
}

message ResourceReference {
  ResourceAddress address = 1;
  optional string incarnation = 2;
}

message AnyScope {
}

message OneOfScope {
  repeated string values = 1;
}

message ScopeConstraint {
  string dimension = 1;
  oneof selection {
    AnyScope any = 2;
    OneOfScope one_of = 3;
  }
}

message QueryScope {
  repeated ScopeConstraint constraints = 1;
}

message NullValue {
}

message TimestampValue {
  sint64 seconds = 1;
  uint32 nanos = 2;
}

message ListValue {
  repeated Value values = 1;
}

message MapValue {
  repeated ValueEntry entries = 1;
}

message ValueEntry {
  string key = 1;
  Value value = 2;
}

message Value {
  oneof selection {
    NullValue null_value = 1;
    bool bool_value = 2;
    string string_value = 3;
    sint64 int64_value = 4;
    uint64 uint64_value = 5;
    double double_value = 6;
    TimestampValue timestamp_value = 7;
    ListValue list_value = 8;
    MapValue map_value = 9;
  }
}

message SchemaDocumentReference {
  string id = 1;
  string revision = 2;
}

message SchemaDocument {
  SchemaDocumentReference reference = 1;
  string dialect = 2;
  bytes document = 3;
}

message SchemaBinding {
  string state = 1;
  optional string revision = 2;
  string dialect = 3;
  bytes document = 4;
  string validation = 5;
  repeated string unvalidated = 6;
  SchemaDocumentReference document_ref = 7;
  string root = 8;
  optional string unavailable_reason = 9;
}

message Representation {
  string id = 1;
  string revision = 2;
  SchemaBinding schema = 3;
}

message Dimension {
  string name = 1;
  bool allow_empty = 2;
}

message Coverage {
  string kind = 1;
  repeated string paths = 2;
  string reason = 3;
}

```

### How to read the existing values

A `ResourceAddress` uses an exact identity scope. Its `provider`,
`authority`, `type` and `id` are opaque strings. Each declared identity
dimension appears once; scope order does not affect identity. An
`AccessRoute` is a connection, not an identity or permission.
`ResourceReference.incarnation` is optional.

A `QueryScope` intersects constraints. Each declared query dimension
appears once. The `any` selection has no values; `one_of` has an
explicit list, where an empty list means no matches. Scope and selection
order are immaterial.

A `Representation` has an ID, revision and `SchemaBinding`. An available
schema has a revision, dialect and exactly one inline document or
document reference. An absent schema has no document binding. An
unavailable schema is not an absent schema and cannot carry an inline
document. The `root` is a local RFC6901 URI-fragment pointer; empty
selects the full schema. Validation is `full`, `reduced` or `none`; only
`reduced` has `unvalidated` constraints. The optional unavailable reason
is a reviewed error code, not diagnostic text.

A tagged `Value` chooses exactly one proto field. The corresponding SDK
JSON uses `kind` and, except for null, `value`. Kinds are `null`,
`bool`, `string`, `int64`, `uint64`, `double`, `timestamp`, `list` and
`map`. Integer JSON values are canonical decimal strings. Doubles are
finite and preserve negative zero. Timestamps are UTC RFC3339 with
nanosecond precision. A selected empty list or map is not null. The body
root is a map; native query input is the P45 tagged value required by
its descriptor. Protobuf timestamps use seconds and nanos as shown
above. Never infer native timestamp type from a string.

P45 `Coverage.kind` is `complete`, `partial` or `unknown`. Its `paths`
are RFC6901 limitation-subtree pointers and its `reason` explains
limitations. Empty paths with partial or unknown coverage limit the
entire body. Coverage and C04 typed `knownAbsent` paths are independent;
never convert one to the other. Source enumeration coverage is a
different fact again.

## Worked lifecycle examples

These are illustrative domain JSON, not a separate wire encoding. The
SDK maps tagged values to the protobuf messages above. The examples show
fields relevant to each frame; the open has already bound this exact
selection and representation. `sessionId` and `generation` are
host-issued strings.

A live source starts with `begin`, then one or more snapshot frames.
This snapshot includes an exact integer and a native timestamp:

```json
{
  "sessionId": "s1",
  "generation": "g1",
  "sequence": "2",
  "snapshot": {
    "observations": [
      {
        "address": {
          "provider": "example",
          "authority": "account-a",
          "type": "item",
          "scope": [],
          "id": "one"
        },
        "representation": {
          "id": "native",
          "revision": "r1"
        },
        "document": {
          "kind": "map",
          "value": {
            "count": {
              "kind": "int64",
              "value": "9007199254740993"
            },
            "created": {
              "kind": "timestamp",
              "value": "2026-11-02T00:00:00Z"
            }
          }
        },
        "coverage": {
          "kind": "complete",
          "paths": []
        },
        "documentCoverage": {
          "knownAbsent": []
        }
      }
    ]
  }
}
```

Expected outcome: the host validates and stages the observation; it does
not yet publish an exhausted snapshot. The integer and timestamp retain
their native kinds. A subsequent snapshot-end declares source coverage
and continuity. In snapshot mode that boundary completes the attempt; in
updates mode it enters following and later changes are permitted.

After the live snapshot-end, this frame removes one member from the
acquisition:

```json
{
  "sessionId": "s1",
  "generation": "g1",
  "sequence": "4",
  "changes": {
    "changes": [
      {
        "remove": {
          "address": {
            "provider": "example",
            "authority": "account-a",
            "type": "item",
            "scope": [],
            "id": "one"
          }
        }
      }
    ]
  }
}
```

Expected outcome: P12 removes that source membership atomically. This
does not prove that the infrastructure object was deleted. It does not
remove membership owned by another source. The example assumes the
boundary was sequence `3`.

A reset terminates this source generation:

```json
{
  "sessionId": "s1",
  "generation": "g1",
  "sequence": "5",
  "reset": {
    "reason": "continuityLost",
    "message": "source continuity lost"
  }
}
```

Expected outcome: the host invalidates `g1` and rejects late frames for
it. Any recovery uses a fresh source generation; dependent result
recovery has its own generation and sequence. A lost reset frame or
unexpected EOF still causes local invalidation; terminal delivery cannot
depend on a full data queue.
