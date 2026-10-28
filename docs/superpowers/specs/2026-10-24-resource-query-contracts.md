# P01 canonical C01/C06/C07/C09 proposal R2

Immutable review artifact. Supersedes R1 in full; not approved, no dependent freeze or public API implementation authorization. The actual safe numeric dependency/profile gate remains BLOCKED. Omniview#80 is a design/spike packet: later catalog/editor/planner/source/lease implementation is excluded, not an extra P01 completion requirement. Consumes coordinator-approved C02 R4 unchanged (SHA256 `0baa42d570479ed98102941cfe44e37c1ae6581ad9281e4173f1d9e765d0ddc0`).

## 1. Canonical domain ownership and exact C01 mapping

P01 chooses the domain below NOW. P45 implements/generates it at its reviewed new-major boundary; it does not choose a different map-vs-sequence representation later. P03 migrates identity consumers. No new public source/generated output is created by this spike.

One handwritten authoritative Go domain: SDK `pkg/resource/v2/domain.go`, package `resourcev2`, with private validation/canonicalization helpers in that package and no competing host domain aliases. Protocol mapping: SDK `proto/resource/v2/domain.proto`, proto package `omniview.resource.v2`, go_package `github.com/omniviewdev/plugin-sdk/proto/resource/v2;resourcepb`. Generated Go is transport-only; host/providers consume validated resourcev2 values through explicit adapter conversion. Runtime TS domain projection: `packages/omniviewdev-runtime/src/resource/v2/domain.ts`, exported deliberately by P47, not legacy models/providers re-exports. P45 owns Go/proto adapter generation/codec; P47 owns TS package ABI/export. This proposal chooses names/field mappings, not an RPC service or provider capability design.

Canonical declarations (strings opaque UTF-8; JSON casing exact):

```go
type ScopeEntry struct { Dimension string `json:"dimension"`; Value string `json:"value"` }
type ResourceAddress struct {
 Provider string `json:"provider"`; Authority string `json:"authority"`
 Type string `json:"type"`; Scope []ScopeEntry `json:"scope"`; ID string `json:"id"`
}
type AccessRoute struct { Connection string `json:"connection"` }
type ResourceReference struct {
 Address ResourceAddress `json:"address"`
 Incarnation *string `json:"incarnation,omitempty"`
}
type ScopeConstraint struct {
 Dimension string `json:"dimension"`; Match ScopeMatch `json:"match"`
 Values *[]string `json:"values,omitempty"` // nil for any; nonnil (including empty array) REQUIRED for oneOf
}
type ScopeMatch string // exactly "any" | "oneOf"
type QueryScope []ScopeConstraint
```

TS uses identical field names: `ScopeEntry={dimension:string;value:string}`, `ResourceAddress={provider:string;authority:string;type:string;scope:readonly ScopeEntry[];id:string}`, `AccessRoute={connection:string}`, `ResourceReference={address:ResourceAddress;incarnation?:string}`, `ScopeConstraint={dimension:string;match:"any"}|{dimension:string;match:"oneOf";values:readonly string[]}`, `QueryScope=readonly ScopeConstraint[]`. No JSON object-map scope at the canonical wire boundary. Private normalized host maps are allowed only after duplicate detection/admission.

Exact protobuf mapping:

```proto
message ScopeEntry { string dimension = 1; string value = 2; }
message ResourceAddress {
 string provider = 1; string authority = 2; string type = 3;
 repeated ScopeEntry scope = 4; string id = 5;
}
message AccessRoute { string connection = 1; }
message ResourceReference { ResourceAddress address = 1; optional string incarnation = 2; }
message AnyScope {}
message OneOfScope { repeated string values = 1; }
message ScopeConstraint {
 string dimension = 1;
 oneof selection { AnyScope any = 2; OneOfScope one_of = 3; }
}
message QueryScope { repeated ScopeConstraint constraints = 1; }
```

Proto repeated entries preserve duplicate dimensions until adapter admission: reject duplicates before building Go normalized indexes. JSON strict decoder rejects duplicate object members and duplicate scope dimensions; generated protobuf maps are NOT used. Unknown proto oneof/unset selection rejects; additive protobuf unknown fields follow negotiated protocol policy, never inferred new selection semantics. JSON unknown fields reject at canonical DTO admission. Optional token absence maps Go nil / proto optional absent / TS omitted; explicit empty token rejects, never stands for absence. SourceRevision is a separate optional observation token, NOT ResourceReference/address identity; P05 uses exactly the same optional-string mapping. Lists are normalized nonnil empty arrays on canonical JSON output. Authority resolution metadata is host catalog state, not a second identity DTO.

Provider/type/id/authority/dimension are nonempty opaque case-sensitive UTF-8; scope values follow the declared provider dimension domain (including empty only where explicitly allowed). No Unicode/case/percent/slash normalization, ID splitting, GVK/namespace/UID/watch/CRUD requirement. Type catalog declares exact identity dimensions. Missing/unknown/duplicate identity dimensions fail INVALID_REQUEST; empty scope is valid for zero dimensions. Address equality excludes access route, incarnation, sourceRevision, schema and representation. Scope order does not matter; normalize once.

Canonical internal key is compact UTF-8 JSON tuple `["omniview.address.v1",provider,authority,type,[[dimension,value],...],id]`, scope sorted by UTF-8 dimension bytes. Quote/backslash/control escaped; `<>&` not HTML-escaped; U+2028/U+2029 escaped `\u2028`/`\u2029`; other Unicode emitted directly, no whitespace/normalization. Host creates key; TS does not independently canonicalize authority/identity. Key equality is identity, NOT authorization/cache sharing.

Host assigns persistent AuthorityID from reliable provider native backing identity. Unknown identity gets isolated connection-local authority and explicit continuity limits. Endpoint/display/credential hash never proves identity. Retargeting resolves new authority and invalidates acquisition; no silent saved-reference rekey. Equal addresses do not merge bodies/access/projections. Optional incarnation distinguishes recreation only if actually supplied; absent stays unknown, no synthesized UID.

