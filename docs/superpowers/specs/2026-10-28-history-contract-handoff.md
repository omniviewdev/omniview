# Resource History: HR01 / HR03 / HR04 contract handoff

Date: 2026-10-28.
Status: **design-only proposal; not approved, implemented, or a public API freeze**.

This document supplies reviewable decisions for HC01, HC03–HC07. It does not authorize production ingestion, publish SDK messages, or replace the HR02 storage/privacy decision. Names and shapes below are proposed semantic messages, not available RPCs or generated bindings.

## 1. Inputs, authority, and readiness

Read from the original host checkout because these history documents were not yet copied into this workspace:

- `docs/roadmap/2026-10-27-historical-resource-context.md`, especially §§5–10.
- `docs/roadmap/2026-10-27-historical-resource-context-work-packages.md`, especially HC01–HC07 and HR01–HR12.

Canonical RI inputs in this host workspace:

- [P01 R2 query/domain proposal](2026-10-24-resource-query-contracts.md), §§1–3 and 6. R2 is unapproved. Its domain mapping is referenced, not duplicated here.
- [Source-session contract](2026-10-17-source-session-contract.md), §§1–3. Accepted lifecycle direction does not freeze transport or require every provider to support durable replay. Its older map-shaped identity examples do not override the canonical-domain owner.
- [C02 R4 trusted invocation/errors](2026-10-23-trusted-invocation-errors.md). Contract acceptance does not grant history-cache authorization or revocation tracking.
- Selected source: `backend/pkg/invocation/invocation.go:23–45,88–122` issues native principals and admits operations; generation `initial` explicitly does not implement revocation.
- Selected source: `backend/pkg/plugin/resource/registry/memory_store.go:32–59,104–130` replaces current entries and deletes membership. These are not append-only history or checkpoint transactions.

Current blocking evidence supplied by the integration owner: CEL v0.33.1 remains unsafe in comparison **and optimized membership**. C06/P01/P45 remain blocked. This document makes no safe numeric claim. No alternate evaluator, narrowed production predicate API, identity fork, or guessed history RPC is approved. Production predicate/profile admission requires the existing RI owner’s accepted dependency and implementation handoff.

### Proposed decisions and unresolved approval

| Area | Proposed decision | Required approval / remaining gate |
| --- | --- | --- |
| Canonical identity and values | Reference the single RI domain and lossless value adapters | P01/P45 canonical mapping/profile approval and usable boundary |
| Evidence identity | Host citation identity independent of native delivery and logical grouping | HC01 domain and storage review |
| Durability | Advance recovery only with corresponding durable evidence/rejections and qualified coverage | HC02 storage profile plus HC03 SDK/storage review |
| Coverage and cost | Qualified searched-as-of claims; host reservation before shared acquisition | HC04 security/scheduler review |
| Query and results | One host compiler and common result protocol, history domain profile only | P07/P13/P14/P15 usable handoffs and HC05 approval |
| Context and comparison | Versioned explicit scope; evidence-backed fidelity | HC06 runtime and HC07 diff review |

## 2. Ownership and mandatory service boundary

The host owns admission, authority resolution, access partitions, source/job ownership, approval, budgets, durable writes, checkpoint recovery, residual query execution, result ordering, coverage, payload authorization, comparison provenance, retention, and export policy. These are mandatory for every consumer, including custom plugin views.

The SDK owns the negotiated optional provider transport after approval. Providers describe native semantics, perform approved acquisition, and normalize source evidence. Replay/checkpoint/follow are separately declared capabilities, not requirements added to every live-resource provider.

The runtime supplies typed clients and bounded subscriptions. It does not evaluate predicates or retain an authoritative browser evidence store. UI controls consume prepared results.

Plugins may render an entire custom timeline, graph, dashboard, comparison, or investigation without registering a built-in renderer. A provider works without React. A custom view cannot bypass host scope, payload admission, or cost approval. Renderer failure falls back to generic read-only evidence; it does not change canonical structured results. Display ownership does not establish provider ownership or a distinct authenticated plugin principal under the current trusted-UI realm.

## 3. HR01 / HC01: identity and evidence

### 3.1 Three identities, no implicit collapse

