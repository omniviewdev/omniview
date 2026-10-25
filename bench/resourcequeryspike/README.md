# P01 canonical contract semantic / codec spike

This is a **verification-only design/spike**, not a host product query service, public SDK contract, accepted numeric dependency or complete planner. Its nested module deliberately does not alter/import the product host module. `cel.dev/cel-go v0.32.0` is an **UNSAFE EXPERIMENTAL PIN**: native mixed-number helpers and optimized membership remain a production blocker. This probe makes no integer-only production proposal and does not duplicate/retest the accepted unsafe mixed-double findings.

The [canonical proposal R2](../../docs/superpowers/specs/2026-10-24-resource-query-contracts.md) selects one canonical Go/proto/TS domain with repeated duplicate-preserving scope entries, explicit multi-field text ANY semantics, dynamic checked Boolean admission, declaration/environment-bound authoring and a small recursive builder grammar. Independent C01/C07 and C06/C09 design reviews approved this exact draft; production numeric admission and dependent contract freeze remain blocked. This packet is a design/spike: downstream catalog/editor/planner/source/result-lease implementation is excluded, not an invented extra P01 completion gate.

## Owned boundary

Node JSON serialization -> stdin of a host-side Go subprocess -> strict typed admission -> actual native CEL parse/check/cost-bounded context evaluation -> Go JSON -> independent Node assertions. It is not Wails, generated bindings, a provider RPC or production authorization proof. Go tests additionally exercise context cancellation, independent P44 identity cases and byte/UTF-16 positions. No JavaScript evaluator or client inventory sort exists.

The finite probe request version is `omniview.p01-spike.v1`, intentionally distinct from the proposed canonical semantic versions. `scenario` and verification-only `candidates` select finite corpus data, not a future public query API. The probe does not accept trusted principals, imported ASTs, arbitrary file paths, provider selectors or native source cursors. Error observations consume C02 machine meanings without defining another production AppError ABI.

Supported probe subset:

- Merged P44 cloud/container/hypervisor native corpus; exact scope selection, opaque canonical identity keys, optional incarnation/revision, absent-schema dynamic bodies, same-element tag correlation, quantifiers and quoted map keys.
- Tagged int64/uint64 decimal strings, finite double, nanosecond timezone timestamps, recursive list/map/nullable bindings and empty collections. Strict unknown-field/tag, duplicate-key, type/range/canonical/byte/depth/item validation. Bindings never interpolate source.
- Complete-document missing vs null, supported dynamic member-path clauses, whole-positive NOT vs guarded inequality, multi-field text ANY AND predicate AND scope, stable global string/missing/null order before bounded page, safe candidate/residual equivalence and unsafe pre-limit counterexample. Empty nonempty-text field lists reject; known absent/null fields are nonmatching. The private `incompleteRepresentation` negative control rejects before any matching text/predicate can mask unavailable information.
- Native CEL cost control; preflight cancellation; checked bool OR dyn with actual Boolean-only results; useful partial-draft parser failure plus bounded member-chain cursor recovery. Authoring carries declarations/environment and document revisions (no execution binding values), checks through native CEL and translates actual native codepoint diagnostics after supplementary/combining characters to UTF-8 bytes; frontend byte/UTF-16 conversion is separately exercised.

Explicit limits:

