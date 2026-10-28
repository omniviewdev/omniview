# Historical Resource Context — work packages and launch order

Date: 2026-10-27.
Status: execution started for independent prerequisites; no production history contract approval or feature acceptance. See the [execution receipt](2026-10-28-history-prerequisite-execution.md) for actual source, fixture, driver and blocker evidence.

Parent: [Historical Resource Context architecture](2026-10-27-historical-resource-context.md). The parent's H00–H07 remain product milestones. HR00–HR29 below are separately assignable delivery packets, not replacements for Resource Intelligence P IDs.

## 1. Review conclusions

1. History is a headless domain with optional plugin providers and arbitrary plugin presentation. Resource, plugin, graph-selection, authority, and global contexts are equal API consumers.
2. H00–H07 were too broad to assign safely. Separate contract decisions, durable ingestion, source adapters, query/results, presentation, investigations, and release acceptance.
3. Existing Resource Intelligence contracts are not all implemented or frozen. The [P01 issue](https://github.com/omniviewdev/omniview/issues/80) remains open with an unresolved numeric gate; its latest inspected comment includes the v0.33.0 upstream assessment. The [P45 provider boundary issue](https://github.com/omniviewdev/plugin-sdk/issues/12) remains open. Do not infer production readiness from merged design/spike work.
4. Existing source-session contracts explicitly do not require durable replay/checkpoints. History must define a feature-specific durable-ingestion extension, not silently add a replay requirement to every resource provider.
5. Full custom-view APIs, deleted-resource navigation, acquisition cost enforcement, privacy, and coverage are foundational work—not late renderer polish or final hardening.
6. A graph consumer proves presentation independence. It does not imply implementing a temporal graph database or reconstructing historical topology from current edges.
7. Freeze basic source controls and redaction before the first production ingest. “Operational hardening later” does not authorize insecure or non-durable early releases.
8. Build on actual selected packages. The inspected `../ui/main` base-ui source is version 0.4.2, while host `package.json` requests ~0.7.0. Its Timeline is an item list, not evidence of an available zoom/brush histogram. HR00 must select and inspect the real compatible UI cohort.

### Changed sequence versus the parent proposal

- Move context-neutral public API, scope transitions, and full custom-view contract into HR04/HR11, before the resource view.
- Split finite source acquisition from durable follow. Neither an open stream nor contiguous delivery sequence proves durable coverage.
- Give query semantics, historical text matching, aggregations, and multi-source union separate explicit ownership.
- Establish storage/privacy decisions before retaining payloads, and a corruption recovery policy before checkpoints can survive restart.
- Give saved investigations, evidence pinning, portable exports, source configuration, and source diagnostics their own deliverables.
- Treat optional backend strategies and future AI/CloudTrail adapters as explicit later packets, not implicit first-release requirements.

## 2. Readiness rules

**Hard dependencies** require accepted contracts and usable implementations before consumer code begins. Packet design may proceed earlier; design readiness is not coding readiness. **RI dependencies** below refer to their actual outputs, not issue closure alone. Handoff receipts identify the precise source/version and exercised behavior.

Current state: HR00 source-cohort work has started; the kind audit fixture and isolated HR02 driver experiment have exercised evidence. HR01/HR03/HR04 have a [design-only handoff](../superpowers/specs/2026-10-28-history-contract-handoff.md), not frozen production contracts. No full HR packet or history API/schema is accepted by those subsets. Production consumers still require the exact reviewed RI/HR handoffs below.

Do not build a parallel identity model, CEL environment, query evaluator, lease protocol, or browser search engine to evade an external dependency. Independent storage/source experiments may use private throwaway inputs; they must not become public compatibility stacks or be shipped as a narrowed feature.

Each implementation packet includes documentation, bounded failure behavior, applicable deterministic regression tests, and an actual headless/source/UI smoke of the changed path. Do not split a coherent behavior into declarations-only and mock-wiring completion claims.

## 3. Required contract handoffs

These gates name required decisions and acceptance artifacts. Their status is **proposed/unfrozen**, except reused RI decisions have their separately recorded status. Owners are engineering roles, not assigned people.

| Gate | Decision owner | Required output | Consumers |
| --- | --- | --- | --- |
| HC01 domain/identity | HR01 + RI P01/P45 owner | Evidence/source identity, canonical resource references, authority resolution, record versus logical event, representation states, versioning | Every ingestion/query/API packet |
| HC02 privacy/storage | HR02 + security/storage owner | Retained-data classes, redaction, encryption/keys, access partitions/offline policy, corruption/migration rules, driver/platform decision | HR05–HR10 and payload/export consumers |
| HC03 acquisition/commit | HR03 + SDK/session owner | Plan/open/follow/commit boundary, checkpoints, page/replay semantics, size budgets, EOF/reset/terminal states | HR05/HR07/HR09/HR16/HR17 |
| HC04 coverage/cost | HR03 + scheduler owner | Selector-qualified coverage algebra, late-arrival policy, estimates versus measured usage, approval/plan binding, shared-work budgets | HR07/HR10/HR16/HR17/HR21/HR24 |
| HC05 query/results | HR04 + RI P13/P14 owner | History targets/schema, text semantics, aggregate coverage, stable cursor/generation, finite/follow delivery, exact values and errors | HR10/HR11/HR20/HR21 |
| HC06 contexts/custom views | HR04 + runtime owner | Versioned context/navigation, scoped direct APIs, saved time semantics, cancellation ownership, no renderer mandate | HR11/HR13/HR14/HR22/HR23 |
| HC07 comparison/changes | HR04 + diff owner | Snapshot/ref/fidelity contract, requested versus observed versus verified changes, semantic path/list matching | HR12/HR19/HR20/HR22 |
| HC08 Kubernetes normalization | HR08 + Kubernetes owner | Audit stages, resource resolution, Event series, observed-state limits, patch classification, authenticator uncertainty | HR09/HR16/HR18/HR19 |
| HC09 EKS access | HR15 + Kubernetes/AWS owner | Verified discovery/overrides, credential chain/role handling, log class/API support, least-privilege guidance, source status | HR16/HR17/HR27 |
| HC10 investigation/pins/export | HR23 + storage/runtime owner | Saved documents, references versus frozen evidence, pin leases, expiry/revocation, export manifest/citations | HR24/HR25/HR29 |
| HC11 ABI/release | HR26 + RI P46/P47 owner | Compatible source/version matrix, optional history admission, migrations, unsupported-plugin behavior, cleanup list | All published packages and first release |

### HC03: commit/recovery decisions that must be explicit

- Provider native IDs identify deliveries; host IDs identify retained evidence; logical audit requests can group multiple stage records. Preserve each layer.
- Recovery state binds source/authority/access/config/parser/selector/representation and native expiration. Unknown/changed bindings reject or replay safely, never transplant tokens.
- Host durable commit is the checkpoint advancement boundary. Choose whether an adapter needs a post-commit callback/ack or can reopen idempotently from committed state; do not impose custom ACKs on every provider without need.
- Disk-full, decode failure, malformed records, oversized payloads, and unsupported envelopes must specify whether acquisition stops, skips with a durable rejection record, or marks coverage partial. Never acknowledge unseen loss as success.
- File offsets and cloud page tokens have different meaning. EOF with finite exhausted pages differs from unexpected follow termination. Flow-control terminal signals must remain deliverable under data-queue saturation.
- No stable native event ID is a declared capability limitation. Hash-based deduplication is not automatically exact, especially for identical legitimate messages.

Four coordinates remain independent: native recovery position; provider stream generation/sequence; durable commit position; consumer result generation/sequence. A source reset invalidates acquisition continuity but **does not erase committed evidence**. Resource replacement-snapshot membership/removal semantics must never be reused as evidence deletion semantics.

Evidence citation identity must survive parser/derived-index upgrades where the underlying retained source record is unchanged. Redaction changes, source rebinding, retention/purge, and imported evidence need explicit lineage and unavailable outcomes; rewriting a projection must not silently make an old citation point to different evidence.

### HC04: cost and plan binding

A host-approved plan binds effective scope, source/access/config generation, time axis/range, predicates, projections/representations, backend strategy, estimate basis, budget owner, expiry, and policy. An opaque reference is not a permission grant. Revalidate at execution; edits or broader scope need a new plan. Reserve shared budgets before concurrent reads and charge observed usage once per acquisition, not once per subscriber.

Start with exact compatible-request sharing and explicitly proved interval containment. General CEL implication/query-subsumption is not an initial requirement. Cancellation controls future work best-effort; it cannot promise reversal of upstream charges already incurred.

Coverage, counts, actors, source names, and cost diagnostics themselves require access checks. Cached hits do not consume remote-acquisition allowance, but remain subject to local query/output/CPU policy. Mixed-target denial behavior follows the shared host contract; an unavailable or denied target must never silently become an empty successful target.

### HC05: no accidental query dialect

Current RI R2 specifies case-sensitive substring text matching. FTS5 token/phrase matching is different. Freeze an explicit versioned history text contract: token/phrase full-text may be a distinct declared history search operator; substring must preserve RI meaning and may need a bounded scan or suitable accelerator. An index candidate must not omit valid substring matches. Do not silently reinterpret existing QuerySpec text as FTS MATCH.

Evidence, changes, and distinct-resource results need explicit row identity and provenance. Aggregation across sources must count retained evidence or explicitly deduplicated logical events—not call either “operations” without a definition. Current labels versus recorded historical labels remain separate predicates.

Freeze history predicate roots and multi-resource-reference quantification with the common compiler owner. The existing resource proposal binds `resource`; adding evidence/change bindings requires a reviewed domain profile, not a second evaluator or incompatible implicit root.

## 4. Resource Intelligence integration boundaries

| RI output | Hard history consumer | Boundary / work not duplicated |
| --- | --- | --- |
| P00 source cohort | HR00 repeats only current cohort proof | Reuse workspace tools; do not implement a second developer environment |
| P01/P45 canonical identity/value/profile ownership | HR01 implementation handoff, HR05/HR10 | Unfrozen numeric/profile blocks production predicate execution. HR01 can refine history schema now, not freeze a competing domain |
| P03 identity consumer cutover | HR14/HR22 resource/graph navigation | Canonical history-only reads need not wait for every live UI consumer, but integrated navigation cannot retain old identity aliases |
| P04 invocation/errors | HR05/HR07/HR10/HR11 | Existing host-issued principal seam is reusable; access partition/revocation policy remains new history work |
| P05/P10 source session/provider implementation | HR19 observed-state adapter | Finite audit-file/CloudWatch reads do not require live-resource watch implementation. Follow principles apply, but durable history replay is a new optional capability |
| P07 schema/catalog | HR10/HR20 and optional semantic schemas | History evidence schema is feature-owned; share catalog/admission mechanisms, not duplicated checking. Source-only audit records may reference undiscovered/deleted types |
| P13 authoritative compiler/execution | HR10/HR20 | History contributes an indexed evidence acquisition/execution target. Do not instantiate a parallel production CEL service |
| P14/P15 result protocol/runtime | HR10/HR11 | Reuse accepted result delivery/generations. Feature job progress differs from result leases. If not delivered, land needed output in owning RI packet, not an HR shadow lease |
| P26 generic contributions | HR22 | Reuse registry; full historical views do not require all P27 declarative visualization features |
| P31/P32 saved versioned documents | HR23 shared-format handoff | History document semantics/pins remain new. Do not force full dashboard/layout delivery merely to save an investigation |
| P35 authorized union | HR21 | Implement/reuse general explicit target union once; evidence coverage and identity remain history-specific |
| P39–P41 index lifecycle | HR24 management integration | Share explain/status vocabulary and controls; durable evidence storage is not an optional current-state accelerator |
| P42/P43 search | HR21/HR23 discovery entry | Existing palette can navigate to history. Historical result search must use authoritative service, not a new provider doing browser scans |
| P46/P47 admission/ABI | HR26 | Coordinate published supported ABI and caller removal; no history-specific exemption for incompatible plugins |

**Escalation rule:** if a required RI implementation is unavailable, assign/advance that existing packet and its exact missing handoff. Do not silently rewrite RI dependencies or narrow public query support. History source normalization, storage research, contract review, and controlled UI exploration remain eligible.

## 5. Work packet index

The dependency field lists HR dependencies only; section 4 and each packet define external RI gates. No numerical wave implies calendar duration or automatic readiness.

| ID | Deliverable | Primary owner/repository | Hard HR dependencies | Milestone |
| --- | --- | --- | --- | --- |
| HR00 | Selected cohort and source/consumer inventory | Integration / host | none | H00 |
| HR01 | Canonical evidence and identity contract | Domain / SDK + host | HR00 | H00 |
| HR02 | Storage/privacy/platform decision | Storage/security / host | HR00 | H00 |
| HR03 | Acquisition, durable commit, coverage, budget contract | Protocol/scheduler / SDK + host | HR01, HR02 | H00 |
| HR04 | Query, comparison and multi-context API contract | Query/runtime / host + SDK | HR01, HR02 | H00 |
| HR05 | Real history capability transport/admission | Protocol / SDK + host | HR03, HR04 | H01 |
| HR06 | Durable evidence store and recovery | Storage / host | HR01, HR02, HR03 | H01 |
| HR07 | Acquisition coordinator and job/budget ownership | Scheduler / host | HR05, HR06 | H01 |
| HR08 | Kubernetes audit normalization and corpus | Kubernetes / Kubernetes plugin | HR01, HR02 | H01 |
| HR09 | Local JSONL import/follow source | Kubernetes / Kubernetes plugin | HR05, HR07, HR08 | H01 |
| HR10 | Finite history query and result delivery | Query / host | HR04, HR06 | H01 |
| HR11 | Public runtime history client/context API | Runtime / host runtime package | HR05, HR07, HR10, HR12 | H01 |
| HR12 | Evidence-backed generic diff service | Diff / host | HR04, HR06, HR10 | H01 |
| HR13 | Controlled time/coverage/progress primitives | Presentation / UI repository | HR04 | H01 |
| HR14 | Resource History and deleted-resource navigation | Product / host + Kubernetes UI | HR09, HR11, HR12, HR13 | H01 |
| HR15 | EKS discovery, credentials and configuration | Kubernetes/AWS / Kubernetes plugin | HR03, HR08 | H02 |
| HR16 | CloudWatch finite audit/authenticator acquisition | Kubernetes/AWS / Kubernetes plugin | HR07, HR15 | H02 |
| HR17 | Durable CloudWatch follow and reconciliation | Kubernetes/AWS / Kubernetes plugin + host | HR16 | H02 |
| HR18 | Kubernetes Events historical adapter | Kubernetes / Kubernetes plugin | HR07, HR08 | H03 |
| HR19 | Scoped observed spec/status history | Kubernetes / Kubernetes plugin + host | HR07, HR08 | H03 |
| HR20 | Structured-change and historical text search | Query/index / host | HR10, HR12 | H04 |
| HR21 | Authorized multi-source union and aggregate/search integration | Query / host | HR11, HR20 | H04 |
| HR22 | Plugin-native views, graph consumer and native diff | Extension/runtime / host + Kubernetes UI | HR11, HR12, HR13 | H05 |
| HR23 | Investigation workspace, persistence and evidence pins | Product/storage / host | HR14, HR21, HR22 | H04 |
| HR24 | Retention, rebuild, recovery and source operations | Storage/operations / host | HR07, HR17, HR23 | H06 |
| HR25 | Evidence export/import manifests and citations | Evidence/security / host | HR23, HR24 | H06 |
| HR26 | Kubernetes/EKS end-to-end release acceptance | Integration / all selected repositories | HR14, HR17, HR18, HR19, HR20, HR21, HR22, HR24, HR25 | H06 |
| HR27 | Optional Insights and sampled Live Tail strategies | Kubernetes/AWS / Kubernetes plugin | HR16, HR17, HR21 | extension |
| HR28 | CloudTrail second-provider validation | AWS / AWS plugin | HR21, HR22, HR25 | H07 |
| HR29 | Read-only AI history tools | Agent API / host | HR21, HR25 | H07 |

## 6. Packet definitions

### HR00 — Selected cohort and real source inventory

- **Start:** host `go.mod`, `package.json`, runtime package/exports, shared dependency maps, SDK transport, sibling Kubernetes manifests and `pkg/main.go`, compatible UI worktree.
- **Deliver:** exact source/version selection; current identity/query/lease implementation inventory; affected resource/drawer/graph/search callers; selected Timeline/date/time/diff controls; source configuration/settings conventions; capture procedure for sanitized audit samples and a pinned kind fixture.
- **Accept:** actual dependency resolution in both Go consumers; runtime/UI source reaches host and plugin without duplicate shared instances; classify each RI handoff as present, design-only, blocked, or unavailable with evidence. Inspect relevant actual code rather than treating old UI source as selected.
- **Exclude:** rewriting workspace tooling, fetching production logs without approved scope, guessing cluster credentials, or claiming prototype runtime acceptance.

### HR01 — Canonical evidence, source and identity contract

- **Deliver:** reviewed Go/proto/TS field mapping and ownership using RI canonical references; sources versus routes; evidence versus logical requests; optional actors/resource refs; time precision; explicit representation/quality states; source/parser/config/access generations; schema evolution and unknown-field policy.
- **Accept:** contracts cover source-only authenticator failures, collection operations, multi-resource evidence, CRDs/deleted types, opaque cloud IDs, unknown UID, recreated cluster/resource, impersonation, exact large integers/time, multiple audit stages and cross-source non-deduplication. Authority lookup does not require a currently live resource catalog entry.
- **Handoff:** HC01 with named RI ownership. No public duplicate identity declaration while P45 is unfrozen.

### HR02 — Storage, privacy and deployment decision

- **Deliver:** benchmark/review SQLite driver candidates, FTS5 availability, WAL/read concurrency, platform build/linking/package cost, encryption/key management, migration/corruption handling, restrictive permissions, payload policy and offline-cache behavior. Decide supported first-release storage profile, not an unspecified encryption promise.
- **Accept:** throwaway driver proof on supported build targets; crash/reopen and disk-full behavior; Unicode text/index behavior; redaction before text/derived indexes; credential changes cannot reuse protected partitions; keys and backups have documented lifecycle. Record practical limits of secure deletion.
- **Boundary:** redacted evidence must still be useful. Raw sensitive mode is not enabled without an approved storage/security policy. Do not add SQLCipher or a remote service solely by assumption.

### HR03 — Acquisition, durability, coverage and cost protocol

- **Deliver:** HC03/HC04 concrete messages/state machines and selector binding; source discovery without scans; plan approval; bounded data/control transport; durable commit/checkpoint semantics; exact sharing; lifecycle ownership; late-arrival coverage and reconciliation; no implicit retry infinity.
- **Accept:** protocol examples resolve empty page/continuation, token expiry, partial file line, malformed/oversized record, source reset, out-of-order delivery, crash before/after commit, budget race, cancellation while opening, permission/config changes and final-subscriber teardown.
- **Boundary:** feature-specific replay optionality does not change all resource providers. “Scanned as of” remains distinct from complete source history.

### HR04 — Query, comparison and multi-context contracts

- **Deliver:** HC05–HC07 exact public request/result mapping: evidence/change/resource targets, field schema, substring versus full-text semantics, payload admission, counts/histograms/facets, frozen and live result generations, keyset paging, context transitions, direct API access, generic/native diff and typed navigation.
- **Accept:** one event can be used from resource, explicit set/graph selection, namespace/cluster, plugin and global contexts; broader scope requires explicit plan; historical-only identities open; comparison distinguishes raw patch intent, observed difference, verified transition, and unavailable; late events do not silently invalidate frozen paging. Precision/timezone handling survives UI roundtrip.
- **RI gate:** no production predicate/profile freeze while P01 numeric gate remains unresolved. No shadow result protocol or all-fields implicit text scan.

### HR05 — Optional history capability over real SDK transport

- **Start:** current SDK registration/capability parsing/client/server conventions; host `backend/pkg/plugin/loader.go`, capability detection, invocation/error boundary.
- **Deliver:** optional provider registration/negotiation, real codec/client/server, host adapter/controller lifecycle, discovery/plan/read/payload operations, typed unavailable/unsupported errors; compatible metadata and shutdown.
- **Accept:** actual provider process over gRPC transports a bounded evidence batch and cancellation; no-history plugin works without fake methods; incompatible history wire is refused before ingest; malformed/oversized messages reject before unbounded allocation; stale generation cannot commit after replacement. Provider-neutral fixture includes no Kubernetes resource body.
- **RI gate:** canonical domain/value admission handed off by P45; final public ABI through P47. Capability presence never grants permission.

### HR06 — Durable store and transactional ingestion

- **Deliver:** evidence/source/ref/payload/dedup/checkpoint/coverage schema and migrations; bounded transactional writer; projected reads; immutable raw provenance and versioned derived indexes; explicit startup corruption behavior. Reuse existing host-contained application-data conventions, not runtime informer storage.
- **Accept:** actual file-backed restart probe demonstrates duplicate replay safety, transaction rollback, no checkpoint ahead of evidence, no silent empty-database recovery, lazy payload access, disk-bound failure and access-qualified read isolation. Same native ID in different source generations remains distinct.
- **Boundary:** configuration state and retained evidence are different storage lifecycles. Byte and cardinality limits exist before large source attachment.

### HR07 — Coordinator, jobs and budget ownership

- **Deliver:** host discovery/plan/acquisition orchestration with exact compatible-job sharing, per-consumer and background-rule ownership, durable job state, policy/plan revalidation, concurrency/request/time/local-byte budgets, race-free progress attachment and explicit bounded recovery.
- **Accept:** two compatible views cause one acquisition; closing one does not stop the other; cancelled pending opens release reservations; budget is not spent twice or exceeded by concurrent reservations; source reload and shutdown terminate old generations; queue saturation cannot hide terminal state. Headless client sees real progress and stop reason.
- **Boundary:** progress stream is not a result lease. Background follow requires explicit rule ownership, not component mount side effects.

### HR08 — Kubernetes audit normalization and source corpus

- **Start:** sibling Kubernetes `connections.go`, discovery mappings, current event helpers and audit.k8s.io/v1 semantics.
- **Deliver:** source-independent audit decoder/normalizer and sanitized provider corpus; stage grouping, outcome/dry-run, principal/impersonation, timestamps, GVR/subresource/UID, non-object requests, request/response representations and patch ambiguity. Define authenticator parsing independently with uncertain correlations.
- **Accept:** actual JSONL samples cover metadata-only, request/response, failed writes, multiple stages, malformed/truncated payload, CRD, absent objectRef, unknown type, name reuse, Secrets, very large exact values and unknown patch media type. No made-up before-state or definite actor from temporal proximity.
- **Boundary:** domain parsing does not perform network lookups per record or depend on currently live objects.

### HR09 — JSONL import and durable local follow

- **Deliver:** configured file/directory source with finite import and explicit follow; identity/offset recovery, rotation, partial records, copytruncate, dedup and file access/error status. Kind setup mounts logs onto an explicitly selected host path; no hidden Docker/SSH shell access.
- **Accept:** actual pinned kind mutation arrives through SDK→coordinator→durable store, survives restart, follows rename rotation, detects truncation gaps, and does not advance beyond uncommitted lines. Run finite directory import with overlapping rotated records and a malformed line under the chosen reject/partial policy.
- **Boundary:** normal kubeconfig does not expose audit files. Remote self-managed collection is explicitly configured, not fabricated discovery.

### HR10 — Finite evidence query and host result delivery

- **Deliver:** history target in authoritative host execution service, indexed bounded range/scoped reads, admitted predicates, projection and payload gates, deterministic total order, opaque keyset cursors, frozen generation lifecycle, and result delivery using accepted common lease semantics.
- **Accept:** headless query reads actual HR06 evidence; equal timestamps page without duplicates; resource/incarnation and access scopes remain isolated; late arrivals cannot contaminate frozen pages; retained-generation expiry is explicit; missing/redacted/unsupported differs from absent. Query cancellation and slow-consumer reset release bounded state.
- **RI gate:** P13 compiler semantics, P07 admission mechanisms, P14 result protocol. Required shared outputs land under their existing owner. No copying the experimental evaluator into history.

### HR11 — Public runtime APIs and contexts

- **Deliver:** supported typed history service/hooks for source/plan/jobs/query/payload/diff/context, bounded subscriptions, stable navigation intent, selection and time propagation. Direct APIs work without built-in UI or renderer registration; sensitive scope resolves in host. Generate bindings with `task bindings`.
- **Accept:** real host bridge serves a standalone non-drawer consumer; context pivot preserves time/evidence, rejects implicit widening, clears stale responses, and cancels owned interest on unmount. Background job ownership survives view closure. No browser evaluator, opaque raw backend client export, or generated-model public ABI leak.
- **Boundary:** a plugin's display ownership is distinct from resource/provider ownership. Shared dependency/export maps stay synchronized if public shared exports change.

### HR12 — Generic evidence-backed comparison

- **Deliver:** host snapshot resolution and structured comparison; lazy bounded payload retrieval; YAML/JSON display serialization; comparison fidelity, redacted/unknown paths, provenance, create/delete sides; separately labeled raw requested patches.
- **Accept:** actual stored evidence compares two known snapshots; metadata-only returns unavailable; failed/dry-run requests never look persisted; create/delete returns an explicit known empty side; missing base/unknown patch semantics cannot produce invented values. Schema-guided ignored fields are an explicit view policy, not deletion of evidence. HR11 exposes these results; HR14 proves actual diff rendering.
- **Boundary:** diff service does not promise reconstructing every object version or identifying every intermediate change.

### HR13 — Optional controlled history presentation primitives

- **Deliver:** selected UI-source gap assessment and reusable controlled time-range/timezone controls, histogram/brush with coverage lanes, progress/lag state, virtualized evidence rows and explicit missing/diff states. Reuse existing date/time/Timeline/editor components where suitable.
- **Accept:** actual browser surfaces support keyboard/timezone/DST boundaries, accessible range edits, partial buckets, dense/sparse data, narrow drawer and full-page contexts. Drag presentation remains local; final committed range drives host acquisition, not one request per pixel.
- **Boundary:** UI components receive prepared data and callbacks. They own no resource discovery, query semantics, cost approval or durable acquisition.

### HR14 — Resource detail integration and local vertical acceptance

- **Start:** host `RightDrawerProvider.tsx`, `RightDrawer.tsx`, runtime drawer context and resource links, Kubernetes plugin drawers.
- **Deliver:** compose standard History with plugin and fallback drawers, stable view IDs, identity-only opening, snapshot versus live edit separation, resource/incarnation scope and default local query, timeline/diff/payload panels and source setup/health entry.
- **Accept:** actual kind create→patch→delete→recreate is inspectable through host UI after restart; deleted resource opens without live Get; earlier incarnation remains separate; denied current Get does not erase allowed history or enable mutations on historical snapshots. Resource/time range changes cancel superseded requests.
- **RI gate:** P03 canonical navigation and P15 runtime alignment. Preserve useful plugin-specific views rather than replace them with one compulsory generic screen.

### HR15 — EKS discovery and explicit source configuration

- **Deliver:** hint-based EKS identity resolution, verified authority/source mapping where permitted, region/account/profile/role chain, default group/prefix mapping, per-connection overrides, source settings persistence/validation and least-privilege IAM guidance. Identify log-class and backend API capabilities.
- **Accept:** default and overridden paths work in a bounded actual EKS discovery smoke; distinguish alias/name mismatch, cross-account ARN, disabled logs, absent group, denied access, missing region, expired session and non-EKS connection. Merely opening settings performs no historical scan or infrastructure mutation.
- **Boundary:** AWS credentials stay backend-only; no AWS plugin installation requirement. Never auto-enable logging/change retention/index policies.

### HR16 — CloudWatch finite evidence reads

- **Deliver:** paginated FilterLogEvents audit/authenticator adapters, safely compiled supported filters, exact host time residuals, stable delivery IDs, durable page progress, SDK cancellation/retry bounds and usage observations. Unsupported filters use declared bounded residual strategy, not altered semantics.
- **Accept:** real bounded EKS read populates local results progressively; deterministic service-boundary cases cover empty-page/nextToken, token expiry, rotated streams, duplicated/out-of-order events, oversized messages, partial failure, throttle and cancellation. Credentials/source changes invalidate old plans. Report requests/returned bytes; do not invent scanned-byte telemetry.
- **Boundary:** API result limit is not evidence-range completion. Availability depends on verified log-class/API capabilities.

### HR17 — Durable follow and delayed-arrival reconciliation

- **Deliver:** explicit background rules with pause/resume, bounded poll windows/overlap, configurable reconciliation horizon, rotation discovery, durable recovery state and lag/uncertainty reporting. Recent data stays scanned-as-of, not complete forever.
- **Accept:** finite backfill and follow overlap without duplicate durable evidence; late event behind max timestamp appears after reconciliation; laptop sleep/restart catches up within policy and exposes uncovered intervals. Budget/permission stop pauses visibly; live preview cannot mark durable coverage.
- **Boundary:** EKS upstream delivery is best effort. Desktop uptime is not an always-on compliance archive.

### HR18 — Kubernetes Events evidence

- **Deliver:** scoped list/continuation and optional watch adapter for core/events.v1 representations, native UID, reporting identity, timestamps/count/series, source retention gaps and object-incarnation linkage. Choose one acquisition representation or prove cross-representation deduplication.
- **Accept:** real kind Event/series updates appear in history with correct cumulative counts, do not duplicate across API versions, link to the correct deleted/recreated object, and recover watch/list boundaries truthfully. Upstream expiration remains visible even if retained local evidence exists.
- **Boundary:** Events are diagnostic observations, not immutable audit operations. Current `GetEvents` output alone is not sufficient ingestion input.

### HR19 — Prospective observed spec/status history

- **Deliver:** opt-in scoped source from accepted resource observation sessions, initial snapshot versus observed update classification, optional snapshots/changed paths, local observation timestamps, relist/reset/gap handling and retention/budget policy.
- **Accept:** real kind spec/status changes create observed evidence; initial list and relist do not masquerade as mutations; disconnect/410 shows uncertainty rather than fabricated replay; known UID change separates incarnations. Status/managedFields never proves a human actor.
- **RI gate:** P05/P10 and compatible P12 acquisition sharing. Do not bolt a second all-cluster informer onto the history drawer.

### HR20 — Historical field-change and text search

- **Deliver:** typed structured-change projections and explicit text index operators over permitted fields; schema/path index lifecycle; queries returning matching evidence or distinct resource refs; backfill/rebuild coverage/version tracking. Source bodies and derived changes retain separate availability.
- **Accept:** actual retained evidence finds an image/replica change and deleted resource; “request touched field” differs from known old/new-value change; token/phrase and substring semantics remain distinct and correct; redacted/unrecorded values cannot satisfy value predicates or negative completeness claims. Rebuild does not silently omit older evidence.
- **Boundary:** semantic changed paths require defensible baselines; no full-payload-leaf index or all-fields secret discovery by default.

### HR21 — Union, aggregates and general history discovery

- **Deliver:** authorized explicit multi-authority/source targets through shared union execution; global order/paging, source-qualified partial coverage, histogram/facet/count definitions, distinct-resource provenance, and integration with authoritative resource/command search entry points.
- **Accept:** two sources/authorities return correctly ordered bounded results; one denied source cannot leak cached data or be hidden as empty success; partially fetched histogram labels remain accurate; a resource result links to the matching historical evidence. Querying a plugin does not automatically include every configured connection.
- **RI gate:** P35 union, P43 resource result integration; palette navigation may be delivered earlier using P42 without pretending it performs resource search.

### HR22 — Full plugin-native views and general graph consumer

- **Deliver:** existing-registry contributions for optional full views/detail/diff renderers, typed matching/priority/unload behavior, scoped direct runtime usage, one Kubernetes plugin-wide custom view, and one independent graph-context consumer. Reuse existing full plugin route trees, not another plugin routing registry. Add one schema-aware native comparison presentation using HC07 results.
- **Accept:** resource detail, plugin view, and independent graph presentation show the same evidence IDs via the same services; no compulsory Timeline component or renderer registration for direct API access. Pivots preserve time/scope, widening replans, unload cleans subscriptions, and renderer failure preserves generic evidence access. Historical selection does not mutate live data.
- **Boundary:** graph layout/transforms may be local. Current graph edges remain labeled current; exact historical topology or state-at-time reconstruction is not required or claimed.

### HR23 — Saved investigations and evidence pins

- **Deliver:** global/authority/plugin workspace using HR APIs; versioned query/context documents, notes, ordered evidence references, explicit frozen evidence pins, saved relative versus absolute time, missing-plugin/source states, safe migration and transactional pin ownership.
- **Accept:** save/reopen an investigation after deletion/source removal/restart; distinguish rerunning a moving query from reproducing captured evidence. Pins retain only permitted evidence under policy and do not grant permanent access. Actor/resource pivots preserve provenance and source coverage; missing evidence remains a typed state.
- **RI gate:** coordinate P31/P32 shared saved-document formats without requiring the full dashboard builder.

### HR24 — Retention, recovery and operational management

- **Deliver:** source/job/index management with build/pause/resume/reconcile/drop/rebuild; age/byte/payload/pin retention, local usage/lag, corruption and schema/parser migration recovery, explicit source deletion/uninstall policy, bounded backup/maintenance behavior.
- **Accept:** actual disk-pressure/corruption/crash probes stop or recover without advancing false checkpoints; purge reconciles payloads/FTS/changes/coverage and preserves allowed pins; dropped derived index can rebuild without refetching retained evidence; access invalidation removes protected read visibility. Parser upgrades do not claim a rebuild when raw material is no longer retained.
- **Boundary:** base limits/privacy/restart safety already ship in HR06/HR07. This packet completes management and adversarial acceptance, not basic correctness deferred until the end.

### HR25 — Portable evidence and export/import

- **Deliver:** versioned bounded export package/manifest with evidence IDs/source locators/hashes, exact scope/time, coverage, normalization versions, redaction state and optional allowed payloads; streaming export cancellation; read-only imported investigation source and citation resolution.
- **Accept:** actual export→import roundtrip preserves exact times, missingness, citations and comparison fidelity without credentials. Reauthorize export; cap archive entry counts/decompression/path traversal; integrity failure is explicit. Hashes establish package consistency, not a cryptographic proof that the upstream source was truthful.
- **Boundary:** referenced-only export is distinct from self-contained evidence. No import executes plugin code, queries a cloud backend or silently merges authorities.

### HR26 — Coordinated Kubernetes/EKS release acceptance

- **Deliver:** reviewed compatible SDK→host/runtime→Kubernetes/UI release set, migration/admission behavior, documentation/settings/IAM guidance, reproducible kind and bounded EKS smoke receipts, benchmark thresholds derived from baseline and independent review.
- **Accept:** actual app exercises resource, explicit resource set/graph, namespace/cluster, plugin and global contexts, progressive finite query, follow/recovery, text/field search, snapshot/diff, source/job status, saved investigation/export and deleted-resource navigation. Verify first-release security/storage policy, unsupported history plugin behavior, no shared-instance duplication and all affected callers migrated.
- **RI gate:** P46/P47. Build runtime before Vite plugin; use `task bindings`; `GOWORK=off` for all Go commands. Run package checks after coordinated edits settle, then actual source/UI smoke. No production cloud mutation is required; use an approved sandbox/time/budget.
- **Boundary:** no completion from screenshots backed by mocks, package builds alone, or a fixture-only EKS test.

### HR27 — Optional CloudWatch analytical and preview strategies

- **Deliver:** capability-qualified Insights queries/StopQuery/cost accounting with truncation handling and optional sampled Live Tail preview; clear mode differences, preview-to-durable reconciliation and backend strategy explanation.
- **Accept:** explicit bounded cloud exercise reports real query status/usage; incomplete result cap never becomes full coverage; Live Tail sampled flag/disconnection cannot mark durable success; unavailable indexes/log classes select an honest alternative or unsupported result. Field-index eligibility/time coverage is preserved.
- **Boundary:** not required for first durable EKS implementation. No automatic field-index/subscription provisioning or invisible paid fallback.

### HR28 — CloudTrail and EC2 validation

- **Deliver:** optional AWS plugin history provider with explicit Event history versus trail/Lake capabilities and cost/retention; mapping to native cloud identities; EC2-native presentation using generic evidence contracts.
- **Accept:** actual bounded supported CloudTrail path queries a native AWS identity without Kubernetes fields; management-event history is not advertised as all historical events; request evidence is not fabricated before/after state. Same headless and custom-view APIs work.
- **Boundary:** future second provider, not initial Kubernetes scope. Additional AWS archive/Lake infrastructure requires separately defined configuration and approval.

### HR29 — Read-only AI adapter

- **Deliver:** discover/describe/plan/query/page/read/compare/traverse/cancel tools over existing host services; stable evidence citations and budget policy; optional investigation capture under user policy.
- **Accept:** headless invocation returns the same scoped results/coverage as UI, cites permitted evidence, refuses wider spend/access, and handles prompt-injection text as data. No React/UI dependency, arbitrary backend query execution, embeddings requirement or mutation permission.
- **Boundary:** future integration consumer; typed headless contracts are delivered much earlier in HR11.

## 7. Launch schedule

### Start now: close the decision frontier

1. HR00 establishes current sources and missing RI handoffs.
2. HR01 and HR02 proceed in parallel after HR00. Neither requires resolving every presentation decision.
3. HR03 and HR04 proceed in parallel after domain/storage decisions. Review their shared plan/query/context/coverage boundary together.
4. Open/advance exact missing work under existing RI owners for canonical domain, safe query profile, compiler/results and runtime admission. Numeric hold remains a real blocker, not a reason to ship altered query semantics.

**First dispatch:** assign HR00 to one integration owner. Its receipt must contain a selected-source matrix, an existing-service versus missing-handoff matrix, an affected-caller map, a source-sample/kind collection plan, and a compatible UI primitive inventory. That receipt makes HR01/HR02 assignable. Do not start production provider/API edits from this backlog alone.

### First running local path

After required contracts and RI handoffs: HR05, HR06, HR08, and HR13 can proceed independently within their locks. HR07 and HR10 follow their prerequisites; HR09 and HR12 then proceed independently, HR11 exposes the usable comparison/query/job APIs, and HR14 delivers the complete local path. HR00–HR04 design and prototypes do not themselves complete H01.

The first app proof is: configure local source → create/patch in kind → progressive retained evidence → read-only diff → restart → delete/recreate → open historical incarnation. A headless runtime consumer must work before product UI acceptance.

### EKS and contextual sources

HR15 can begin once HR03/HR08 resolve its contracts; it need not wait for finished drawer polish. HR16/HR17 follow coordinator and EKS prerequisites. HR18 and HR19 are independent adapters once their respective resource-session handoffs exist. HR20 can proceed alongside cloud acquisition using real local evidence. HR22 can proceed alongside EKS once runtime/comparison/components are usable.

### Investigation and release

HR21 joins authoritative targets; HR23 delivers investigation persistence/pins. HR24 completes operations/retention and HR25 portability. HR26 requires the complete Kubernetes/EKS path, not only one successful local timeline. HR27–HR29 are separately eligible extensions; do not put them on the initial release critical path.

### Ownership locks and integration rules

- One owner for SDK history/domain/protobuf files and capability admission.
- One owner for durable schema/ingestion/checkpoint migrations; adapters must not write store tables directly.
- One owner for query/result/CEL integration with RI. UI/source owners consume reviewed DTOs.
- Runtime exports/bindings/shared dependency maps have one integration owner; regenerate once after compatible schema changes settle.
- JSONL/CloudWatch/Events/observed-state adapters share normalized evidence fixtures, not mutable store internals.
- UI primitive, host resource view, and plugin custom-view owners can work independently after HC06/HC07 freeze.
- Integration owner records actual selected dependencies, evidence, migrations/removals and release receipts. No agent independently publishes an incompatible package.

## 8. Unresolved decisions and closure criteria

| Decision | Conservative direction | Owner / closure |
| --- | --- | --- |
| Production query dependency | Preserve upstream-first safe numeric gate | Existing P01 owner supplies admitted pin/profile; do not rerun unchanged known failures |
| Canonical domain availability | Consume RI-owned domain, no historical alias fork | HR01 + P45 reviewed field/codec ownership |
| SQLite driver/encryption | Benchmark supported local choices; redacted default | HR02 records selected platforms, key policy, measured packaging and crash behavior |
| Offline access/revocation | Explicit retained-evidence policy and access partitioning | HR02 security decision; UI labels offline authorization limits |
| Native recovery ACK | Smallest protocol that proves commit/replay safety | HR03 source-specific proof, not universal custom ACK assumption |
| Text operators | Explicit substring versus token/phrase contracts | HR04 semantic cases; HR20 accelerator completeness proof |
| Frozen paging retention | Bounded host snapshot/generation lifetime, explicit expiry | HR04/HR10 store and lease design; avoid unbounded long-lived SQLite readers |
| Audit record grouping | Preserve stage evidence; explicit logical request projection | HR01/HR08/HR21 count and identity semantics |
| Patch format certainty | Unknown stays raw intent | HR08 corpus; HR12 never guesses application semantics |
| Remote self-managed audit transport | Explicit configured supported backend | HR09 ships local mounted/imported JSONL; broader remote transport is a new adapter packet, not hidden SSH execution |
| Default budgets/windows/retention | Narrow finite defaults with explicit broader rules | HR00 baseline + HR07/HR17/HR24 measured policy; no invented SLOs |
| Evidence export trust | Integrity/provenance metadata, no legal chain-of-custody claim | HR25 documented threat model and bounded import |

## 9. Cross-check against user requirements

| Requirement | Accountable packets |
| --- | --- |
| Plugin audit/history provider API | HR01, HR03, HR05 |
| Resource and plugin audit actions/custom views | HR04, HR11, HR14, HR22 |
| General graph and larger/global contexts | HR04, HR21, HR22, HR23 |
| EKS defaults and configurable CloudWatch paths | HR15, HR16, HR17 |
| Plain Kubernetes and actual kind validation | HR08, HR09, HR14, HR18, HR19 |
| Who did what, impersonation, failed requests | HR08, HR16, HR20, HR23 |
| Events and spec/status changes | HR18, HR19 |
| YAML and plugin-native diffs | HR12, HR22 |
| Text/field history search and deleted resources | HR10, HR14, HR20, HR21 |
| Live tail/follow and durable index status | HR07, HR09, HR17, HR24; sampled preview HR27 |
| Time brush, moving windows and requestable paging | HR04, HR10, HR13, HR17, HR21 |
| Progressive fetch, bounded cost and local persistence | HR02, HR03, HR06, HR07, HR16, HR17 |
| Deep investigations and reusable evidence | HR23, HR24, HR25 |
| AI-ready discovery, filters, citations and headless access | HR01, HR04, HR11, HR25; tool integration HR29 |
| Future AWS CloudTrail/EC2 | HR28 |

## 10. Planning verification and limits

Reviewed parent architecture, existing RI work packages/readiness/source/query contracts, current host package and dependency surfaces, Kubernetes registration, and existing UI Timeline/range component source. Read current remote P01/P45 issues without modifying them. No new issues, boards, branches, dependencies, application code, cluster resources or paid queries were created.

This backlog defines ownership roles and acceptance requirements, not assigned engineers or promised dates. All new contract gates remain unfrozen until their packet review. Product verification belongs to packet execution; document consistency checks do not certify implementation.

Executed document checks: 30 unique indexed packets match 30 definitions; all HR predecessors exist; dependency graph is acyclic; HR00 is the sole dependency root; both planning documents have balanced code fences and valid local Markdown links. Contract frontier is HR00 → HR01/HR02 → HR03/HR04. These are planning-structure checks, not application tests.