Query scope selection differs from exact identity. Each declared query dimension has one any or oneOf constraint. Unknown/duplicate dimension invalid; omitted remains unresolved until a documented default is made explicit in effective request. oneOf requires an actual array; empty matches nothing, duplicates normalize once. any stays inside admitted target/route/access, not all accounts. Body tags only become source dimensions if declared. Native scope never confers trust.

## 2. Versioned query/result semantics C07

Canonical semantic versions proposed: `omniview.query.v1`, `omniview.resource-predicate.v1`, `omniview.builder.v1`, `omniview.authoring.v1`. Persist source/profile/declarations and structured host concerns, never CEL AST/protobuf or native cursors/handles.

```
QuerySpec={version:"omniview.query.v1", targets:Target[],
 predicate: CELPredicate | {language:"builder",version:"omniview.builder.v1",document:Builder},
 declarations:Record<string,BindingType>, bindings:Record<string,BoundValue>,
 text?:{term:string,fields:DocumentFieldPath[],match:"substring",case:"sensitive",combine:"any"},
 projection:{id:string,path:DocumentFieldPath}[], order:OrderTerm[],
 delivery:{mode:"once"|"follow",pageSize:number,after?:string,allowPartial?:boolean}}
Target={targetId:string,provider:string,authority:string,type:string,
 accessRoute:AccessRoute,representation:RepresentationBinding,scope:QueryScope}
CELPredicate={language:"cel",profile:"omniview.resource-predicate.v1",source:string}
DocumentFieldPath=readonly ({kind:"member",name:string}|{kind:"index",index:number})[]
```

Targets are explicit union memberships, not joins/all-connections search. targetId unique nonempty request-local stable string, no authority. Equal addresses in different targets remain separate rows/projections/provenance; row key includes target membership + address + available incarnation, no address-only dedupe/enrichment. Access generation/representation/schema/source guarantees further bind sharing eligibility.

Text has exactly ANY semantics over the selected admitted string values; ALL is not accepted in v1. It ANDs with predicate AND target/scope. All referenced text fields must first pass authorization/representation coverage admission, even if an earlier string matches: unavailable field requires plan hydration or explicit unsupported/coverage policy, never masked by ANY/empty term/Boolean result. Known absence and present-null contribute false; admitted non-null nonstring is UNSUPPORTED unless an explicit schema-applicability guard excludes that alternative. Empty term imposes no text restriction AFTER coverage/admission; nonempty term + empty fields INVALID_REQUEST. Empty term + empty fields is the explicit no-text-restriction case. No implicit all-fields scan, token grammar, source interpolation, or dropping scope/predicates. Matching is literal case-sensitive Unicode substring, no normalization/case folding. Duplicate paths normalize once. Raw CEL text keeps native error semantics.

Typed values retain accepted bool/string/int64/uint64/double/timestamp/list(element)/map(value)/nullable(value) declarations; value tags null or matching scalar/list/map + value. Bindings are data, never source interpolation. Direct declared identifiers, body root resource; reject reserved/shadowing/unknown/missing/extra identifiers. Nullable parameters remain required. Canonical int64/uint64 decimal strings range-check with no whitespace/exponent/fraction/-0/rounding. Double finite binary64, not exact decimal/integer substitute. Timestamps timezone RFC3339, <=9 fractional digits, supported Gregorian range, UTC normalization; reject precision/range before parser truncation. Strict discriminants/unknown fields/duplicates/recursive cardinality/depth/bytes; empty collections retain declaration types; no coercion.

Final result semantic shape: host generation, ordered keyed rows with target/representation/provenance, projected values `{state:"absent"}|{state:"null"}|{state:"value",value:BoundValue}` only where coverage permits; unavailable is explicit coverage/error, never absent. Qualified source/document coverage and limitations; count unknown/exact/estimate with decimal UInt64Text; optional host continuation. No automatic raw-body disclosure, no page-length-as-count. Exact lease/frame/control wire belongs P14/P15 and is not guessed here.

OrderTerm={path:DocumentFieldPath,direction:"asc"|"desc",missing:"first"|"last",null:"first"|"last"}. Missing/null state priority independent of direction: when both first, missing then null then value; both last, value then null then missing; mixed first/last positions implied by their placement. Values compare string Unicode-scalar lexicographic, timestamps instants, numeric accepted exact-domain/mixed policy only after numeric gate. Lists/maps/unrelated heterogeneous alternatives UNSUPPORTED absent explicit comparator. Unavailable cannot be sortable absence. Final tie ascending canonical target/address/incarnation tuple regardless of requested direction; token bytes are tie-break determinism, not source recency.

Final global scope/text/predicate/residual membership and ordering precede projection/page. Provider arrival/page/revision never defines final sort/cursor. Pushdown candidates must be proved superset under exact capability/schema/access/scope; residual preserves intact unsupported CEL. Native limits/projection/order cannot discard necessary rows/fields. P44 filtering UNSUPPORTED: finite candidate/residual proof is host transformation evidence, not native API proof.

Continuation opaque host state binds effective query/order/profile/bindings/schema/access/result generation/consistency/expiry; never provider cursor. Invalid/expired returns CONTINUATION_EXPIRED or RESET_REQUIRED under actual lifetime. once finite; follow requires supported bounded window protocol or UNSUPPORTED, no fake watch. allowPartial defaults false, explicit true permits policy-allowed partial only with coverage/errors, NEVER denial. Empty success differs from partial/unavailable/error. Compilation identity uses source/profile/declarations/environment/schema, not values; execution/result sharing additionally values/targets/order/projection/access and relevant delivery. Sensitive values not log keys.

## 3. C06 native CEL and schema semantics

Public source → host parse/check → internal native checked AST/program. Known checked nonboolean type rejects INVALID_REQUEST; checked bool OR dyn may execute, but actual result MUST be native Boolean true/false. Dynamic map/string/null/number is error, no truthiness or error-to-false. resource.enabled with a dynamically checked body and actual bool is valid. Untrusted imported artifacts recheck; no cross-version cache trust. Host semantic plan adds access/target/acquisition/coverage/residual/order/window; bounded builder/pushdown form is not another universal IR/evaluator.