- Bundled schema bytes are corpus evidence, not normalized schema admission/static catalog checking. Resource unions/partial documents retain the accepted design semantics; this spike does not claim to implement them. Existing accepted nullable/union/schema evidence is reused, not promoted or copied into a second normalizer.
- Dynamic numeric fixture bodies admit exact int64/uint64 integral lexemes only; fractional body numbers return UNSUPPORTED in this probe. This is a probe subset, **not a proposed production ban**. Typed finite double bindings work; mixed exact/binary64 mathematical safety is not claimed. Timestamps in resource bodies remain original strings unless a predicate explicitly constructs timestamps; tagged timestamp bindings are actual CEL timestamps.
- Builder supports member-only dynamic paths and the listed state/value clauses; it is a CEL lowerer, not a second evaluator. Operands must be declared valid parameter identifiers, never CEL literal/reserved names. No correlated-array builder UI, branch-specific union lowering or advanced reverse conversion is claimed. Correlated arrays execute through native CEL text.
- Order is ascending string, missing then null then values, then ascending address key and opaque incarnation token (absent before present in this private representation). This request has one target; neither fixture name, source revision nor arrival order is a tie-break. No full comparator, multi-target union, opaque result continuation, lease/follow or source protocol is implemented. Offset is finite experimental state, never a production cursor. P44 server-filter support is absent: candidate/residual controls are host-only, not actual native-provider equivalence.
- Draft recovery handles unquoted `resource.member.` chains only. It returns context/replacement bytes and declaration/revision-bound native diagnostics; it is not catalog completion, schema/permission discovery or an LSP/editor. Caller revision labels are echoed only in this private experiment; production host-authoritative environment identity and stale-response admission follow the canonical design, not a provenance claim from this probe.
- Corpus coverage/freshness is carried unchanged. Exhaustion is selected-access-relative, bestEffort remains bestEffort, partial remains partial; no production exact/live query success inferred.
- Limits (64KiB request/document,16KiB source,depth32,4096 JSON values,128 declarations/page rows,cost100000,5s process evaluation deadline) are finite experiment settings, not measured product budgets. The stdin reader reads at most64KiB+1; corpus export is trusted provenance-checked fixture input.

## Reproduce after coordinator barrier

Use the private clean-environment launcher supplied by the coordinator. All Go children use `GOWORK=off`. From this directory, sequentially:

```sh
BASELINE="${OMNIVIEW_P01_BASELINE_ENV:?Set to the reviewed private-HOME environment launcher}"
"$BASELINE" node export-corpus.mjs ../../../plugin-sdk "$BASELINE"
"$BASELINE" go mod tidy
"$BASELINE" go test ./... -count=1 -v
"$BASELINE" go test -race ./... -count=1
"$BASELINE" go build -o p01-probe .
"$BASELINE" node driver.mjs
```

`export-corpus.mjs` verifies exact merged SDK HEAD `da0c53be2da636d3833b7ca1e73f8a6c8d26b5c7`, then clones committed objects into an exclusively owned private checkout (`--no-local --no-hardlinks --no-checkout`, detached reviewed commit, Git hooks disabled). It builds there, never in the caller worktree: tracked modifications, untracked and ignored Go inputs in that worktree cannot enter the export. Explicit corpus-source comparisons remain. An exclusive UUID-named SDK-internal temporary exporter invokes existing `NativeCorpus()` and `Validate()` with `go run -mod=readonly`; `finally` removes its source/directory and the private checkout before publishing provenance. Raw stdout bytes are preserved (no JS numeric reserialization). No retained caller SDK changes or public exporter.

Generated local `corpus.json`, `corpus-provenance.json`, `results.json` and `p01-probe` are ignored. Keep actual result/provenance outputs with coordinator evidence; do not commit binaries/caches. `go.sum` is the exact experimental dependency checksum lock, not production dependency approval.

The exporter behavioral regression uses its own disposable SDK clone with a broken tracked `go.mod` plus untracked and ignored Go init panics. It executes the real exporter CLI, checks the independently recorded corpus digest and verifies caller bytes/status remain unchanged. After the coordinator barrier:

```sh
"$BASELINE" env OMNIVIEW_P01_BASELINE_ENV="$BASELINE" OMNIVIEW_P01_SDK="$(pwd)/../../../plugin-sdk" node --test export-corpus.test.mjs
```

## Numeric gate and acceptance status

No full P01 closure/C06 profile freeze: need an official corrected dependency covering both mixed-numeric helper semantics and optimized set aliases plus actual selected-pin mixed-numeric/optimized/nullable conformance and pin/license/performance acceptance; alternatively a separately authorized bounded reviewed temporary dependency patch with update/removal owner. No such safe candidate or authorization exists. Upstream-first accepted strategy does not authorize a fork/host equality engine/dynamic ban/upstream mutation.

Test code was written before implementation under the coordinator's no-mid-flight-check barrier. No red run is claimed. Execution receipts are recorded only after the settled barrier in the coordinator report; source presence alone is not a passing result.

## Executed settled-barrier receipt