1. **Evidence identity:** host-issued opaque persistent `evidenceId`, namespaced by persistent `storeId`. Citation resolves the retained source-record identity, not its current parser projection.
2. **Native delivery identity:** source instance/generation plus provider-declared native record key and key scheme. Opaque IDs retain exact bytes/encoding semantics. Native key availability and collision guarantees are capabilities.
3. **Logical grouping identity:** an optional typed correlation key and scope. Multiple records may belong to one request. Grouping never deletes stage evidence or cross-source records.

For Kubernetes, a logical request groups authority plus auditID; stage differentiates stage records. Stage alone is not guaranteed delivery uniqueness: adapters must declare repeated-stage behavior. Audit, authenticator, Event-series observations, and watched-state observations remain separate evidence even when correlated. Correlation carries basis and confidence; temporal proximity does not establish a definitive actor or causal transition.

Deduplication uses a validated stable native key inside its source namespace/generation. A repeated key with contradictory immutable content is a conflict: stop/quarantine and mark coverage partial, never overwrite cited evidence. Without stable keys, retain distinct deliveries and declare duplicate uncertainty. Content hashes may locate possible duplicates but must not collapse identical legitimate messages. Parser changes alone must not create new native-record identities.

### 3.2 Canonical resource references and authority

Use RI `ResourceReference`, `ResourceAddress`, `AccessRoute`, `QueryScope`, `RepresentationBinding`, typed values, and timestamp/value admission **by reference** to the owning canonical proposal and eventual accepted version. This document declares no competing Go/proto/TS identity DTO or canonical key algorithm.

`resourceRefs` is a bounded ordered list of `{reference: RI.ResourceReference, role, certainty, nativeLocator?}`. Zero references is valid for authentication failures, non-resource endpoints, collection requests, and unresolved objects. Multiple references do not duplicate an evidence row. Roles distinguish subject, related object, and collection context; a collection selector is not a fabricated object ID. Preserve original GVR/API version/subresource and unknown type information in source schema fields.

Canonical authority resolution is host-owned and does not require a currently live resource or type-catalog entry. An unresolved native locator stays unresolved until a justified mapping exists; no fabricated canonical type or UID. Opaque cloud IDs are not split by UI conventions. Incarnation absence means unknown, not any known UID. Name reuse and cluster recreation do not silently rekey old citations. Connection aliases, endpoints, credentials, and equal addresses do not prove shared authority or access. Unknown authority continuity remains isolated and explicit. Native revision is observation provenance, not identity or a portable ordering number.

### 3.3 Proposed feature envelope

The following is a semantic field inventory. `RI.*` denotes externally owned types, not new aliases to publish. Limits and concrete protobuf field numbers require HC01/HC11 review.

```text
EvidenceEnvelope {
  envelopeVersion, sourceSchema: {id, version},
  citation: {storeId, evidenceId},
  source: {sourceId, identityGeneration},
  acquisition: {jobId, accessPartitionRef, accessGeneration,
                configGeneration, parserVersion, redactionPolicyVersion},
  native: {keyScheme?, recordKey?, locator?, revision?, correlationKeys[]},
  authority: RI authority binding,
  resourceRefs: [{reference: RI.ResourceReference, role, certainty, nativeLocator?}],
  family, nativeOperation?, category?, outcome?,
  principals: {authenticated?, effective?, impersonator?, attributionBasis?},
  times: [{axis, instant: RI lossless timestamp, precision, basis}],
  summary?, extensions: schema-admitted bounded source fields,
  representations: [{kind, revision, state, format?, schema?, patchMediaType?,
                     payloadRef?, coverage?, reason?}],
  quality: {observationBasis, identityCertainty, attributionCertainty, limitations[]},
  lineage: [{relation, citation, basis, confidence?}]
}
```

Host fields are assigned after validation; provider-supplied citation/access labels are not trusted. Go uses the accepted canonical domain values, protobuf uses explicit reviewed transport conversions, and TS uses the accepted runtime domain facade. Integer counts/revisions that are numeric use the RI exact tagged/decimal encoding; native revision strings stay opaque. No JavaScript `number` conversion of large integers or nanosecond instants. Times distinguish event, request/stage, upstream ingestion, local observation, and durable commit. Unknown times are absent with a reason, not epoch zero. Native precision and translation uncertainty remain visible.

