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
