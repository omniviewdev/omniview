# Resource intelligence: agent work packages and launch order

Date: 2026-10-17
Status: proposed backlog, not approval to implement.
Design context: [Product roadmap](2026-10-17-product-roadmap.md).
Execution: [Contract readiness](2026-10-17-resource-intelligence-contract-readiness.md), [complete launch schedule](../superpowers/plans/2026-10-17-resource-intelligence-launch.md), [P00 baseline plan](../superpowers/plans/2026-10-17-resource-intelligence-baseline.md). Start with actual C00 evidence; the dependency frontiers are eligibility, not permission to code against unfrozen contracts.

Remote execution: [complete issue index and progress-maintenance rules](2026-10-23-resource-intelligence-remote-index.md), [delivery project](https://github.com/orgs/omniviewdev/projects/13), [parent roadmap](https://github.com/omniviewdev/omniview/issues/78). Stable P IDs and hard dependencies are preserved as native GitHub blocked-by relationships; launch waves are dependency eligibility, not dates. UI-quality followups are separately scoped and do not complete the full packets below.

## Execution reconciliation — 2026-10-22

The separate UI repository's `feature/resource-intelligence-table-ui` work supplies reusable presentation/editor subsets, not completion of these end-to-end packets. Paths in this section are **relative to the UI repository**, not host paths. This tracking update records available source and previously reported scoped checks; it runs no builds/tests and does not certify a merged release or production integration.

| Packet(s) | Available UI execution evidence | Remaining acceptance |
| --- | --- | --- |
| P18 / P19 | Monaco CEL editor and controlled bridge: `packages/editors/src/components/cel-query-editor/{CelQueryEditor.tsx,bridge.ts,CelQueryEditor.test.tsx,bridge.test.ts}`; retained editor workbench at `packages/editors/src/development/cel-language-service/ResourceWorkbench.stories.tsx` | Reuse this editor evidence rather than repeat feasibility implementation. P18's actual host focus/accessibility/startup/memory decision and P19's production contract/host integration remain unproven; dependencies still apply |
| P16 / P17 / P19 | Focused LSP adapter at `packages/editors/src/development/cel-language-service/{index.ts,lsp.ts,decoder.ts,lsp.test.ts}` and `tools/cel-language-service/{lsp.go,lsp_position.go,lsp_transport.go,lsp_test.go}` | Real schema/discovery/access generations, permission-aware inventory suggestions and production authoring contract freeze |
| P20 / P21 / P31 | Controlled query input, builder, variables and value controls at `packages/base-ui/src/components/query-authoring/{QueryAuthoring.tsx,QueryInput.tsx,QueryBuilder.tsx,QueryVariables.tsx,QueryValueInput.tsx,QueryAuthoring.test.tsx,QueryBuilder.test.tsx}` | Host resource-view wiring, authoritative builder conversion, query persistence, variable validation/dependencies and atomic lease replacement |
| P23 / P24 / P30 | Prepared/controlled table and virtual detail implementation at `packages/base-ui/src/components/data-table/{DataTable.tsx,DataTableVirtualBody.tsx,types.ts,DataTable.Controlled.test.tsx,DataTableVirtualBody.test.tsx,DataTable.Prepared.stories.tsx}` | Actual host adapter, performance baseline, authoritative group results and live identity/lease behavior; not P29 grouping execution |
| P27 / P28 / P33 | Visualization/binding/layout presentation at `packages/base-ui/src/components/visualization/{Visualization.tsx,VisualizationBindingEditor.tsx,ViewLayout.tsx,Visualization.test.tsx,ViewLayout.test.tsx}` | P26 registry cutover, schema/field validation, contributions, saved documents and actual expanded host consumers |
| P25 / P30 / P31 / P35 / P36 / P43 | Reusable controls at `packages/base-ui/src/components/resource-workspace-controls/{ResourceScopePicker.tsx,ResourceGroupingControls.tsx,ResourceResultNavigation.tsx,SavedResourceManager.tsx,ExploreWorkspace.tsx,ResourceSearchResults.tsx,ResourceWorkspaceControls.test.tsx}` | Child/result lease lifecycle, host grouping, saved configuration, authorized multi-provider execution, actual Explore routes/search; controls do not implement these services |
| P37 / P38 / P39 / P40 / P41 | Inspector controls at `packages/base-ui/src/components/resource-inspector-controls/{RelationshipRuleEditor.tsx,RelationshipPreview.tsx,QueryExplainPanel.tsx,ResourceIndexManager.tsx,ResourceInspectorControls.test.tsx}` | Real graph rule derivation, explain/index inventory, index lifecycle/budgets/permissions and persistence; no host operations are established by UI callbacks |

The real Go CEL **development fixture service** lives in `tools/cel-language-service/{service.go,language.go,catalog.go,values.go,service_test.go}`; its supported contract and limitations are recorded in `tools/cel-language-service/README.md`. It uses native CEL checking/evaluation, exact integer decimal-string bindings and typed string/bool bindings, never source interpolation. Its integer-only profile rejects mixed floating-point use; it does not resolve P01's production numeric gate. Pod/cloud/VM fixture profiles are not P44's real provider/SDK-boundary conformance corpus.

The implemented LSP 3.17 subset includes initialization/shutdown, full document open/change/close, completion, hover, signature help, pull diagnostics and cancellation, over stdio and loopback HTTP JSON-RPC. UTF-8/UTF-16 position conversion and document/session isolation are development authoring behavior, not a production authorization guarantee. Catalog/evaluation stay separate from LSP. No formatting, rename, indexing, full packet completion or production Wails service is claimed.

Thirteen composition-only Resource Intelligence stories were trimmed; reusable controls, component-focused stories/tests and the editor workbench remain. Their removal is not removal of the underlying controls, and retained fixture demonstrations are not production integrations.

**Current frontier:** P00/C00's [selected-source baseline](2026-10-17-resource-intelligence-baseline.md), P44's real SDK conformance and P02's [available-surfaces performance baseline](../../bench/app/README.md) are accepted. Full P04/C02 acceptance is merged through [PR136](https://github.com/omniviewdev/omniview/pull/136), including its published SDK/Kubernetes consumers; [issue #83](https://github.com/omniviewdev/omniview/issues/83) is closed. P42/C11 command/provider acceptance is merged through [PR139](https://github.com/omniviewdev/omniview/pull/139), with [actual-header/native-service and independent review receipts](2026-10-25-global-command-search-acceptance.md); P43 still requires P35's authoritative query service. P01's reviewed design/spike is merged; production numeric/profile admission remains blocked. P18 reuses merged editor/portable browser evidence while retaining native feasibility gates. P23's P00/P02 predecessors are closed, but its authoritative host-prepared result/order/window integration still consumes unfrozen C08. Baseline or UI acceptance alone does not freeze production contracts; accepted C02 and P42's feature-local C11 do not complete provider/schema/numeric/query/lease gates.

## How to use this backlog

Each P-number is a separately reviewable deliverable, normally one PR in its owning repository or a coordinated cross-repository release set when a protocol changes. Do not dispatch an entire milestone as one coding assignment. Do not split a coherent behavior into scaffolding, wiring, and mock-only PRs.

**Depends** lists hard package dependencies, not every product-priority preference. Dependencies must have reviewed contracts and usable outputs before downstream implementation begins. Interface design can overlap; code must not depend on guessed signatures. **Size** is an uncalibrated S/M/L risk/capacity label, not a promise of agent wall-clock time; see the roadmap's planning envelope. Read current source at execution time; paths below are starting points, not a frozen line-number patch plan.

All packets inherit provider neutrality, bounded CPU/memory/IPC, cancellation, structured errors and no secret discovery. Architecture wins over source/binary/API compatibility: existing Find/FilterExpression, GVK keys, mandatory CRUD, Wails-v2 namespaces and raw client exports may be replaced. One semantic authority and explicit compiler stages do not mean one historical AST. Migrate affected callers/configuration, delete superseded paths before release, and keep sound implementations where they fit. SDK capabilities are not permission grants.

**Provider-neutrality is mandatory for all 48 packets.** Core querying/identity/schema/acquisition/graph/UI/persistence cannot require Kubernetes metadata, GVK, namespace, UID/resourceVersion, labels, owner references, RBAC, CRUD or informers. AWS/GCP/Azure/OCI, Docker/Podman, Proxmox and other conforming single-provider plugins do not wait for Explore. Provider-specific optimizations stay behind explicit capabilities/adapters, not permanent adapters for legacy public contracts.

**Pragmatic thin clients apply across all packets.** The host owns authoritative resource/query semantics and expensive inventory-dependent processing; every client must obtain correct results without another engine. Bounded local presentation work, UI caches/keyed maps, editor mechanics/token display, cached suggestion narrowing, static-command matching and appropriate graph layout are allowed when simpler/faster. Do not return only raw events and force clients to reconstruct query results, or label local filtering of a partial window as a complete query. Workers/WASM can support justified presentation, not replace universal service semantics. Measure latency, CPU, heap and wire cost; avoid unnecessary backend round trips and full-inventory transfers.

| Affected packets | Required computation placement |
| --- | --- |
| P03/P12–P15 | Host owns canonical identity, result semantics and execution sharing; clients may use bounded keyed maps/cache/deduplication and apply prepared frames |
| P16–P21 | Host provides authoritative parsing/schema/type/discovery services and exact edits; bounded editor mechanics, lexical display and cached suggestion narrowing may be local without becoming a second semantic engine |
| P23–P30 | Host owns resource order/groups/counts/membership; local geometry/virtualization and explicitly scoped presentation transforms are valid. Partial-window transforms never claim complete-query semantics |
| P31–P38 | Host validates variable/config semantics and dependencies, owns acquisition/sharing/graph derivation; clients may provide responsive editing, widget arrangement and measured graph presentation/layout |
| P39–P43 | Host owns indexes/explain/advice and resource search; small static UI-command matching may remain local. Resource/permission semantics stay portable across clients |

The [reviewed foundation](../superpowers/specs/2026-10-17-resource-foundation-design.md) governs these boundaries. Future concrete wire/API design must make thin clients possible rather than documenting a prohibition while sending only raw provider events.

P44 is an early verification deliverable; stable packet numbering does not imply launch order. Its cloud-style, container-style and hypervisor-style profiles exercise applicable behavior in every generic packet. Provider-only P08–P11 retain Kubernetes-specific acceptance; Kubernetes examples in other packets are additional integrations, not the definition of core success. No requirement to implement all future product plugins is introduced.

For bug packets, reproduce the relevant static finding first, retain a consumer-visible regression case where practical, then demonstrate the corrected path. For features, exercise the actual API/UI path, not just forwarding mocks. Code-only experiments are throwaway until a focused design approves their adoption. No packet requires production credentials or mutation of a real cluster.

**Breaking-cutover rule:** P01 decides the target design without an old-API constraint; P45 implements the new provider contract; P47 owns public ABI/caller/legacy removal; P46 owns incompatible-plugin admission and the compatible release gate. Packet IDs remain stable; P08–P11/P03/P05 are retargeted to the replacement rather than repairing code about to be removed. Any temporary migration translator is private and deleted before M1, never a shipped fallback.

### Frozen contract artifacts

These are contract subjects, not preselected filenames or new API symbols. The owning packet records exact names/types before consumers are dispatched.

| Contract | Owner | Must specify |
| --- | --- | --- |
| Query semantics | P01 | Canonical QuerySpec vs selected-language parser AST vs logical IR vs physical plan vs native selector; typed paths/literals/parameters, collection quantifiers/correlation, exact numeric policy, null/missing, text+filter composition, sorting/paging/live windows, cost bounds and unsupported semantics; legacy Find is not a constraint |
| Resource and query identity | P01/P45 contract; P03 consumer cutover | Resource refs use provider/AuthorityID/type/exact identity scope/object ID; connection is access-route provenance, not identity. Host-generated canonical handles, optional incarnation/revision, type/API/schema version separation and access-qualified sharing; no client identity/query canonicalization |
| Invocation and errors | P04 | Trusted actor provenance vs caller input, target scope/operation, cancellation/request ID, handle ownership, permission epoch slot, denied/partial/unsupported/stale states |
| Resource/schema discovery | P07 | Authoritative resource catalog/schema revisions, structure/queryability/native-support separation; static/discovered/absent schemas and derived editor/filter projections; no mandatory action-schema helper or old RPC signature |
| Snapshot/read model | P12 | Finite paginated acquisition plus optional updates; coverage/freshness/source consistency, hydration, host snapshot watermark/epoch, explicit refresh/reset, ownership/eviction; no invented source-wide order or mandatory watch |
| Live query lease | P14 | Initial snapshot and optional ordered host delta/reset, source capability/freshness, enter/update/leave/delete, sort/page effects, backpressure, resnapshot, deduplication and cancellation/refcount |
| Completion/editing | P16/P17/P19 | Cursor/replacement range, schema path, operator/type, key/value prefixes, result bounds/completeness, request generation/cancellation, language adapter lifecycle |
| Saved configuration | P31/P32 | Query/language/config versions, variable typing/binding/dependencies, user-owned component instances/layout, plugin contributions and missing-plugin behavior |
| Index lifecycle | P40 | Provider identity/query scope, path/type/schema version; host build generation and observed-update/refresh catch-up; source coverage/freshness; memory/disk budgets, invalidation, safe drop/rebuild and sensitive data policy; no mandatory source resourceVersion |
| Provider boundary | P45 | New resource protocol major and neutral DTO ownership; catalog plus independent enumeration/get/native-query/update/mutation/action support; connection/scope capabilities and source-vs-query paging/coverage; no mandatory Find/CRUD/list or true-by-default flags |
| Public runtime ABI and admission | P47/P46 | Supported frontend contracts/imports, private host transport, canonical model/enum exports, incompatible UI/backend refusal, caller/package/contribution migration and explicit deletion list; user-data migration safety |

## A. Baseline, fixes, and contracts

### P00 — Resolve the integration baseline
- **Depends:** none
- **Owner / size:** integration owner; host + selected source worktrees; S
- **Start:** host `go.mod`, `package.json`, `Taskfile.yml`, plugin shared-dependency lists; sibling Kubernetes module/package manifests; `ui/main` package exports; existing workspace plan.
- **Deliver:** resolved source/version matrix and isolated linking procedure; inventory all host/runtime/plugin consumers of Find/List search, namespace/GVK identity, providers/raw clients, compatibility models and legacy contributions. Assign every affected surface to P03/P05/P07/P10/P15/P26/P43/P45/P47; P43 owns legacy `useResourceSearch` callers and superseded search execution. Inventory is migration input, not a reason to keep old APIs.
- **Accept:** demonstrate selected SDK source actually reaches both Go consumers with `GOWORK=off`; demonstrate one selected UI/runtime export reaches host and plugin without duplicate React/CSS/runtime instances. Record current versions and incompatibilities; do not merely change version strings.
- **Exclude:** implementing the existing workspace program again. If environment prerequisites are not delivered, use a verified equivalent for these smokes and name its limits.

### P44 — Early provider-neutral conformance fixtures
- **Depends:** P00
- **Owner / size:** SDK/host conformance owner; verification fixtures using the real plugin/service boundary; M
- **Start:** provider-native fixture data and semantic expectations, existing SDK transport only for baseline probes, P00 version map and the evolving P01/P45 replacement contracts.
- **Deliver:** deterministic verification-only provider profiles: paginated flat cloud-style resources with ARN/OCID-like opaque IDs, account/region scopes and tag arrays; container-style objects with engine scope, labels and optional event updates; hypervisor-style objects with node-local numeric IDs, host/VM/disk links and snapshot-only reads. Include bundled and absent schemas, read-only/no-server-filter modes, optional incarnation/version and explicit partial/eventual coverage. Keep these as reusable conformance fixtures, not released product providers or frontend fake rows.
- **Accept:** complete the provider-native corpus and real current-SDK baseline probes without fabricated Kubernetes bodies/identity. P44 can finish before P01/P45; P45 owns porting these fixtures to the new-major boundary. Do not freeze GVK wire encodings to avoid migration or certify future APIs. Keep opaque ID and honest coverage/freshness expectations as reusable consumer behavior.
- **Exclude:** implementing AWS/GCP/Azure/OCI/Docker/Podman/Proxmox plugins, a generic cloud emulator, required production credentials, or a product fallback that returns fixture data.

### P01 — Complete the CEL query/resource contracts and confirmation gates
- **Depends:** P00, P44
- **Owner / size:** query contract owner; SDK + host design/spike; M
- **Start:** product requirements, P44 corpus and current SDK/host contracts as evidence of constraints to remove, not as a mandatory architecture.
- **Deliver:** concrete canonical request/result/error contracts using the accepted CEL direction and internal checked AST/program, with a host query plan and bounded builder/pushdown forms only where justified. Define the versioned safe environment/profile, typed identity, parameter/numeric wire policy, schema admission and incomplete-draft tooling needed for P45. Legacy Find/FilterExpression/TextSearchProvider do not constrain the design. Language selection has evidence; production integration still needs confirmation.
- **Accept:** corpus covers maps/tag arrays, same-element array correlation, quantifiers, opaque IDs/scopes, absent schema/UID, quoted paths, missing/null, exact large integer and timestamp transport, typed bindings/injection, text+predicates+scope, deterministic global sort/page, invalid/unsupported input and complexity limits. Partial cursor input is useful; supported builder/text and pushdown/residual paths agree semantically without forced AST identity.
- **Numeric dependency gate:** follow the [accepted upstream-first correction strategy](../superpowers/specs/2026-10-17-cel-binding-schema-contract.md#7-numeric-profile-investigation). The isolated fix has executable evidence, not production approval. Confirm the actual dependency pin, numeric/optimized-membership conformance and patch ownership/removal if a temporary patch is separately approved. Do not replace this gate with a host equality engine or blanket rejection of dynamic queries.
- **Exclude:** implementing the full planner or source protocol in this design packet, multiple independent semantic engines, preserving old query behavior solely for compatibility, or inventing a textual DSL just to obtain an IR.

### P45 — New-major provider contract and usable SDK/host read boundary
- **Depends:** P01, P04, P44
- **Owner / size:** SDK/provider boundary owner; SDK transport/registration + host adapter; L
- **Start:** current Resourcer/ResourceProvider, registry capability derivation, resource proto/client/server, P01 target contract and P44 providers.
- **Deliver:** usable new resource protocol major with opaque types/refs/scopes/metadata and required resource catalog; independently supported enumeration/get/native-query/update/mutation/action interfaces with honest connection/type/scope-qualified descriptors. Separate source pages from host query pages, preserve agreed numeric precision, remove mandatory Find/CRUD/list and true-by-default flags, and decouple host contracts from generated/v1 DTO aliases. One RPC service may dispatch optional operations.
- **Accept:** P44 providers enumerate through real new-major gRPC/host API with correct support/errors; get-only/native-query-only capability variants cannot advertise enumeration or mutation, and read-only sources need no fake methods. Verify page/coverage/unknown-total/cancellation/opaque-scope semantics without old resource adapters. Preserve active logs/exec/metric implementations; no mechanical service-per-method split.
- **Exclude:** full host query evaluation (P13), live-session implementation (P05), normalization/editor UX (P07), a generic plugin framework rewrite, or shipping an old/new public dual stack. P47 removes temporary in-branch shims after consumers migrate; P46 enforces final admission.

### P02 — Establish end-to-end resource performance baselines
- **Depends:** P00, P44
- **Owner / size:** performance owner; host `bench` + UI benchmarks; M
- **Start:** `bench/app`, `bench/render`, `scripts/perf`; UI `packages/benchmarks`.
- **Deliver:** repeatable query/table-shaped corpus and actual Go→IPC→runtime→paint measurement path, plus existing isolated renderer measurements. Record source watches, scans/evaluations, stream/lease counts, IPC bytes, retained objects/heap, CPU and latency.
- **Accept:** capture a named baseline across the P44 cloud/container/hypervisor profiles plus Kubernetes payloads; distinguish native/server/browser and fake-backend evidence; profile typing, scrolling, sparse patches, groups, expansion and repeated mounts using available surfaces. Measure paginated/snapshot-only acquisition separately from event-driven update work. Later features extend the harness; never claim completed behavior from simulation.
- **Exclude:** optimization without measurement or fixing arbitrary unrelated benchmark regressions.
- **Accepted receipt:** [PR134](https://github.com/omniviewdev/omniview/pull/134), merge `1e67b3303598ffae2ffe4538b6e0fc8294d0faf5`; [real-path reproduction and limits](../../bench/app/README.md), [portable baseline](../../bench/app/resource-baseline-2026-10-24.json) and [separate lifecycle cleanup](../../bench/app/resource-cleanup-2026-10-24.json). Original available-surfaces acceptance is complete. Future host query evaluation/leases and native pixel or retained-heap plateau claims remain unavailable, not zero or implicitly accepted.

### P03 — Canonical resource identity and cache cutover
- **Depends:** P00, P44, P45
- **Owner / size:** identity/domain owner; host store/graph/runtime consumers; L
- **Start:** `packages/omniviewdev-runtime/src/hooks/resource/{useResources,useResource,useResourceSearch,useEventBatcher,useResourceActions,useResourceMutations}.ts`; `ui/components/tables/Resources/index.tsx`; backend registry/graph identity types.
- **Deliver:** migrate stores, graph refs, runtime list/detail/search/mutation/action keys and affected navigation/config references to P45 structured identity and canonical result ownership. Opaque types/scopes replace core GVK/namespace parsing and slash concatenation; preserve source ID meaning and optional incarnation. Do not patch the old default-table listener just to delete it in P15; migrate its caller once.
- **Accept:** same-name scoped/global resources remain correct, delimiter-containing IDs and node-local VM IDs roundtrip, graph/cache/invalidation/navigation agree, and unsupported recreation detection is explicit. One-way preference/reference migration preserves user choices or reports unconvertible entries without overwriting originals; no legacy-key alias remains.
- **Exclude:** the query compiler or whole public-ABI retirement owned by P47. Useful workflows survive; legacy request/key shapes need not.

### P04 — Trusted invocation seam and uniform resource errors
- **Depends:** P00
- **Owner / size:** service/security contract owner; host resource services + SDK context as needed; M
- **Start:** `backend/pkg/plugin/resource/{controller.go,service_wrapper.go,graph_service.go}`; `backend/pkg/apperror`; SDK context; runtime error parser and shared API exposure.
- **Deliver:** host-owned invocation-context boundary for future query/discovery/graph/lease operations; target scope, operation, request/cancellation and handle ownership; consistent permission/partial/unsupported error mapping. Document which current plugin call paths cannot authenticate a distinct plugin actor.
- **Accept:** denied service operations cannot create handles/populate caches; invalid/unsupported/provider errors retain consistent meaning; caller-supplied IDs do not grant privileges. Exercise host errors and preserve useful workflows through migration, not through old export/DTO compatibility. Document current UI plugins as trusted same-realm code until a separate isolation project.
- **Exclude:** full ABAC engine, grant/consent product UI, plugin install policy, AI tooling, or pretending a shared-origin wrapper authenticates hostile code.

### P05 — New source snapshot/update session protocol
- **Depends:** P00, P44, P45
- **Owner / size:** SDK source-session owner; SDK/host transport + conformance providers; L
- **Start:** P45 provider boundary; old watch.proto/client/server/sink as implementation evidence, not compatibility requirements.
- **Deliver:** source-scoped finite acquisition and optional snapshot-plus-update sessions with typed identity/metadata envelope, snapshot boundary, source capability/coverage/freshness, reset/completion/cancellation and host/source-token distinction. Replace old independent List+type-watch stitching where superseded; snapshot-only sources terminate truthfully. Provider clients/informers may be reused behind the new session API.
- **Accept:** concurrent snapshot/add/update/delete cannot silently gap or overwrite newer host observations under the declared source guarantees; finite and event profiles work through real transport, optional metadata stays optional, lost coverage resets explicitly and sources do not manufacture global order. No raw-body Kubernetes metadata reconstruction is required.
- **Accepted contract / evidence:** [source-session boundary and executed probes](../superpowers/specs/2026-10-17-source-session-contract.md). Independent cutover and loopback lifecycle probes passed asserted outcomes; real SDK codec/negotiation, native adapter guarantees and query-result integration remain gates. Require pre-allocation wire limits and independently cancellable terminal paths; no implication that contiguous frames repair native recency or that fixture scheduling notifications are production ACKs.
- **Exclude:** adding metadata to old watch messages as a throwaway first step, mandatory watches/pollers, a second query evaluator, or preserving the old type-subscription API after cutover.

### P06 — Isolate graph declarations by provider
- **Depends:** P00, P03
- **Owner / size:** graph owner; host graph; S
- **Start:** `backend/pkg/plugin/resource/graph/{graph.go,graph_indexer.go}`.
- **Deliver:** declaration lookup consistently scoped to plugin + resource type; preserve current directional extraction/traversal and bounded subgraph behavior.
- **Accept:** reproduce declaration lookup behavior with two plugins sharing a resource key; only each plugin's declarations generate its edges. Same-plugin relationships and plugin unload/reload still behave correctly.
- **Exclude:** cross-provider extraction rules, graph rewrite, new visualization framework.

### P07 — Authoritative resource schema/capability catalog
- **Depends:** P01, P04, P45
- **Owner / size:** schema contract owner; SDK + host schema catalog; M
- **Start:** P45 type/capability boundary and provider schema sources; existing raw-schema/editor/filter APIs are migration inputs, not fixed signatures.
- **Deliver:** resource schema identity/revision, scope/type context, structural navigation and explicit queryability/native-execution overlay. Derive editor associations and field discovery; keep action input schemas a separate role. Replace deficient RPC signatures and duplicated hand-maintained truth when superseded; retain useful raw schema documents/provider fetch code.
- **Accept:** P44 static/discovered/absent schemas work without GVK/OpenAPI; identical types can vary by scope/revision without cache contamination; refs/union/array/map/null handling is bounded. Schema existence does not grant native filter support or bypass validation. Old schema APIs need not remain exported.
- **Confirmation constraint:** [nullable/union evidence](../superpowers/specs/2026-10-17-cel-binding-schema-contract.md#9-executed-nullableunion-confirmations) supports a bounded adapter, not full dialect coverage. Preserve anyOf/oneOf/coverage semantics and explicit unsupported shapes; repeated same-schema admissions must not retain per-row schemas in the catalog. Runtime branch-dispatch views need bounded lifetimes/structural reuse and measured memory/concurrency behavior.
- **Exclude:** forcing resource schemas through the restricted action helper, preserving a schema registry merely because it exists, or a competing second authoritative catalog.

## B. Provider readiness and the query data plane

### P08 — Preserve Kubernetes discovery mappings
- **Depends:** P00, P10
- **Owner / size:** Kubernetes provider owner; SDK discovery metadata only if required; M
- **Start:** Kubernetes `pkg/plugin/resource/{discovery_provider.go,register_v1.go}` and `resourcers/pattern_resourcer.go`; SDK type discovery metadata.
- **Deliver:** connection-qualified GVK→actual GVR/plural/namespacedness/verbs mapping, refresh/removal behavior, wildcard CRUD routing based on discovery rather than guessed Kind pluralization.
- **Accept:** irregular-plural and cluster-scoped CRDs route to correct endpoints; same GVK on two clusters does not share wrong scope/schema metadata; removed APIs surface unavailable state without stale routing.
- **Exclude:** making every discovered type live before P11. This package can run early but is not required to query built-in Pods.

### P09 — Wire complete Kubernetes built-in resource schemas
- **Depends:** P07, P10
- **Owner / size:** Kubernetes schema owner; provider connection/resourcer integration; M
- **Start:** active `pkg/plugin/resource/connection_provider.go:467-620`, raw schema capability, existing schema tests; not just legacy `schemas.go`.
- **Deliver:** one complete reference-resolvable source for built-in raw-resource and editor schemas; correct GVK matching, dialect normalization and revision/cache lifecycle. P11 extends it to discovered dynamic types.
- **Accept:** traverse Pod `spec.containers` to item fields/types; resolve sibling refs; distinguish map keys from fixed properties; raw-schema and editor consumers refer to the same schema revision; endpoint/RBAC failure is explicit rather than an authoritative empty schema.
- **Exclude:** query evaluation and per-keystroke cluster schema fetches.

### P10 — Migrate Kubernetes acquisition and native execution to the new contract
- **Depends:** P01, P05, P45
- **Owner / size:** Kubernetes provider owner; SDK registration/source/operation adapter; L
- **Start:** native clients/informers and current base/pattern List/Find implementations; P45 optional operations and P05 source sessions.
- **Deliver:** port Kubernetes built-in registrations, snapshots/update sources, supported CRUD/actions and native selectors to the new provider API. Namespace/GVK/owner-reference behavior stays inside this adapter. Declare exact pushdown/residual support; source pagination is not final host-query pagination. Remove old Find/validation/text-search plumbing and mandatory-method stubs instead of first completing the old API.
- **Accept:** initial fetch and informer-backed paths emit correct complete/partial/snapshot/update semantics; supported scope/predicates execute, unsupported operations fail explicitly; combined text/filters/scope/order/cursors cannot be dropped by a search shortcut. Existing useful mutations/actions survive under supported operation contracts. P44 generic core does not depend on this packet.
- **Exclude:** per-query Kubernetes informer creation, a full provider-side copy of the host language/evaluator, or preserving old Find exports. P08/P09 add discovery/schema coverage after this built-in adapter works.

### P11 — Complete live/query/schema support for dynamic Kubernetes types
- **Depends:** P05, P08, P09, P10
- **Owner / size:** Kubernetes dynamic-provider owner; new catalog/source registrations; L
- **Start:** native discovery/REST mapping, P08/P09 catalog/schema coverage and P10 new-major source adapter.
- **Deliver:** dynamic-type acquisition/update lifecycle and schema invalidation using the new provider contracts; reuse native shared informer implementations where useful, not legacy mandatory Resourcer/watch registration conventions.
- **Accept:** create/watch/update/delete an irregular-plural CRD in an isolated local fixture cluster; schema change invalidates completion; removing the CRD or disconnecting removes stale live state; rediscovery/reconnect resynchronizes. No built-in-only assumptions in host.
- **Exclude:** requiring this package before the built-in Pod milestone, or advertising live CRDs before this acceptance passes.

### P12 — Shared resource read model and snapshot lifecycle
- **Depends:** P02, P03, P04, P05
- **Owner / size:** ingestion/read-model owner; host resource controller/sink/store; L
- **Start:** `backend/pkg/plugin/resource/{controller.go,sink.go,registry,indexer}` and provider finite-list/optional-update acquisition boundary.
- **Deliver:** bounded active-scope object read model reusing metadata indexes; truthful coverage/freshness and paginated hydration; host snapshot watermark/epoch, refresh/reset/eviction and optional-update semantics. Source-specific adapters handle native events or provider-managed polling; no mandatory informer/watch or automatic generic poller. No default raw-object disk persistence.
- **Accept:** all P44 profiles hydrate without Kubernetes fields; partial pages are never declared complete, snapshot-only results report refresh/freshness, and eventual consistency is explicit. Host-observed concurrent changes reconcile without stale overwrite; recreation is distinguished only when supported; disconnect/reload/eviction preserve correct scope/epoch and unrelated consumers.
- **Generation gate:** partial/unknown replacement preserves unseen observations only as separately stale state with original provenance, not deletion or promotion into current rows. Complete replacement retires only bound-source membership. Maintain generation-scoped staging and prove physical retention/update costs; fixture full-map clones/transcript histories are not production design.
- **Exclude:** a general database, all-provider permanent object replication, expensive index builds on the shared sequential watch dispatcher.

### P13 — Authoritative query compiler and finite execution
- **Depends:** P01, P07, P12
- **Owner / size:** query-core owner; neutral host compiler/planner + declared SDK source pushdown; L
- **Start:** P01 query request/logical semantics, P07 catalog, P12 read model and P45 source/capability boundary; old Find is not an API constraint.
- **Deliver:** parse/resolve/type-check and compile approved inputs through the chosen logical/physical stages. Select bounded local, native or hybrid execution, use safe pushdown and preserve residual constraints; separate source pages/text matching from final query ordering/paging/limits. A full read-model mirror is not mandatory. Reject unavailable/over-budget exact evaluation or label intentional partial coverage, rather than silently crawl all accounts or truncate semantics to old Find.
- **Accept:** P44 corpus agrees across builder/text/native/residual paths for supported arrays/bindings/numerics and global ordering/paging after residual evaluation. No-native-query sources can use bounded host execution; native-only sources reject unsupported query subsets honestly. Absent schemas are runtime-validated; real service cancellation/cost/partial states work without old-Find fallback.
- **Coverage gate:** native CEL Boolean/error masking is not proof of source completeness or permission success. Resolve acquisition/admission/access policy separately; preserve returned errors without inventing absent/null/default values. Confirm the real combined compiler→admission→result path rather than infer integration from independent probes.
- **Integration evidence:** [bounded source→CEL→window proof](../superpowers/specs/2026-10-17-source-session-contract.md#9-executed-integrated-source--cel--result-window-proof) exercises real CEL with two typed binding values and incremental touched-resource work. It is not a general planner, schema/error implementation or production index; preserve its independent expected outcomes when building real contracts rather than copying temporary allocation/data structures.
- **Exclude:** managed indexes, arbitrary joins, user JavaScript, preserving old-Find validator/default behavior, or multiple independent semantic engines. Multiple explicit compiler representations are allowed.

### P14 — Shared live query leases
- **Depends:** P12, P13
- **Owner / size:** query-scheduler owner; host resource live service/bridge; L
- **Start:** type subscription manager, source sink and P13 compiled execution.
- **Deliver:** query leases return a snapshot plus optional host deltas/reset according to source capabilities; enter/update/leave/delete and sorted-window transitions, shared execution/acquisition, ownership/refcounts/cancellation and bounded resnapshot recovery. Snapshot-only providers expose freshness/manual-refresh state, not fake real-time subscriptions.
- **Accept:** P44 event-driven and snapshot-only profiles retain distinct truthful modes; membership/windows/reset are correct for observed changes; equal authorized queries share work, distinct scopes/variables/permission epochs do not leak results; slow consumers and repeated unmounts cannot leak queues/leases or trigger unsupported watchers/pollers.
- **Integration gate:** bounded prototype evidence now covers source loss/reset reaching independent query-result generations and one slow consumer resetting without a source reopen. Repeat through actual SDK ingestion/evaluation/delivery and settle result/control/reattachment semantics, including repeated overlapping recovery. Closing one lease cannot cancel other interests; finite completion and terminal notification must have bounded cleanup independent of a stalled peer/full data queue.
- **Exclude:** stopping a source still used by graph/others, invented replay or source-wide consistency, and requiring every provider to supply native events.

### P15 — Runtime query client and cache migration
- **Depends:** P03, P14
- **Owner / size:** runtime owner; runtime hooks + host consumers; M
- **Start:** existing resource hooks/event batching/cache factories and generated service bindings.
- **Deliver:** intentional typed transport/query/operation APIs and bounded observer adapter over host-owned execution. Apply host-provided row keys/projections/removals/order/generations atomically; the host owns query equivalence/sharing. Move affected List/type-listener/raw-client consumers to this path; no client inventory scans, source-object diffing, query hashing or domain cache reconciliation.
- **Accept:** equivalent authorized consumers share host work; reordered/replaced windows and gaps/reset/access invalidation display correctly, stale generations are ignored, client scripting scales with the bounded delivered patch/window rather than total source cardinality. Measure actual bridge/paint/heap as well as Go; preserve useful operations and compile selected plugins before P47 retirement.
- **Client evidence gate:** the vertical proof's passive Bun replay applies only bounded JSON windows and rejects stale generations without resource filtering/sorting. It is not live bridge/reconnect or actual UI proof. Freeze row/frame/reset DTOs, then exercise generated bindings and real host interactions; exact integers remain lossless on the selected result wire.
- **Exclude:** client-side evaluators/planners/grouping/deep diffs or worker/WASM equivalents, per-screen inventories and legacy API-shape preservation. Necessary bounded frame application and rendering are not domain evaluation.

### P47 — Runtime/plugin public ABI cutover and legacy retirement
- **Depends:** P15, P26, P45
- **Owner / size:** runtime/plugin ABI integration owner; host/runtime/Vite-plugin + selected plugins/release packaging; L
- **Start:** `packages/omniviewdev-providers`, runtime `api.ts`, `models.ts` and `compat/`; host/Vite shared-package lists/shims; plugin normalization/validation; Kubernetes frontend imports/entry declarations; P00 caller inventory.
- **Deliver:** intentional plugin-facing resource/operation/model exports and host-private orchestration transport; migrate all release-selected callers. Retire `@omniviewdev/providers` source/dependency/build/version-stamping/publishing entries, Wails-v2 namespaces and legacy enum aliases, public raw resource/graph clients, obsolete shims, and legacy sidebar/drawer normalization after migration to generic contributions. Move active linked-resource drawer code rather than deleting it with the inert federation loader. Delete temporary old/new translators and old Find/filter exports/validators/transport adapters once all in-scope callers move.
- **Accept:** host plus selected plugin builds/load in native-ESM development and SystemJS packaged mode using one runtime/React/query instance; new resource calls and active logs/exec/metrics/networking/settings utilities still work through intentional supported contracts. Caller/import inventory has no old resource/provider/namespace/legacy-contribution consumers; released exports/shared maps/shims match; first-party examples/docs and affected tests use the new contract. Historical npm artifacts need not be unpublished.
- **Exclude:** full hostile-plugin isolation, silent deletion of useful non-resource functionality, retaining old import shapes as aliases, or mass deletion of a directory containing active components.

### P46 — Incompatible-plugin admission and coordinated release gate
- **Depends:** P45, P47
- **Owner / size:** plugin admission/release owner; host loader/UI preflight + SDK/frontend contract metadata; M
- **Start:** host backend validator/loader/protocol negotiation and frontend import adapter/PluginService; SDK metadata and plugin manifests.
- **Deliver:** explicit resource protocol major, UI ABI/required features and metadata-format compatibility policy, distinct from plugin release/package versions. Refuse missing/incompatible UI contracts before JavaScript import in dev/prod/reload/update paths; reject backend peers with no common resource protocol before resource-controller/connection activation. Metadata may preflight binaries before launch, but wire negotiation cannot prove what an unexecuted binary implements. No legacy adapter fallback.
- **Accept:** a compatible new-major fixture loads and performs reads; old/missing/incompatible UI fixtures are never evaluated; incompatible backend cannot activate resources/autoconnect; error UI reports installed/required/supported contracts and permits explicit compatible update/reinstall without changing user state. Verify selected release manifests/exports/protocol versions and M1 migration/removal evidence; Kubernetes feature smoke remains its provider/milestone gate, not a dependency of generic core.
- **Exclude:** package semver as sole ABI proof, advisory warnings instead of refusal, automatic deletion of user plugins/state, pretending preflight metadata authenticates code, or upgrading unrelated subsystem protocols without a shared-envelope need.

## C. Completion and the first query experience

### P16 — Schema-aware field/operator completion
- **Depends:** P01, P07
- **Owner / size:** query-language/completion owner; host language service, runtime DTOs; M
- **Start:** P07 resolved resource schema/queryability catalog and P01 parser/cursor context; old FilterField lists are migration evidence, not required runtime APIs.
- **Deliver:** error-tolerant next-tier field/operator completions, types/docs, correct replacement spans, arrays/map access and scope/schema-revision keys. Tokenizer aids display; parser context determines valid suggestions.
- **Accept:** schema-derived paths include `spec.`/`spec.con` only for applicable types, cloud nested/flat fields, container `State`, hypervisor hardware fields and map/tag-array access. Incomplete quotes/operators and mid-expression edits produce valid replacements; types govern operators/enums; switching provider/type/scope/schema invalidates suggestions. No core list of Kubernetes field names.
- **Authoring gate:** preserve conditional branch applicability and actual static/partial/dynamic checking strength, including nullable ancestors and schema/document revisions. A discriminator hint is not general flow-sensitive CEL narrowing; dynamic checking does not mean schema information is absent.
- **Exclude:** loading the whole schema into every popup or inferring authoritative schemas solely from example objects.

### P17 — Bounded dynamic keys and value discovery
- **Depends:** P07, P13
- **Owner / size:** query discovery owner; host + optional SDK/provider capability; M
- **Start:** observed read model, FilterField enums, agreed optional provider interfaces.
- **Deliver:** prefix/context-scoped dynamic map-key and distinct-value lookup; typed result, pagination/bounds, observed coverage/freshness and truncation; enum→local→optional provider tiers; request cancellation. Exclude the currently edited incomplete clause when computing its appropriate facet context.
- **Accept:** keys/values follow provider-declared scopes and applicable predicates across P44 map-label/tag-array/no-tag resources; absent namespace is valid, normalized facets preserve documented duplicates/multivalues, and sensitive/denied values do not leak. Bounds, no full-object frontend fetch, truthful partial/freshness state and stale-response rejection hold.
- **Exclude:** mandatory provider network lookup on every keystroke or implementing every provider adapter before the local tier works.

### P18 — Compact query-input feasibility decision
- **Depends:** P00
- **Owner / size:** UI/editor owner; UI editors + host integration spike; S
- **Start:** library CodeEditor/onMount, host Monaco wrapper, SearchInput/Autocomplete/CommandList, P02 harness when available.
- **Deliver:** throwaway Monaco vs lightweight input comparison; decision and edit/completion adapter requirements. No retained feature implementation until design choice is approved.
- **Accept:** measure cold/warm mount/focus, bundle/worker and retained heap behavior; exercise IME, newline/paste, Enter acceptance vs submission, Escape/Tab, screen-reader labels, overlays/theme and disposal in real host surface. Confirm pinned APIs/exports, not just latest docs.
- **Exclude:** choosing Monaco solely because it is already installed or making one editor per table row.

### P19 — Implement the reusable query editor adapter
- **Depends:** P01, P18
- **Owner / size:** UI/editor owner; UI editors/base-ui as selected; M
- **Start:** existing editor/input/completion primitives and chosen adapter design.
- **Deliver:** controlled editor/diagnostic/suggestion UI with cancellable host language-service callbacks and exact edits. Host semantic validation and schema/discovery services are authoritative; local lexical display, immediate editor feedback and bounded narrowing of cached suggestions are allowed when useful. No full schema/inventory fetch to build a second client query engine; measure typing latency and IPC as well as client work.
- **Accept:** keyboard/mouse/IME completion, select/dismiss, loading/error/empty states, mid-expression replacement, rapid edits/unmount/remount and focus within host popovers all work; no stale provider registrations/models retained.
- **Exclude:** schema fetching or query evaluation inside a generic UI package.

### P20 — Live query bar in the existing resource view
- **Depends:** P15, P16, P17, P19, P44
- **Owner / size:** host resource UX owner; host UI + provider integrations; M
- **Start:** `ui/components/tables/Resources`, resource route, adapter-declared scope/columns and plugin table integration.
- **Deliver:** generic query bar/leases, schema-derived field/operator/value suggestions and diagnostics; provider-declared query scope composes with predicates. Neither namespace selectors nor `metadata.name`/`status.phase` are required. P09/P10 supply the separate first Kubernetes production integration, not generic UI prerequisites.
- **Accept:** use cloud/container/VM P44 profiles through actual host UI: flat/tag-array predicates, non-Kubernetes completion, optional-schema hints and truthful snapshot-only/refresh state. Also demonstrate Pod phase/label/namespace live filtering once P09/P10 are accepted. Scope replacement/cancellation and denied/offline states work in browser and native host.
- **Exclude:** dashboards and unsupported real-time/CRD claims. M1 includes both generic conformance and Kubernetes integration; failure of a Kubernetes adapter cannot disable generic providers.

### P21 — Visual query builder and safe code-mode conversion
- **Depends:** P20
- **Owner / size:** UI controls owner + host query UX integration; M
- **Start:** base-ui Combobox/Autocomplete/FilterBar; P01 AST and existing query bar.
- **Deliver:** intuitive field→operator→typed-value clauses, AND/OR grouping within supported semantics, add/remove/reorder and validation; same completion sources and execution contract as code mode; live preview/explanation and contextual examples.
- **Accept:** build cloud tag-array/numeric, container state and VM hardware conditions without syntax, plus the Kubernetes label/phase/array example; code↔builder preserves supported meaning, unsupported advanced code remains intact with warning, keyboard/permission states work, and field/scope choices come from provider schemas/capabilities.
- **Clause gate:** use schema-supported presence/null guards; distinguish whole-clause negation from present-value inequality and define descendant path-presence labels. Prove generated clauses through the production union adapter; disjoint prototype branch-type guards do not establish overlapping-anyOf membership. Keep unavailable/denied states distinct from known absence.
- **Exclude:** separate builder evaluator or promising lossless arbitrary jq/code conversion.

## D. Live tables, relationships, and visualizations

### P22 — Relationship queries for live child membership
- **Depends:** P06, P14
- **Owner / size:** graph/query adapter owner; host generic relationships + provider integrations; M
- **Start:** graph service/indexer, canonical references and P44 VM/container links; Kubernetes relationship descriptors/deployment resolver as one integration.
- **Deliver:** generic graph-derived membership with typed relationships, bounded direct/transitive traversal, scope and provenance. Owner references/selectors are provider-specific extractors, not universal link semantics. Kubernetes Deployment→ReplicaSet→Pod ownership remains an explicit adapter case.
- **Accept:** P44 VM→disk/host and container→network links update/refresh with no namespace/owner references; source freshness/coverage and optional incarnation are honest. Also verify Kubernetes rollout, late arrivals, orphan/adopt and supported UID-recreation semantics; bound cycles/depth/fanout.
- **Exclude:** Kubernetes-only relationship APIs, invented direct Deployment→Pod edges, and requiring cross-provider union first.

### P23 — Table live-render and identity contract
- **Depends:** P00, P02
- **Owner / size:** UI table owner; base-ui table + narrow host adapter; M
- **Start:** `DataTableVirtualBody`, `useDataTable`, table types/context; host raw TanStack table/virtualizer integration.
- **Deliver:** immutable keyed-row/cell rendering contract and stable measurement identity; resource consumers use external/manual sorting/filtering/grouping/pagination and host-provided order/windows. Preserve useful memo boundaries and viewport geometry without invoking client resource row-model computation.
- **Accept:** visible/offscreen patches, selection/expansion/column changes and host-driven reorders render correctly with bounded DOM and measured browser work; no client resource scans/sorts/groups or full-inventory clones per patch. Generic static UI component behavior is not justification for resource consumers to rebuild engine results locally.
- **Exclude:** replacing the component library or relying on the column ID `select` as a universal invalidation strategy.

### P24 — Virtual arbitrary expanded-content rows
- **Depends:** P23
- **Owner / size:** UI table owner; base-ui + host table adapter; M
- **Start:** existing nonvirtual `renderExpandedRow`, VirtualBody, nested-table stories.
- **Deliver:** typed virtual expanded-content slot supporting heterogeneous subtables or arbitrary React content, dynamic height measurement, stable keys, controlled expansion, and explicit fixed-height compatibility. Host table must consume the mechanism, not just receive a library release.
- **Accept:** expand/collapse, asynchronous content height, sorting while expanded, scroll-away/back and keyboard operation retain correct content/position with viewport-bounded DOM. Reuse existing nonvirtual/tree behavior instead of duplicating it.
- **Exclude:** resource fetching, provider subscriptions or domain relationships in base-ui.

### P25 — Lazy provider-neutral child tables and Deployment integration
- **Depends:** P15, P22, P24
- **Owner / size:** resource table integration owner; host + provider UI adapters; M
- **Start:** query-driven generic resource table, P22 relationship membership and adapter column definitions.
- **Deliver:** expand any resource row to a declared related/query-selected child type with independent columns/state; acquire child snapshot plus optional updates only for the required expansion lifetime. Integrate Deployment→Pod as one production example; no Deployment, Pod, namespace or ownership-tree assumption in core.
- **Accept:** P44 host→VM/VM→disk or container→network expands with correct opaque IDs and snapshot/event capability states; Deployment expansion follows P22 when its adapter is ready. Collapsed rows create no child lease, closing releases work, and overlapping views share source acquisition without unnecessary scans/watchers.
- **Exclude:** per-parent eager queries, hardcoded Kubernetes parent/child dispatch, and unbounded nesting/concurrency.

### P26 — Cut custom resource renderers over to the current registry
- **Depends:** P00, P03
- **Owner / size:** host extension owner; host/runtime + affected plugin declarations; M
- **Start:** `ui/components/tables/Resources/cells/CustomTableCell.tsx`, obsolete `ui/federation/index.tsx`, existing extension registry/PluginService ownership and drawer/sidebar points.
- **Deliver:** typed current-registry resolution for affected custom cell/detail contributions; migrate all active callers/declarations identified by P00 and remove the superseded affected federation loader path. Preserve existing custom drawer/sidebar behavior.
- **Accept:** a contributed custom cell renders through actual plugin load, reload and unload; missing plugin/contribution produces an explicit unavailable state; ownership/matching resolve correct plugin/type and stale renderer references disappear.
- **Exclude:** a second contribution registry or indiscriminate directory deletion. P47 explicitly retires obsolete providers/compatibility/public ABI surfaces after migrating useful functionality.

### P27 — Declarative visualization contributions and field bindings
- **Depends:** P07, P15, P26
- **Owner / size:** host visualization/extension owner; runtime typed extension points + host components; M
- **Start:** existing extension registry, dashboard/home/drawer points, current table/key-value/card/list components.
- **Deliver:** typed visualization contribution within existing registry: config schema, compatible result shape and selector/field bindings, not arbitrary user code. Support table, card/stat, list/key-value and relationship view via existing components where practical.
- **Accept:** selecting nested scalar/array/map fields renders intended values and missing/type-error states; plugin reload/removal preserves user config while marking unavailable renderer; query permission errors render a visible state with hover/detail explanation, not blank content.
- **Exclude:** user JavaScript execution, a generic low-code application framework or plugin-owned copies of query caches.

### P28 — Non-table expanded visualizations
- **Depends:** P15, P24, P27
- **Owner / size:** host table/detail UX owner; generic host + provider consumers; S
- **Start:** expanded-content slot and visualization contributions.
- **Deliver:** choose a registered detail visualization instead of a child table for an expanded resource row, with declared binding/query lifecycle and existing resource navigation.
- **Accept:** an expanded card/list/relationship visualization updates live; changing visualization releases obsolete queries; collapse/scroll virtualization follows explicit lease-retention policy; errors, missing data and permissions are visible without failing the parent table.
- **Exclude:** separate table-only rendering/query framework for each visualization type.

### P29 — Incremental grouping in the query service
- **Depends:** P14
- **Owner / size:** query-core owner; host evaluator/scheduler; M
- **Start:** compiled query results and lease deltas.
- **Deliver:** typed group keys and incremental partitions/counts for labels/tags/selected fields, stable null/missing/multivalue semantics and group ordering; reuse one logical source result.
- **Accept:** object changes group without duplicate/lost membership; absent vs null behavior matches P01; high-cardinality groups have explicit bounds/paging; adding groups does not create one provider query/full scan per group. Compare counts and groups against finite reference results under event sequences.
- **Exclude:** arbitrary analytical aggregation language or per-group source watchers.

### P30 — Grouped live table presentation
- **Depends:** P15, P23, P29
- **Owner / size:** UI table owner + host integration; base-ui + host/plugin tables; M
- **Start:** controlled TanStack table integration, group result contract and existing virtual renderer.
- **Deliver:** provider-declared field/facet grouping, stable expandable headers/counts, selection/sort/filter interaction and virtualized group/member rendering. Namespace/label-specific shortcuts are optional adapter UI, not the generic grouping model.
- **Accept:** P44 cloud tag arrays, container labels and VM numeric/placement fields group correctly with missing/multivalue semantics; no namespace/tag requirement. Group migration/collapse/sparse updates preserve identity and viewport-bounded DOM while sharing one logical result.
- **Exclude:** one independent widget/subscription for each group. Serialize shared table-internal edits with P24.

## E. Saved queries, custom views, and dashboards

### P31 — Saved queries and typed interactive variables
- **Depends:** P13, P15, P20
- **Owner / size:** query configuration owner; host persistence/runtime configuration + UI; M
- **Start:** query bar, host state storage conventions, existing settings/card preferences.
- **Deliver:** versioned saved queries, typed variables/defaults/constraints/value sources and host-owned binding/validation/dependency/cycle evaluation; clients render controls and forward edits. Persistence/migrations store configuration, not copied inventories. Do not independently implement variable semantics in dashboard JavaScript.
- **Accept:** save/reopen query and variables across app restart; strings cannot inject syntax; missing/invalid variable and cycles are readable; upstream-variable changes cancel old dependent lookups/results and do not mix scopes; schema drift prompts actionable diagnostics.
- **Exclude:** string interpolation as execution semantics, secret variable values in exported documents, or dashboard-only variable implementations.

### P32 — Versioned saved-view documents and migration
- **Depends:** P27, P31
- **Owner / size:** host configuration/storage owner; host + runtime public document types; M
- **Start:** homepage card settings, resource table preferences, dashboard extension points and application state storage.
- **Deliver:** persisted user-owned component definitions/presets and view documents containing component instances/contribution IDs, field bindings, query references, variables and layout; explicit migrations from relevant current preferences; format validation, export/import and schema version policy.
- **Accept:** restart/import roundtrip preserves layout/bindings/query references and reusable component presets; incompatible/corrupt docs do not overwrite valid data; missing plugin or changed resource schema leaves recoverable user configuration; preference migration preserves existing choices.
- **Exclude:** storing executable plugin objects or inventing a parallel contribution registry. Determine document format before P33 begins.

### P33 — Resource-view component and layout builder
- **Depends:** P32
- **Owner / size:** host view-builder UX owner; host + reusable UI layout primitives only when missing; L
- **Start:** saved-view store, visualization bindings, existing drag/reorder patterns.
- **Deliver:** add component, choose fields/query/visualization, edit bindings/config, save/reuse a component preset, resize/reorder/arrange, preview, save/reset and select user view versus provider default for a resource context.
- **Accept:** create a card plus list/table view for a resource, reuse a saved component in a second view, rearrange and reopen both, revert to provider default without losing saved config; keyboard-accessible layout editing; invalid binding/error is localized to its component; no data is executed as code.
- **Exclude:** pixel-perfect arbitrary application designer or a requirement to rebuild all stock resource views.

### P34 — Live dashboards and query sharing
- **Depends:** P14, P33, P35
- **Owner / size:** dashboard runtime owner; host dashboard page/layout integration; M
- **Start:** existing placeholder dashboard page and widget/tab extension points, saved view/component/query contracts.
- **Deliver:** compose saved query-backed components into a dashboard with variable controls, per-panel status and scoped shared-query leases; mount/visibility policy that avoids work for inactive views while preserving intentional live panels.
- **Accept:** 12 panels including equivalent queries across multiple provider/connection scopes share appropriate backend work; variable changes replace affected leases without mixed generations; closing/deleting dashboard releases work; one failed/denied provider leaves other panels usable; measured memory/IPC/render costs stay within calibrated budgets.
- **Exclude:** a separate dashboard query engine, persisted raw result cache or mandatory managed indexes for every view.

## F. Cross-provider Explore and relationships

### P35 — Multi-connection/provider query scope and union
- **Depends:** P04, P07, P14
- **Owner / size:** query federation owner; host query service + runtime scope contract; L
- **Start:** canonical refs/scopes, schema catalog, resource query service.
- **Deliver:** bounded multi-scope query union with provenance, heterogeneous schemas/field applicability, consistent paging/order, explicit partial/denied/offline results and cancellation. Normalize common label/tag facets only through documented mappings.
- **Accept:** P44 non-Kubernetes profiles participate alongside Kubernetes where available; IDs/type keys stay distinct and declared account/project/subscription/compartment/region/engine/node scopes work without inventing namespaces. Incompatible fields/slow/denied/snapshot-only sources yield truthful partial/freshness states, not leaks or lost healthy results; no unbounded scan default.
- **Exclude:** arbitrary joins, automatic linking of equally named fields, or silently opening every saved connection.

### P36 — Top-level Explore workspace
- **Depends:** P20, P21, P30, P32, P35
- **Owner / size:** host Explore UX owner; host routes/navigation + query/view components; M
- **Start:** existing header/navigation/routes, query bar/builder, grouped resource views and scope picker.
- **Deliver:** explicit provider/connection/type selection; global schema-aware query, label/tag search, split/group by type then chosen fields; navigate results to existing drawers/resource views and save reusable queries/views.
- **Accept:** query multiple isolated clusters/accounts/providers, split by type/label, drill into a result without losing source context; partial/denied scopes show reasons; query replacement and navigating away release work; reuse same result/query infrastructure as resource views.
- **Exclude:** copying provider-specific resource tables into a new independent Explore engine. Reuse P32 saved documents; integrated dashboard runtime P34 is not a prerequisite to Explore.

### P37 — User-defined relationship rules within a provider
- **Depends:** P06, P13, P22
- **Owner / size:** relationship rule owner; host graph/query + user configuration; M
- **Start:** provider descriptors, normalized schema paths, current graph derivation/provenance.
- **Deliver:** declarative source/target types and typed link conditions, cardinality/scope mapping, preview and validation, enable/disable/save lifecycle and explainable edge provenance; provider defaults remain distinguishable.
- **Accept:** preview shows matched/unmatched examples and ambiguity; changing a field or rule updates/removes derived edges; malformed/many-to-many/high-cardinality rules are bounded; rules cannot access disallowed scopes. Preserve provider-defined edges when user rules are removed.
- **Exclude:** guessing relationships from schema alone or executing rule JavaScript.

### P38 — Cross-provider links and relationship visualization
- **Depends:** P27, P35, P37
- **Owner / size:** graph federation owner; host + SDK target addressing only where required; L
- **Start:** ResourceRef, same-provider rule configuration, graph extractor target addressing and existing plugin graph visualizations.
- **Deliver:** explicit provider/connection/account mapping and typed cross-provider link rules; bounded graph/relationship visualization using registered components, scope/provenance/error states and existing resource navigation.
- **Accept:** link two non-Kubernetes profiles, such as cloud instance→hypervisor inventory or container→cloud image, by configured identity/scope without owner references; also retain Kubernetes→AWS/GCP label/annotation example. Optional incarnation, denied/unavailable scopes, bounded matching and per-edge provenance stay correct.
- **Exclude:** production credentials or hostile-plugin isolation claims. Reuse P44 real-boundary verification fixtures; they are not a fake product backend.

## G. Explain, index management, and advice

### P39 — Query explain and index inventory
- **Depends:** P02, P13
- **Owner / size:** query observability owner; host query/index inspection + UI; M
- **Start:** current metadata/graph indexes and query execution stages; existing diagnostics UI conventions.
- **Deliver:** inspect current index kind/scope, actual retained memory or estimated measurement basis, disk footprint where relevant, rebuild state, query scan/candidate/residual costs and plan selection; show why a view/query is slow. Distinguish metadata indexes from document indexes.
- **Accept:** selective/nonselective representative queries produce truthful explain results; existing in-memory indexes report no fictional on-disk resource database; changing filter changes observed plan/work; inspection overhead is bounded and does not dump secret values.
- **Exclude:** managed persistent indexes or prescribing indexes before measuring workloads.

### P40 — Explicit managed resource indexes
- **Depends:** P14, P39
- **Owner / size:** index lifecycle owner; host index service/storage + management UI; L
- **Start:** existing ResourceIndexer seam, read-model generations and P39 evidence; do not append expensive synchronous work blindly to shared dispatcher.
- **Deliver:** create/drop/rebuild selected path indexes with scope/type/schema identity, build progress and cancellation, mutation catch-up, atomic generation activation, memory/disk accounting and quotas. Choose memory-only versus persisted implementation with measured evidence and an approved design. Indexes are optional accelerators, not the source of truth.
- **Accept:** P44 cloud/tag-array, container and snapshot-only VM indexes preserve query results through observed updates or explicit refresh/build/drop; source revision/UID/watch is not mandatory and incomplete/stale coverage stays visible. Failed/canceled builds retain previous generation or scan fallback; dropping never deletes provider data/views; footprint/references are inspectable; persisted indexes recover from schema change/corruption under sensitive-data policy.
- **Exclude:** automatic index creation per view, a new database product by default, persisted raw objects without explicit data policy.

### P41 — Per-view index suggestions and maintenance UX
- **Depends:** P32, P40
- **Owner / size:** query/index UX owner; host view inspector + index management; M
- **Start:** saved-view query bindings, explain and managed-index inventory.
- **Deliver:** view→query→index dependency inspection, evidence-based index suggestions, estimated benefit/space/write cost with confidence/measurement basis, explicit user approval for creation, safe unused-index review/removal.
- **Accept:** an actual selective workload suggests an applicable index; irrelevant/already-covered queries do not get misleading advice; creating it records measurable before/after explain/performance; dropping it preserves view correctness and reports expected scan fallback; disk/memory costs remain visible.
- **Exclude:** an autonomous tuner, guaranteed speedups or claims that every view needs an index.

## H. Unified command and search surface

### P42 — Functional global command/settings/navigation palette
- **Depends:** P00, P04
- **Status:** accepted in [PR139](https://github.com/omniviewdev/omniview/pull/139); [portable acceptance receipt](2026-10-25-global-command-search-acceptance.md). This does not accept P43 resource search.
- **Owner / size:** host shell/search owner; host + UI shell adapter only if needed; M
- **Start:** `ui/layouts/core/main/Header/areas/HeaderSearchArea.tsx`, current settings/router/action registrations, UI CommandList/CommandPalette.
- **Deliver:** typed contributions in existing registry for commands/settings/navigation; controlled cancellable search provider composition, keyboard shortcut and accessible palette. Reuse host services for allowed settings/actions; keep discoverability separate from permission to execute.
- **Accept:** keyboard opens palette, finds/navigates a setting/resource route and executes an allowed host command; disabled/denied commands explain why; plugin reload/unload removes contributions; external async results cannot overwrite newer query; actual global header now functions.
- **Exclude:** new permission policy product, privileged third-party writes justified only by frontend ownership stamps, or forcing remote results through the current local-only CommandPalette wrapper.

### P43 — Unified resource search integration
- **Depends:** P35, P42
- **Owner / size:** host search-provider owner; host/runtime query adapter; M
- **Start:** multi-scope query API, global command/search providers, legacy multi-List `useResourceSearch` callers.
- **Deliver:** bounded resource/name/label/tag search through the same query service; grouped typed results with source provenance and open-resource actions; command/settings results remain distinct. Migrate affected old search callers and remove superseded search execution for those workflows.
- **Accept:** global search finds settings and resources in all applicable P44 profiles without Kubernetes field/name/namespace assumptions; navigate using opaque provider identity and declared display fields. Limits/cancellation/scope/permission/freshness match query service; unavailable sources produce readable partial results without a second frontend index.
- **Exclude:** unrestricted secret/body full-text indexing, AI-specific search semantics or requiring the Explore UI to exist before the query-backed search provider is useful.

## Launch schedule and collision rules

### Earliest dependency frontiers

These frontiers are a topological schedule, **not** a recommendation to run ten agents against shared files at once. Respect owner locks below. Within a frontier, product priority and available reviewers determine which ready packet starts; work from later frontiers can start as soon as its own predecessors finish.

| Frontier | Ready after prior dependencies | Operational use |
| --- | --- | --- |
| F0 | P00 | Integration baseline first |
| F1 | P04, P18, P44 | Trust/error and editor work plus non-Kubernetes corpus |
| F2 | P01, P02, P42 | Target architecture/language, profiling and independent shell work |
| F3 | P19, P23, P45 | New-major provider boundary plus editor/table primitives |
| F4 | P03, P05, P07, P24 | Structured identity, source sessions, catalog and virtual details |
| F5 | P06, P10, P12, P16, P26 | Graph isolation, Kubernetes migration, read model, hints and renderer cutover |
| F6 | P08, P09, P13 | Kubernetes discovery/schema adapters and independent host compiler/planner |
| F7 | P11, P14, P17, P39 | Dynamic Kubernetes coverage; generic live leases, values and explain |
| F8 | P15, P22, P29, P35, P40 | Runtime, relationships, grouping, multi-scope and optional managed indexes |
| F9 | P20, P25, P27, P30, P37, P43, P47 | Feature integrations and public ABI/legacy retirement |
| F10 | P21, P28, P31, P38, P46 | Builder/details/parameters/links and incompatible-plugin admission |
| F11 | P32 | Saved view/component documents |
| F12 | P33, P36, P41 | View builder, Explore and index advice |
| F13 | P34 | Dashboard runtime |

Readiness is not priority: explain/index work in F7 does not outrank M1. P08–P11 are Kubernetes-only; no generic packet depends on them. P45 is a real new-major source baseline, not an API-stub gate; P47 removal and P46 admission block release without becoming permanent dual stacks. Single-provider querying does not wait for P35 union; Explore can ship without dashboards, and dashboards without cross-provider rules/index advice.

### Shared ownership locks

| Lock | Packets/paths that can collide | Rule |
| --- | --- | --- |
| SDK/protobuf/codegen | P45, P05, P07, P08, P10, P11, P13, P17, P38, P46 | One SDK integrator sequences new-major registration/DTOs/source/schema changes. Optional operations follow truthful support, not mandatory old Resourcer methods; share frozen artifacts and delete temporary compatibility paths in P47. |
| Ingestion/read model | P45, P03, P05, P12, P14 | New boundary precedes identity/source migration; sessions precede host retention/live scheduler. Assign one owner for shared controller/sink/store changes, not parallel old/new fixes. |
| Query core | P13, P14, P16, P17, P29, P35, P39, P40 | Partition evaluator/scheduler/completion/facets/grouping/federation/inspection files only after API freeze; otherwise one core lane. No independent evaluator implementations or competing parser semantics. |
| Runtime/cache | P03, P15, P20, P25, P31, P43 | Canonical key/cached shape cutover first; query adapter next. Feature agents use adapter rather than editing core hooks independently. |
| UI table internals | P23, P24, P30; base-ui and host raw table adapter | Live contract first. Serialize virtual-detail and grouping internals unless owner explicitly partitions files; integrate host/plugin consumers rather than assuming library release upgrades them. |
| Renderer/config registry | P26, P27, P32, P33, P37, P42 | Typed points in existing registry; separate contribution lifecycle from user docs. One owner for exported types and config migrations. |
| Kubernetes | P05, P08–P11, P20, P22, P25 | Separate connection/schema/discovery, generic resourcers and UI files where possible; provider owner merges API/registration changes in dependency order. |
| Generated JS/shared deps | Any public runtime/UI export change | Integration owner runs `task bindings` where needed, builds runtime before Vite-plugin shims; keep host/plugin shared-dependency lists in sync; verify both dev and packaged plugin import paths. |
| Conformance profiles | P44 fixtures; applicable consumers across all generic packets | One fixture owner maintains deterministic native shapes/capability modes; feature owners add meaningful behavior coverage without turning fixtures into product fallbacks or duplicating Kubernetes-shaped models. |
| Public ABI/removal/admission | P15, P26, P47, P46 | P15 establishes runtime APIs, P26 current rendering, P47 migrates exports/models/contributions and deletes old surfaces, P46 enforces compatible loading. One integration owner synchronizes both shared lists, dev/prod shims, manifests and release packaging. |

### Concrete first dispatch

After roadmap/product approval:

1. Run P00 inline with the integration owner.
2. Deliver P44 baseline corpus/probes while P04 trust/errors and P18 editor comparison proceed independently. Do not require future APIs to complete the corpus.
3. Run P01 architecture/language design and P02 baseline in parallel; then P45 implements a usable new-major SDK/host boundary. UI P19/P23 can proceed from frozen contracts while that boundary lands.
4. After P45, partition P03 structured identity, P05 source sessions and P07 catalog under one SDK integration owner. P12 waits for its real prerequisites; P10 migrates Kubernetes directly, followed by P08/P09/P11. Do not spend a packet completing old Find first.
5. Continue P13→P14→P15 and generic P20/P21. P26 uses new identity, P47 retires old public surfaces/callers, then P46 rejects incompatible contracts. M1 additionally needs P09/P10 Kubernetes smoke, but these adapters never constrain generic core dependencies.
6. Review new-major conformance, removals and useful-workflow/user-data migration before release. Re-estimate remaining table/view/federation work; index implementation follows measured need, not early topological readiness.

### Dispatch template

```text
Goal: implement <P-number and title>, not the entire roadmap.
Context: read this packet, the roadmap, its approved focused spec/plan,
         and the named predecessor contract artifacts.
Repository bases: <exact selected worktrees/refs and dependency resolutions>.
Ownership: <files/seam exclusively owned>; do not edit <shared owner paths>.
Consumes: <reviewed exact predecessor types/signatures/error/status semantics>.
Produces: <exact reviewed API/config/event artifacts for downstream agents>;
          declare applicable P44 conformance cases, source capabilities and
          provider-specific adapter behavior; no implicit Kubernetes model.
Behavior: <packet deliverable and every acceptance scenario>.
Non-goals: <packet exclusions plus roadmap future constraints>.
Verification: consumer-visible regression/contract cases as appropriate,
              actual API/UI smoke, calibrated performance evidence,
              affected docs/examples and all caller cutovers.
Handoff: changed repos/files, contract version, exercised commands/scenarios,
         observed output, artifact paths, limits and remaining blockers.
Do not run build/lint/tests/formatters mid-flight; implementation owner runs
coordinated verification after edits are complete. Never use production state.
```

Before executing a packet, replace every angle-bracket dispatch field from actual repository/spec facts; this is an orchestration template, not an executable implementation plan. Agents must not fill missing contract decisions by inventing incompatible APIs.

## Verification and release handoff

- All Go commands use `GOWORK=off`. In the selected host: `GOWORK=off go build .` and scoped `GOWORK=off go test ./backend/pkg/plugin/resource/... -count=1` where that code changed; run applicable SDK/provider suites in their own selected modules.
- Bindings only via `task bindings`; never invoke raw Wails generation. Build runtime before Vite-plugin shim regeneration/verification. Use actual package scripts from selected checkouts for UI types/build/tests.
- Host existing test command is `pnpm test`; narrow by actual affected test paths during packet verification. Permanent tests cover meaningful behavior, not copied defaults/source text/mock echoes. A smoke script is suitable for simple feature contract demonstration; remove throwaway scaffolding afterward.
- UI acceptance requires actual host/plugin surfaces, keyboard/focus/scroll behavior, screenshots where meaningful, console errors and teardown inspection. Browser/server mode is not native WebView proof; use isolated native verification for editor/overlay/performance-sensitive milestones.
- Generic packets exercise P44 profiles through real SDK/gRPC/host/UI paths as applicable, including snapshot-only/no-schema/read-only modes; do not wait for cross-provider milestones to validate non-Kubernetes use. Kubernetes integration uses a disposable local cluster or authorized test environment only; never mutate a user's production infrastructure.
- Preserve user-owned configuration and useful product operations through explicit one-way migration, backup/rollback-safe writes and visible unconvertible-state handling. Do not preserve old API shapes, unsupported defaults, silent ignored clauses or legacy fallbacks. First-party callers migrate; older external plugins are refused with actionable compatibility information until rebuilt.
- M1 cannot ship until P47 removal/caller inventory and P46 admission pass, alongside generic and Kubernetes milestone smokes. Record coordinated host/SDK/runtime/Vite/UI/plugin versions, protocol/ABI contracts, regeneration, migrations, exercised scenarios and platform/performance limits; no permanent dual-stack release.

## Brain-dump coverage ledger

Every requested feature or future constraint has an owner below. “Future seam” means intentionally not implementing that future product capability now, matching the request.

| Requirement | Owning packets / gate |
| --- | --- |
| Provider-registered resource schemas and schema navigation | P07, P09; dynamic types P08/P11 |
| Schema useful to graph/manual links | P22, P37/P38; schema is validation, not inferred relationship truth |
| Tiered field/key hints with partial `spec.`/`spec.con` input | P16, P19, P20 |
| Tiered dynamic map/label/tag keys | P17, P20 |
| On-demand field values and autocomplete | P17, P19, P20 |
| Choose jq/JMESPath/JSONPath/etc. with documented semantics | P01 decision, P13 authoritative execution |
| Tokenizer and cursor-aware immediate filterable suggestions | P01, P16, P19 |
| Grafana/SQL-IDE-inspired query bar and typed select/dismiss dropdown | P18–P20 |
| Intuitive non-language visual query builder | P21 |
| Component/view registry and field selectors | P26/P27, P32; extend current registry |
| Cards/lists/tables and configurable resource layouts | P27, P32/P33 |
| Size, arrange and save views; provider defaults remain available | P32/P33 |
| Top-level cross-plugin/resource Explore and dashboards | P35/P36, P34 |
| Split by type then labels/tags, multi-cluster/account | P29/P30, P35/P36 |
| Query variables with types/conditions and interactive views | P31–P34 |
| Create/manage/inspect indexes and space use | P39/P40 |
| Determine whether an index helps a view | P39/P41 |
| Deployment→Pod live subtable | P22, P24/P25 |
| Subscribe with initial query only when expanded | P14/P15/P25 |
| Arbitrary non-table expanded visualization | P24, P27/P28 |
| Group live results without per-group subscription waste | P29/P30 |
| Native-feeling rendering and low IDE CPU/memory | P02; P12–P15, P23; milestone performance gates |
| Future efficient ABAC and plugin install/update permissions | P04 future seam; no full policy/consent/isolation implementation or protection claim |
| Clean permission errors in queryable components, hover detail | P04, P20, P27, P34/P36 |
| Future AI/MCP query and mutation | P01/P04/P13 transport-neutral read/error contract; separate existing mutation boundary; future write security/preconditions gate |
| Unified documented query model and easy plugin development | P01/P07/P13; optional capabilities, provider example and docs in each public API packet |
| Unified command/settings/navigation search vision | P42/P43 over existing action/query services |
| Independent scoped changes and agent launch order | All 48 packets; dependency frontiers, ownership locks and milestone gates |
| Provider-neutral core from first release; Kubernetes optimizations stay adapters | P44 corpus; P01/P45 contracts, P03/P05/P07/P12–P17 core implementation and applicable conformance throughout; P08–P11 provider-only |
| Architecture-first breaking changes and removal of legacy without losing user data | P01 target design; P45 new-major provider boundary; P47 caller/public-ABI retirement; P46 admission/release gate; owner-packet migrations rather than compatibility shims |