Authenticated/effective/impersonating identities are separate optional facts. Missing actor is valid. A cloud role/session identity is not automatically the human actor.

### 3.4 Representation and citation lifecycle

Representation state is one of `present`, `missing`, `notRecorded`, `redacted`, `truncated`, `expired`, `denied`, `unsupported`. These exact proposed serialized spellings apply across the architecture and handoff. Each representation is independently versioned and bounded. `present` requires an admitted payload reference, `format: {mediaType, encoding}`, and an explicit schema availability descriptor: `{state: known, ref}` or `{state: absent | unavailable | unsupported}`. A schema-less source remains valid without inventing a schema. The envelope's `sourceSchema` does not substitute for payload schema availability. Truncation records retained extent and unknown remainder. `missing` means expected but unavailable, not known absent. `denied` is request-relative and must not disclose protected existence. `notRecorded` is source policy knowledge. Unknown path coverage must not become null or false.

For recorded patches, `patchMediaType` preserves the native request patch media type only when known; absent means unknown, not a default patch algorithm. Payload `format.mediaType` such as JSON describes its stored encoding and does not establish JSON Patch, merge-patch, or strategic-merge semantics. Payload/snapshot resolution returns the representation's admitted format, schema availability, and patch metadata for its pinned revision. `SnapshotRef` identifies that stored representation; callers cannot override these facts through request fields. Unknown patch media type remains raw intent only.

Redaction occurs before summaries, text/structured indexes, correlation fields, payload persistence, diagnostics, and exports. Redacted paths remain unknown for evaluation and comparison. Raw-sensitive retention is disabled unless HC02 explicitly approves its storage/access/key policy. Credentials never enter evidence. Redacted evidence remains useful through permitted provenance and normalized metadata.

Citation `{storeId,evidenceId}` remains stable across parser and derived-index upgrades. A derived projection has its own parser/schema/index revision; a result can pin that revision when reproducibility requires it. Reparse does not redirect the citation to another source record. Stronger redaction can remove representation availability without reusing the identity; record policy lineage without retaining forbidden values. Source rebinding creates a new source identity generation, not a rewritten citation. Retention/purge produces an authorized unavailable outcome; tombstone retention itself follows privacy policy, not an unlimited promise. Imports get local citations plus origin/manifest lineage; origin IDs do not confer trust or globally deduplicate records. Frozen exports identify exact representation revisions and policy transformations.

### 3.5 Versioning and admission

Negotiate envelope major version before ingest. Unknown mandatory envelope versions fail `UNSUPPORTED` before checkpoint advancement. Unknown fields in strict canonical RI DTOs follow RI admission; do not silently relax their rejection policy. Extensible provider data belongs only in a declared, bounded source-schema extension container. Unknown optional extensions may be retained only under approved redaction and size policy; they are not implicitly searchable. Required unknown semantic fields reject. Source schema, parser, redaction policy, config, access, and derived-index versions remain independent.

Compatible optional additions do not redefine existing states or fields. Meaning changes require a new semantic/schema version and explicit migration/rebuild policy. Rebuild coverage is separate from acquisition coverage. Historical parser projections are not silently claimed equivalent after migration.

## 4. HR03 / HC03: acquisition and durable recovery

### 4.1 Proposed messages and bindings

```text
AcquisitionBinding {
  sourceId, sourceIdentityGeneration, authorityBinding,
  accessPartitionRef, accessGeneration, configGeneration,
  parserVersion, redactionPolicyVersion, sourceSchemaVersion,
  selectorFingerprint, representationSet, timeAxis, range: [start,end)
}
PlanProposal {
  binding, effectiveSelector, predicateRef, projection,
  strategy, pushdownProof, residualRequirements,
  expectedCoverage, estimate: {basis, confidence, dimensions, unknowns},
  limits, warnings
}
ApprovedPlan {
  planRef, proposalDigest, budgetOwnerRef, reservationPolicyRef,
  policyRevision, expiresAt
}
OpenRead { planRef, recoveryRef?, negotiatedLimits }
DataFrame {
  sessionId, generation, sequence: RI.UInt64Text,
  records[], checkpointCandidate?
}
CheckpointCandidate {
  throughSequence: RI.UInt64Text, recoveryState,
  nativeExpiry?, coverageDelta
}
Control {
  sessionId, generation, sequence: RI.UInt64Text,
  kind: progress | gap | reset | terminal,
  detail
}
Terminal {
  outcome: exhausted | cancelled | budgetStopped | failed | resetRequired,
  lastDeliveredSequence, committedPosition?, coverage, observedUsage, error?
}
```