Proposed pure environment: native CEL standard types/operators/functions and macros has/all/exists/exists_one/map/filter; no extension packages, IO/clock/random/network/provider callback/blocking function. Standard deterministic timestamp construction/conversion available. Profile fixes allowed environment and numeric comparison configuration; semantic changes version profile. Static mixed equality rejection vs dynamic equality and explicitly lossy conversion remain documented CEL distinctions, not custom host equality.

Controls: UTF8/source bytes, parser recursion/nodes, declarations and value/document bytes/depth/cardinality; schema refs/branches/traversal; actual runtime cost + ContextEval polling + cancellation preflight; independent concurrency/acquisition/output bytes/deadlines outside CEL. Probe limits64KiB request/document,16KiB source,depth32,4096 JSON values,128 declarations/page,cost100000,5s are finite experiment ceilings, NOT measured production defaults/profile freeze. INVALID_REQUEST for malformed/type/syntax/runtime nonboolean; UNSUPPORTED explicit semantic subset; RESOURCE_LIMIT bounded work; CANCELLED/TIMEOUT lifecycle, no false success.

One revision-bound catalog schema/value adapter owns checking AND strict admission. Known properties typed, map keys arbitrary; absence/null/union/availability independent. Preserve full schema metadata even where nullable complex/list/map/timestamp or union becomes dyn; no new flow-sensitive checker. anyOf at least one valid branch, exclusive oneOf exactly one; overlapping branches preserved, no invented resource envelopes/per-value retained schema catalogs. Required/closed/additional/dialect constraints never silently dropped. Unsupported constraint gives explicit unsupported/reduced-validation contract, not full valid. No schema bounded dynamic; unavailable schema remains error state, not permanent absence.

Complete known absence has=false; present-null has=true; unguarded missing retains CEL errors. Unknown partial-document path hydrates through host plan or explicit coverage/unsupported policy; never IO getter/sentinel/default/nonmatch. Admit access/coverage before evaluation; CEL decisive Boolean error masking is not coverage/permission success. Fast IsSet bool callbacks cannot erase unavailable errors. Catalog structural metadata bounded/revision-bound; accepted prototype row-retention is not promoted.

### Actual numeric dependency hold

Official v0.32.0 and inspected master unsafe; upstream PR1377 helper-only/unmerged does not correct optimized membership aliases. Historical observations accepted, not reprobed to doubt them. Exact tagged transport and same-domain controls do not approve mixed exact/binary64 semantics. No integer-only production fallback, blanket dynamic ban, host equality engine, silent fork/patch or upstream mutation.

Full P01/C06 safety/profile freeze needs an official corrected candidate covering BOTH native helpers AND optimized aliases, then accepted mixed numeric/optimized/nullable conformance plus exact pin/license/release/bounded-profile performance review. Alternative only a separately authorized reviewed bounded temporary dependency patch with named update/removal owner; none approved. Isolated nested v0.32.0 module is visibly UNSAFE EXPERIMENTAL, never imported/pinned by product. Independent nonnumeric/typed-data design evidence can proceed but no dependent contract freeze from partial P01.

## 4. C09 authoring identity, offsets and limits

Authoring request={version:"omniview.authoring.v1",requestId,documentId,documentRevision,source,cursor:{offset,unit:"utf8-byte"},profile,environmentRevision,declarations OR immutable host-resolved declarationEnvironmentRef,target/schema/representationRevisions,accessGeneration,maxSuggestions}. Host resolves/validates the declaration environment; environmentRevision includes parameter declaration types + profile implementation + schema environment. Actual binding VALUES are not needed for ordinary checking/completion and must not be fetched/disclosed. Type changes invalidate even unchanged source. Supplied access labels never confer trust; host context remains authoritative.

Response echoes request/document/source-environment/schema/access identities and only applies if ALL still match. Client cancels/supersedes previous work; host cancellation checked before expensive work and before emission. Cancellation may race response, so stale discrimination still required. No unbounded queue of keystrokes. Signature/hover/diagnostics use the same environment and identity.

Host translates native CEL Unicode-scalar/codepoint offsets (or line/column via native Source mapping) AGAINST THE EXACT SOURCE REVISION into zero-based half-open UTF8 byte spans BEFORE wire emission. Validate codepoint bounds and byte boundaries; a point diagnostic may use a zero-width EOF or one-codepoint span, never invent a full-token span from a native point. Frontend then translates those validated byte spans to UTF16 in the exact echoed revision. Supplementary chars one scalar/two UTF16 units; combining chars separate scalars, no normalization. Invalid cursor/out-of-range/split UTF8 rejects, no silent clamping. C02 host-owned error location uses same byte convention.

Incomplete draft is normal authoring, not executable. Host bounded parse/context recovery returns useful context/replacement/expected-token diagnostics even without checked AST; no executing repaired source or permanent repair. Bounded prototype recovers unquoted resource.member chains; full production service later, but contract preserves quoted member/index/relative-array paths and invalid prefixes explicitly.

Suggestions:{items:[{label,kind,type,checking:"static"|"partial"|"dynamic",presence,nullable,applicability,edit:{start,end,unit:"utf8-byte",text}}],completion:{kind:"complete"}|{kind:"truncated",reason:"itemBudget"|"byteBudget"|"traversalBudget"}}. maxSuggestions positive bounded request <= host ceiling; host also bounds bytes/traversal/time. Truncated is NOT absence/no further fields/full observed-key coverage; no continuation implied. Access denied yields safe C02 error, not empty success. Conditional union/ancestor facts retained even if CEL dyn. Observed key/value suggestions access-scoped/bounded, never schema guarantees.

Operator insertion: host returns one exact revision-bound replacement edit for the recognized cursor clause/path, including required spacing/quoted-member syntax and operator arity. Unary state clauses replace the clause; binary operations include an explicit editable operand placeholder selection range INSIDE the edit's inserted UTF8 text, not executable fake parameter/source. Host validates operator against selected field/applicability/environment; unsupported operator returns explicit unsupported. Client applies text/edit+selection only, does not synthesize schema guards/operators. No automatic execution until source checks and required operands supplied.

## 5. Exact bounded Builder v1 grammar and lossless conversion

