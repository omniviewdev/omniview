# P16 schema-aware completion: acceptance evidence

Date: 2026-11-09. Issue: [omniview#90](https://github.com/omniviewdev/omniview/issues/90). Base: `origin/main` `c726f84f`. Contract: [P16 completion contract](../superpowers/specs/2026-11-09-p16-schema-aware-completion.md). Status of each row is stated as observed; nothing below is claimed beyond what was run.

## Commands run (macOS arm64, go1.27.0, `GOWORK=off`)

| Command | Result |
| --- | --- |
| `go test -race -count=1 ./backend/pkg/resourceauthoring/ ./backend/pkg/plugin/resource/query/ ./backend/pkg/resourcecatalog/... ./internal/auditgate/...` | all `ok` |
| `go test -race -count=1 ./backend/pkg/plugin/resource/ -run 'ResolveTarget\|Scope\|Finite\|Schema\|Editor\|Catalog\|ActualSDKChild\|Authoring\|CompletePredicate\|RapidDocument'` | `ok` (includes the SDK conformance child over gRPC) |
| `go test -count=1 -run 'Audit\|Policy\|BoundService\|Wails' .` | `ok` (every bound Wails method is classified; `CompletePredicate` added as `allow`) |
| `go build ./...`; `go vet ./backend/pkg/resourceauthoring/ ./backend/pkg/plugin/resource/query/` | clean |
| `task bindings` | regenerated; baseline regeneration before any change produced no diff |
| `pnpm exec vitest run src/resource/v2/authoringUnits.test.ts src/resource/v2/authoringSession.test.ts` (in `packages/omniviewdev-runtime`) | 53 tests pass |
| `pnpm exec tsc -p tsconfig.app.json --noEmit`, `pnpm exec eslint` on the changed non-test files | no output |

Counts from the Go run: 293 passing tests and subtests in `resourceauthoring`; the checker cross-check compiled 753 suggestions (533 static, 191 partial, 29 dynamic) across seven schemas; the all-cursors test ran 4,625 completions over five schemas and 53 drafts; `FuzzComplete` runs its seed corpus under `go test`.

## Acceptance and verification

| Issue bullet | Evidence | Status |
| --- | --- | --- |
| Paths, operators, enum values, types and docs from the resolved catalog; `spec.`/`spec.con` only on applicable types; nested and flat cloud fields, container `State`, VM hardware, maps, tag arrays | `TestSpecOnlyOnApplicableTypes` (cloud has no `spec`; committed Pod and Deployment OpenAPI documents do), `TestCloudFlatFieldsAndTagArray`, `TestNestedCloudFieldsMapsAndQuotedNames`, `TestContainerStateAndLabels`, `TestVMHardwareNestingAndConditionalBranches`, `TestHypervisorOpenAPIConditionalAndAllOf`, operator/value tests; real SDK child: `TestActualSDKChildCompletion` | Met. Container `State` and VM `hardware` documents are test inputs through the real catalog (the P44 corpus has flat container and VM schemas) |
| Exact replacement ranges for incomplete quotes/operators, array/map access, mid-expression edits; units defined; Unicode, UTF-8 and UTF-16 demonstrated | `TestReplacementRangesForIncompleteDrafts`, `TestArrayAndMapAccessRanges`, `TestMidExpressionEditsKeepTheRestOfTheText`, `TestRetypedOperatorKeepsTheExistingOperand`, `TestUnicodeCursorsAndRanges` (emoji, CJK, combining marks; an editor offset reused as bytes lands elsewhere; cursors inside scalars rejected), `TestUnitVectorsConvertBothWays`, `TestNativeCELScalarOffsetsConvertToWireBytes`, TS `authoringUnits.test.ts` reading the same vectors | Met |
| Provider, type, scope, access generation, schema revision and document revision changes invalidate or reject stale suggestions; cancellation and bounds | `TestAuthoringIdentityChangesRejectStaleExpectations`, `TestRapidDocumentChangesAreSupersededThroughTheTransport`, `TestAuthoringDeadlineAndCancellation`, `TestAuthoringResponseIsBoundedForLargeSchemas`, `TestSuggestionBoundsAndTruncation`, `TestResponseByteBudget`, `TestTraversalBounds`, `sessions_test.go`; TS `authoringSession.test.ts` | Met at the host and the runtime helper. No permission epoch exists to key on (§Gaps) |
| Conditional branch applicability, nullable ancestors, actual static/partial/dynamic strength; discriminator hint is not narrowing | `TestDiscriminatorComparisonDoesNotNarrow`, `TestVMHardwareNestingAndConditionalBranches`, `TestCheckingLabelsMatchTheCELChecker` | Met |
| Contract cases for partial paths, quotes, operators, Unicode, nested nullability, conditional branches across cloud/container/VM and Kubernetes | files above | Met |
| Rapid document/type/provider/scope/schema/access changes through the real authoring transport; bounded responses; stale rejection | the transport tests call `ServiceWrapper.CompletePredicate` with the request JSON-decoded strictly and the response JSON-encoded, against the real controller; one run of the burst served 4 and cancelled or refused 176 of 180 requests, every answer carrying its own revision | Met for the Go transport. The Wails runtime/HTTP layer and a browser were not driven (§Gaps) |
| Labels inspected against actual catalog semantics, not example objects | every suggested path compiled with `celtypes` (the production catalog-bound CEL environment) and compared with the checker; operator and value edits compiled once their placeholder was filled | Met. It found three catalog facts now documented (contract §6, §8) |
| Link PRs and executed evidence; no fixture-only or forwarding-mock proof | this document and the PR body | Met. Mock providers appear only to vary a schema, slow or block a call; the P44 profiles run through the SDK child |

## Findings from checking against the real checker

1. CEL cannot index a typed object. `resource["name-with-dash"]` and `resource.network["vpc"]` fail to check when the parent has declared properties. The edits use `.name`, index syntax (map/dyn parent) or `dyn(parent)["name"]` accordingly.
2. Only `true`, `false`, `null` and `in` cannot follow `.`; `resource.metadata.namespace` checks.
3. A typed map or list with dyn elements (Kubernetes `resources.limits`) is labelled `static` by P07; its elements are `dynamic`.

## Overlap notes

Touched shared files, minimally: `backend/pkg/plugin/resource/controller.go` (one struct field after `schemas`, away from PR #395's interface hunk), `service.go` and `service_wrapper.go` (one method each), `finite_service.go` (extracted `normalizeQueryScope` from `ResolveTarget`, behavior unchanged), `backend/pkg/plugin/resource/query/{parse,request}.go` (two additive exports: `PredicateParser`, `ValidateDeclarations`), `internal/auditgate/policy.json` (one line), generated bindings. Not touched: `ancillary_service.go`, `catalog_binding.go`, `finite_operations.go`, `reference_admission.go`, `testutil_test.go`, `ui/providers/monaco/*`, `ui/App.tsx`, the Grafana files, `resource/graph`. PR #442 lists files under `internal/auditgate/gateway/`; its `policy.json` involvement was not checked.

## Migration

No `FilterField` list, type or consumer exists on `origin/main` (searched Go and TypeScript), so there is nothing to migrate or remove. `GetSchemaFields` and its hook stay: they are the tier navigation API for pickers and are not superseded.

## Remaining gaps

- No permission epoch exists on the host; `accessGeneration` folds in the provider generation, connection epoch and the principal's generation slot only. Permission-aware inventory suggestions belong to P17.
- Navigation cannot reach a field past the 128th of one node by prefix (P07 policy); the response is truncated, not wrong. Fixing it requires a reviewed P07 change.
- Hover, signatures, diagnostics and expected-token reporting are not implemented; `draft` reports only valid/incomplete.
- The Wails HTTP/IPC layer, the real app and a browser editor were not driven; no e2e spec was added. The runtime `authoringSession` helper is tested against a fake transport, not a live bridge. Nothing in the host UI calls it yet (P19/P20).
- `filter(...)` keeps the receiver's item type (`TestFilterKeepsTheReceiversItemType`); `map(...)` results, arithmetic operands and ternaries resolve no members.
- Operand extraction delimits a postfix chain lexically and then parses it; shapes outside the fuzz and draft corpus (comments inside a chain, optional `?.` syntax) are not covered by tests and may yield no suggestions.

## Proposed ledger update

Work packages P16: "Implemented in this PR: host completion service `CompletePredicate` (`omniview.authoring.v1`), runtime projection and session helper; remaining: P19/P20 consumers, permission epoch, hover/diagnostics". Contract readiness C09: "cursor/replacement units (UTF-8 bytes, conversions proven), document/schema/access/environment identity, stale rejection, bounds and operator insertion rules defined in the P16 contract; descendant path-presence is reported as `context.ancestors`; builder guard generation and whole-clause NOT remain P21".