Host creates session/generation and binds all messages to admitted work. A checkpoint candidate covers only its contiguous validated prefix. Opaque recovery state may contain native tokens but is encrypted/protected according to HC02, bounded, and never a client cursor. Control sequencing shares transport ordering for loss detection; concrete multiplexing and codec are HC03/HC11 approval items. The `committedPosition` field is host-populated status, not a provider claim of durability.

Discovery lists capabilities/configuration needs without scanning or mutating upstream infrastructure. A plan is non-executing. Opening revalidates authority/access/config/schema/selector/representation, expiry, policy, limits, and reservation. Unknown or changed recovery bindings reject or begin explicitly approved bounded replay. Tokens never transfer across access partitions or retargeted sources.

### 4.2 Four coordinates

| Coordinate | Meaning | Never substitutes for |
| --- | --- | --- |
| Native recovery position | File identity/offset, page token, scan window, provider replay key | Host durability or final sort |
| Provider session generation/sequence | Contiguous delivery within one attempt | Upstream completeness or commit |
| Durable commit position | Host persistent transaction watermark | Native event time or result cursor |
| Consumer result generation/sequence | Membership/order/window changes after execution | Provider sequence or recovery |

Reset fences old acquisition generations and records a gap; it does not erase committed evidence. Evidence appends, explicit lineage, and retention/purge are separate from current-resource replacement snapshots and removal events. A relist cannot delete evidence or prove all missed transitions were recovered.

### 4.3 Actual transaction contract required from HR06

For a validated contiguous batch prefix, one real durable transaction must:

1. Verify current source/access/config/session fence and expected previous commit position.
2. Insert evidence idempotently and validate native-key conflicts.
3. Store admitted representation bytes/references, refs, provenance, and required derived indexes, or explicit versioned deferred-index coverage.
4. Persist durable rejection records only where the approved skip policy permits them.
5. Persist qualified coverage, measured usage ledger updates, and recovery/checkpoint state for exactly that prefix.
6. Commit under the approved storage durability profile before publishing committed progress or an acknowledgement.

No checkpoint may precede the evidence or rejection accounting it covers. External blob storage needs an approved atomic/recoverable staging protocol before this promise can be made; an in-memory queue flush is insufficient. Index failure rolls back the batch unless an explicitly admitted deferred-index state is transactional and query-visible as unavailable. Serialization/recovery must not silently create an empty store on corruption.

Crash before commit replays the prior checkpoint. Crash after commit but before response may replay; stable-key idempotence returns the same citation. Store corruption, disk-full, and fence conflicts stop advancement. Commit success does not establish upstream completeness.

Default recovery decision: reopen idempotently from committed state without a provider ACK. A provider requiring acknowledgement to release native retention must negotiate a feature-specific post-commit ACK carrying the committed prefix and idempotency key. ACK loss permits retransmission; ACK cannot precede durable commit. Providers lacking safe replay expose that limitation and a gap on restart, not invented durability. This does not modify generic source sessions.

### 4.4 State transitions and bounds

Job lifecycle:

```text
proposed -> approved -> reserved -> opening -> reading -> draining -> terminal
opening/reading -> cancelling -> draining -> terminal(cancelled)
opening/reading -> paused(resource/access/recovery issue)
paused -> approved revalidation -> reserved -> opening(new generation)
any nonterminal -> draining -> terminal(failed | budgetStopped | resetRequired)
```

Resume always revalidates and may require a new plan. Terminal is immutable for that attempt. Finite exhaustion and follow termination differ: follow EOF is not successful exhaustion unless the finite contract explicitly ends there. No implicit infinite retries; retry count, backoff, deadline, replay extent, and reconciliation work consume approved limits.