Builder is a saved authoring document, lowered only through host CEL. This small recursive grammar defines the allowed constructs; no universal union-cast helper or second evaluator:

```
Builder={version:"omniview.builder.v1",root:Node}
Path={root:"resource"|{element:string},segments:DocumentFieldPath}
Operand={kind:"parameter",name:string}|{kind:"literal",type:BindingType,value:BoundValue}
Condition={kind:"discriminatorEquals",path:Path,value:string|bool}
Node=
 {kind:"state",path:Path,state:"absent"|"present"|"null"|"nonNull"}
 |{kind:"value",path:Path,op:"equal"|"notEqualPresent",operand:Operand,when?:Condition[]}
 |{kind:"all"|"any",children:Node[]}
 |{kind:"not",child:Node}
 |{kind:"exists",path:Path,element:string,child:Node,when?:Condition[]}
```

Each document/path/value cardinality/depth is host-bounded; malformed/unknown fields fail. all/any require >=1 child (explicit constants stay code-only); state nodes have no operand/when; exists path must admit list and child paths use its lexical element root. element names host-validated unique in lexical scope, cannot shadow resource/parameters/CEL reserved names; arbitrary free identifiers reject. Nested exists allowed within finite limits, binding each element independently; same-element conjunction is one child all, never independent exists per correlated field. Paths may refer resource or currently bound ancestors only, no forward/free variables; negative/noninteger indexes reject. Index/quoted member preserve exact segments.

Literal operands carry the SAME typed data admission as bindings; host allocates collision-free private parameter identifiers and activation values, not string-interpolated numeric/string code. Literal schema type preserved, no lossy inferred double. Public parameter references require declarations; nullable literal null only with nullable type, state null preferable. Branch conditions are explicit discriminator equality guards on reachable admitted string/bool paths. Every referenced discriminator constraint must actually prove the needed field/operation applicability under the retained schema; missing/unsupported/overlapping alternatives without such proof return UNSUPPORTED. Conditions are ANDed as positive guarded clauses before branch-specific value/exists operation; not hidden schema rewriting, not branch identity tests.

Lowering semantics: state present means terminal reachability (null/absent ancestor → not reachable); null means reachable terminal actually null; nonNull reachable and nonnull. Positive value includes supported presence/ancestor-null guards; absent/null nonmatch. Whole not wraps the ENTIRE lowered child and may include absent/null; notEqualPresent keeps guards and excludes absent/null. Generate null guards only for actual CEL/schema type allowing them. Arrays use one native exists binding for correlated child; no helper evaluator. Conditions and guard + value remain one semantic clause under grouping/negation. Unavailable data remains admission/coverage error, not false.

Lossless code→builder recognizer accepts ONLY checked native CEL AST patterns generated by this grammar: exact supported select/index/literal-parameter forms; declared/private operand reference; correctly scoped exists macro/comprehension shape with retained macro metadata; &&/|| groups; whole !; exact present/null guard conjunctions matched to the same clause/path/applicability environment. Associative regrouping allowed only when clause/guard boundaries are retained and independently verified semantically; no forced AST identity. Declared literal-private mapping must be present or recognition returns unsupported (do not invent public names/values). Arbitrary functions/arithmetic/general comprehensions/map/filter/other quantifiers/custom condition/unknown macros/unrecognized guards/unsupported union proof remain code-only unchanged. Text source and source revision are retained on failed conversion; no partial conversion or approximation. Builder→CEL→builder uses normalized document equality within this subset; native/residual path equivalence requires independently expected outcomes, not AST identity. P21 implements the full bounded grammar; current probe implements representative member-only state/value/whole-not clauses and native-text correlated exists, explicitly not every advertised grammar construct.

## 6. C02 consumption and source/result separation

Existing host AppError is canonical. Consume exact C02 codes/recovery/URI/status, host-created request correlation and validated UTF8 locations; no production OperationError competitor. Host issued provenance/principal/owner/access generation never request DTO authority. Provider-controlled titles/actions/raw errors/spans/correlation cannot bypass safe provenance redaction. Probe `{code,detail}` is PRIVATE serialized observation only, not AppError ABI. P04 current action-stream readiness/attachment/lifetime untouched.

SourceSession sequence/generation/coverage and result-lease sequence/generation remain independent. Provider revision opaque, no lexical recency. Source pages/frames never final query cursor/deltas. Partial/unknown enumeration cannot prove deletion/completeness; bestEffort not pointInTime/gapFree; source unavailable field not null/absence. P05/P12/P14/P15 own actual acquisition/ingestion/result transport; no source protocol/planner built here.

## 7. Exact P01 acceptance / independently executable evidence

1. Versioned canonical request/result/error, typed identity + ONE Go/proto/TS mapping, binding/numeric wire, profile/schema/draft authoring: §§1–6 are complete design decisions pending independent review. No mapping representation deferred to P45. C06 safe numeric profile freeze still blocked.
2. Corpus maps/tag arrays/correlation/quantifiers/opaque IDs/scopes/absent schema/incarnation/quoted paths/missing/null/exact integers/timestamps/typed bindings/injection/text+scope+predicate/global sort/page: execute host-owned native CEL/codec against exported merged P44 bodies, independent expected Node/Go outputs. Dynamic bool result and nonboolean rejection, multi-field ANY known-null/absent vs unavailable policy, actual native Unicode diagnostic conversion included. Existing accepted schema/union/admission evidence reused with original limits; raw JSON never relabeled static union validation.
3. Invalid/unsupported/complexity useful partial cursor/builder/text/candidate-residual agreement: explicit C02-meaning outcomes, real native parser/cost/cancellation; supported finite builder clauses and textual equivalents; partial draft context/revisions; actual native diagnostic after supplementary+combining chars. P44 native server filter unsupported; safe finite prefilter/residual controls and unsafe limit counterexample, no fabricated native-provider proof. Supported subset stated, advanced expressions unchanged.
4. Numeric actual dependency/upstream-first/mixed/optimized membership: BLOCKED exactly §3. No accepted safe production pin or patch/removal approval. P01 cannot close/full C06 freeze; independent reviewed semantics/codec receipt does not hide this gate.
5. Actual executed evidence and review links: report after authorized settled barrier; tests written first/no red run under parent no-midflight-check contract. Parent owns publication/PR/issue/central readiness. Later production Wails/generated exports/catalog/editor/native adapters/planner/leases are downstream exclusions, not additional P01 design/spike closure requirements.

