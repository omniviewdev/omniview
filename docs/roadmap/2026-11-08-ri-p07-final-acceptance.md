# P07 / C05: final acceptance evidence

Status: executed-evidence receipt for [omniview #85](https://github.com/omniviewdev/omniview/issues/85), produced on `origin/main` `38867c35b819f2283900ce54109c86d5bb028c59` (2026-11-08/09). This change adds tests, evidence files and this receipt. It changes no production code, no frozen contract text, no pin, no CI variable and no project state. The user alone merges and closes.

It replaces the open items of [the 2026-11-03 receipt](2026-11-03-ri-p07-schema-catalog-acceptance.md), which disclaimed full acceptance.

## Result

- **Matrix.** All 23 rows of the acceptance matrix below are backed by executed tests on current main. 22 are met outright. One row (N1, native cross-connection and editor isolation) is met for the host controller and for the real application, and is not exercised in the real Monaco editor UI.
- **Gaps closed with new tests.** Eleven Go tests and one Playwright spec. They cover provider-neutral schema states, isolation across every catalog key dimension (including under concurrent replacement), distinct-row and concurrent retention with heap and cleanup measurement, partial representations, editor and field-discovery agreement with admission, editor identity, and the import boundary. Six deliberate production mutations each fail the matching new test (section E6).
- **Live Kubernetes.** With the real Kubernetes plugin binary from the host gitlink, a real kind v1.35.0 cluster and the real host controller, 90 of 90 live Pods are admitted through the corrected published schema. The same 90 Pods are rejected 90 of 90 once `nullable: true` is removed from the two time components. Maximum admission work was 3,338 units against the 1,048,576-unit policy (section E8).
- **Real application.** A focused run of the repo e2e harness drove the real application and the real `workspace-probe` plugin process through its four probe connections: cloud, container, hypervisor and a Kubernetes-shaped fixture (section E9).
- **Findings.** One live Kubernetes record fails admission (`CSINode`, a Kubernetes adapter schema mismatch outside the Pod acceptance row). Three smaller observations are listed in section F.
- **Closure assessment.** The catalog criteria in #85 are met on current main. The specific proof that remains is real-UI Monaco isolation, which depends on the open editor-registration change [#394](https://github.com/omniviewdev/omniview/pull/394) (it replaces the registration code such a run would exercise), and the Kubernetes adapter follow-up for `CSINode`. Section G lists exactly what each needs.

## E0. Sources and environment

| Component | Revision |
| --- | --- |
| Host | `origin/main` `38867c35b819f2283900ce54109c86d5bb028c59` ([#448](https://github.com/omniviewdev/omniview/pull/448)), clean worktree |
| Frozen contract | `docs/superpowers/specs/2026-11-01-resource-schema-catalog.md`, merged by [#342](https://github.com/omniviewdev/omniview/pull/342) (`9b5a75cb5259cb3659d15fee4466217ac040a3c0`); not changed here |
| SDK | `github.com/omniviewdev/plugin-sdk v0.18.0` = `da2874ad99673675aa76f175480932fcce6bfe98`. GitHub compare reports it 16 commits ahead of SDK #44 (`458597dc`) and 19 ahead of SDK #38 (`a712097d`) |
| Kubernetes provider | gitlink `plugins/kubernetes` = `77cf9f58d35dc6e339c64d0efa4ca58ee3bf243c` (plugin 0.17.0). `git merge-base --is-ancestor 3f89634305b6b7c57a00d68057c155f56be3f103 77cf9f58d35dc6e339c64d0efa4ca58ee3bf243c` succeeds, so Kubernetes #88 is contained |
| CEL | `cel.dev/cel-go v0.33.1` replaced by `github.com/omniviewdev/cel-go v0.33.2-0.20261028172556-d7bb038d8c7b` |
| Toolchain | macOS 27.0.1, Apple M5 Max (18 CPUs), go1.27.0 darwin/arm64, node v26.12.0 (v26.13.0 for the e2e harness), pnpm 12.14.0, Docker 29.9.2, kind v0.30.0, kubectl v1.33.0 |

Merged pull requests the matrix relies on:

| Pull request | Merge commit | Subject |
| --- | --- | --- |
| omniview [#342](https://github.com/omniviewdev/omniview/pull/342) | `9b5a75cb5259cb3659d15fee4466217ac040a3c0` | publish the approved C05 catalog contract |
| omniview [#348](https://github.com/omniviewdev/omniview/pull/348) | `a499e65d793738486e80da869d6071b3e663de50` | authoritative resource schema catalog (P07) |
| omniview [#350](https://github.com/omniviewdev/omniview/pull/350) | `1c418ad3cc9328a80484e48b3c00275d23d18df6` | host source coordinator (P05), the merged baseline P07 integrated against |
| omniview [#362](https://github.com/omniviewdev/omniview/pull/362) | `e1ac997988b96fe8f102eb8f571d990f2bcba6b9` | preserve partial collection uncertainty |
| omniview [#364](https://github.com/omniviewdev/omniview/pull/364) | `23fb11ebd6ab9b48aef75c6c03d5a485d8ab656a` | pin the merged Kubernetes cohort |
| plugin-sdk [#38](https://github.com/omniviewdev/plugin-sdk/pull/38) | `a712097dbcd6af34d7e499c8e289e43ccfd74833` | host-derived schema catalog inputs |
| plugin-sdk [#39](https://github.com/omniviewdev/plugin-sdk/pull/39) | `eea5943f7a5319fb1585a8ec2d9ce5d06fa763ca` | phased source sessions (P05) |
| plugin-sdk [#44](https://github.com/omniviewdev/plugin-sdk/pull/44) | `458597dc74be0a203d7b1e602c1c35f02e5d3f54` | count schema bytes by byte budget |
| omniview-plugin-kubernetes [#88](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/88) | `3f89634305b6b7c57a00d68057c155f56be3f103` | publish nullable Kubernetes times |

Reviews and approvals are recorded in the issue: the C05 freeze approval ([comment](https://github.com/omniviewdev/omniview/issues/85#issuecomment-6569606815)), the independent review that blocked the #348 candidate until the approved contract text and the corrections (#342, #362) landed ([comment](https://github.com/omniviewdev/omniview/issues/85#issuecomment-6571104050)), the merged correction proof ([comment](https://github.com/omniviewdev/omniview/issues/85#issuecomment-6592544543)), and the current-main audit that scoped this pass ([comment](https://github.com/omniviewdev/omniview/issues/85#issuecomment-6606663101)).

## Acceptance matrix

Test locations: `[C]` is `backend/pkg/resourcecatalog`, `[T]` is `backend/pkg/resourcecatalog/celtypes`, `[R]` is `backend/pkg/plugin/resource`, `[S]` is plugin-sdk v0.18.0 `pkg/resource/v2` (run through the host module). "Proof added here" lists the files this change adds.

| # | Criterion (issue #85) | Status | Proof already on main | Proof added here |
| --- | --- | --- | --- | --- |
| A1a | One host catalog owns identity, revision, type and scope | Met | `TestResolveStaticDiscoveredAndAbsent` [C], `TestObserveSnapshotIdentityAndRevisionReplacement` [C], `TestIsolationAcrossConnections` [C], `TestRevisionTracksRevisionsContentKeyTracksContent` [T] | `TestCatalogImportBoundary` [C] (no second catalog, no Kubernetes import) |
| A1b | Bounded structural navigation | Met | `TestNavigateFieldTruncationBoundary` [C], `TestNavigateVisitTruncationBoundary` [C], `TestNavigateBranchViewBudgetRetriesWithoutDuplicateMembers` [C], `TestNavigateBranchViewBudgetsSharedPropertyDeclarations` [C], `TestNavigateSharedUnionDAGStopsBeforeCachingExpansion` [C] | `TestAcceptanceSchemaGrantsNoOperationOrNativeFiltering` [C] (walks every navigable position) |
| A1c | Explicit queryability / native-execution overlay | Met | `TestOverlayNativeQueryLanguagesRequireTheCapability` [C], `TestOverlayStatesForEachResolveOutcome` [C], `TestOverlayUnavailableBindingPreservesReasonClassification` [C] | `TestAcceptanceSchemaGrantsNoOperationOrNativeFiltering` [C] |
| A1d | Editor associations derive from the catalog | Met | `TestGetEditorSchemasDerivesAssociationsFromCatalog` [R], `TestGetEditorSchemasAuxiliarySchemas` [R], `TestEditorJSONRendersDraft07` [C] | `TestEditorAssociationIdentityIsScopedAndRevisionStable` [R], `TestAcceptanceEditorSchemaMatchesAdmission` [C] |
| A1e | Field discovery derives from the catalog | Met | `TestGetSchemaFieldsNavigatesCatalogSchema` [R], `TestGetSchemaFieldsReportsSchemaStates` [R], `TestNavigationAgreesWithCELShape` [T] | `TestAcceptanceNavigationAgreesWithAdmission` [C] |
| A1f | Action input schema role stays separate | Met | `TestActionInputSchemasAreNotEntries` [C], `TestActualSDKChildSchemaCatalog` [R] | none needed |
| A2a | Static, discovered and absent schemas work without GVK/OpenAPI | Met | `TestResolveStaticDiscoveredAndAbsent` [C], `TestActualSDKChildSchemaCatalog` [R] | `TestAcceptanceProviderNeutralSchemaStates` [C] |
| A2b | Identical types in different scopes and revisions cannot contaminate caches | Met | `TestIsolationAcrossConnections` [C], `TestNavigateIsolatesConnectionsWithTheSameTypeName` [C], `TestGetEditorSchemasIsolatesConnections` [R], `TestSchemaSnapshotRejectsRetiredEpochWithoutReplacingCurrent` [R] | `TestAcceptanceIdenticalTypeIsolationAcrossScopeAndRevision` [C], `TestAcceptanceSameReferenceOnTwoConnectionsIsFetchedIndependently` [C], `TestAcceptanceConcurrentReplacementNeverServesAnotherScopesSchema` [C] |
| A3a | Refs, unions, arrays, maps and null keep anyOf/oneOf semantics within limits | Met | `TestNormalizeRecursiveRefIsALink` [C], `TestAdmitUnions` [C], `TestNavigateOverlappingAnyOfConditions` [C], `TestAdmitEnforcedConstraints` [C], `TestNavigateOpenAPINullableMapAndArray` [C], `TestNormalizePolicyBoundaries` [C], `TestAdmitWorkBudgetBoundary` [C] | `TestAcceptanceProviderNeutralSchemaStates` [C], `TestAcceptanceNavigationAgreesWithAdmission` [C] |
| A3b | Partial documents keep indeterminate outcomes | Met | `TestAdmitMissingRequiredFollowsCoverage` [C], `TestAdmitOmissionSensitiveCollections` [C], `TestAdmitLocalizedCollectionLiteral` [C], `TestAdmitPartialUnionBranches` [C] | `TestAcceptancePartialRepresentationsProviderNeutral` [C] |
| A3c | Unsupported dialect and shapes are not silently weakened | Met | `TestResolveRootAndDialectFailures` [C], `TestNormalizeDialects` [C], `TestNormalizeUnvalidatedKeywords` [C], `TestAdmitKubernetesValidationsAreReduced` [C], `TestResolveBooleanFalseSchemaIsReduced` [C] | `TestAcceptanceEditorSchemaMatchesAdmission` [C] |
| A3d | Live Kubernetes Pod admission through the corrected published schema | Met (new live run) | none: the earlier 189/189 stays tied to its cohort | Section E8: 90/90 live Pods admitted, 0/90 without the correction |
| A3e | The pinned provider carries the Time/MicroTime correction and the partial-coverage mapping | Met | gitlink `plugins/kubernetes` is `77cf9f58`; #88 merge `3f896343` is its ancestor | Section E8: served bytes equal the apiserver's except the two components; `Pod[model]` 90/90 under partial coverage |
| A4a | No native filtering or capability from schema existence | Met | `TestOverlayNativeQueryLanguagesRequireTheCapability` [C], `TestActualSDKChildSchemaCatalog` [R] | `TestAcceptanceSchemaGrantsNoOperationOrNativeFiltering` [C] |
| A4b | No validation bypass | Met | `TestAdmitClosedObjectRejectsExtraKey` [C], `TestAdmitEnumUsesExactTaggedEquality` [C], `TestAdmitAbsentSchemaIsStructuralOnly` [C], `TestSchemaBindingJSONRejectsRemovedValidationClaims` [S] | `TestAcceptanceProviderNeutralSchemaStates` [C], `TestAcceptanceEditorSchemaMatchesAdmission` [C] |
| A4c | Superseded RPCs and duplicate truth replaced; raw schemas and provider fetches survive | Met | `TestEditorSchemaKeyLanguageAndDuplicateRules` [S], `TestActualRPCServerRejectsDuplicateAuxiliaryEditorSchemas` [S], `TestPresentation_SchemaDocument` [R], `TestPresentation_SchemaDocumentRejectsUnreferencedReference` [R], `TestResolveFetchVerificationAndCaching` [C] | `TestCatalogImportBoundary` [C] |
| A5a | Repeated admissions retain no per-row schemas | Met | `TestRetentionSequentialAdmitNavigate` [C], `TestAdmitDoesNotBuildBranchViews` [C] | `TestAcceptanceDistinctRowAdmissionsRetainNoPerRowSchemas` [C] |
| A5b | Revision-bound metadata and bounded branch-view lifetime and reuse | Met | `TestNavigateBuildsAtMostOneViewPerUnionNode` [C], `TestProviderBuiltOncePerDocument` [T], `TestCleanupReleasesEveryDocument` [C] | `TestAcceptanceDistinctRowAdmissionsRetainNoPerRowSchemas` [C] |
| A5c | Measured memory and concurrency behavior | Met | `TestConcurrentMixedWorkloadMatchesSequential` [C], `TestConcurrentCompileSharesOneProvider` [T] | `TestAcceptanceDistinctRowAdmissionsRetainNoPerRowSchemas` [C] |
| N1 | Native cross-connection and editor isolation | Met for the host and the real application; real-UI Monaco not exercised | `TestActualSDKChildSchemaCatalog` [R], `TestGetEditorSchemasIsolatesConnections` [R], `TestSchemaSnapshotRejectsRetiredEpochWithoutReplacingCurrent` [R] | Sections E8 and E9 |
| V4a | PRs and reviews linked | Met | Section E0 | this PR |
| V4b | No fixture-only or forwarding-mock proof of production behavior | Met | real SDK child process over gRPC: `TestActualSDKChildSchemaCatalog` [R], `TestActualSDKChildHostFiniteBoundary` [R] | real Kubernetes plugin binary on a real cluster (E8); real application and plugin process under Playwright (E9) |
| V4c | Useful workflows preserved; callers and docs updated | Met | removed surfaces absent (E10); SDK v0.18.0 docs state host-derived editors and no provider validation claims | none needed |

## Executed evidence

Complete verbatim outputs are in [`evidence/p07-final-acceptance-20261108/`](../../evidence/p07-final-acceptance-20261108/README.md). Go commands used `GOWORK=off`. The excerpts below are unedited lines from those files.

### E1. Catalog packages on main, before this change's tests

```text
$ GOWORK=off GOFLAGS= GOTMPDIR=/tmp/p07-acc/tmp go test -race -count=1 -v ./backend/pkg/resourcecatalog/...
ok  	github.com/omniviewdev/omniview/backend/pkg/resourcecatalog	9.092s
ok  	github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes	3.006s
```

118 tests (254 results with subtests) passed; none failed or were skipped. The existing sequential retention test logged:

```text
    retention_test.go:160: HeapAlloc delta 15272 B (before 1214704, after 1229976)
    retention_test.go:161: HeapInuse delta 8192 B, HeapSys delta -32768 B
    retention_test.go:166: RSS not measured on darwin
    retention_test.go:234: sequential {Connections:4 Entries:8 Documents:2 RetainedBytes:3225 BranchViews:1 CELProviders:2} concurrent {Connections:4 Entries:8 Documents:2 RetainedBytes:3225 BranchViews:1 CELProviders:2}
```

Full output: `host-main-catalog-race.txt`.

### E2. Host controller schema, editor, catalog and real-child tests on main

```text
$ GOWORK=off GOFLAGS= GOTMPDIR=/tmp/p07-acc/tmp go test -race -count=1 -v -run 'Schema|Editor|Catalog|ActualSDKChild' ./backend/pkg/plugin/resource
ok  	github.com/omniviewdev/omniview/backend/pkg/plugin/resource	10.347s
--- PASS: TestActualSDKChildHostFiniteBoundary (4.80s)
--- PASS: TestActualSDKChildHostCatalogGenerationFence (1.70s)
--- PASS: TestActualSDKChildSchemaCatalog (1.51s)
```

51 tests (73 results with subtests) passed; none failed or were skipped. The three `TestActualSDKChild*` tests compile the SDK conformance child from the module cache, start it as a go-plugin gRPC child process and drive the host controller against it. `TestActualSDKChildSchemaCatalog` covers the P44 bundled-static, discovered-by-reference, absent, unavailable (`FORBIDDEN`), unsupported-dialect (2019-09) and OpenAPI hypervisor scenarios. It checks overlays, `NativeFilter`, association statuses, a raw schema document fetch, a `NOT_FOUND` for an unreferenced reference, a `NOT_FOUND` for another connection's editor document, and admits the three hypervisor records with `reduced` validation. Full output: `host-main-resource-schema-catalog-native-child-race.txt`.

### E3. SDK contract tests (v0.18.0)

```text
--- PASS: TestSchemaBindingJSONRejectsRemovedValidationClaims (0.00s)
--- PASS: TestEditorSchemaKeyLanguageAndDuplicateRules (0.00s)
--- PASS: TestCoveragePathsAreLimitedSubtreePointers (0.00s)
ok  	github.com/omniviewdev/plugin-sdk/pkg/resource/v2	0.508s
--- PASS: TestActualRPCServerRejectsDuplicateAuxiliaryEditorSchemas (0.00s)
--- PASS: TestActualRPCClientRejectsDuplicateAuxiliaryEditorSchemas (0.00s)
ok  	github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin	0.329s
```

Full output, including the other schema-contract tests: `sdk-v0.18.0-schema-contract-tests.txt`.

### E4. Editor consumers (UI)

```text
 Test Files  2 passed (2)
      Tests  9 passed (9)
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

The first block is `ui/providers/monaco/schemaRegistry.spec.ts` plus `useSchemaRegistration.test.tsx`, which include "replaces one route without changing another route" and "merges plugins and removes only the requested route or plugin". The second is `packages/omniviewdev-runtime/src/hooks/resource/useEditorSchemas.test.ts`. These tests mock the native client, so they prove consumer behavior only. Production behavior is proven in E2, E8 and E9. Full output: `ui-vitest-schema-consumers.txt`.

### E5. New tests in this change

```text
$ GOWORK=off GOFLAGS= go test -race -count=1 -v -run 'TestAcceptance|TestCatalogImportBoundary' ./backend/pkg/resourcecatalog/
--- PASS: TestAcceptanceIdenticalTypeIsolationAcrossScopeAndRevision (0.00s)
--- PASS: TestAcceptanceSameReferenceOnTwoConnectionsIsFetchedIndependently (0.00s)
    acceptance_isolation_test.go:374: 5842 resolutions served their own schema, 158 observed RESET_REQUIRED after replacement
--- PASS: TestAcceptanceConcurrentReplacementNeverServesAnotherScopesSchema (0.07s)
--- PASS: TestAcceptanceProviderNeutralSchemaStates (0.01s)
    acceptance_profiles_test.go:482: NativeFilter "unsupported" at every field of 6 cloud and 5 container navigation positions
--- PASS: TestAcceptanceSchemaGrantsNoOperationOrNativeFiltering (0.00s)
--- PASS: TestAcceptanceNavigationAgreesWithAdmission (0.00s)
--- PASS: TestAcceptanceEditorSchemaMatchesAdmission (0.00s)
--- PASS: TestAcceptancePartialRepresentationsProviderNeutral (0.00s)
    acceptance_retention_test.go:308: sequential: 10000 distinct rows; HeapAlloc delta 112 B, HeapObjects delta 2, HeapInuse delta 0 B
    acceptance_retention_test.go:354: concurrent: 24 workers x 700 distinct rows (16800 admitted); 295 statistics samples
    acceptance_retention_test.go:355: sampled extremes: min {Connections:3 Entries:6 Documents:2 RetainedBytes:4436 BranchViews:2 CELProviders:2} max {Connections:3 Entries:6 Documents:2 RetainedBytes:4436 BranchViews:2 CELProviders:2}
    acceptance_retention_test.go:363: concurrent: HeapAlloc delta 60064 B, HeapObjects delta 459, HeapInuse delta 73728 B, HeapSys delta 4194304 B
    acceptance_retention_test.go:375: control: retaining 5000 rows' results grows HeapAlloc by 9423008 B and HeapObjects by 40456
    acceptance_retention_test.go:404: after cleanup: HeapAlloc delta vs start 60192 B, HeapObjects delta 460
--- PASS: TestAcceptanceDistinctRowAdmissionsRetainNoPerRowSchemas (0.91s)
--- PASS: TestCatalogImportBoundary (0.00s)
ok  	github.com/omniviewdev/omniview/backend/pkg/resourcecatalog	2.543s
```

The whole catalog suite with the new tests, again under the race detector:

```text
ok  	github.com/omniviewdev/omniview/backend/pkg/resourcecatalog	6.991s
ok  	github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes	2.090s
```

128 tests (292 results with subtests) passed; none failed or were skipped. Full outputs: `host-pr-new-acceptance-race.txt` and `host-pr-catalog-race.txt`. `TestEditorAssociationIdentityIsScopedAndRevisionStable` in `backend/pkg/plugin/resource` passes under `-race` in the targeted run of that package (52 tests, 74 results with subtests; `host-pr-resource-schema-catalog-native-child-race.txt`).

| New test | What it proves |
| --- | --- |
| `TestAcceptanceProviderNeutralSchemaStates` | Static (JSON Schema 2020-12 inline), discovered (draft-07 by reference, fetched once), absent, unavailable (`FORBIDDEN`) and unsupported-dialect (2019-09) schemas on cloud, container and hypervisor profiles with no Kubernetes dimension, extension or OpenAPI document. Resolve, overlay, admission, navigation and CEL typing all follow the state. Unsupported is not weakened to dynamic. Absent gives structural admission only. |
| `TestAcceptanceSchemaGrantsNoOperationOrNativeFiltering` | One descriptor under four schema states yields the same operations and native languages. Every field at every navigable depth of two rich schemas reports `NativeFilter: "unsupported"`. |
| `TestAcceptanceNavigationAgreesWithAdmission` | A field reported `required` is rejected when missing and an `optional` one is not. A field reported nullable `yes` or `no` admits or rejects null. Discovery and admission read one model. |
| `TestAcceptanceEditorSchemaMatchesAdmission` | The rendered editor document states the enforced constraints (`minimum`, `uniqueItems`, `maxItems`, closed objects, `enum`) and omits an unvalidated `not`. Reduced validation still rejects invalid bodies. The document is rendered once. |
| `TestAcceptancePartialRepresentationsProviderNeutral` | 21 coverage cases: a missing required value is unavailable inside a limitation and invalid outside it; `minItems`, `minProperties`, collection `enum` and `oneOf` exclusivity are indeterminate; `maxItems`, `uniqueItems`, closed-object keys and `oneOf` overlap stay errors; paths are sorted and unique. |
| `TestAcceptanceIdenticalTypeIsolationAcrossScopeAndRevision` | One type name across plugin, connection, generation, epoch and catalog revision with different documents. Each snapshot serves only its own schema, documents are shared only by identical bytes, a replaced snapshot returns `RESET_REQUIRED`, and CEL content keys, revisions and editor documents stay separate. |
| `TestAcceptanceSameReferenceOnTwoConnectionsIsFetchedIndependently` | Two connections with the same document reference fetch independently and keep their own bytes. Both fetches are forced to be in flight together. |
| `TestAcceptanceConcurrentReplacementNeverServesAnotherScopesSchema` | 24 workers resolve, admit and navigate while six slots are replaced through 40 revisions: 5,842 resolutions served exactly their own schema and 158 observed `RESET_REQUIRED`. Foreign properties were rejected every time. |
| `TestAcceptanceDistinctRowAdmissionsRetainNoPerRowSchemas` | 10,000 sequential and 16,800 concurrent distinct rows (valid, invalid and partial). Catalog statistics never moved while a sampler read them. Live heap after garbage collection moved by at most 60 KB and 460 objects against bounds of 1 MiB and 4,096 objects. A control that retains per-row results grows the heap by 9.4 MB and 40,456 objects, so the bounds can see retention. After `DropConnection` every statistic is zero, the weak document pointers clear, and the heap returns to its starting level. |
| `TestCatalogImportBoundary` | `resourcecatalog` imports only the standard library, the SDK `resourcev2` package and `singleflight`. `celtypes` adds the catalog and cel-go. No Kubernetes, controller or second-catalog dependency can appear. |
| `TestEditorAssociationIdentityIsScopedAndRevisionStable` (`[R]`) | The model directory follows the contract's hash formula, differs for every change of plugin, connection, type, representation or auxiliary key (an auxiliary key named like a representation does not collide), and stays stable across schema revisions while `DocumentID` follows content. |
| `e2e/tests/plugins/schema-catalog.spec.ts` | Section E9. |

### E6. Sensitivity of the new tests to production faults

Each mutation was applied through `go test -overlay`, so no tracked file changed. Every one fails the matching new test:

| Mutation | Failing test | First failing line |
| --- | --- | --- |
| `Observe` ignores generation and epoch | `TestAcceptanceIdenticalTypeIsolationAcrossScopeAndRevision` | `generation change must replace the snapshot` |
| reference fetch deduplication shared by every snapshot | `TestAcceptanceSameReferenceOnTwoConnectionsIsFetchedIndependently` | `the second connection's fetch never started: the reference fetch was shared across connections` |
| missing required ignores coverage | `TestAcceptancePartialRepresentationsProviderNeutral` | `admit {} under partial: … required property at "/id" is missing`, then `unavailable = [], want ["/placement" "/placement/zone"]` |
| `Admit` retains 512 bytes per call | `TestAcceptanceDistinctRowAdmissionsRetainNoPerRowSchemas` | `live heap grew by 5211368 B / 10018 objects over 10000 sequential rows` |
| `Admit` retains 16 bytes per call | same | `live heap grew by 257664 B / 10035 objects over 10000 sequential rows` (below the byte bound, caught by the object bound) |
| editor model directory hash omits the connection | `TestEditorAssociationIdentityIsScopedAndRevisionStable` | `file:///omniview-schema/92410528e6d340ee` expected, `8b4cb2444d5bd698` actual |

The diffs and outputs are in `mutation-sensitivity.txt`.

### E7. Measured cost of the catalog paths

```text
$ GOWORK=off GOFLAGS= go test -run '^$' -bench . -benchmem -count=3 ./backend/pkg/resourcecatalog/
BenchmarkNormalizeKubernetesCoreV1-18    	      73	  15826707 ns/op	 101.38 MB/s	19552431 B/op	  180583 allocs/op
BenchmarkAdmitPod-18                     	  249932	      4797 ns/op	    5856 B/op	      33 allocs/op
BenchmarkNavigatePodSpec-18              	   60091	     20863 ns/op	   50992 B/op	     254 allocs/op
BenchmarkCELCompileEvalPod-18            	   34710	     34662 ns/op	   37631 B/op	     641 allocs/op
```

First of three counts shown; all three are in `host-benchmarks.txt`. The machine was shared with two concurrent build jobs, so the figures are indicative. Admission allocates 5,856 bytes per call and retains none of it (E5).

### E8. Live Kubernetes on kind, with the real provider, host controller and cluster

Scope and fidelity. A Kubernetes plugin binary was built from the host gitlink pin (`77cf9f58`, sha256 `dac430ac3582cfa0adb6d3d73f7e3857b25d4f1d8255e7dee11f67cff08c6bc6`, go1.26.1 with `GOEXPERIMENT=jsonv2`, SDK v0.16.0 inside the plugin). It ran as a go-plugin gRPC child with the same client configuration shape as `backend/pkg/plugin/loader.go`. A temporary test in an isolated clone of the host drove the real host resource controller (`OnPluginStart`, `StartConnection`, `Catalog`, `ResolveTarget`, `Enumerate`, `GetSchemaFields`, `GetEditorSchemas`, `GetEditorSchemaDocument`, `GetSchemaDocument`) and the real `resourcecatalog` (`Observe`, `Resolve`, `Admit`, `Navigate`) against a disposable kind v1.35.0 cluster (`kindest/node:v1.35.0`, sha256 `4613778f3cfc…`) that the plugin discovered from a scratch kubeconfig. Not real in this run: the Wails shell, the plugin installer, the settings broker and lifecycle callbacks; the controller came from the existing test helper. The host used SDK v0.18.0 and the plugin SDK v0.16.0; the negotiated protocol version was 1 and no wire problem appeared. The harness source is `live-kubernetes-harness.go.txt`; it is not part of the test suite because it needs a plugin binary and a cluster.

Cluster: 90 Pods across crash-looping, OOM-killed, Pending, scheduling-gated, failing-readiness, image-pull-backoff, init-failure, sidecar, ephemeral-container, Terminating, Job, CronJob and StatefulSet shapes, plus a 10-container Pod. `kubectl get pods -A --no-headers | wc -l` was 90 before and after admission.

```text
Pod                            records=90   admitted=90  rejected=0   validation=reduced   unvalidated=29   maxWork=3338   meanWork=1156.6
Pod-CONTROL                    records=90   admitted=0   rejected=90  validation=reduced   unvalidated=29   maxWork=0      meanWork=0.0
Pod[model]                     records=90   admitted=90  rejected=0   validation=reduced   unvalidated=29   maxWork=3041   meanWork=967.2
Pod#2                          records=90   admitted=90  rejected=0   validation=reduced   unvalidated=29   maxWork=3338   meanWork=1156.6
```

- **Corrected schema.** All 90 Pods are admitted with `Validation:"reduced"`. The 29 unenforced constraints are 27 `x-kubernetes-list-type` and 2 `x-kubernetes-unions`. Maximum work was 3,338 units (`p07-web/exotic-ten-containers`), found by binary search of the smallest successful `MaxAdmissionWork`. This fills the "no measured successful Pod maximum" gap in contract §9. By the §9 formula, twice 3,338 rounds up to 8,192, below 1<<20, so the default policy is unchanged.
- **Control.** The harness removes `nullable` from the two component schemas in the served bytes and nothing else. All 90 Pods are rejected with `{"code":"INVALID_REQUEST","title":"","message":"value at \"/status/conditions/0/lastProbeTime\" has kind null, schema at \"/components/schemas/io.k8s.apimachinery.pkg.apis.meta.v1.Time\" allows string"}`. Navigation reports `lastProbeTime` as `Types:["null","string"]`, `Nullable:"yes"` with the correction and `Types:["string"]`, `Nullable:"no"` without it. The correction is also load-bearing for Events (924 rejections at `/eventTime`, 7 at `/firstTimestamp` without it) and not for the other required types.
- **Required types.** Deployment 15/15, ConfigMap 26/26, Service 11/11, Node 1/1, Namespace 11/11, Event 931/931, ReplicaSet 16/16, StatefulSet 1/1, DaemonSet 3/3, Job 6/6, CronJob 1/1, PVC 6/6 and Secret 7/7 are admitted. The enumerated count equals `kubectl get <kind> -A` for every kind except Event, which keeps changing.
- **Model representation.** `kubernetes.model.v1` carries `Coverage{Kind:"partial", Paths:["/metadata/managedFields"], Reason:"Kubernetes model projection omits metadata.managedFields"}` (`native_read.go:383` in the plugin). All 14 required types (Pod and the 13 others listed above) admit 100% under it. The default representation preserves `managedFields` and the model one omits it.
- **Coverage on a live Pod with `spec.containers` removed.** `complete` and `partial [/metadata/managedFields]` reject with `required property at "/spec/containers" is missing`. `partial [/spec]`, `partial []` and `unknown []` admit and list `/spec/containers` among the unavailable paths. `image` as int64 5 is still rejected under `partial []`.
- **Served document preserved.** The provider served 21 GroupVersion documents (5,717,638 bytes). All 21 are semantically equal to the apiserver's `/openapi/v3` document after removing `nullable`, and every byte outside the two component bodies is identical (21 of 21). The core/v1 document is 1,455,594 bytes natively and 1,455,626 bytes published. `Time` becomes `{"description":…,"format":"date-time","nullable":true,"type":"string"}` and `MicroTime` the same way.
- **Digests.** The binding revision, the document reference revision and `sha256(served bytes)` are all `86412b24ba08cf26b7d92b2afb58903f2a70ec9e5529fbfb814fbbb5bdc9d4c2`, so the revision reflects the correction. The editor `DocumentID` is `3a18edfefabca55a947217e9e99d88601938fafdd5bac25b8545bf297a89af12` = `sha256("omniview.schema-doc.v1\x00openapi-3.0\x00" + bytes)` (the contract's digest, not equal to the served-bytes hash, as expected).
- **Catalog and overlay.** 70 types (62 enumerable) and 21 distinct documents. `GetEditorSchemas` returns 65 `available` and 5 `absent` associations. `GetSchemaFields` at the root of all 70 types gives 65 `schemaChecked/reduced` and 5 `dynamic/none`, and no field with `NativeFilter` other than `unsupported`. The Pod editor document is 447,840 bytes of valid draft-07 JSON with 1,931 definitions. `StartConnection` connected in 475 to 661 ms.
- **Three connections to one cluster** (`kind-p07-acceptance`, `p07-a`, `p07-b`). The Pod model directory differs on each (`4772ad462c0990b1`, `a33105f773816b20`, `0399436438dc0acd`), all 210 (connection, type) directories are distinct, and the document digest is identical on all three, so the catalog went from `{Connections:1 Entries:137 Documents:21 RetainedBytes:11138644}` to `{Connections:3 Entries:411 Documents:21 RetainedBytes:11138644}`: documents are shared by digest and entries are per connection. No digest was referenced by one connection and not another, so a cross-connection `NOT_FOUND` was not applicable and was not forced. An unreferenced digest returns `NOT_FOUND` ("Editor schema document is not referenced by this connection.").
- **Determinism.** Two separate processes with separate plugin children gave the same counts (90/90/0) and maximum work 3,338. Three fresh catalogs over the same captured bodies gave identical per-record work vectors and identical schema digests. Only the Pod mean moves in the third decimal because live status changes between runs (1156.589 against 1156.756).
- **Sweep of the enumerable catalog types outside the 14 required ones (48 types):** 1,235 records, 1,234 admitted, 1 rejected. The rejection is `CSINode` (finding F1). Maximum work across the sweep was 16,576. Types whose schema is absent (the Helm and audit types) are admitted structurally with `Validation: none`.
- **Cleanup.** The cluster was deleted with `kind delete cluster --name p07-acceptance` (`Deleted nodes: ["p07-acceptance-control-plane"]`) and every scratch directory, clone and kubeconfig was removed. The user's kubeconfig was not touched.

Evidence: `live-kubernetes-report-run5.txt`, `live-kubernetes-admission-table-run5.txt`, `live-kubernetes-determinism-run4-vs-run5.txt`, `live-kubernetes-provenance.txt`, `live-kubernetes-harness.go.txt`.

### E9. Real application, focused e2e harness run

The repo harness (`node e2e/scripts/run.mjs`) builds the real application in Wails server mode (`-tags server,devcontrol,e2eapplication`), builds the Kubernetes and `workspace-probe` plugins from committed sources, launches the application and runs Playwright against it. This run was focused (`--grep "schema catalog"`), not the full e2e acceptance suite. It ran from an isolated clone at `88a227eb42793b78f7826279997a8bdb69cb9ec9` (`38867c35` plus only `e2e/tests/plugins/schema-catalog.spec.ts`, whose blob `9623e90a6da5d1bee5cd48dec9bf7f3693a1e608` is the file added here), with SDK `da2874ad99673675aa76f175480932fcce6bfe98`, `plugins/kubernetes` at `77cf9f58`, node v26.13.0 (tarball sha256 verified against the published `SHASUMS256.txt`), pnpm 12.14.0 and go1.27.0.

```text
$ node e2e/scripts/run.mjs --grep "schema catalog"
  ✓  1 tests/plugins/schema-catalog.spec.ts:107:3 › Schema catalog › a provider that declares no schema stays absent, dynamic and isolated on every connection (1.2s)

  1 passed (4.6s)
```

The invocation report records `succeeded: true`, 149,537 ms of the 1,800,000 ms budget, zero retries, and the launch drain `{requests: 1, drained: 1, childrenEmpty: true}`. A repeat run also exited 0 (`1 passed (3.7s)`).

What the spec does, with nothing between the plugin process and the assertions simulated: for each of the four `workspace-probe` connections (cloud, container, hypervisor, a Kubernetes-shaped fixture) it starts the connection through the browser's own "Connect and continue" action and calls the host's resource service over its real runtime endpoint:

- `GetSchemaFields`: `schemaState: "absent"`, no schema revision or dialect, `fields: []`, and overlay `HostEvaluation: "dynamic"`, `Validation: "none"`, `NativeQueryLanguages: []`, with the descriptor's own operations.
- `GetEditorSchemas`: one `absent` association per type, with a model directory equal to the contract's hash of plugin, connection, type and representation. The four directories are distinct: `1408dc61f6215dd8`, `ca0a8e521089851d`, `98be7c689adea740`, `2ebc2ca8fd43a011`.
- `GetEditorSchemaDocument` with a made-up digest and `GetSchemaDocument` with an unreferenced reference both return `NOT_FOUND` on every connection.
- Each connection is stopped again and reports `DISCONNECTED`.

The probe declares an absent schema on every connection, so this run proves the real application path for the provider-neutral absent profile and for editor isolation by directory. It does not exercise an available schema or the Monaco editor. The first attempt of this harness used the Homebrew `go` 1.26.1 and failed in `application-build-once` with `module … requires go >= 1.27.0 (running go 1.26.1)`; every earlier phase passed. A first draft of the spec asserted the provider's own catalog revision and failed because the SDK binds revisions as `ovc1.<nonce>.<digest>`; the spec now asserts that shape. Evidence: `e2e-harness-run.txt`, `e2e-harness-invocation.json`, `e2e-schema-catalog-facts.json`.

### E10. Superseded surfaces and duplicate truth

```text
$ grep -rln --include=*.go -E '"additionalProperties"|"\$ref"|"x-kubernetes-int-or-string"|"anyOf"|"oneOf"|"allOf"' backend pkg internal cmd | grep -v _test.go | grep -v '^backend/pkg/resourcecatalog/'
internal/mcprelay/catalog.go
internal/mcprelay/generic_kubernetes.go
internal/mcprelay/resource_schema.go
internal/mcprelay/resource_tools.go
```

These four files build MCP tool input schemas from the restricted action and native-query `resourcev2.Schema` (`taggedSchema(schema resourcev2.Schema)` in `resource_schema.go`). That is the separate action-input role. None parses a provider resource schema document. In the UI, `ui/providers/monaco/schemaRegistry.ts` only registers `{ $ref: documentURI + (association.root ?? '') }` and `packages/omniviewdev-runtime/src/resource/v2/schema.ts` only declares DTO types; neither walks a schema. The SDK v0.18.0 `SchemaBinding` has no `Validation` or `Unvalidated` field, and its `docs/resource-v2-api.md` states that bindings carry no validation claims and that the host derives editor associations, file matches and model URIs.

## F. Findings

1. **F1: live `CSINode` is rejected (Kubernetes adapter).** `value at "/spec/drivers" has kind null, schema at "/components/schemas/io.k8s.api.storage.v1.CSINodeSpec/properties/drivers" allows array`. The apiserver returns `{"drivers": null}` for a node with no CSI drivers while the OpenAPI schema declares `drivers` required and a non-nullable array. Under contract §5 and §10.1 the host is right to reject and the correction is adapter-owned, so this is not a catalog defect and it is outside the Pod acceptance row. 1 of 1,235 records outside the required types fails. A follow-up in omniview-plugin-kubernetes (an adapter correction for this shape) is recommended; it needs no catalog or contract change.
2. **F2: placeholder association for providers without auxiliary editor schemas.** In E9 `GetEditorSchemas` returns the absent catalog association plus `{type:"", language:"yaml", modelDirectory:"", fileMatch:"", status:"unavailable", code:"UNSUPPORTED"}`. The host's gRPC client always satisfies the optional editor-schema interface, so the host calls it, receives `UNSUPPORTED` and records the §7.1 placeholder for a failed auxiliary call. §7.1 also says "none when unimplemented". The two sentences disagree for an out-of-process provider that implements nothing. It is harmless (the Monaco bridge skips non-available entries), and the spec and the host were left unchanged.
3. **F3: stopped-route error.** After `StopConnection`, `GetEditorSchemaDocument` returns `AppError{code="INVALID_REQUEST" type="omniview:validation" status=400 detail="resource operation failed"}`. The code is accurate enough for a stopped route and the detail is unspecific.
4. **F4: `TypeOverlay` has no JSON tags.** The overlay therefore appears with Go-cased keys (`HostEvaluation`, `Validation`, `NativeQueryLanguages`) in the runtime bindings. That is what the frozen §6.2 declares and what the generated TypeScript model uses; the e2e spec asserts those names.

## G. Remaining gaps and what proves each

| Gap | State | What closes it |
| --- | --- | --- |
| Real-UI Monaco cross-connection isolation (open editors on two connections show only their own schema) | Not exercised. E4 covers the registry's route isolation with a mocked client; E8 and E9 cover host and application bindings. | The editor registration under `ui/providers/monaco` is being replaced by open [#394](https://github.com/omniviewdev/omniview/pull/394). Re-run a two-connection hover or marker check against an available-schema provider after #394 merges. The `workspace-probe` declares absent schemas, so that run needs a provider that serves available schemas on two connections. |
| `CSINode` adapter mismatch (F1) | Open, adapter-owned. | A Kubernetes adapter correction and a live re-run of the sweep. |
| Available-schema run through the real application | Not run. E9's probe is absent on every connection. | A fixture or provider that serves different available documents per connection, driven through the same harness. |
| Historical catalog-startup waits of 90 to 95 seconds on earlier candidate hosts | Not re-assessed. E8's `StartConnection` took 475 to 661 ms, and E9's four connections each started inside the harness's 15-second lifecycle timeout, but neither used the earlier UI query path. | A native Kubernetes UI run on the merged cohort. |
| Earlier 189/189 and 185-Pod samples | Historical, kept as recorded. The 90/90 run above is a new sample on the current cohort and does not relabel them. | none |
| Full e2e acceptance suite | Only the focused spec ran locally. CI runs the suite on this change. | the PR's CI |

## H. Proposed ledger update

For the integration owner to reconcile; this change edits no shared ledger.

- **P07:** catalog acceptance criteria and verification bullets are met on `38867c35b819f2283900ce54109c86d5bb028c59` with the evidence in this receipt. Remaining non-catalog items: real-UI Monaco isolation after #394, and the Kubernetes adapter `CSINode` correction.
- **C05:** the contract is unchanged; fresh live Pod admission (90/90, control 0/90, maximum work 3,338) and the served-document preservation result (21/21) were recorded on the current cohort.