Before open, negotiate finite maxima for encoded frame bytes, record count, individual record/payload bytes, decoded depth/cardinality, in-flight frames/bytes, writer queue, control bytes, startup/runtime/idle deadlines, and retry/replay work. Host ceilings dominate provider claims. Exact production numbers remain blocked on HR02/HR05 measured review; absence of approved positive bounds blocks production open. Validate encoded and decoded sizes before unbounded allocation or decompression. Lazy payload reads have independent output/decompression limits.

Reserve a separate bounded control path and retained terminal slot so data saturation cannot hide failure/cancellation. A control path also has limits: coalesce progress, never unbounded enqueue. Terminal attachment/reconciliation follows the common lifecycle owner’s approved pattern, not a new history result lease. Stop data on slow-writer pressure; if lossless pause is impossible, terminate with a gap/partial coverage. Final-subscriber release cancels view-owned work; explicit background-rule ownership may keep it alive. Pending-open cancellation releases reservations even when native establishment races. Cancellation cannot undo upstream charges.

### 4.5 Required failure policy

| Situation | Proposed behavior |
| --- | --- |
| Empty cloud page with continuation | Continue within bounded plan; not exhausted |
| Expired page token | Bounded approved replay from durable window/native-key state, or explicit reset-required gap |
| Partial trailing file line | Retain bounded pending bytes; do not commit offset beyond last complete accepted/rejected line |
| Malformed complete record | Default stop before record; optional explicit durable rejection plus partial coverage policy |
| Oversized record/payload | Stop before advancement; optional source-proven bounded discard/rejection only under approved partial policy |
| Unsupported envelope/schema | Stop; typed unsupported; no success checkpoint through it |
| Out-of-order/missing frame | Fence session; discard uncommitted suffix; restart/replay or expose gap |
| File rotation/copytruncate | Track native file identity; reopen/rotate with explicit continuity proof or gap |
| Disk full/write/index error | Roll back, pause/fail visibly, preserve previous checkpoint |
| Access/config/authority changes | Fence old generation, stop sharing, reauthorize; never transplant recovery state |
| Unexpected follow EOF/transport loss | Failed/interrupted continuity; bounded recovery, not exhausted |
| Provider termination with uncommitted data | Drain only validated allowed prefix; terminal reports actual committed position |

A rejection record contains safe locator/hash, reason, extent, policy version, and coverage effect, not an unredacted rejected payload. It acknowledges known loss only as partial, never complete success. If record boundaries cannot be established, stop rather than guess a safe skip.

## 5. HR03 / HC04: coverage, late arrivals, and cost

Coverage is qualified evidence about acquisition, not a Boolean completeness flag.

```text
CoverageSegment {
  binding: AcquisitionBinding,
  interval: [start,end),
  state: notRequested | queued | reading | searchedAsOf | partial |
         denied | sourceDisabled | retentionExpired | sampled | gap | failed,
  enumeration: exhausted | partial | unknown,
  consistency: sourceDeclaredGuarantee,
  observedAt, nativeRetentionKnowledge,
  representationCoverage, rejectionCount, limitations[],
  lateArrival: {policyRef, reconciliationBounds, uncertainty},
  commitPosition
}
```

Partition comparisons include authority, source generation, access/config, selector, family, time axis, representations, and relevant policy/parser semantics. A resource-scoped scan cannot satisfy cluster scope. Missing bodies cannot satisfy payload text. Denied fields cannot prove negative predicates. Redacted values cannot prove equality or inequality. Access changes invalidate incompatible reuse without deleting retained evidence automatically.

Union coverage combines only proven-compatible segments. Keep holes, partial regions, sampled intervals, and per-source limitations. Overlap does not add completeness. Intersection/containment requires explicit selector proof. Initial sharing supports exact compatible requests and independently proved interval containment, not general CEL implication. Counts/facets/histograms carry separate coverage and exact/estimated/unknown state; page length is not a total.

`searchedAsOf` means the selected backend search exhausted its declared finite pages for that selector at that observation time. It does not mean all historical events have arrived. Record upstream ingestion and local observation separately. Late arrivals behind the latest event timestamp remain possible. Reconciliation scans bounded overlapping windows and creates new evidence/coverage revisions; no fixed overlap proves permanent completeness for best-effort delivery. Frozen query generations do not mutate when late data arrives. Live generations announce new rows/reset through the common result protocol.