## 8. Conditional implementation handoff — 2026-10-28

This section completes design decisions missing from R2; it does not approve a dependency or publish an SDK API. P04 is accepted through host PR136 / commit `e1e09f2668dc553ee0b4b1960aa92da475bc0254`. Its native invocation and AppError implementations, not the earlier proposal's approval label, govern consumers. The user's subsequent fork-first decision selects a maintained Omniview CEL fork as the primary dependency path. Upstream submission/CLA approval is optional, not a delivery gate; this supersedes historical upstream-first/temporary-only wording in §§3/7 and the earlier evidence. Both numeric helpers and optimized membership, immutable source, license/performance/conformance review and named update ownership remain required. The dependency owner supplies that receipt; the integration owner approves it independently. P01 must not invent a version or consume an unapproved checkout. Any future upstream replacement requires equivalent conformance and explicit cutover review; no promise to remove the maintained fork on an unreviewed upstream release is made.

### 8.1 Profile manifest and implementation ownership

The host profile owner is P01, then P13 for implementation maintenance. SDK/P45 never imports CEL. The host owns an immutable manifest with `profile`, `implementationRevision`, `dependency` (module path, exact version/commit, authenticated checksum, patch digest if applicable), `environmentRevision`, `crossTypeNumericComparisons:true`, `optimization:true`, `extensions:[]`, and the effective finite `limits`. A missing admitted dependency makes this manifest unavailable, not an integer-only alternative profile. Persist the semantic profile in saved source; include the immutable implementation revision in compiler cache identity and evidence. A changed dependency requires conformance and manifest review even when the semantic profile remains compatible.

The environment is the selected native standard CEL environment, including standard operators, conversions and receiver functions, with only standard `has`, `all`, `exists`, `exists_one`, `map`, and `filter` macros. No optional-types extension, comprehensions extension package, custom overload, custom equality, host callback, environment variable, current time or provider lookup is enabled. Standard duration/bytes/type values can occur inside expressions; they are not additional public binding/value variants. Unsupported result variants fail explicit wire admission rather than stringify. Static mixed equality remains a checker error; heterogeneous ordering is enabled; dynamic equality uses corrected native semantics; explicit conversion remains potentially lossy. Native cost tracking, optimization and context evaluation are mandatory together.

`limits` records positive ceilings for source/request/document/output bytes, parser recursion/nodes, declaration count/depth, value count/depth, schema bytes/references/branches/traversal, authoring items/bytes/traversal, runtime cost, cancellation polling interval and deadline. Host policy may lower limits per invocation; request input cannot raise them. Missing/zero/unbounded limits reject profile installation. P02 measurements and corrected-dependency performance review must justify numeric production defaults before installation. The existing finite spike settings remain experiment settings, not silently promoted defaults. Runtime cancellation must check before admission and use native ContextEval polling during evaluation; output/deadline/acquisition quotas remain host controls outside CEL.

### 8.2 Schema admission and authoring seam

P45 owns provider catalog delivery and structural schema/representation provenance, not schema normalization. P07 owns dialect normalization and the immutable catalog field model. P01 owns CEL mapping/admission rules consumed by P13; P16 owns the authoring service, P17/P19/P21 its clients. No independent editor schema evaluator or per-row retained schema catalog is introduced.

The host resolves each target to an immutable `SchemaBinding` containing provider/type, representation ID/revision, schema state, schema revision when present, dialect and validation capability. Schema state is exactly `absent`, `available`, or `unavailable`. `absent` permits bounded dynamic admission; `unavailable` requires a truthful error/coverage outcome and cannot become absent. A changed schema/representation revision invalidates checking and authoring identities. A provider token is opaque equality data, not a lexical freshness order.

Schema admission returns one of: admitted value plus binding and validation capability; invalid body (`INVALID_REQUEST`); unsupported dialect/constraint (`UNSUPPORTED`); unavailable representation/schema (existing C02 unavailable/coverage policy); bounded-work failure (`RESOURCE_LIMIT`); or lifecycle error. An explicit reduced-validation capability must enumerate unvalidated constraints before execution admission; callers requiring full validation reject it. Unknown dialects, unresolved external references, ignored `required`/closed-object constraints, or silently discarded union branches cannot claim full validation. Normalization follows bounded references within the admitted catalog, never fetches arbitrary schema URLs. `anyOf` requires at least one valid branch; `oneOf` requires exactly one. Nullable complex/union checking may be dynamic while admission still validates every retained constraint.

Coverage admission precedes Boolean evaluation, text, sorting and projection. Known complete absence is a field fact; unknown coverage is not. P13 may hydrate through its later planner, or reject unavailable coverage now. No sentinel, lazy I/O getter, default value or false result may stand in for hydration. Permission denial dominates partial results and suggestions. Fast presence callbacks must not erase unavailable errors.

Authoring requests use §4's exact identities and byte offsets. The host obtains schema/access/environment revisions from admitted state, not caller authority. P16 validates request identity, bounds recovery/traversal, checks cancellation before response and emits explicit truncation. Clients apply only matching document and environment identities and convert validated bytes to UTF-16. Quoted member/index paths, relative array scopes, conditional alternatives and operator edits remain required production service behavior; the member-chain spike proves only its stated subset. No authoring response promises executable validity for an incomplete draft.

### 8.3 Exact P45 value and codec boundary

P45 owns the single Go/protobuf adapter for §1's domain and the tagged values from the binding contract. P47 owns its intentional TS projection/export. Generated transport structs do not become host domain aliases. No legacy Find/filter DTO or second identity package survives the public cutover.

Canonical resource document transport must preserve scalar intent, not just parameter intent. Encode the document as a recursive tagged `BoundValue` map, using the same scalar/list/map/null tags and validation as bindings. This represents heterogeneous maps/lists without a homogeneous parameter declaration; parameter declarations still constrain their own values recursively. Resource roots must be map values. Providers classify native values before serialization. Raw JSON cannot establish whether a rounded JS number was an exact int64, uint64 or double; admission must not infer recovered precision from that payload. Native JSON adapters must parse numeric tokens without an intervening float64 conversion and apply their declared schema/native numeric policy, or report unsupported ambiguity. JSON timestamps remain strings unless provider schema/native adaptation explicitly establishes timestamp intent.

