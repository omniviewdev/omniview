# Resource History: HR01 / HR03 / HR04 contract handoff

Date: 2026-10-28; HC01 scoped design review integrated 2026-10-29.
Status: **design-only proposal; not approved, implemented, or a public API freeze**.

This document supplies reviewable decisions for HC01, HC03–HC07. It does not authorize production ingestion, publish SDK messages, or replace the HR02 storage/privacy decision. Names and shapes below are proposed semantic messages, not available RPCs or generated bindings.

## 1. Inputs, authority, and readiness

Reviewed history inputs, now present in the managed source cohort:

- `docs/roadmap/2026-10-27-historical-resource-context.md`, especially §§5–10.
- `docs/roadmap/2026-10-27-historical-resource-context-work-packages.md`, especially HC01–HC07 and HR01–HR12.

Canonical RI inputs in this host workspace:

- [Accepted P01 canonical query/domain handoff](2026-10-24-resource-query-contracts.md), §§1–10; acceptance is recorded in host issue #80 and merged PRs #181/#184. History references that domain rather than publishing another mapping.
- [Source-session contract](2026-10-17-source-session-contract.md), §§1–3. Accepted lifecycle direction does not freeze transport or require every provider to support durable replay. Its older map-shaped identity examples do not override the canonical-domain owner.
- [C02 R4 trusted invocation/errors](2026-10-23-trusted-invocation-errors.md). Contract acceptance does not grant history-cache authorization or revocation tracking.
- Selected source: `backend/pkg/invocation/invocation.go:23–45,88–122` issues native principals and admits operations; generation `initial` explicitly does not implement revocation.
- Selected source: `backend/pkg/plugin/resource/registry/memory_store.go:32–59,104–130` replaces current entries and deletes membership. These are not append-only history or checkpoint transactions.

P01 is accepted using the reviewed immutable Omniview CEL fork `d7bb038d8c7b6f26225d4fbd210ca2b3c60a6774`, with the original upstream failing lane preserved. Upstream contribution/CLA is not a delivery gate. HR00 #179 and HR02 #180 are accepted. This does not accept the replacement SDK surface: SDK PR21 remains **draft**, and the user must review proposed-versus-resource-spec before SDK completion or merge. P45 SDK issue #12 still requires actual SDK/host/Kubernetes/runtime integration and independent acceptance. Production compiler/schema/result handoffs P07 #85, P12 #86, P13 #87, P14 #88 and P15 #89 remain required. No history-specific evaluator, result-lease system, identity fork or narrowed predicate fallback is approved.