Approved plan binding includes effective source/access/config generation, authority, time axis/range, selector/predicate and profile/declarations/bindings digest, representation/projection, strategy, estimate basis, limits, policy, budget owner, and expiry. An opaque plan reference is not authority. Any broadened scope or material change requires new approval. Host policy determines whether equivalent narrower work can reuse a plan; UI guesses cannot.

Reserve multi-dimensional budgets atomically before concurrent opens. Track requests, runtime, returned/processed bytes, local disk/output/CPU, and backend billable dimensions when observable. Reserve unknown-cost work only under explicit conservative limits/approval, not a fabricated zero estimate. Charge measured acquisition once to its owner ledger; subscriber attachment does not duplicate spend. Settle/release unused reservation on terminal and pending-open cancellation. Crash recovery reconciles reservation/usage without double charging. Cached reads avoid remote-acquisition charges but still consume local policy limits. Cancellation controls future work best-effort, not a hard cloud billing cap.

Coverage, actor names, source names, counts, job diagnostics, and cost metadata require authorization too. No successful empty result masks a denied target. Mixed-target denial follows the common RI host policy; `allowPartial` never overrides denial.

## 6. HR04 / HC05: query domain and results

### 6.1 Proposed feature request mapping

```text
HistorySelection {
  version: "omniview.history-selection.v1" [proposed],
  scopeRef, sources, families,
  time: {axis, start, end},
  target: evidence | changes | distinctResources,
  query: RI.QuerySpec using reviewed history domain profile,
  acquisition: localOnly | previewPlan | approvedPlan(planRef),
  consistency: frozen | live,
  requestedCoverage
}
```

This is a feature composition proposal, not permission to wrap and narrow the unapproved R2 public API. HC05 must resolve the exact embedding/target mapping with P13 before publishing Go/proto/TS definitions. RI owns predicates, typed bindings, field paths, projection/order, errors, and result leases. The history domain supplies schema, acquisition target, row identity, and coverage. No second compiler or implicit evaluator exists.

Proposed checked bindings for review are `evidence` for normalized evidence and `change` for a structured change row; explicit declared parameters retain RI rules. Resource references are a list under evidence, not an implicitly singular `resource`. Multi-reference predicates use explicit quantification over that list. An empty list makes `exists` false and `all` vacuously true under native CEL; no automatic subject is injected. Distinct-resource rows are derived memberships with matching evidence provenance, not a second inferred body binding. The common compiler owner must approve exact roots, schemas, reserved identifiers, resource-target compatibility, and unknown-field admission. Until then these are not executable profile names or frozen bindings.

Historical labels come only from recorded admitted representations. Current-label enrichment is separately requested and authorized, time-labeled, and cannot satisfy historical predicates. Zero-reference evidence is searchable from non-resource contexts. Resource-focused selection matches explicitly qualifying references; unresolved identities remain discoverable through allowed source/native fields without fabricated canonical identity.

### 6.2 Text and field availability

Retain RI case-sensitive substring semantics over explicit admitted string fields with ANY combination, ANDed with predicate/scope. No implicit full-body or all-fields text search. Known absent/null strings do not match. Unavailable/redacted/truncated requested fields require hydration through an approved plan or an explicit coverage/unsupported outcome before evaluation; an earlier matching field cannot hide unavailable coverage.

Token/phrase full-text is a distinct proposed versioned operator with its own analyzer, Unicode, case, tokenizer, phrase and rebuild semantics. It is not `QuerySpec.text` reinterpreted as FTS MATCH. HC05 must approve its syntax/profile and measured index behavior before exposure. FTS candidates for substring must be proved a safe superset; otherwise use an approved bounded accelerator/scan or report unsupported. Backend pushdown never drops possible residual matches, changes mixed numeric semantics, or treats provider page limits as final query limits.

### 6.3 Row identity, generations, and paging

- Evidence rows key by target membership plus citation, retaining per-source provenance.
- Change rows key by target membership plus comparison/projection revision and stable structured-change identity, referencing source evidence.
- Distinct-resource rows key by target membership plus canonical reference/incarnation under reviewed RI identity rules. Unknown incarnation does not merge proven different incarnations. Matching evidence links remain available.