The protobuf `Value` mapping is oneof `null_value = 1` (empty marker), `bool_value = 2` (bool), `string_value = 3` (string), `int64_value = 4` (sint64), `uint64_value = 5` (uint64), `double_value = 6` (double), `timestamp_value = 7` (TimestampValue), `list_value = 8` (ListValue), or `map_value = 9` (MapValue). `TimestampValue` has `sint64 seconds = 1; uint32 nanos = 2;`; `ListValue` has `repeated Value values = 1;`; `MapValue` has `repeated ValueEntry entries = 1;`; `ValueEntry` has `string key = 1; Value value = 2;`. Unset/unknown selections reject; repeated map entries retain duplicates until rejection. Empty map/list wrappers remain selected, distinct from missing oneof. JSON int/uint values remain canonical decimal strings. Timestamp seconds/nanos must describe years 0001–9999 and nanos 0–999999999; normalize negative instants using floor seconds and nonnegative nanos. Never transport nanoseconds as JS number epoch units.

Both adapters reject duplicate members, invalid UTF-8/unpaired escaped surrogates, unknown tags, nonfinite doubles, malformed/range-invalid integers, excessive timestamp precision, unsupported variants and all configured bounds. JSON timestamp output uses UTC RFC3339 with up to nine fractional digits; omission of trailing zero digits does not lose instant precision. Signed double zero remains binary64 zero; no exact-decimal promise exists. Representation coverage and optional incarnation/sourceRevision remain separate metadata, not null-valued document keys.

P45 must validate bounded raw protobuf wire bytes BEFORE generated message decoding at every inbound new-major transport boundary, including nested Value messages. Generated decoding can discard duplicate singular fields, choose the last oneof scalar, or merge repeated message occurrences; postdecode validation cannot recover that evidence. The raw validator must enforce message/decompressed-byte, nesting, field-count and length budgets; reject malformed tags/varints/lengths, invalid wire types, groups, duplicate singular fields (even identical values), and more than one occurrence of any Value oneof alternative (including repeated occurrences of the same alternative). Legitimate repeated list values/map entries remain allowed within budgets; duplicate map keys reject before constructing a map. Run generated decoding only after raw validation succeeds, then apply semantic/range/UTF-8 validation. A normal postdecode gRPC interceptor is too late: P45 must install a codec/decode boundary that can inspect the original payload first. It must not claim this protection from generated structs alone.

The negotiated resource protocol version selects the raw validator's exact field-number/wire-type table. For that selected version, unknown fields anywhere in the resource message tree reject with UNSUPPORTED; invalid encoding or ambiguous duplicate selections reject with INVALID_REQUEST; exhausted bounds reject with RESOURCE_LIMIT. Unknown fields are neither silently dropped nor accepted as a new Value variant. A peer requesting a newer unimplemented version receives UNSUPPORTED before operation dispatch. Future additive fields require a reviewed negotiated protocol revision and updated validator table; they do not silently widen this version. This strict resource-wire policy is the negotiated policy referenced by §1, not a change to unrelated existing gRPC services. Validation failure must precede provider dispatch, handles, cache material and CEL evaluation.

P45 malformed-wire acceptance must send actual raw gRPC message bytes through that decoder boundary: duplicate scalar, identical duplicate scalar, two different oneof alternatives, repeated message-valued oneof, duplicate nested timestamp seconds/nanos, duplicate map key, unknown outer/nested field, wrong wire type, truncated length/varint, excessive nesting/field count and unsupported negotiated version. Assert exact safe error class and no dispatch/materialization. Include valid repeated list/map entries, empty selected wrappers and omitted default-valued timestamp components as controls. These cases are future P45 acceptance, not checks exercised by this design amendment.

P45 acceptance must run actual new-major provider → gRPC → handwritten adapter → admitted host value → selected native CEL → tagged result → Node. Assert native timestamp arithmetic and pre-epoch nanoseconds, int64/uint64 boundaries, heterogeneous nested containers, optimized membership off/on, static mixed equality rejection, dynamic mixed equality/order, explicit lossy conversion, and malformed/unsupported/bounded outcomes. Echoing admitted input alone does not prove result encoding. The current Node spike proves native Boolean predicates plus normalized input echo, not a new-major result codec or gRPC.

### 8.4 Acceptance and implementation matrix

| P01 requirement | Existing evidence / concrete decision | Remaining acceptance, owner |
| --- | --- | --- |
| Canonical request/result/error and typed identity | §§1–6; accepted P04 native AppError/invocation; one Go/proto/TS domain mapping | Independent review of this amendment; P01. Actual generated public implementation belongs P45/P47, not P01 planner work |
| Safe profile and dependency | §§8.1/10 define exact environment, remote immutable fork and actual selected-pin receipt | Independent acceptance of candidate/profile/license/performance and named maintained-fork lifecycle owners; dependency owner + P01/integration coordinator. Upstream PR/CLA is not a gate |
| Schema admission and absent/unknown state | §§3, 8.2 plus retained schema/nullable evidence | Review explicit admission capabilities and ownership; P01. Product dialect normalization/catalog implementation remains P07, not claimed by raw P44 schema bytes |
| Authoring and incomplete drafts | §§4–5, 8.2; actual native diagnostics and bounded member recovery in merged PR130 | Review full path/conditional/operator/stale identity contract; P01. Production service and UI remain P16/P17/P19/P21 |
| Maps/tags/correlation/quantifiers/quoted paths | PR130 corpus plus §10 actual corrected selected-pin rerun and retained schema/nullable/builder controls | Independent review of scoped proof and limits; P01. Spike builder subset is not full grammar implementation |
| Opaque IDs/scopes, absent schema/incarnation | Merged PR130 canonical keys and deterministic incarnation ties | Review provider-neutral mapping unchanged; P01. Real new-major providers and authority resolution remain P45/P03 |
| Exact integers/timestamps/typed data/injection | §10 actual tagged body → native computed result → tagged output transport, plus timestamp boundary predicates and retained 124 transport cases | Independent review; P01. New-major protobuf decoder/gRPC remain P45, cannot be marked available now |
| Text/predicate/scope and global order/page | Merged finite ANY/scope/residual/global-page controls | Review full semantic order and continuation contract; P01. Full numeric comparator, target unions, planner and host cursor implementation remain P13/P14 |
| Invalid/unsupported/limits | Merged strict codec, native checker/cost/cancel outcomes; §§8.1–8.3 | Selected corrected-pin outcomes and measured profile ceilings before production install; P01/P02 |
| Builder/text/native/residual agreement | Merged supported native-CEL lowering and candidate/residual controls; P44 explicitly has no native filtering | Preserve unsupported native path; no fabricated provider equivalence. Actual supported native-query implementation and comparison belong P45/P13 |
| Evidence, review and callers | PR130 records 230 native subprocess observations and contamination regression | Current scoped receipt, independent review and parent reconciliation of readiness/issue status; P01/integration owner |