Coordinator explicitly authorized sequential export, nested tidy, scoped gofmt, tests/race, build and actual Node driver. The commands above ran through the clean launcher with `GOWORK=off`; Go reported `go1.26.1 darwin/arm64`, Node `v24.14.0`.

- P44 export completed with exact SDK source `da0c53be2da636d3833b7ca1e73f8a6c8d26b5c7`, source-byte comparisons and successful temporary-exporter source/directory removal.
- `go mod tidy` and scoped `gofmt -w` completed; only this experimental nested module gained dependency locks. Product host module and SDK/public/generated sources were untouched.
- Corrected cohort: `go test ./... -count=1 -v` passed all **14 top-level tests**, including four correlation/presence subcases (`ok github.com/omniviewdev/omniview/bench/resourcequeryspike 0.415s`).
- Corrected cohort: `go test -race ./... -count=1` passed (`ok github.com/omniviewdev/omniview/bench/resourcequeryspike 1.350s`); no race report for this finite workload, not every possible schedule.
- `go build -o p01-probe .`: exit0. Corrected `node driver.mjs` stdout: **`Node -> Go -> native CEL -> Node: 73 independently expected observations passed; numeric production gate BLOCKED`**.
- Export SHA256: `a9d39f6e56aef5d8b2568332d9d93b5dd602e6fe96f5342abf0f4b1e8e50b1a0`; provenance SHA256: `36fb9f3765786179a6edf7275f1333f6969eb8e118df73f01ac07f7802a0b322`; corrected actual `results.json` SHA256: `1b6bfe1c774c7329a75b5a982176517b1115d0a611acb87a6445e516ac15c9fd`.

The unsafe historical mixed-numeric cases were not rerun. Exact integer/timestamp transport and nonnumeric outcomes above do not resolve the separate unsafe optimized-membership gate. No app process, network service, publication, public ABI export or product integration claim was created.

### Corrected receipt provenance and review boundary

The corrected 73-observation cohort supersedes the earlier 58-observation receipt. Independent implementation review and coordinator boundary probes found four defects after that earlier run: Go's case-insensitive DTO member aliases, unpaired escaped UTF-16 coercion, the declaration-count admission boundary, and incomplete mid-token authoring replacement. Root-cause fixes and Go/Node regressions cover exact DTO names while retaining arbitrary map-key case/Unicode; reject invalid escaped surrogates while preserving valid pairs/literal replacement/backslash data; distinguish 128/129 declarations from binding mismatch; and replace the complete authoring token.

Corrected source SHA256 recorded with that authorized cohort:

| Source | SHA256 |
|---|---|
| `codec.go` | `aa5747ab723b9e912f50961ee1cf3f4d09cdac15ccc747e088b87b12fc3a5095` |
| `json_admission.go` | `b3b51f2ee160ab1487795291e55ece1f00b037e0b5c68c93ea0d39e558f576aa` |
| `authoring.go` | `1038fea99472361ff136aa55c95369c1d0ac0f2168b920f1bb2ddbdca3bfbd42` |
| `codec_review_test.go` | `f596cb1fd37ed27ea68af61aa194c69ee743ed89681dbd3c84a24328c8a7d298` |
| `driver.mjs` | `9a1946d0a0ca0de8837d55b6223ac3673e267df3a223a053a42fcf6d37941ff9` |

These are retained historical execution receipts, not a new run or a public evidence-download URL. The ignored artifacts remain local coordinator evidence; the published source and reproduction instructions are independently usable. Final independent implementation re-review approved those four corrected fixes, and a later authorized rerun passed normal/race/build/73 observations. The design reviews and that bounded implementation approval do not substitute for numeric production approval.

### Bounded upstream status check (2026-10-24)