Default proposed timeline order is selected time axis plus citation as a deterministic tie-breaker; missing-time policy must be explicit. Order semantics and exact typed comparisons remain RI-owned. Host keyset continuation binds effective query/profile/bindings, target memberships, schema/index revisions, access, time range, order, frozen generation, and expiry. It is never a native token or timestamp alone.

Frozen generations pin an admitted durable cutoff plus stable projection/membership/order state. Retention, access revocation, or expired retained generation returns explicit expiry/reset/denial; it must not silently resume against new data. Live membership uses common result generation/sequence/reset semantics. Result progress and acquisition-job progress remain independent. P14/P15 own actual frame/lease wire and bounded delivery; this document creates no shadow protocol.

Aggregate counts name their unit: retained evidence, explicitly grouped logical requests, structured changes, or distinct resources. Cross-source correlated rows are not automatically deduplicated operations. Histogram buckets specify time axis, UTC boundaries, display timezone policy, count unit, and coverage. Exact totals require admitted whole-range coverage, not a loaded page. Preserve lossless timestamps and decimal counts through runtime/UI roundtrip, including timezone/DST conversions.

## 7. HR04 / HC06: versioned contexts and pivots

```text
HistoryContext {
  version: "omniview.history-context.v1" [proposed],
  contextId, revision,
  scope: resource(RI.ResourceReference) |
         resourceSet(RI.ResourceReference[]) |
         authority(scopeRef) | plugin(scopeRef) | global(explicitTargets),
  time: absolute(axis,start,end) | relative(axis,duration,anchorPolicy),
  selectedEvidence: citation[],
  budgetPolicyRef,
  queryDocumentRef?, comparisonRefs?
}
PivotIntent {
  fromContextId, expectedRevision, nextScope, nextTime?,
  preserveEvidence: citation[], approvalRef?
}
```

Namespace/cluster scope uses canonical admitted authority/query dimensions, not a hard-coded namespace identity model. Graph selection creates an explicit bounded resource set; current edges do not establish historical topology. Plugin/global scopes resolve explicit authorized targets in the host, never implicit all-connections scans.

Context is a versioned navigation/query document, not authority, result lease, or job. Host resolves supplied scope and reauthorizes each operation. Resource, resource set, graph, namespace/cluster, plugin, and global clients use the same services without mounting a built-in view.

`budgetPolicyRef` selects an existing host-resolved acquisition policy; it is neither a reservation nor approval nor a permission grant. The host rejects unknown, expired or inaccessible policy references. A policy/context change invalidates incompatible plans and requires revalidation; saved/imported contexts cannot silently fall back to a broader policy.

Pivot transition: validate expected revision; resolve/admit new scope; retain selected citations and time intent; invalidate incompatible results/plans; cancel only superseded consumer interest; publish a new context revision. Broader scope requires explicit user intent and new approved acquisition plan. Failure leaves the previous admitted context intact. Stale async responses must match context revision plus result/request identity before application. A retained citation outside the new scope stays an explicit selection, not permission to disclose it.

Deleted/historical-only references open identity-only read views without current Get. Live enrichment/edit actions are separate admitted operations and never target a historical snapshot as if current. Saved absolute ranges preserve exact bounds. Saved relative ranges preserve duration/anchor policy and resolve to a visible absolute interval on open; saving must not silently freeze or reevaluate time. Context closure releases owned view subscriptions, not another view’s interest or explicit background rules. Pins/export persistence remains HC10 ownership, not implied by saving context.

## 8. HR04 / HC07: comparison and fidelity

```text
CompareRequest {
  left: snapshotRef | knownEmpty(create),
  right: snapshotRef | knownEmpty(delete),
  mode: observedDifference | requestedChange | verifiedTransition,
  normalizationPolicyRef?, schemaRevision?, limits
}
SnapshotRef { citation, representationKind, representationRevision, path? }
CompareResult {
  state: available | unavailable,
  mode, fidelity, sources[], schemaRevision?, normalizationPolicyRef?,
  changes[], unknownPaths[], warnings[], unavailableReason?
}
```