P45's concrete next change is the reviewed domain/Value IDL and handwritten adapters, required catalog, independently optional operations and the final finite snapshot portion of the P05 source contract. It must not ship a throwaway List protocol, claim source pages as final host pages, require fake mutation methods, infer unknown totals, or treat missing incarnation/schema as fabricated tokens. P05 still owns update negotiation/continuity; P13 still owns the planner. P45 remains blocked until P01's reviewed admission receipt exists. This amendment is a conditional handoff, not that receipt.

## 9. Bounded policy and implementation admission

The reference policy proposed for P01 review is `omniview.predicate-policy.v1`. Policy limits are finite safety ceilings, not inventory-size/latency promises; hosts may lower them without changing CEL semantics. Raising a ceiling requires a reviewed policy revision and corresponding boundary measurements. This does not install a production service: P13 owns enforcement during production compiler/evaluator installation; P07/P16 own schema/authoring enforcement. P45 consumes value bounds at its actual transport decoder boundary.

| Work | Exact reference ceiling | Admission owner / required outcome |
| --- | --- | --- |
| Request / admitted document / encoded result | 65536 UTF-8 bytes each; decoded/decompressed bytes, not compressed frame size | P45 transport and P13 query boundary; reject before unbounded allocation, RESOURCE_LIMIT |
| CEL source | 16384 UTF-8 bytes; parser recursion 64; parsed expression nodes 4096 including macro-expanded nodes | P13 compiler; byte bound before parse, node bound before program creation |
| Declarations / typed or tagged values | 128 declarations; declaration/value depth 32; 4096 wire JSON values and 4096 native result nodes; no omitted limits | P45/P13; stricter wire nesting may reject before semantic depth, RESOURCE_LIMIT |
| CEL execution | 100000 native runtime cost units; ContextEval interruption check frequency 1; 5 seconds maximum invocation deadline | P13; preflight and postwork cancellation; RESOURCE_LIMIT/CANCELLED/TIMEOUT, never false membership |
| Schema catalog binding | 65536 schema bytes, 32 definitions, 512 schema nodes/reference visits, depth 12, 4 union branches per node, 512 shared admission work units | P07; reference/branch work shares one request budget, no reset per alternative |
| Catalog fixture collection admission | 64 elements per schema-admitted collection, 16384 string bytes | P07 reference adapter policy only; not a claim that all product resource arrays must use that fixture policy |
| Authoring | 128 suggestions, 65536 encoded response bytes, 4096 field/path visits, 250ms request deadline; one active request per admitted document/owner | P16; cancellation/supersession, explicit truncation reason, no unbounded keystroke queue |
| Predicate work scheduling | One active evaluation per admitted invocation; no implicit acquisition or fan-out inside CEL | P13/P04; service-wide concurrent request/acquisition quotas remain separately admitted host policy, not request-controlled |

Only the limits actually implemented in a given proof are reported as exercised. The existing spike enforces wire structure/source/declarations, native cost/polling/deadline and finite result encoding. It does not implement a macro-expanded AST-node gate, the production schema catalog, an authoring scheduler or global host quotas. Retained schema/nullable probes exercise their own stated fixture bounds; they are not relabeled as the production P07 implementation. These are explicit downstream enforcement tasks, not additional P01 planner implementations.

The resource-body proof uses the §8.3 tagged map document directly as the native `resource` activation and serializes the native evaluated value recursively, including computed integers/timestamps/heterogeneous containers. It must not return the admitted input as the claimed evaluated output. Bytes/duration/type values and nonstring map keys have no public value variant and return UNSUPPORTED; nonfinite numeric results and invalid timestamp ranges reject. This private expression-value mode is a codec proof only; resource query membership still requires a native Boolean. Neither mode implements P45 gRPC or P13 planning.

## 10. Selected immutable fork and actual P01 proof — 2026-10-28

Status: selected-candidate verification admitted by the integration coordinator, exercised below; **independent P01 acceptance remains required**. This receipt supersedes historical “no authorized/admissible candidate” statements above, not the unsafe findings or scope boundaries. The nested spike alone consumes the fork; product host go.mod, SDK, Wails and generated bindings remain unchanged.