Assignable contract reviews: [HR01 / HC01 #186](https://github.com/omniviewdev/omniview/issues/186), [HR03 / HC03–HC04 #187](https://github.com/omniviewdev/omniview/issues/187), and [HR04 / HC05–HC07 #188](https://github.com/omniviewdev/omniview/issues/188). The following remains a review proposal, not public SDK messages or permission to ingest.

### Proposed decisions and unresolved approval

| Area | Proposed decision | Required approval / remaining gate |
| --- | --- | --- |
| Canonical identity and values | Reuse the canonical RI candidate and lossless adapters, conditional on SDK user review | Preserve accepted P01 semantics; user review of SDK PR21 and usable P45 integration remain separate gates |
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

Deduplication uses a validated stable native key inside its source namespace/generation. Without one, retain distinct deliveries and declare duplicate uncertainty; a message hash or audit stage cannot substitute for a uniqueness guarantee. Parser changes alone do not create new native-record identities.

At first durable insertion, freeze a host-private **comparison-basis descriptor**: source-schema meaning, key capability, immutable field paths, relevant parser interpretation, retained-policy revision/classification, and exact equality rules. Its facts must already be admitted retained evidence, not an extra raw comparison copy. Eligible facts are source-declared immutable stage, operation, timestamp plus precision, or native revision only where declared immutable for that delivery. Exclude citation/commit time, acquisition attempt/sequence, local observation, summary, authority enrichment and parser/index artifacts. Compare canonical typed values directly, preserving absent/null/unknown/redacted/unavailable; no stringification or floating-point coercion.

| Same validated native identity | Required disposition |
| --- | --- |
| Comparable required basis facts, at least one unequal known immutable value | Proven contradiction: preserve cited evidence; quarantine delivery, stop/fence acquisition and mark coverage partial. Never overwrite. |
| All required basis facts comparable and equal | Replay-consistent **within retained basis**: reuse citation. Not raw-message equivalence; an empty basis cannot claim substantive equality. |
| Required fact removed/not admitted, or incompatible parser/schema/policy interpretation | Incomparable, not conflict or duplicate-content equality. Preserve citation; do not advance recovery beyond unresolved replay without HC03-approved durable rejection/skip or replan. |

A reviewed migration may prove a compatible common basis from retained permitted facts only; equal field names are insufficient. Stronger redaction removes affected comparison facts/caches too. Never keep hashes, fingerprints, encrypted forbidden fields or derived discriminators to preserve conflict detection. Looser policy does not restore removed facts; separately authorized acquisition needs a new representation revision and provenance. Parser corrections alone, including timestamp interpretation, cannot prove native contradiction.

### 3.2 Canonical resource references and authority

Reuse the canonical candidate `resourcev2.ResourceReference`, `ResourceAddress`, `AccessRoute`, `QueryScope`, `Representation`/`SchemaBinding`, lossless tagged `Value`, and timestamp admission through their owning RI/P45 adapters, **conditional on the SDK user-review gate in §1**. Accepted P01 semantics do not approve every added SDK admission/lifecycle API. This document declares no competing Go/proto/TS identity DTO or canonical key algorithm.

`resourceRefs` is an ordered list of `{reference: RI.ResourceReference, role, certainty, nativeLocator?}` bounded by §3.5. Exact roles are `subject|related`; certainty is `resolved|qualified`. Zero references is valid; multiple references do not duplicate an evidence row. Reject duplicate identical `(reference,role)` entries. This **amends the earlier collection-role inventory**: a collection selector cannot inhabit a canonical reference requiring an object ID. Collection context stays a native locator, never `*` or an empty fabricated ID.

Canonical authority resolution is host-owned and does not require a currently live resource or type-catalog entry. An unresolved native locator stays unresolved until a justified mapping exists; no fabricated canonical type or UID. Opaque cloud IDs are not split by UI conventions. Incarnation absence means unknown, not any known UID. Name reuse and cluster recreation do not silently rekey old citations. Connection aliases, endpoints, credentials, and equal addresses do not prove shared authority or access. Unknown authority continuity remains isolated and explicit. Native revision is observation provenance, not identity or a portable ordering number.

Source association is not an authority proof. In particular, a current EKS connection, matching cluster name/ARN, or default CloudWatch group name cannot alone bind older records to the current cluster incarnation. Resolution must retain its source/epoch/native-incarnation basis and uncertainty; records outside proven continuity remain unresolved or explicitly qualified. Discovery never repairs this by guessing an authority. CloudWatch APIs lacking a stable event ID must declare delivery-duplicate uncertainty rather than substitute a message hash or audit stage.

| Historical admission concern | Proposed decision / owning handoff |
| --- | --- |
| Historical-only/deleted Type | **P07 owns reusable declaration admission; HR01 owns historical provenance/retention.** Providers propose existing `ResourceType` plus exact `IdentityDimensions`. Historical descriptors have empty capabilities/query dimensions/representations and no default representation/authority hint. They never enter the live catalog or resurrect Types through `ObserveCatalog`. |
| Declaration evidence | Host retains provider ownership, source identity generation, authority-binding/declaration/mapping revisions, applicable record/epoch interval and proof. `declarationBasis=capturedDiscovery\|capturedCRD\|reviewedProviderContract`. A log assertion, missing namespace or current discovery alone is insufficient. Reuse/factor canonical SDK validation; validate addresses against the admitted identity dimensions, not structural validation alone. |
| Kubernetes/deleted CRD | Reuse existing `native_catalog.go` mapping: `k8s:` + native API group + `/` + plural resource. API version/subresource remain provenance. A proven namespaced declaration requires exact `namespace` dimension, disallowing empty; cluster-scoped has none. Historical CRD scope needs applicable captured declaration or reviewed provider contract. Missing/conflicting proof leaves native locators unresolved. No per-record live lookup. |
| Authority/epoch | Extend the existing host authority owner with versioned historical proof, not a second allocator. Its current resolver is connection-local and searches active route cohorts only; no cross-route/epoch stable scheme is approved. Provider `NativeAuthorityHint{scheme,id,continuity}` is evidence, not authority or permission. |
| Cluster/EKS continuity | Current `kubernetes.namespace-uid.v1` hint is a backing observation, not a cluster UUID guarantee or proof of older logs. HC09 must bind verified account/region/native cluster locator, creation identity, log source and covered epoch/records. Names/ARN/default groups/current metadata or timestamps alone cannot establish this. Record-time uncertainty must lie inside a proven interval unless record-bound provenance proves the epoch independently. |
| Recreation/restart | Detected backing/creation-identity change creates a new source identity generation and authority binding; fence acquisition/recovery, preserve old mappings/citations. Lost store, aliases, reused log groups and unproven restart continuity do not resurrect old authorities. A user override/import manifest is a claim, not proof. |
| Live operations | Historical declaration/reference presence cannot authorize Get, CRUD, utilities or enumeration. Open identity-only read views. Live enrichment/actions require separate current route/catalog/capability/authority/incarnation admission and host authorization. |

Host-private authority assessment uses `resolution=resolved|qualified|unresolved|conflict`, `basis=capturedNativeIdentity|declaredSourceEpoch|verifiedCreationInterval|none`, a resolution revision and applicable source/epoch proof. `qualified` requires a proven canonical address inside an isolated bounded source epoch; it never permits guessed authority/Type/dimensions/ID. Missing authority yields no canonical refs. `quality.identityCertainty` uses the same resolution vocabulary, folding conflict before unresolved before qualified before resolved; no applicable identity claim is unresolved with `IDENTITY_NOT_APPLICABLE`. Missing incarnation stays unknown, never a wildcard for a known UID.

Native locators are schema-admitted `Value` maps `{scheme,kind,fields}`, with `kind=object|collection|nonResource|unknown`. Initial schemes: `kubernetes.audit.objectRef.v1` permits `apiGroup,apiVersion,resource,subresource,namespace,name,uid`; `kubernetes.audit.requestURI.v1` permits reviewed `path,selector` projections, not raw query strings; `aws.cloudwatch.event.v1` permits `account,region,logGroup,logStream,eventId`. Pinned source schema supplies required fields/classification. Unresolved object locators stay in bounded `extensions.unresolvedResourceLocators`; collection/non-resource context uses `native.locator`. Locator equality never establishes canonical identity. Identity limitation codes are `AUTHORITY_UNPROVEN`, `SOURCE_EPOCH_UNPROVEN`, `TYPE_UNDECLARED`, `TYPE_DECLARATION_CONFLICT`, `INCARNATION_UNKNOWN`, `CONTINUITY_CONNECTION_LOCAL`, `LOCATOR_INCOMPLETE`, `IDENTITY_NOT_APPLICABLE`.

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

Host fields are assigned after validation; provider-supplied citation/access labels are not trusted. Go/proto/TS reuse the reviewed canonical candidate through explicit owning adapters, conditional on §1; generated bindings are not public domain aliases. Integer counts/revisions that are numeric use the RI exact tagged/decimal encoding; native revision strings stay opaque. No JavaScript `number` conversion of large integers or nanosecond instants. Proposed time axes are `event|request|stage|upstreamIngestion|localObservation|durableCommit`. Unknown times are absent with a reason, not epoch zero; native precision and translation uncertainty remain visible.

`principals` contains **reported source actor facts**, never native `invocation.Principal` or a grant. The host alone supplies invocation provenance, `acquisition.accessPartitionRef` and `accessGeneration`; current generation `initial` does not implement history revocation.

| Actor field / mapping | Exact proposed vocabulary and constraint |
| --- | --- |
| Three optional actor slots | `authenticated`, `effective`, `impersonator`: admitted `Value` maps with required `scheme,id`; optional `kind,uid,groups,issuer,session,attributes`. `kind=user\|serviceAccount\|service\|roleSession\|unknown`, only when supported by evidence. Actor schemes initially `kubernetes.userInfo.v1`, `aws.iam.principal.v1`, `aws.sts.assumedRoleSession.v1`; preserve opaque source spelling. Attributes require a source-schema allowlist. |
| Structured `principals.attributionBasis` | Entries `{slot,basis,trust,evidence,mappingRevision?}`: `slot=authenticated\|effective\|impersonator`; `basis=sourceReported\|explicitCorrelation`; `trust=unverified\|hostBoundSource\|corroborated`. Evidence is admitted citations/record-local source field paths. Explicit correlation requires mapping revision. No arbitrary rationale text or numeric confidence. Do not flatten/relocate entries into extensions. |
| Trust/certainty | `hostBoundSource` verifies acquisition provenance, not actor truth or host authentication. `corroborated` requires an independent admitted source and reviewed explicit correlation rule. `quality.attributionCertainty=reported\|corroborated\|unknown`: all present slots corroborated => corroborated; otherwise supported source facts => reported; no usable facts => unknown. |
| Kubernetes audit | `user` => reported authenticated. If `impersonatedUser` exists: it => effective; `user` => impersonator. Otherwise copy authenticated to effective only when complete admitted schema establishes no impersonation, not when the field is redacted/unavailable. |
| Authentication failure / IAM | Attempted identity stays classified `extensions.authenticationAttempt`, not authenticated/effective without successful-authentication evidence. Role/session names, ARN paths, usernames, groups, email-like strings and nearby authenticator timestamps never imply a human, cause, service account mapping or host principal. Cross-source evidence remains separate. |

Same actor/address does not permit partition sharing. Actor searches/counts, source diagnostics, payloads and exports require current host authorization; missing actor is valid. Actor/native-locator/provenance text can be private or secret-bearing and follows §3.4 redaction.

### 3.4 Representation and citation lifecycle

Representation state is one of `present`, `missing`, `notRecorded`, `redacted`, `truncated`, `expired`, `denied`, `unsupported`. These proposed representation spellings do not redefine schema availability. Each representation is independently versioned and bounded. `present` requires an admitted payload reference, `format: {mediaType, encoding}`, and the canonical `SchemaBinding`: availability is exactly `absent`, `available`, or `unavailable`, with validation capability and unsupported constraints separate. A schema-less source remains valid without inventing a schema. The envelope's `sourceSchema` does not substitute for payload schema availability. Truncation records retained extent and unknown remainder. `missing` means expected but unavailable, not known absent. `denied` is request-relative and must not disclose protected existence. `notRecorded` is source policy knowledge. Unknown path coverage must not become null or false.

For recorded patches, `patchMediaType` preserves the native request patch media type only when known; absent means unknown, not a default patch algorithm. Payload `format.mediaType` such as JSON describes its stored encoding and does not establish JSON Patch, merge-patch, or strategic-merge semantics. Payload/snapshot resolution returns the representation's admitted format, schema availability, and patch metadata for its pinned revision. `SnapshotRef` identifies that stored representation; callers cannot override these facts through request fields. Unknown patch media type remains raw intent only.

Redaction occurs before summaries, text/structured indexes, correlation fields, payload persistence, diagnostics, and exports. Redacted paths remain unknown for evaluation and comparison. Only reviewed schema-admitted retained projections are permitted; HC02 encryption does not authorize raw source dumps or a general sensitive-body retention switch. Credentials and authentication bodies never enter evidence. Permitted private actor/provenance fields require explicit classification and historical-access policy; arbitrary free text is not certified secret-free by its field name. Redacted evidence remains useful through admitted metadata and payload projections.

Citation `{storeId,evidenceId}` remains stable across parser and derived-index upgrades. A derived projection has its own parser/schema/index revision; a result can pin that revision when reproducibility requires it. Reparse does not redirect the citation to another source record. Stronger redaction can remove representation availability without reusing the identity; record policy lineage without retaining forbidden values. Source rebinding creates a new source identity generation, not a rewritten citation. Retention/purge produces an authorized unavailable outcome; tombstone retention itself follows privacy policy, not an unlimited promise. Imports get local citations plus origin/manifest lineage; origin IDs do not confer trust or globally deduplicate records. Frozen exports identify exact representation revisions and policy transformations.

Retained record provenance (citation, source generation, native key, permitted native actor/locator facts and original acquisition binding) is immutable only while policy permits retention. Historical declarations/proofs are versioned provenance. Authority/resource resolution, actor normalization/correlation, certainty, summaries and indexes are versioned projections pinned to their source-schema/parser/resolver/mapping/policy revisions; later proof may create a new projection under the same citation, never rewrite an old pin silently. Current live enrichment is separately authorized/time-labeled and cannot supply historical facts.

Proposed lineage relations are `derivedFrom|policyTransformedFrom|importedFrom|correlatedWith`; basis is a registered schema code and confidence `asserted|supported|uncertain`. Correlation does not assert causality/identity. If policy forbids key/locator/citation existence, lineage endpoints or revision history, remove those too. Authorize before distinguishing missing/expired/purged/denied; unauthorized resolution must not enumerate tombstones.

Mandatory removal fences reads, commits, caches, pins, in-flight work and export staging. HR06/HR24 must reconcile permitted evidence/basis, blobs, schemas, lineage, changes, summaries/indexes, temporary files, WAL/journals, backups and tombstones with crash-safe cleanup; rebuild cannot rehydrate forbidden data. Pins cannot defeat deletion. HC02 owns bounded cleanup windows and platform/key/backup mechanics. SQL DELETE/unlink is not physical-erasure proof; SSD/filesystem snapshots, swap, unmanaged backups and prior external exports prevent a universal erasure promise.

### 3.5 Versioning and admission

Negotiate envelope major version before ingest. Unknown mandatory envelope versions fail `UNSUPPORTED` before checkpoint advancement. Unknown fields in strict canonical RI DTOs follow RI admission; do not silently relax their rejection policy. Extensible provider data belongs only in a declared, bounded source-schema extension container. Unknown optional extensions may be retained only under approved redaction and size policy; they are not implicitly searchable. Required unknown semantic fields reject. Source schema, parser, redaction policy, config, access, and derived-index versions remain independent.

Compatible optional additions do not redefine existing states or fields. Meaning changes require a new semantic/schema version and explicit migration/rebuild policy. Rebuild coverage is separate from acquisition coverage. Historical parser projections are not silently claimed equivalent after migration.

#### Proposed composed limits

These are unapproved starting ceilings requiring HC01/HC02/HC03/HC07/HC11 corpus and resource-cost review. They constrain the existing envelope/source containers, not canonical Value semantics or a second wire profile. Apply the tightest negotiated carrier/document and aggregate limits before allocation; overflow fails explicitly, never silently truncates identity/attribution.

| Component | Proposed maximum |
| --- | --- |
| Envelope metadata, excluding separately admitted schemas/payload bytes | 256 KiB encoded, plus decoded counters |
| Canonical refs / unresolved native locator entries | 64 each; all locator paths share 4 KiB/locator and 16 KiB aggregate |
| Native key / revision; correlation keys | 4 KiB each key/revision; 16 correlation entries, 1 KiB each / 16 KiB total |
| Ordinary noncanonical token / registered code / summary | 256 UTF-8 bytes / 128 bytes / 4 KiB; names do not certify secret-free content |
| Actors and nested attribution | 4 KiB/slot, 12 KiB total; 32 groups/actor, 256 bytes/group; 16 allowlisted attributes/actor, 64 bytes/key; attribute source-container depth 4 / 128 nodes per actor, unchanged RI Value semantics |
| Attribution entries | At most 3, exactly one per present actor slot; 4 evidence refs/entry; basis/mapping/field-path tokens 128 bytes. Charge nested evidence/paths/mapping once to associated actor, actor aggregate and envelope; applicable extension/lineage budgets also apply, without relocating fields. |
| Times / representation descriptors and payload refs | 8 times, unique declared axis/basis tuple; 8 representations, one payload ref each; opaque host payload token 512 bytes, never provider-controlled URL/file traversal |
| Lineage | 32 edges / 16 KiB total; reject self-derivation; traversal 128 visited citations / depth 8 per operation |
| Extensions / quality limitations | 64 declared top-level names / 32 KiB admitted extension bytes; 16 limitation codes / 128 bytes each |
| Representation bytes / schema documents per evidence admission | 16 MiB aggregate each, also subject to individual canonical document/transport bounds; payload reads remain lazy/bounded |

The inspected SDK candidate has 16 MiB documents, depth 64, 262144 Value nodes, 32 MiB messages, 1048576 wire fields and 256 page records; these are **not approved history/predicate defaults**. Multiple envelopes, schemas and payloads must fit the actual carrier aggregate. Chunking requires HC03's reviewed transport mapping. HC01/source owners register finite family/representation/operation/category/outcome/basis vocabularies or bounded classified strings; unknown required semantics reject. HC10/HR25 separately own archive entry/decompression/path/count budgets.

#### Admission order

1. Bound transport bytes/fields/depth/allocation while decoding and negotiate versions; never log rejected raw input. Host authentication/authorization must precede semantic source/actor disclosure or acquisition; do not trust provider citations/access labels.
2. Bind source/session/config/access/policy fences; transiently validate source schema, strict canonical values/timestamps, enum membership and aggregate counters. Missing privacy policy blocks ingestion.
3. Classify/redact before persistence, summaries, indexes, correlation, comparison basis, diagnostics or export staging; then revalidate retained projection/representation/schema budgets and derive only from admitted facts.
4. Resolve source epoch/authority and pinned historical declaration through owning canonical admission, validating addresses against declared dimensions. Valid missing proof produces native-only unresolved projection; malformed claimed canonical identity fails, not guessed success.
5. Validate refs/actors/attribution, host blob refs and authorized lineage plus all composed limits. HC03 default is stop without checkpoint advancement; this proposal authorizes no new skip policy.
6. Within the durable transaction recheck fences, expected commit, native-key comparison outcome, blobs/indexes/rejections/qualified coverage and recovery for exactly the approved contiguous prefix (§4.3). Commit before progress; incurred spend is not erased by rollback.
7. Reauthorize current policy before reads/comparisons/export/output; invalidate incompatible pins rather than reveal old projections. Rebuild coverage remains separate from acquisition coverage.

### 3.6 Identity and retention boundary matrix

| Boundary | Required outcome |
| --- | --- |
| Deleted namespaced CRD, applicable declaration and proven epoch | Exact namespace/name/ref and recorded UID; identity-only navigation, no live CRUD grant. |
| Unknown GVR/scope, current discovery absent or conflicting | Native locator and limitation, no invented Type/dimensions; later proof creates a projection under same citation. |
| List/deletecollection/non-resource path or authentication failure | Zero refs unless named objects are actually recorded; collection locator, no `*` ID; attempt is not authenticated actor. |
| Subject plus independently resolved related object | Multiple ordered refs, one evidence row; unresolved related locator remains native. |
| Same name, UIDs A/B, third record without UID | Distinct known incarnations; third stays unknown, joins neither specific incarnation; address-wide scope explicit. |
| Restart/alias/lost store; backing UID unavailable | Fence work; no old-authority resurrection. Only proven bounded isolated epochs qualify; otherwise native-only. |
| EKS recreation or reused log group/name/ARN | New generation/binding; pre-creation/boundary-uncertain records remain unresolved without record-bound proof. |
| User impersonates service account | Separate reported authenticated/impersonator/effective roles; none becomes host principal or partition grant. |
| Nearby authenticator role/session, no reviewed join key | Separate citations; no human/causal attribution or actor replacement from time/name. |
| Source supplies principal owner/access label; other partition has same address | Reject control claims; host binding and current authorization prevail; denial is not empty success. |
| Same key after parser correction or stronger redaction | Comparable retained immutable contradiction => conflict; missing/incompatible required basis => incomparable, not conflict. Remove forbidden derivatives. |
| Policy loosens or purged pin/export is reopened | Removed facts do not regenerate; new authorized representation has provenance; old pins cannot bypass policy or imply physical erasure. |

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

1. Atomically verify current source/authority/access/config/session, parser/redaction/policy fences and compare-and-swap the expected previous commit position inside the durable transaction.
2. Insert evidence idempotently and validate native-key conflicts.
3. Store admitted representation bytes/references, refs, provenance, and required derived indexes, or explicit versioned deferred-index coverage.
4. Persist durable rejection records only where the approved skip policy permits them.
5. Persist qualified coverage and recovery/checkpoint state for exactly that prefix, and attach idempotent references to independently durable attempt/usage accounting. An upstream charge need not correspond to committed evidence; rolling back evidence must not erase incurred or uncertain spend.
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

Before open, negotiate finite maxima for encoded frame bytes, record count, individual record/payload bytes, decoded depth/cardinality, in-flight frames/bytes, writer queue, control bytes, startup/runtime/idle deadlines, and retry/replay work. Host ceilings dominate provider claims. HR02 is accepted, but concrete history acquisition limits still require HR05 measurement and HC03 review. P45's resource wire candidate (32 MiB frame, 16 MiB body, depth 64, 262144 nodes, 1048576 fields, 256 page records) is an input, not automatic history-policy approval. Absence of approved positive bounds blocks production open. Validate encoded and decoded sizes before unbounded allocation or decompression. Lazy payload reads have independent output/decompression limits.

Reserve a separate bounded control path and retained terminal slot so data saturation cannot hide failure/cancellation. A control path also has limits: coalesce progress, never unbounded enqueue. Terminal attachment/reconciliation follows the common lifecycle owner’s approved pattern, not a new history result lease. Stop data on slow-writer pressure; if lossless pause is impossible, terminate with a gap/partial coverage. Final-subscriber release cancels view-owned work; explicit background-rule ownership may keep it alive. Pending-open cancellation releases only reservation proved unused; raced native establishment follows §5 exposure and uncertainty accounting. Cancellation cannot undo upstream charges.

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

A rejection record contains an admitted bounded native locator/extent, reason, policy version, and coverage effect, not an unredacted rejected payload. A hash is allowed only over an explicitly admitted projection under its recorded comparison policy. Raw-record hashes and other forbidden-value derivatives are prohibited, including for malformed or oversized input whose schema/classification failed. Prefer a native byte extent or delivery key when no projection can be admitted. Rejections acknowledge known loss only as partial, never complete success. If record boundaries cannot be established, stop rather than guess a safe skip. File continuity checks also cannot persist fingerprints of forbidden source content.

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

Time pushdown requires an admitted mapping between the requested axis and the backend axis, including native precision and endpoint convention. For native quantum `q`, lower bounds round outward toward negative infinity; exclusive upper bounds round outward toward positive infinity. An inclusive native upper endpoint uses the last representable native tick below that exclusive bound. Exact host residual filtering applies the original `[start,end)` bounds after acquisition; it does not substitute coarse backend bounds for requested semantics. Use checked pair/integer arithmetic across the entire canonical timestamp range, never overflowing `UnixNano` or JavaScript millisecond conversions. A proven finite skew bound may widen a plan; an unknown axis relation cannot. Unsupported translation requires an explicit unsupported result or newly approved bounded partial strategy, not an implicit full-retention scan. Coverage binds the requested axis, translation version, native interval and residual outcome.

Union coverage combines only proven-compatible segments. Keep holes, partial regions, sampled intervals, and per-source limitations. Overlap does not add completeness. Intersection/containment requires explicit selector proof. Initial sharing supports exact compatible requests and independently proved interval containment, not general CEL implication. Counts/facets/histograms carry separate coverage and exact/estimated/unknown state; page length is not a total.

`searchedAsOf` means the selected backend search exhausted its declared finite pages for that selector at that observation time. It does not mean all historical events have arrived. Record upstream ingestion and local observation separately. Late arrivals behind the latest event timestamp remain possible. Reconciliation scans bounded overlapping windows and creates new evidence/coverage revisions; no fixed overlap proves permanent completeness for best-effort delivery. Frozen query generations do not mutate when late data arrives. Live generations announce new rows/reset through the common result protocol.

Approved plan binding includes effective source/access/config generation, authority, time axis/range, selector/predicate and profile/declarations/bindings digest, representation/projection, strategy, estimate basis, limits, policy, budget owner, and expiry. An opaque plan reference is not authority. Any broadened scope or material change requires new approval. Host policy determines whether equivalent narrower work can reuse a plan; UI guesses cannot.

Reserve multi-dimensional budgets atomically before concurrent opens. Track requests, runtime, returned/processed bytes, local disk/output/CPU, and backend billable dimensions when observable. Reserve unknown-cost work only under explicit conservative limits/approval, not a fabricated zero estimate. Charge measured acquisition once to its owner ledger; subscriber attachment does not duplicate spend. Settle/release unused reservation on terminal and pending-open cancellation. Crash recovery reconciles reservation/usage without double charging. Cached reads avoid remote-acquisition charges but still consume local policy limits. Cancellation controls future work best-effort, not a hard cloud billing cap.

Before any potentially chargeable dispatch, persist a unique acquisition-attempt identity, its reservation/exposure bounds, owner, plan digest and dispatch state. Source retries belong to that attempt or obtain a new admitted reservation; subscriber attachment does not create a charge. Persist usage observations independently of evidence success and settle by stable attempt/observation IDs. A crash after dispatch but before receipt leaves `uncertainSpend`, not zero usage or an automatically released reservation. Retain conservative exposure until bounded native reconciliation, a terminal proof, or an explicit authorized uncertainty-resolution policy accounts for it. Estimated/conservatively debited amounts remain labeled separately from measured billable usage and processed bytes. Unknown billable exposure stays unknown; no invented dollar upper bound. Cancellation releases only work proved unable to dispatch or incur further exposure; an opening race remains reserved/uncertain until reconciled. Recovery and settlement are idempotent and cannot double-charge or refund evidence rollback.

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

This is a feature composition proposal, not a second or narrowed public query API. HC05 must resolve the exact embedding/target mapping with P13 before publishing Go/proto/TS definitions. P01 semantics are accepted; production compiler/result implementation is not implied. RI owns predicates, typed bindings, field paths, projection/order, errors, and result leases. The history domain supplies schema, acquisition target, row identity, and coverage. No second compiler or implicit evaluator exists.

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

Schema `unavailable` forbids schema-dependent matching, not automatically every admitted generic comparison; schema `available` grants neither payload access nor unsupported-constraint validity. Resolve a pinned representation's stored format/schema/coverage/native patch metadata, never caller overrides. Policy/parser changes follow §3.1's retained-basis incomparability and §3.4's removal rules; forbidden facts cannot survive in comparison caches or frozen generations.

## 9. Review receipt required before implementation handoff

Contract review must produce explicit accepted/rejected/amended outcomes, owning reviewers, exact input revisions, and remaining gates. A list of proposed DTO names is not an acceptance receipt.

### Scoped HC01 semantic review, 2026-10-29

Inputs were the two private drafting artifacts by `HC01IdentityGates` and `HC01RetentionGates`, now condensed into §3 and §8 rather than a parallel framework. Inspected bases: host `09bf38f914cba0cf8237d20f5e98634601fbd818`; SDK `a8416f844df1e7742217372ee12205001dca0805` (review document and canonical source; underlying implementation receipt `08421dc` is not user acceptance); Kubernetes `728009541a87d5f901362339e797a3ac66fda048`; UI cohort `11a55a53acb67328f743c512757cabd29135f5fc` (revision only, not reviewed UI behavior).

Source anchors: this document's original §§3/8/9 (original lines 101/107 read raw); [work-package HC01/RI ownership](../../roadmap/2026-10-27-historical-resource-context-work-packages.md#3-required-contract-handoffs); SDK [`resource-v2-spec-review.md:1–54`](https://github.com/omniviewdev/plugin-sdk/blob/a8416f844df1e7742217372ee12205001dca0805/docs/resource-v2-spec-review.md#L1-L54), [`domain.go:16–137`](https://github.com/omniviewdev/plugin-sdk/blob/a8416f844df1e7742217372ee12205001dca0805/pkg/resource/v2/domain.go#L16-L137), [`validation.go:177–219,555–610`](https://github.com/omniviewdev/plugin-sdk/blob/a8416f844df1e7742217372ee12205001dca0805/pkg/resource/v2/validation.go#L177-L219); host [`authority.go:28–60,121–214`](https://github.com/omniviewdev/omniview/blob/09bf38f914cba0cf8237d20f5e98634601fbd818/backend/pkg/plugin/resource/authority.go#L28-L60), [`invocation.go:23–45,89–123`](https://github.com/omniviewdev/omniview/blob/09bf38f914cba0cf8237d20f5e98634601fbd818/backend/pkg/invocation/invocation.go#L23-L123); Kubernetes [`native_catalog.go:82–125,146–160`](https://github.com/omniviewdev/omniview-plugin-kubernetes/blob/728009541a87d5f901362339e797a3ac66fda048/pkg/plugin/resource/native_catalog.go#L82-L125).

| Reviewers / scope | Observed outcome |
| --- | --- |
| `ReviewHC01Identity`: identity admission, actor/access separation, cross-artifact agreement | P2 structured-attribution shape/budget contradiction closed after alignment; no remaining scoped blocker. |
| `ReviewHC01Retention`: retained comparison basis, policy removal, composed budgets and citation privacy | Same P2 closed; no remaining finding for that amendment. |

Both reviews require structured per-slot attribution and charging nested evidence to actor/envelope plus applicable extension/lineage limits (§§3.3/3.5). These are **scoped semantic review receipts**, not approval of this integrated edit, a public freeze, ingestion/implementation acceptance, SDK completion, or closure of issue #186. Owning reviews below remain required.

### Owning handoffs and execution order

Concrete HC01 decisions above → external P07 declaration/authority, HC02 access/privacy and HC09 epoch-proof handoffs → HC03/HC04 plus RI query/result handoffs → production implementation/acceptance. Native P45 acceptance proceeds independently; SDK PR21 cannot be done/merged before user review.

| Owner / language | Exact missing next handoff |
| --- | --- |
| P07 + P45 / Go; host authority owner + HR01 / Go | Factor existing canonical Type validation; admit versioned historical-only declarations independently of live catalog. Extend existing authority owner with retained source/epoch proofs and historical lookup, no second allocator. Preserve unknown/conflicting results. |
| HC02 security/invocation + HR06/HR24 / Go | Actual partition/generation, revocation/offline actor policy, bounded cleanup/key/blob/backup guarantees and current read/output fences. `initial` invocation generation is insufficient. |
| HC08 HR08 + HC09 HR15 Kubernetes/AWS / Go | Reuse existing Type mapping; supply source schemas/impersonation corpus and verified EKS creation/source-to-epoch proofs/key guarantees, not discovery-name heuristics. |
| HC03/HC04 + HR06 / Go; HR05 / proto adapters | Map conflict/replay/incomparable and composed budgets into durable contiguous recovery/coverage/cost. After approvals, import existing canonical proto/reference/Value/schema definitions into optional negotiated transport; assign field numbers then, no duplicate DTOs. |
| HC07 HR12 / Go; P47 HR11/HR14 / TS | Resolve actual pinned retained representations with truthful comparison fidelity. Consume existing `resource/v2/domain.ts`; identity-only navigation and source actor facts never invoke live CRUD or replace host access. No generated-model public ABI. |
| P07/P12/P13/P14/P15 + HC05/HC06 | Deliver actual schema/source-result/compiler/result/runtime ownership; no narrowed evaluator, shadow lease, browser identity mapper or issue-closure substitute. |

SDK admission/lifecycle/framing/ABI choices remain conditional on the user's proposed-versus-spec review; every implementation owner supplies deterministic boundary cases and actual usable handoffs rather than declarations-only completion.

### Required owning approvals

- **HC01 / HR01:** RI/domain and SDK reviewers approve canonical-reference reuse, no duplicate domain, native-key conflict behavior, stable citations, zero/multi-reference semantics, unknown authority/incarnation, principals, exact values/time, envelope evolution, and representation lineage. Cover CRDs/deleted types, opaque IDs, cluster/resource recreation, multiple stages, and cross-source non-deduplication.
- **HC02 prerequisite:** storage/security reviewers approve retained classes, redaction, access partitions/offline revocation, encryption/key lifecycle, supported driver/platform profile, crash/corruption/migration behavior, purge/tombstone limits, and blob atomicity. No raw-sensitive ingest before this receipt.
- **HC03 / HR03:** SDK/storage reviewers approve concrete wire mapping, replay versus optional ACK, contiguous-prefix transaction contract, fenced generations, bounded data/control/terminal path, and every failure policy. Required traces include crash before/after commit, empty continuation, token expiry, partial file line, malformed/oversized record, reset/out-of-order frame, access/config replacement, and cancellation while opening.
- **HC04 / HR03:** scheduler/security reviewers approve coverage qualification/algebra, searched-as-of and late-arrival meaning, selector-sharing proof, approval binding, atomic reservations/settlement/recovery, and final-subscriber/background ownership. Include concurrent budget races and authorized metadata disclosure.
- **HC05 / HR04:** RI compiler/results reviewers approve target/root schemas and quantification, text distinction, payload admission, count units, exact values, stable frozen paging, live generation/reset, and aggregate coverage. Preserve the accepted P01 numeric/profile semantics; usable P07/P12/P13/P14/P15 outputs remain blocking. Separate feasibility probes or a narrowed history evaluator cannot replace them.
- **HC06 / HR04:** runtime/navigation reviewers approve versioned context/pivot mapping, explicit widening, historical-only navigation, absolute/relative saved time, cancellation, stale-response fencing, and direct custom-view access without renderer registration.
- **HC07 / HR04:** diff reviewers approve discriminated snapshot/patch requests, fidelity proof, known-empty sides, redaction/unknown paths, patch/list semantics, structured-change identity, and native-renderer fallback.
- **HC11 before publication:** release/SDK reviewers approve negotiated versions, actual Go/proto/TS mappings and limits, supported source cohort, optional capability admission, and generated runtime facade. Host bindings use `task bindings` only when implementation is authorized.

Required review outcomes distinguish **design accepted**, **implementation available**, and **exercised production acceptance**. This document establishes none of those by itself. HR05–HR12 production work must wait for their actual owning RI/HR handoffs, not issue closure or this proposal’s existence. No implementation, tests, generation, or verification was performed for this design-only handoff.