Requested-change mode resolves a recorded request/patch reference; the exact discriminated request mapping needs HC07 review rather than accepting meaningless left/right combinations. Admission rejects mismatched modes and missing required provenance. Payload resolution is lazy, bounded, representation-specific, and reauthorized; missing/redacted/expired/denied are not empty objects.

Observed difference compares two actual snapshots and states that intermediate changes may be unknown. Requested change shows intent, including failed or dry-run requests; it does not claim persistence. Verified transition requires defensible before/after linkage, not temporal adjacency or successful response alone. A response may establish after-state without immediate before-state. Unknown patch media type permits raw intent only; do not guess JSON Patch/merge/strategic semantics or replay on an arbitrary baseline.

Known-empty create/delete sides require evidence establishing that semantic boundary. Missing bodies never synthesize a deleted object or empty side. Redacted paths are unknown, not equal. List order stays meaningful unless an admitted schema explicitly declares keyed/set matching. Schema matching, ignored-field display policy, and renderer versions remain explicit provenance. Normalization never deletes retained source evidence. Structured paths and typed before/after values distinguish known absence, null, value, and unavailable under the shared value/coverage model.

A structured-change predicate requiring an old value cannot match an unknown old value. “Requested field touched,” “observed field differs,” and “verified value transition” are distinct searchable concepts and fidelity labels. Host structured comparison remains canonical. Plugins may add native display or reviewed schema-aware matching, not overwrite evidence meaning.

## 9. Review receipt required before implementation handoff

Contract review must produce explicit accepted/rejected/amended outcomes, owning reviewers, exact input revisions, and remaining gates. A list of proposed DTO names is not an acceptance receipt.

- **HC01 / HR01:** RI/domain and SDK reviewers approve canonical-reference reuse, no duplicate domain, native-key conflict behavior, stable citations, zero/multi-reference semantics, unknown authority/incarnation, principals, exact values/time, envelope evolution, and representation lineage. Cover CRDs/deleted types, opaque IDs, cluster/resource recreation, multiple stages, and cross-source non-deduplication.
- **HC02 prerequisite:** storage/security reviewers approve retained classes, redaction, access partitions/offline revocation, encryption/key lifecycle, supported driver/platform profile, crash/corruption/migration behavior, purge/tombstone limits, and blob atomicity. No raw-sensitive ingest before this receipt.
- **HC03 / HR03:** SDK/storage reviewers approve concrete wire mapping, replay versus optional ACK, contiguous-prefix transaction contract, fenced generations, bounded data/control/terminal path, and every failure policy. Required traces include crash before/after commit, empty continuation, token expiry, partial file line, malformed/oversized record, reset/out-of-order frame, access/config replacement, and cancellation while opening.
- **HC04 / HR03:** scheduler/security reviewers approve coverage qualification/algebra, searched-as-of and late-arrival meaning, selector-sharing proof, approval binding, atomic reservations/settlement/recovery, and final-subscriber/background ownership. Include concurrent budget races and authorized metadata disclosure.
- **HC05 / HR04:** RI compiler/results reviewers approve target/root schemas and quantification, text distinction, payload admission, count units, exact values, stable frozen paging, live generation/reset, and aggregate coverage. C06 safe numeric/profile and P13/P14/P15 usable outputs remain blocking; no production fallback.
- **HC06 / HR04:** runtime/navigation reviewers approve versioned context/pivot mapping, explicit widening, historical-only navigation, absolute/relative saved time, cancellation, stale-response fencing, and direct custom-view access without renderer registration.
- **HC07 / HR04:** diff reviewers approve discriminated snapshot/patch requests, fidelity proof, known-empty sides, redaction/unknown paths, patch/list semantics, structured-change identity, and native-renderer fallback.
- **HC11 before publication:** release/SDK reviewers approve negotiated versions, actual Go/proto/TS mappings and limits, supported source cohort, optional capability admission, and generated runtime facade. Host bindings use `task bindings` only when implementation is authorized.

Required review outcomes distinguish **design accepted**, **implementation available**, and **exercised production acceptance**. This document establishes none of those by itself. HR05–HR12 production work must wait for their actual owning RI/HR handoffs, not issue closure or this proposal’s existence. No implementation, tests, generation, or verification was performed for this design-only handoff.