- Canonical import: `cel.dev/cel-go`, required version `v0.33.1`, replaced remotely by `github.com/omniviewdev/cel-go v0.33.2-0.20261028172556-d7bb038d8c7b`.
- Actual Go download Origin.Hash: `d7bb038d8c7b6f26225d4fbd210ca2b3c60a6774`; authenticated module sum `h1:HxSRMZlGZZifltDzxCQusazlIHNkqyN3YiLVf1IXa7k=`, go.mod sum `h1:DnVip7tpJSsgZymwfT+m1tnEVy3ivAjSMXPx12YrMkU=`.
- Selected corrected conformance corpus: Omniview cel-spec `50a95f64a56bcb1cb8b23b98fcc500f5841a1146`. The independently reviewed dependency receipt retains corrected **2380 pass / 0 fail / 59 existing skips**, original **2376 pass / 4 fail / the same 59 skips**. These counts are consumed evidence, not a new conformance execution by P01.
- Exact dependency review: [immutable fork receipt](https://github.com/omniviewdev/cel-go/blob/d7bb038d8c7b6f26225d4fbd210ca2b3c60a6774/docs/numeric-comparison-review.md). It contains both correction paths, native/spec/license notices, measured unchanged-baseline comparison, source derivation and retained original/corrected raw evidence.
- Maintenance owner is the **Omniview query/runtime maintainer**; accountable update/admission/future-removal coordinator is the **Omniview integration coordinator**, recorded in issue80. Every update is immutable and reruns both correction paths, oracle/spec/profile/nullable/transport evidence plus dependency/license/performance review. Replacement by upstream is optional and requires equivalent verified behavior; no upstream PR/CLA gate or implicit removal deadline exists.

### Exercised barrier and independent expectations

All Go invocations used `GOWORK=off`. Remote tidy/list/download used `GOPROXY=direct`, without disabling checksums. `go list -m -json cel.dev/cel-go` resolved the remote fork in the module cache, not a workspace/local replacement. `go mod verify` reported all modules verified; `go mod download -json` reported the exact Origin.Hash and sums above. The nested Go lock files are committed. Scoped gofmt ran only after source edits settled.

| Actual selected-candidate check | Observed result |
| --- | --- |
| Scoped normal / race Go tests | pass, final `0.228s` / `1.612s`; native cost exhaustion, cancellation and nonfinite result encoding included |
| Native probe build and original Node driver | build success; **241** independently expected observations |
| New actual Node → tagged Go document admission → optimized native CEL → recursive native-result encoding → Node | **37** observations; computed signed/unsigned large integers, timestamp arithmetic across epoch, heterogeneous nested results, exact dynamic equality/order/optimized membership, checker rejection, explicit lossy conversion, missing/null, injection data, unsupported variants and expanded output bounds |
| Retained numeric native / checked-ordering lanes | **64 / 72** observations, zero mathematical mismatches/runtime rejections; checked lane retains **4** expected mixed-equality rejections; optimizer off/on included |
| Retained rational oracle | **100816** directional checks per lane, zero pair failures |
| Retained actual transport | **124** expected outcomes |
| Retained schema / nullable admission / builder | **75 / 131 / 269** expected outcomes |

`retained-driver.mjs` extracts the committed archives into its exclusively owned temporary directory and applies only the selected remote fork module replacement. It does not modify archived evaluator/schema/builder source. For transport, the five archived unsafe expected results are replaced only with each request's already retained `semanticExpected`. For schema, exactly three named archived unsafe equality expectations become mathematically correct false. The historical schema process therefore intentionally exits1 for those three stale fixture expectations; the outer runner independently checks all75 actual outcomes, asserts those exact three cases and that exit status, and reports the corrected-candidate lane separately. No other failed assertion is ignored. Archived source labels still say v0.32.0; the outer module-resolution receipt, not those unchanged labels, identifies the actual dependency.

The actual current body/result proof is no longer an admitted-input echo: it computes integer additions/subtractions, timestamp duration arithmetic, list/map construction and native Boolean outcomes, then serializes actual native values. This proves the bounded JSON/tagged semantic seam, not P45 protobuf/gRPC or production schema normalization. The original P44 driver still uses its documented integer-only fixture-body reader; the new heterogeneous tagged-body proof covers binary64 without changing that reader into an unsupported production policy.

Final retained replay removed its private checkout before publishing its receipt. Local result artifacts remain ignored and reproducible:

| Artifact | SHA256 |
| --- | --- |
| `results.json` (241 original-driver observations) | `2260065a160e83b6af4a3f1ec37b33c88729be751bfd72abd317034b2049f9f4` |
| `value-results.json` (37 computed-result observations) | `03fe263479660fdf16ab1ce5ae607b9762f39de2d82cadc9f9ba3b4283f73651` |
| `retained-results.json` (actual resolved module, archive digests, all retained outcomes and command receipts) | `2eb139bd96f31b465016879a7bc4886b77a4f2e608629ae3067434b5d1a4d6be` |

### Bounded profile measurements and review limit

On darwin/arm64, Apple M5 Max, the selected fork ran `GOMAXPROCS=1 go test -run '^$' -bench '^BenchmarkValueProof$' -benchmem -benchtime=200ms -count=3 -cpu=1`. It includes strict request/document admission, native compilation/optimized evaluation, native-result encoding, final JSON serialization and a5s deadline per invocation; no compiled-program cache is claimed.

| Tagged input elements | Three measured ns/op | Approximate median | Allocations/op |
| --- | --- | --- | --- |
| 1 | 50367, 55695, 48820 | 50.4µs | 1037 |
| 64 | 391525, 392137, 461694 | 392µs | 7991 |
| 256 | 1402412, 1598386, 1421160 | 1.42ms | 29135 |

These measurements justify only bounded feasibility under the reference policy. The prototype repeatedly parses tagged wrappers for strict admission and does not represent an optimized production catalog/codec. No latency-tail, max-budget load, large-inventory, cross-platform or application benchmark is claimed. Native dependency comparison/performance deltas are reviewed separately in the immutable fork receipt; P13 must measure its actual installed service rather than copy these throughput/allocation numbers.

### Exact remaining acceptance and P45 release condition

P01's remaining gate is independent review/acceptance of this selected-pin receipt, the §9 reference policy and §§1–8 canonical contracts, including raw-wire admission and schema/authoring ownership. No additional P13 planner or P45 gRPC implementation is imposed on this design/spike packet. The integration owner then records the accepted artifact and releases P45's native dependency gate. Until that explicit acceptance, this remains a conditional handoff.

P45 must implement the one reviewed domain/Value mapping, raw protobuf validator and handwritten adapters, required catalog and independently optional operations, plus actual finite snapshot/Get/native-query paths and P44 new-wire acceptance. It must prove its own result codec over actual gRPC; it cannot cite this JSON proof as that implementation. P07/P16/P13 respectively enforce production schema, authoring and compiler/planner budgets at their named installation boundaries. No new identity, public dual stack or alternate numeric engine is authorized.