Read-only upstream metadata still identifies [v0.32.0 as the latest official release](https://github.com/cel-expr/cel-go/releases/tag/v0.32.0) and [master `4ab6aedf5933b15dcf0b3237e4bf0aed58b953dc`](https://github.com/cel-expr/cel-go/commit/4ab6aedf5933b15dcf0b3237e4bf0aed58b953dc), unchanged from the previously inspected unsafe sources. [PR1377](https://github.com/cel-expr/cel-go/pull/1377) remains open/unmerged at head `7d2d5e7d1203562205788c1a45392e1e86c645d3`; its current diff changes numeric comparison helpers and their tests, not optimized-membership aliases. This bounded status check admits no corrected candidate and runs no historical unsafe probe. Both correction paths and the selected-candidate conformance/license/pin/performance gate above remain required. No dependency, fork or upstream mutation was made.

### PR130 follow-up corrections and executed barrier

Review identified three additional valid gaps: builder literals accepted as parameter names, missing incarnation in final page ties, and exporter commit provenance not excluding other modified SDK build inputs. The current source rejects undeclared/reserved builder references, uses the required address/incarnation final tie (no fixture-name/stable-arrival substitute), and builds exclusively from the private committed SDK checkout described above. Go and actual subprocess Node regressions exercise rejected references, a valid bound operand, and equal-address incarnation pages under permuted arrival/name/revision order. Exporter contamination is exercised by the separate real-CLI regression above.

After explicit coordinator grant, all five commands ran sequentially through the private-HOME launcher (`GOWORK=off`); no source edits during checks:

- `go test ./... -count=1 -v`: all **16 top-level tests** passed, including 18 reserved/undeclared builder subcases and four existing correlation/presence subcases; final `ok github.com/omniviewdev/omniview/bench/resourcequeryspike 0.410s`.
- `go test -race ./... -count=1`: passed, `ok github.com/omniviewdev/omniview/bench/resourcequeryspike 1.349s`; no race diagnostic for this finite workload.
- `go build -o p01-probe .`: success, no stdout.
- `node driver.mjs`: exact stdout **`Node -> Go -> native CEL -> Node: 92 independently expected observations passed; numeric production gate BLOCKED`**. This supersedes the 73-observation cohort for the changed source.
- The exporter regression command above: **1 test passed, 0 failed/skipped**, exercising the real CLI with broken tracked module input and untracked/ignored Go init panics in its owned caller checkout. Exact committed corpus digest held and caller bytes/status were preserved; the exporter removed its private checkout before emitting provenance.

No canonical corpus re-export/tidy/formatter/install/bindings/broad E2E/performance measurement ran. Historical source/provenance/result hashes above describe their original cohort, not the newly changed source or latest 92-observation result. No production dependency/profile change or safe mixed-number/optimized-membership claim.

### Nested ancestor follow-up: observed RED → GREEN

The next review found that a dynamic member path could apply membership/indexing to a non-map ancestor. Tests were written first, then the coordinator-authorized RED runs reproduced actual native CEL errors on string/integer/Boolean/list ancestors and incorrect present/absent membership for a deeper list containing the member name. Existing missing/null controls, typed list/map leaves and all five builtin-shadowing rejection controls passed; the actual Node subprocess also failed on the expected string-ancestor case.

The lowerer now adds standard native CEL `type(parent) == map` applicability before each membership test. Existing ancestor/terminal null guards and whole-clause NOT remain intact. Only ancestors must be maps: reachable terminal lists/maps retain typed operand comparison, including empty lists and injection-shaped bound string data. Existing declaration admission rejects `type`/`map` and other builtin-shadowing names; no new reserved names or helper evaluator were added.

After explicit coordinator GREEN grant, sequential scoped `gofmt -w authoring.go contract_test.go`, normal/race/build, actual Node driver and real exporter regression all succeeded through the private-HOME launcher with `GOWORK=off`; no source edits during checks:

- `go test ./... -count=1 -v`: **18 top-level tests passed**, including all 133 nested shape/clause cases and five builtin-shadowing controls; final `ok github.com/omniviewdev/omniview/bench/resourcequeryspike 0.463s`.
- `go test -race ./... -count=1`: `ok github.com/omniviewdev/omniview/bench/resourcequeryspike 1.683s`, no race diagnostic for this workload.
- `go build -o p01-probe .`: success, no stdout.
- Actual driver stdout: **`Node -> Go -> native CEL -> Node: 230 independently expected observations passed; numeric production gate BLOCKED`**.
- Real exporter contamination regression: **1 passed, 0 failed/skipped**; committed corpus digest and unchanged caller bytes/status held.

This 230-observation cohort supersedes historical 92 for the changed lowerer source. It remains bounded design/spike evidence, not schema normalization, production authorization/planner/provider filtering or mixed-number/optimized-membership safety. Numeric production remains BLOCKED.
