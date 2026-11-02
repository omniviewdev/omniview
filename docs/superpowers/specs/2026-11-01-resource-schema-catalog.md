# P07 authoritative resource schema/capability catalog contract

Status: pending explicit user freeze approval for [omniview#85](https://github.com/omniviewdev/omniview/issues/85). Contract review does not constitute user approval. Changes after user freeze require a new review round. This document is normative: MUST, MUST NOT, SHOULD and MAY follow RFC 2119.

Related: [P01 resource query contracts](2026-10-24-resource-query-contracts.md) §§8.2, 9; [CEL binding and schema-admission contract](2026-10-17-cel-binding-schema-contract.md) §§4, 8, 9; [work packages](../../roadmap/2026-10-17-resource-intelligence-work-packages.md) P07.

Repositories and bases: `omniviewdev/plugin-sdk` (v0.12.1, `0a5b64ed`), `omniviewdev/omniview` (`486a9a47`), `omniviewdev/omniview-plugin-kubernetes` (`6ce354aa`).

## 1. Ownership

- The SDK (`pkg/resource/v2`) delivers raw schema bindings and raw schema documents only. It MUST NOT normalize schemas and MUST NOT carry provider validation claims. SDK validation requires a non-empty dialect for `available` bindings; it does not decide dialect support.
- The host package `backend/pkg/resourcecatalog` is the only schema normalizer and the only schema validation authority. No second authoritative catalog, editor schema evaluator or client-side schema walker is introduced.
- The catalog owns schema identity (content digest, schema revision, dialect), representation revision, type and scope (plugin, generation, connection, epoch, catalog revision), structural navigation, value admission, the queryability/native-execution overlay, editor association derivation and the catalog-backed CEL type adapter (`resourcecatalog/celtypes`).
- P13 consumes `Admit` and `celtypes`. P16 consumes `Navigate`. P19/P21 render host output and MUST NOT walk schemas.
- Action input schemas keep their separate role and are not catalog entries. Auxiliary editor schemas (for example Helm values) are not catalog representations; they are normalized by the same catalog through `ResolveAux` but carry no resource type semantics.
- Raw documents remain available through `GetSchemaDocument` and provider `SchemaDocumentProvider` fetches.
- `resourcecatalog` imports only the SDK `resourcev2` package, the Go standard library and `golang.org/x/sync/singleflight`. `celtypes` additionally imports `cel.dev/cel-go` v0.33.1, replaced by `github.com/omniviewdev/cel-go v0.33.2-0.20261028172556-d7bb038d8c7b`.

## 2. Catalog keys and lifetimes

### 2.1 Public API

```go
type Catalog struct{ /* mu sync.Mutex; store; connections map[connKey]*Snapshot; policy */ }
func NewCatalog(policy Policy) *Catalog
type ConnectionKey struct { PluginID, Generation, Connection string; Epoch uint64 }
func (c *Catalog) Observe(key ConnectionKey, catalog resourcev2.Catalog) *Snapshot
func (c *Catalog) DropConnection(pluginID, connection string)
func (c *Catalog) DropPlugin(pluginID string)
func (c *Catalog) Stats() Stats // {Connections, Entries, Documents, RetainedBytes int64, BranchViews, CELProviders int}
type Snapshot struct{ /* key; revision; provider; entries map[[2]string]*Entry; aux []*AuxEntry; retired bool */ }
func (s *Snapshot) Revision() string
func (s *Snapshot) Provider() string
func (s *Snapshot) Entry(resourceType, representation string) (*Entry, error)
func (s *Snapshot) Entries() []*Entry // sorted by type, representation
type DocumentSource func(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error)
type Entry struct {
    Type, Representation, RepresentationRevision string // read-only
    Binding    resourcev2.SchemaBinding                  // read-only
    Descriptor resourcev2.ResourceType                   // read-only
    /* unexported: per-entry mutex, done channel, cached outcome */
}
func (e *Entry) Resolve(ctx context.Context, fetch DocumentSource) (*Schema, error)
type Schema struct { Document *Document; Root NodeID; Dialect, SchemaRevision string; Validation string /* "full"|"reduced" */; Unvalidated []Constraint }
func (s *Snapshot) ResolveAux(ctx context.Context, schemas []resourcev2.EditorSchema, fetch DocumentSource) ([]AuxResult, error)
func (s *Snapshot) Document(digestHex string) (*Document, bool)
```

`AuxResult` is `{Schema resourcev2.EditorSchema; Resolved *Schema; Err error}`. `Snapshot.Entry` returns `NOT_FOUND` "Resource type or representation is not in the route catalog." for an unknown pair. `Snapshot.Document` returns only documents referenced by this snapshot's resolved entries or aux results. `Entry` fields are exported for read access by the host controller; callers MUST NOT mutate them.

### 2.2 Keys

Cache keys:

| Key | Composition | Purpose |
| --- | --- | --- |
| Connection snapshot | `ConnectionKey{PluginID, Generation, Connection, Epoch}` + `Catalog.Revision` | One snapshot per (plugin, connection); replaced when any field or the revision differs |
| Entry | snapshot + (type, representation) | Per-representation binding and resolve outcome |
| Reference fetch | snapshot + `SchemaDocumentReference{ID, Revision}` | In-flight fetch dedup within one snapshot (§2.3) |
| Document | `Document.Digest = sha256("omniview.schema-doc.v1\x00" + dialect + "\x00" + raw bytes)` | Content-addressed sharing of immutable normalized documents across connections |
| CEL environment reuse | `Environment.ContentKey` (§8) | Host-internal reuse of a `cel.Env` over the same immutable document and root |

Isolation invariant: no cache key omits plugin, connection, generation, epoch or catalog revision, except the Document and `ContentKey` keys, which address only immutable content. Only immutable normalized documents (and state derived purely from them) are shared, and only by content digest. Two connections with the same type name and different documents MUST yield different navigation; byte-identical documents under the same dialect MUST share one `Document`.

Derived identities (not cache keys):

| Identity | Composition | Purpose |
| --- | --- | --- |
| Editor association `hex16` | §7.1 | Monaco model directory per plugin/connection/type/representation or aux key. It is deliberately revision-stable so open Monaco models survive catalog changes; the association's `DocumentID` carries content identity |
| CEL environment `Environment.Revision` | §8 | Checking/authoring identity; changes with snapshot, representation or schema revision |

### 2.3 Lifetimes

- **Observe** does no I/O. It returns the stored snapshot unchanged when all four key fields and `catalog.Revision` match. Otherwise it builds a new snapshot with one `Entry` per (type, representation), copies the `Descriptor` (dimensions, capabilities, native queries), atomically replaces the old snapshot, marks the old one `retired`, and releases every document the old snapshot held.
- **DropConnection / DropPlugin** retire and release the affected snapshots. The host calls `DropPlugin` in `OnPluginStart` (when it replaces an existing generation) and in `OnPluginStop`, and calls `DropConnection` inside the per-connection loop of `invalidateSourceRoutesLocked`.
- **Resolve** runs at most one in-flight resolve per entry (per-entry mutex and done channel). The binding state is decided before any fetch. Outcomes by binding state:
  - `absent` → `(nil, nil)`; callers treat it as dynamic.
  - `unavailable` → `resourcev2.NewError(reason or "UNAVAILABLE", "Schema is unavailable for this representation.")`.
  - `available` + `Document` → inline bytes.
  - `available` + `DocumentRef` → `fetch`. Fetches are deduplicated per `Snapshot` by a singleflight keyed by `SchemaDocumentReference` (ID + Revision): concurrent resolves of entries that share a reference perform one fetch. The fetched result is held only until the store acquire completes; the singleflight caches neither the fetched bytes nor fetch errors afterwards (per-entry outcome caching follows the caching rule below). The returned `Reference` MUST equal the binding reference and the returned `Dialect` MUST equal the binding dialect, otherwise `INVALID_REQUEST`. A nil `fetch` → `UNSUPPORTED` "provider does not serve schema documents".
  - The document is acquired from the store and `Root` is resolved. Empty `Root` selects the document root node (JSON Schema dialects only; see §4 for OpenAPI); a non-resolving pointer → `INVALID_REQUEST` "schema root does not resolve".
  - The result is installed under `c.mu` only if the snapshot is not `retired`. Otherwise the document is released and the call returns `RESET_REQUIRED` "Schema catalog changed during resolution."
  - Caching rule: a code in the normalization set (`INVALID_REQUEST`, `UNSUPPORTED`, `RESOURCE_LIMIT`) ⇔ cached ⇔ deterministic result. Binding-state outcomes (`absent`, `unavailable`) and normalization outcomes (success, `INVALID_REQUEST`, `UNSUPPORTED`, `RESOURCE_LIMIT`, including reference/dialect mismatch and nil `fetch`) are cached per entry. Fetch errors with codes `INVALID_REQUEST`, `UNSUPPORTED` or `RESOURCE_LIMIT` are cached per entry like normalization outcomes, because a provider's refusal of a reference is deterministic for the snapshot's catalog revision. All other fetch error codes (for example `UNAVAILABLE`, `FORBIDDEN`, `TIMEOUT`, `CANCELLED`, `NOT_FOUND`) and `RESET_REQUIRED` are never cached. Fetch errors are returned unwrapped. A caller that needs the origin checks `entry.Binding.State`: an error for an `unavailable` binding is a binding-state outcome; an error for an `available` binding with a code in the normalization set is a deterministic (cached) outcome, whatever its origin; any other code for an `available` binding came from `fetch` and is transient.
- **ResolveAux** normalizes each auxiliary binding (dialect from `EditorSchema.Binding.Dialect`) the same way, replaces `s.aux` atomically, releases the previous aux documents and returns per-item results.
- **Store**: content-addressed by digest, refcounted, with `singleflight` keyed by digest so concurrent identical normalizations run once. `acquire(dialect, raw, policy)` returns `RESOURCE_LIMIT` when the acquisition would exceed `MaxRetainedDocuments` or `MaxRetainedBytes`; documents in use are never evicted. A document is freed when its refcount reaches zero. `retainedBytes` = raw length + 128 bytes per node + string bytes, plus rendered editor JSON bytes once rendered (updated under the store lock).
- **Per-document caches** (branch views, editor JSON, CEL provider) live inside the immutable `Document`, are built at most once with `sync.Once`, and are freed with it. Admission never allocates state that outlives the call; repeated admissions retain no per-row schemas.
- **Locking**: the catalog mutex is a leaf lock. Code holding it MUST NOT call into the resource controller.

## 3. Dialect and keyword table

### 3.1 Dialects

The dialect comes from `SchemaBinding.Dialect` (or `EditorSchema.Binding.Dialect`). Supported values are exactly the SDK constants:

| Constant | Value | Normalized roots |
| --- | --- | --- |
| `DialectJSONSchema202012` | `https://json-schema.org/draft/2020-12/schema` | document root, every `$defs` entry |
| `DialectJSONSchemaDraft07` | `http://json-schema.org/draft-07/schema#` | document root, every `definitions` entry |
| `DialectOpenAPI30` | `openapi-3.0` | every `components.schemas` entry |

- Any other dialect → `UNSUPPORTED` "unsupported schema dialect". It MUST NOT be weakened to dynamic.
- A JSON Schema document whose `$schema` disagrees with the binding dialect → `INVALID_REQUEST` "schema document dialect does not match binding". `$schema` comparison ignores the `http`/`https` scheme and a trailing empty fragment `#` on both sides; otherwise it is exact string equality. A binding dialect is never rewritten by the host: an unknown dialect string stays `UNSUPPORTED`.
- Raw bytes are first checked with `resourcev2.ValidateJSON` (duplicate keys, invalid UTF-8), then decoded with `json.Decoder.UseNumber()`.
- Numbers: bounds map to `*big.Rat`. For `enum`/`const`, an integral token maps to `int64` or `uint64`; overflow beyond those ranges returns `INVALID_REQUEST`. Other numeric tokens map to finite `double`. Booleans, strings, null, arrays and objects map to matching `resourcev2.Value` tags.
- Refs are local only (`#...` RFC6901 fragments) and MUST resolve to a normalized node. An external or relative-URL `$ref` adds `{pointer, "$ref"}` to `Unvalidated` and makes the node `any`. A local `$ref` that does not resolve to a normalized node → `INVALID_REQUEST`. Any schema-valued location (property, items, branch, additional schema, definition entry or a nested definition such as `#/properties/x/definitions/y`) that a `$ref` targets is normalized as a node.
- `$defs` and `definitions` are definition containers in both JSON Schema dialects, at any nesting level; their entries are normalized when they are dialect roots (§3.1 table) or when referenced. In OpenAPI documents, top-level keys other than `components.schemas` (`openapi`, `info`, `paths` and others) are ignored and not counted.
- Boolean schemas: `true` normalizes to an `any` node. `false` normalizes to an `any` node with `Unvalidated{pointer, "false"}` (the host does not enforce "admits nothing"). Exception: `additionalProperties: false` stays `AdditionalForbidden`, and `additionalProperties: true` stays `AdditionalAny`.
- A `$ref` cycle with no structural node in between → `INVALID_REQUEST`. Recursion through properties/items is allowed: refs are node links, never inlined.
- Budget overruns → `RESOURCE_LIMIT` naming the exceeded policy field: `MaxDocumentBytes`, `MaxDocumentNodes`, `MaxDefinitions`, `MaxDepth`, `MaxRefChain`, `MaxUnionBranches`, `MaxEnumValues`.
- Kubernetes keeps sending raw OpenAPI 3.0 documents with dialect `openapi-3.0`.

### 3.2 Keywords

| Keyword | Treatment |
| --- | --- |
| `type` (string or array) | `Types` |
| `nullable: true` (OpenAPI only) | adds `TypeNull`, only when `type` is present |
| `properties`, `required`, `additionalProperties` (bool or schema) | structural; absent `additionalProperties` = `AdditionalAny` in all dialects |
| `items` (schema form) | `Items` |
| `items` (array form, draft-07), `prefixItems` (2020-12) | unvalidated + `any` items |
| `allOf`, `anyOf`, `oneOf` | structural |
| `$ref` | `Ref`. Draft-07 and OpenAPI ignore sibling keywords next to `$ref`; 2020-12 keeps them |
| `enum`, `const`, `format`, `minimum`, `maximum`, `exclusiveMinimum`/`exclusiveMaximum` (bool in OpenAPI, number in draft-07/2020-12), `multipleOf`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `uniqueItems`, `minProperties`, `maxProperties` | enforced. A `pattern` that fails `regexp.Compile` (RE2) is unvalidated instead |
| `title`, `description`, `default`, `examples`, `readOnly`, `writeOnly`, `deprecated`, `$comment`, `$schema`, `$id` (root only), `discriminator` (OpenAPI), `xml`, `externalDocs`, `example` | annotation (`title`/`description` kept) |
| `not`, `if`/`then`/`else`, `dependentSchemas`, `dependentRequired`, `dependencies`, `patternProperties`, `propertyNames`, `contains`, `minContains`, `maxContains`, `unevaluatedProperties`, `unevaluatedItems`, `$dynamicRef`, `$recursiveRef`, `$anchor`/`$dynamicAnchor` used as ref targets | unvalidated |
| `x-kubernetes-int-or-string: true` | Conjoin integer/string alternatives with existing combinators; never replace provider constraints. Preserve a null alternative when the original typed node permits null. Synthesized nodes use `<parent pointer>/x-kubernetes-int-or-string/0` (integer), `/1` (string), and `/2` (null, when needed) |
| `format: "int-or-string"` on an OpenAPI 3.0 string | Kubernetes built-in `/openapi/v3` uses this representation for `IntOrString`. Conjoin integer/string alternatives with existing combinators and preserve permitted null, using synthesized pointers `<parent pointer>/format/0`, `/1`, and `/2`. Retain `Format`. Other dialects and types retain their declared types |
| `x-kubernetes-preserve-unknown-fields: true` | `Additional = AdditionalAny`; with no `type`, the node is object-or-any |
| `x-kubernetes-embedded-resource`, `x-kubernetes-list-map-keys`, `x-kubernetes-map-type`, `x-kubernetes-patch-*`, `x-kubernetes-group-version-kind` | annotation |
| `x-kubernetes-list-type: set` or `map`, `x-kubernetes-validations`, `x-kubernetes-unions` | unvalidated |
| any other `x-*` | annotation |
| any other unknown keyword | unvalidated |

`x-kubernetes-list-type: atomic` is an annotation. An unvalidated keyword is recorded as `Constraint{Pointer, Keyword}` on its node; it MUST NOT be silently dropped.

## 4. Normalized model

```go
type NodeID uint32 // 0 = none
type TypeSet uint8 // bits: TypeNull, TypeBoolean, TypeString, TypeInteger, TypeNumber, TypeObject, TypeArray; 0 = any
type AdditionalKind uint8 // AdditionalAny, AdditionalForbidden, AdditionalSchema
type Constraint struct { Pointer string; Keyword string } // RFC6901 pointer into the source document
type Property struct { Name string; Node NodeID }
type Node struct {
    Pointer      string
    Types        TypeSet
    Properties   []Property // sorted by Name, unique
    Required     []string   // sorted, unique
    Additional   AdditionalKind
    AdditionalOf NodeID     // valid when Additional == AdditionalSchema
    Items        NodeID     // 0 = items unconstrained
    AllOf, AnyOf, OneOf []NodeID
    Ref          NodeID     // resolved local $ref target
    Enum         []resourcev2.Value
    Const        *resourcev2.Value
    Format       string
    Minimum, Maximum *big.Rat; ExclusiveMinimum, ExclusiveMaximum bool; MultipleOf *big.Rat
    MinLength, MaxLength, MinItems, MaxItems, MinProperties, MaxProperties *uint32
    Pattern      *regexp.Regexp
    UniqueItems  bool
    Title, Description string
    Unvalidated  []Constraint // constraints present on this node that admission does not enforce
}
type Document struct {
    Digest   [32]byte // sha256("omniview.schema-doc.v1\x00" + dialect + "\x00" + raw bytes)
    Dialect  string
    Nodes    []Node   // index = NodeID; Nodes[0] unused
    pointers map[string]NodeID
    retainedBytes int64
    views    branchViews // lazily built (§6.3)
}
func (d *Document) Lookup(pointer string) (NodeID, bool) // decoded RFC6901 pointer without the leading "#"; "" = document root
```

- A `Document` is immutable after normalization, except for its `sync.Once` caches.
- `SchemaBinding.Root` is a `#/…` URI fragment with percent-encoding (SDK `validateSchemaRoot`). The catalog strips `#`, percent-decodes and passes the RFC6901 pointer to `Lookup`. OpenAPI 3.0 bindings MUST carry a non-empty `Root` because the OpenAPI document root is never a normalized node; an empty `Root` there → `INVALID_REQUEST` "schema root does not resolve".
- `Schema.Validation` is `full` when `Schema.Unvalidated` is empty, otherwise `reduced`. `Schema.Unvalidated` is the set of constraints reachable from `Root`, sorted by (Pointer, Keyword) and deduplicated.
- Number constraints are exact `big.Rat` values. In 2020-12/draft-07 a numeric `exclusiveMinimum: n` sets `Minimum = n, ExclusiveMinimum = true`; when both `minimum` and numeric `exclusiveMinimum` are present, the stricter bound is kept.
- `MinLength`/`MaxLength` count Unicode code points.

### 4.1 Policy type

```go
const PolicyVersion = "omniview.schema-policy.v1"
type Policy struct {
    MaxDocumentBytes, MaxDocumentNodes, MaxDefinitions, MaxDepth, MaxRefChain,
    MaxUnionBranches, MaxEnumValues, MaxNavigationVisits, MaxNavigationFields,
    MaxAdmissionWork, MaxRetainedDocuments int
    MaxRetainedBytes int64
}
func DefaultPolicy() Policy
```

Values are in §9.

## 5. Admission outcomes

```go
type Admission struct { Validation string /* "full"|"reduced"|"none" */; Unvalidated []Constraint; UnavailablePaths []string }
func Admit(ctx context.Context, schema *Schema, value resourcev2.Value, coverage resourcev2.Coverage, policy Policy) (Admission, error)
```

- A nil `schema` (absent) performs a `resourcev2.ValidateValue`-equivalent structural check and returns `Validation:"none"`.
- The resource root MUST be a map; otherwise `INVALID_REQUEST`.
- Type compatibility: `int64`/`uint64` satisfy `integer` and `number`; `double` satisfies `number` only; `timestamp` satisfies `string` only when `Format == "date-time"`. No coercion.
- Every enforced keyword (§3.2) is enforced. Numbers compare exactly with `big.Rat`; `enum`/`const` use exact tagged-value equality (an int64 `9007199254740993` never equals a double `9007199254740992`). `format` other than `date-time` is enforced only as the type check above plus no additional assertion; `Format` is retained for navigation and CEL.
- Closed objects (`AdditionalForbidden`) reject undeclared keys.
- `allOf` requires all branches; `anyOf` at least one valid branch; `oneOf` exactly one. Branches whose validity depends on missing limited fields are indeterminate, not confirmed matches or definite failures. Preserve their unavailable paths when the union outcome depends on them. Reject when all branches definitively fail or more than one `oneOf` branch definitively matches. Branch evaluation shares the request work budget.
- **Coverage.Paths format.** `Coverage.Paths` entries are RFC6901 JSON pointers into the record body, each starting with `/` (the empty pointer `""` is excluded), naming *limitation* subtrees: subtrees the representation may omit or truncate. The SDK slice documents this on `Coverage` and enforces it in coverage validation: a non-empty entry that is not a well-formed pointer starting with `/` → `INVALID_REQUEST`. An earlier inventory found no producers emitting non-empty paths; the current Kubernetes candidate sets `Paths: []string{"/metadata/managedFields"}` on model-projection partial coverage in `native_read.go`. `Admit` uses the entries as given; there is no conversion.
  - **C04 integration boundary.** C04 document coverage carries typed `knownAbsent` facts, which are distinct from limitation paths and cannot be losslessly converted to them. P12 preserves the original observation, and its enumeration coverage is separate. P13 MUST preserve `knownAbsent` separately and reject affected admission when the existing `Admit` interface cannot represent the facts safely. A lossless admission interface requires a reviewed contract revision; consumers MUST NOT silently coerce or discard these facts.
- Missing required properties (a pointer `p` naming the missing property):
  - `coverage.Kind == "complete"` → `INVALID_REQUEST` naming `p`.
  - `coverage.Kind` `partial` or `unknown` with empty `Paths` → `p` is appended to `UnavailablePaths` (the whole body is limited).
  - `coverage.Kind` `partial` or `unknown` with non-empty `Paths` → `p` is appended to `UnavailablePaths` when some listed limitation path is a segment-wise prefix of `p` (or equal to it); otherwise `INVALID_REQUEST` naming `p`.
- `UnavailablePaths` reports only the missing *required* subset. An optional field absent under a limitation path is indistinguishable from absence in `Admission`; P13 owns coverage policy and reads `Coverage` itself (P01 §8.2) to decide hydration or rejection.
- Every error message carries the RFC6901 pointer of the failing value.
- Each visited value node, schema node, branch attempt and recursive value-comparison step costs 1 work unit. Exceeding `MaxAdmissionWork` returns `RESOURCE_LIMIT`. Check `ctx.Err()` every 1024 units; return `CANCELLED` or `TIMEOUT` via `resourcev2.NewError`.
- Compare a `double` to numeric constraints as the exact rational value of its binary64 representation.
- A `timestamp` value that satisfies a `string` node through `format: date-time` is also checked against that node's `minLength`, `maxLength` and `pattern`, using its RFC3339 text.
- Result: `Validation` is `full` when `schema.Unvalidated` is empty, `reduced` otherwise; `Unvalidated = schema.Unvalidated`. Callers that require full validation MUST reject `reduced`.
- `Admit` allocates nothing that outlives the call, never writes to `Document` and never builds branch views.

| Outcome | Code |
| --- | --- |
| Admitted, schema fully enforced | `Validation:"full"` |
| Admitted, listed constraints not enforced | `Validation:"reduced"` + `Unvalidated` |
| Admitted, absent schema | `Validation:"none"` |
| Body contradicts schema / missing required under complete coverage / multiple oneOf | `INVALID_REQUEST` |
| Unsupported dialect (from Resolve) | `UNSUPPORTED` |
| Unavailable schema (from Resolve) | provider reason or `UNAVAILABLE` |
| Work budget exceeded | `RESOURCE_LIMIT` |
| Lifecycle | `CANCELLED`, `TIMEOUT`, `RESET_REQUIRED` |

## 6. Navigation and overlay DTOs

### 6.1 Navigation

```go
type PathSegment struct { Kind string /* "field"|"mapValue"|"item" */; Name string `json:",omitempty"` }
type BranchCondition struct { Pointer string; Branch int; Combinator string /* "anyOf"|"oneOf" */ }
type FieldInfo struct {
    Segment PathSegment
    Types []string // "null","boolean","string","integer","number","object","array"; empty = any
    Format, Title, Description string
    Enum []resourcev2.Value // first MaxEnumValues
    Presence string    // "required"|"optional"|"unknown"
    Nullable string    // "yes"|"no"|"unknown"
    Applicability string // "unconditional"|"conditional"
    Conditions []BranchCondition
    CELChecking string // "static"|"partial"|"dynamic" (§8)
    HasChildren bool
    NativeFilter string // always "unsupported" in P07
}
type Navigation struct { Fields []FieldInfo; Truncated bool; TruncationReason string /* "fields"|"visits" */ }
func Navigate(ctx context.Context, schema *Schema, path []PathSegment, policy Policy) (Navigation, error)
```

- `Navigate` walks `path` from `Root`. At each step the current position is a *set* of (node, accumulated conditions) pairs, starting with `{(Root, [])}`. `field` on an object goes through `Properties` or the additional schema; `mapValue` goes to the additional schema of a map; `item` goes to `Items`.
- Before each step and before listing, every member of the set is expanded: `Ref` and single-branch `allOf` resolve to their target; a multi-branch `allOf` contributes all of its branches unconditionally (no condition is added); an `anyOf`/`oneOf` contributes each branch with an appended `BranchCondition{Pointer: union node pointer, Branch: index, Combinator}`. Nested unions expand recursively and concatenate conditions. Expansion of one union counts at most `MaxUnionBranches` branches.
- Descent through a union: a `field` declared in k branches continues on the set of those k per-branch nodes, each carrying its accumulated conditions. Ancestor conditions therefore propagate to every field below a branch-local field (CEL contract §8.4 "effective field path").
- Listing at the target set:
  - Own `Properties` of a node that also has `anyOf`/`oneOf` are listed first as `unconditional`; branch-view entries follow. A name present both as an own property and in branches is listed once, `unconditional`.
  - Properties contributed through multi-branch `allOf` are listed as `unconditional`; `Presence` is `required` if any `allOf` branch requires the name.
  - Union members: the branch view's merged children (§6.3).
  - A map lists a single `{Kind:"mapValue"}`; an array a single `{Kind:"item"}`. Entries are sorted by name within each group.
- A merged conditional field reports `Types` = sorted union of the branch types (empty if any branch is `any`); `Format`, `Title`, `Description` and `Enum` only when identical across all declaring branches (otherwise empty); `HasChildren` if any branch node has children; `Conditions` = the union of the per-branch accumulated conditions, sorted by (Pointer, Branch). Incompatible alternatives are therefore visible as distinct conditions, never silently merged into an unconditional field.
- A non-resolving path → `INVALID_REQUEST` "schema path does not resolve". A nil schema → `Navigation{}`, no error; the caller reports dynamic.
- `MaxNavigationFields` truncates with `"fields"`; `MaxNavigationVisits` truncates with `"visits"`. Every node expansion counts one visit. Each property declaration materialized in a branch view also counts one visit, before allocation, so shared references cannot multiply an uncharged property table.
- `Presence` is `required` when the property is in `Required` of every declaring branch (or of any `allOf` branch), `optional` when declared and not required, `unknown` for map values, items and `any` nodes. `Nullable` is `yes` when `Types` contains null, `no` when `Types` is non-empty without null, `unknown` for `any`.

### 6.2 Overlay

```go
type TypeOverlay struct {
    Operations []resourcev2.Operation // copied from Descriptor.Capabilities, sorted, unique
    NativeQueryLanguages []string // Descriptor.NativeQueries languages, only if OperationNativeQuery is declared; else empty
    HostEvaluation string // "schemaChecked" | "dynamic" | "unavailable" | "unsupported"
    HostEvaluationCode string // error code when unavailable or unsupported
    Validation string // "full"|"reduced"|"none"
    Unvalidated []Constraint
}
func OverlayFor(entry *Entry, schema *Schema, resolveErr error) TypeOverlay
```

- `HostEvaluation`:
  - resolved schema → `schemaChecked`;
  - absent → `dynamic` (`Validation:"none"`);
  - code in the normalization set (`UNSUPPORTED`, `INVALID_REQUEST`, `RESOURCE_LIMIT`), from normalization or from `fetch` → `unsupported` with `HostEvaluationCode`. These are exactly the cached deterministic outcomes (§2.3);
  - `unavailable` binding state or a fetch error with any other code → `unavailable` with `HostEvaluationCode`.
  Unsupported, unavailable and absent schemas thus keep distinct states (CEL contract §8.3).
- Schema existence MUST NOT grant native capabilities or native filtering, and MUST NOT bypass admission. `FieldInfo.NativeFilter` is the constant `"unsupported"` because the SDK has no per-field native filter declaration.

### 6.3 Branch views

- `func (d *Document) branchView(node NodeID, visit func() bool) *BranchView` builds a merged property table lazily. Charge each unique node/complete-condition-path expansion and each materialized property declaration before allocation. Cache only complete views; a mutex protects retries and `sync.Once` publishes successful views. An exhausted budget returns explicit visit truncation, never a cached partial view. Cached reuse charges the same total member-expansion and property-declaration visits.
- Members are resolved through `Ref` and single-branch `allOf` before merging; nested unions merge recursively with concatenated conditions (§6.1).
- A field present in every branch with the same `TypeSet` is `unconditional`; any other field is `conditional` with one `BranchCondition` per declaring branch.
- Views live inside the immutable `Document` and are freed with it. Their count is bounded by the number of union nodes; `Stats().BranchViews` reports it. Admission and CEL never create views.

## 7. Editor rendering rules

- `func (d *Document) EditorJSON() ([]byte, error)` is cached once per document and outputs `{"$schema":"http://json-schema.org/draft-07/schema#","definitions":{"n<id>":<node>…}}`.
- Node rendering: `TypeSet` → `type` (a string, or a sorted array including `null`); `Ref` → `{"$ref":"#/definitions/n<id>"}`; a node with `Ref` and kept sibling keywords (2020-12) renders as `{"allOf":[{"$ref":"#/definitions/n<id>"}], …siblings}` because draft-07 consumers ignore siblings of `$ref`; combinators emitted as is; `additionalProperties` is `false`, a schema `$ref`, or omitted; all enforced constraints emitted; unvalidated constraints omitted; `title`/`description` emitted.
- Values: `enum`/`const` render as plain JSON literals, not tagged `resourcev2.Value` JSON: int64/uint64 as JSON numbers written from their decimal strings, double via `strconv.FormatFloat(v, 'g', -1, 64)`, timestamp as an RFC3339 string, bool/string/null structurally, list/map recursively. `*big.Rat` bounds render as exact decimals (`Rat.FloatString` with the minimal number of digits that is exact; integers without a fraction). Exclusive bounds render in draft-07 numeric form (`exclusiveMinimum: n`, `exclusiveMaximum: n`).
- `func EditorRoot(schema *Schema) string` returns `"#/definitions/n<id>"`.
- Output above `MaxDocumentBytes` → `RESOURCE_LIMIT`. Rendered bytes count toward `retainedBytes`.

### 7.1 Host methods

Operation names: `resource.GetSchemaFields`, `resource.GetEditorSchemas`, `resource.GetEditorSchemaDocument`. Each follows the `GetEditorSchemas` admission pattern (`c.admit` → `finishResource` → `c.operationGeneration` → `c.admitAncillaryCatalog`), observes the snapshot with `ConnectionKey{PluginID, Generation: generation.generationID, Connection: route.Connection, Epoch: sourceEpochSnapshot.Epoch}`, uses a `DocumentSource` over `resourcev2.SchemaDocumentProvider` (nil when unimplemented) and finishes with `ancillaryResult`.

```go
type SchemaFieldsRequest struct { Route resourcev2.AccessRoute `json:"route"`; Type string `json:"type"`; Representation string `json:"representation,omitempty"`; Path []resourcecatalog.PathSegment `json:"path"` }
type SchemaFieldsResult struct {
    CatalogRevision string `json:"catalogRevision"`; Type, Representation string
    SchemaState string `json:"schemaState"`
    SchemaRevision string `json:"schemaRevision,omitempty"`; Dialect string `json:"dialect,omitempty"`
    Overlay resourcecatalog.TypeOverlay `json:"overlay"`
    Fields []resourcecatalog.FieldInfo `json:"fields"`; Truncated bool `json:"truncated"`; TruncationReason string `json:"truncationReason,omitempty"`
}
func (c *controller) GetSchemaFields(ctx context.Context, pluginID string, request SchemaFieldsRequest) (SchemaFieldsResult, error)

type EditorSchemaAssociation struct {
    Type string `json:"type"`; Representation string `json:"representation,omitempty"`; Key string `json:"key,omitempty"`
    Language string `json:"language"`
    ModelDirectory string `json:"modelDirectory"` // "file:///omniview-schema/<hex16>"
    FileMatch string `json:"fileMatch"`           // "**/omniview-schema/<hex16>/*"
    DocumentID string `json:"documentId,omitempty"`
    Root string `json:"root,omitempty"`
    Status string `json:"status"` // "available"|"absent"|"unavailable"|"unsupported"|"invalid"|"limit"
    Code string `json:"code,omitempty"`
}
func (c *controller) GetEditorSchemas(ctx context.Context, pluginID string, route resourcev2.AccessRoute) ([]EditorSchemaAssociation, error)
type EditorSchemaDocument struct { DocumentID string `json:"documentId"`; Schema json.RawMessage `json:"schema"` }
func (c *controller) GetEditorSchemaDocument(ctx context.Context, pluginID string, route resourcev2.AccessRoute, documentID string) (EditorSchemaDocument, error)
```

- `GetSchemaFields`: empty `Representation` uses `Descriptor.DefaultRepresentation`; if that is empty → `INVALID_REQUEST` "representation is required for types without a default". The result always carries `Overlay` from `OverlayFor`. A deterministic (cached, §2.3) resolve outcome returns a result with empty fields: a code in the normalization set (`INVALID_REQUEST`, `UNSUPPORTED`, `RESOURCE_LIMIT`, from normalization or `fetch`) gives `HostEvaluation:"unsupported"`, the `unavailable` binding state gives `HostEvaluation:"unavailable"`. Fetch errors with any other code and lifecycle errors (`CANCELLED`, `TIMEOUT`, `RESET_REQUIRED`) are returned as errors.
- `GetEditorSchemas`: one association per catalog type for its `DefaultRepresentation` (types without a default are skipped), plus one per auxiliary schema from `EditorSchemaProvider` → `ResolveAux` (none when unimplemented). Any entry resolve or auxiliary call failing with `CANCELLED`, `TIMEOUT` or `RESET_REQUIRED` aborts the method and is returned as the error. Any other auxiliary call failure adds one `{Status:"unavailable", Code:<code>, Language:"yaml"}` with empty `Type`/`Key`, and catalog associations are still returned.
- `hex16` = first 16 hex characters of sha256 over `"omniview.editor.v1\x00"+pluginID+"\x00"+connection+"\x00"+type+"\x00"+(representation or "aux:"+key)`.
- Status: absent → `absent`; resolve code (from normalization or `fetch`; code in the normalization set ⇔ cached ⇔ deterministic) `UNSUPPORTED` → `unsupported`, `INVALID_REQUEST` → `invalid`, `RESOURCE_LIMIT` → `limit`, any other → `unavailable` with `Code`. `DocumentID` (full hex digest) and `Root` are set only when `Status=="available"`. Language is `yaml` for catalog entries and the provider value for auxiliary entries.
- `GetEditorSchemaDocument` returns `EditorJSON()` only for a document found by `snapshot.Document(documentID)`; otherwise `NOT_FOUND` "Editor schema document is not referenced by this connection."
- `GetSchemaDocument` (raw) rejects a reference not used by any binding of the fresh catalog with `NOT_FOUND` "Schema document is not referenced by the current catalog."

### 7.2 Monaco bridge

- `schemaRegistry.register(pluginID, connectionID, associations, documents)` adds one document entry per unique `documentId` (uri `omniview-schema:/<documentId>`, `fileMatch: ''`, parsed schema, association language) and one association entry per `available` association (uri `omniview-schema:/assoc/<modelDirectory hex16>`, `fileMatch: association.fileMatch`, `schema: {$ref: "omniview-schema:/<documentId>" + root}`). Non-available associations are skipped. A missing document throws.
- `editorModelPath(association, name)` = `${association.modelDirectory}/${encodeURIComponent(name)}.${association.language}`. Editors obtain paths through `useResourceEditorModelPath`; providers never supply file matches or URIs.
- Both registration and references use Monaco's canonical authority-free URI form with one slash after the scheme. Native verification showed that the YAML service normalizes registered handles but not every lookup: mixed one-slash and three-slash forms cause `No content` errors. Cross-document references resolve with canonical URIs, so associations do not embed document copies.

## 8. CEL mapping table (`omniview.schema-cel.v1`)

```go
const MappingVersion = "omniview.schema-cel.v1"
type Environment struct {
    Options    []cel.EnvOption
    ContentKey string // host-internal cel.Env reuse only
    Revision   string // checking/authoring identity
}
func NewEnvironment(snapshotRevision string, entry *resourcecatalog.Entry, schema *resourcecatalog.Schema) (*Environment, error)
func ToCEL(v resourcev2.Value) (ref.Val, error)
```

- Nil schema → `[]cel.EnvOption{cel.Variable("resource", cel.DynType)}`.
- Otherwise `cel.CustomTypeProvider(p)` + `cel.Variable("resource", rootType)`, where `p` implements `types.Provider` over the document, is created once per `Document` (`sync.Once`, unexported field) and shares its lifetime. `Stats().CELProviders` counts providers.
- `ContentKey` = hex sha256 of `PolicyVersion + MappingVersion + hex(digest) + root pointer` (for a nil schema: of `PolicyVersion + MappingVersion + "dyn"`). It MAY key host-internal reuse of a `cel.Env` and nothing else.
- `Revision` = hex sha256 of `ContentKey + "\x00" + snapshotRevision + "\x00" + entry.RepresentationRevision + "\x00" + schema.SchemaRevision` (empty `SchemaRevision` for a nil schema). A changed snapshot, representation or schema revision changes `Revision` even when the bytes are identical (P01 §8.2, CEL contract §8.3). Consumers (P13, P16) MUST key checking and authoring identities on `Revision`, never on `ContentKey`.

| Normalized node | CEL type | Checking |
| --- | --- | --- |
| object with `AdditionalForbidden` | struct `omniview.schema.<hex16(digest)>.n<id>`; unknown field = checker error | static |
| object with properties and `AdditionalAny`/`AdditionalSchema` | same struct; `FindStructFieldType` returns `dyn` (or the additional schema type) for undeclared names | partial |
| map (no properties, `AdditionalSchema`) | `map(string, T)` | static |
| array with `Items` | `list(T)` | static |
| `string` | `string` | static |
| `string` with `Format=="date-time"` | `dyn` | partial |
| `integer` with `Format` `int32`/`int64` | `int` | static |
| `integer` with `Format` `uint32`/`uint64` | `uint` | static |
| `integer` without format, `number` | `dyn` | partial |
| `boolean` | `bool` | static |
| `Types` includes null alongside another type; any `anyOf`/`oneOf`; `allOf` of more than one non-trivial branch; `TypeSet` any; unvalidated-only node | `dyn` | dynamic |

- An `allOf` with exactly one non-trivial branch maps through to that branch; annotation-only branches are ignored. `Ref` maps through to its target. A node with its own shape and a `Ref` or non-trivial `allOf` branch maps to `dyn`.
- An object without properties and with `AdditionalAny` is `map(string, dyn)` (partial).
- `has()` on struct fields works through `FieldType.IsSet`.
- `ToCEL` converts to `types.DefaultTypeAdapter` values: maps → `map[string]any`, lists → `[]any`, `int64`/`uint64`/`double`/`bool`/`string` native, timestamp → `time.Time`, null → `types.NullValue`. Runtime struct-typed paths stay plain CEL maps; no per-value schema object is created.
- Test profile: `cel.CrossTypeNumericComparisons(true)`, `cel.ParserRecursionLimit(64)`, `cel.ParserExpressionSizeLimit(16384)`, optimization on.
- If the fork's provider API names differ from those above, only method names adapt; the actual names are recorded here.

## 9. Policy `omniview.schema-policy.v1`

This section supersedes the P01 [`2026-10-24-resource-query-contracts.md`](2026-10-24-resource-query-contracts.md) §9 rows "Schema catalog binding" and "Catalog fixture collection admission". Those reference fixture ceilings no longer bind P07; the other P01 §9 rows are unchanged.

Limits are finite safety ceilings, not inventory or latency promises. Hosts MAY lower them. Raising a ceiling requires a reviewed policy revision with new boundary measurements.

The Measure slice (2026-11-01) filled the measured-value column and the observed table below; `DefaultPolicy()` returns the measured values. The provisional column is kept for history. Any change to the formula, or any ceiling above an SDK wire ceiling, re-enters contract review.

Counted quantities:

- `MaxDocumentBytes`: raw document bytes before decoding.
- `MaxDocumentNodes`: normalized `Node` entries, including synthesized nodes (§3.2).
- `MaxDefinitions`: entries of all definition containers in the document (`$defs` and `definitions` at any level for JSON Schema; `components.schemas` for OpenAPI 3.0), whether or not referenced.
- `MaxDepth`: structural nesting of schema-valued locations within the source document (properties, items, additional schema, combinator branches, definition entries), counted along the source tree; a `$ref` is a link and does not add depth to its target.
- `MaxRefChain`: consecutive `$ref` hops from a node to the first non-`$ref` target.
- `MaxUnionBranches`: branches of one `allOf`, `anyOf` or `oneOf` (and the two synthesized `x-kubernetes-int-or-string` branches).
- `MaxEnumValues`: entries of one `enum`.
- `MaxAdmissionWork`: §5 work units per `Admit` call.

| Field | Provisional value | Measured value | Exceeded outcome |
| --- | --- | --- | --- |
| `MaxDocumentBytes` | 16<<20 (= `resourcev2.MaxDocumentBytes`) | 16<<20, fixed at the SDK wire ceiling (measurement recorded, not applied) | `RESOURCE_LIMIT` |
| `MaxDocumentNodes` | 262144 | 262144, fixed at the SDK wire ceiling (measurement recorded, not applied) | `RESOURCE_LIMIT` |
| `MaxDefinitions` | 8192 | 1024 (observed 258) | `RESOURCE_LIMIT` |
| `MaxDepth` | 64 | 64 (observed 19) | `RESOURCE_LIMIT` |
| `MaxRefChain` | 32 | 2 (observed 1) | `RESOURCE_LIMIT` |
| `MaxUnionBranches` | 8 | 8 (observed 4) | `RESOURCE_LIMIT` |
| `MaxEnumValues` | 512 | 256 (observed 65) | `RESOURCE_LIMIT` |
| `MaxNavigationVisits` | 4096 | 4096 (fixed, P01 authoring row) | truncation `"visits"` |
| `MaxNavigationFields` | 128 | 128 (fixed) | truncation `"fields"` |
| `MaxAdmissionWork` | 1<<20 | 1<<20 = max(4096 from observed successful 1459, 4 × `resourcev2.MaxValueNodes`) | `RESOURCE_LIMIT` |
| `MaxRetainedDocuments` | 256 | 256 = max(256, 4 × 51 GroupVersions = 204) | `RESOURCE_LIMIT` on acquire |
| `MaxRetainedBytes` | 256<<20 | 256<<20 = max(256<<20, 4 × 43,623,005 = 174,492,020) | `RESOURCE_LIMIT` on acquire |

Measurement formula:

- Inputs (the measurement sample): every GroupVersion document from the homelab cluster's (`admin@homelab`) `/openapi/v3` (read-only); every Pod and Deployment body from `kubectl get pods,deployments -A -o json` on that cluster (not committed); and the four P44 schema scenarios (`cloud-discovered-schema`, `cloud-unavailable-schema`, `container-unsupported-dialect`, `hypervisor-openapi-vms`) with their record bodies. Values derived from this sample are sampled values, not inventory predictions.
- Per document: raw bytes, definitions, normalized nodes, max structural depth, max ref chain, max union branches, max enum values, retained bytes; per body: admission work units.
- Ceiling = smallest power of two ≥ 2 × largest observed value, with these exceptions:
  - `MaxDocumentBytes` = 16<<20 and `MaxDocumentNodes` = 262144, fixed at the SDK wire ceilings. Their observed maxima are recorded in the observed table but are not applied, so a GroupVersion larger than any in the sample but within the wire ceilings is not rejected.
  - `MaxAdmissionWork` = max(sampled formula value, 4 × `resourcev2.MaxValueNodes`) (= max(formula, 1<<20)). A wire-admitted body can exceed this budget during branch exploration or value comparisons.
  - `MaxNavigationVisits`/`MaxNavigationFields` fixed at 4096/128.
  - `MaxRetainedBytes` = max(256<<20, 4 × sum of retained bytes over all homelab GroupVersions); `MaxRetainedDocuments` = max(256, 4 × GroupVersion count).
- A document in the sample above an SDK wire ceiling returns `RESOURCE_LIMIT` and is listed here by name.
- If the homelab is unreachable, values stay provisional and this section is marked "provisional: homelab unavailable".

**Observed table.** Sample: the cluster `admin@homelab` (Kubernetes v1.37.2), fetched read-only on 2026-11-01. It has 77 `/openapi/v3` paths: 51 GroupVersions, 23 group/legacy discovery documents (`api`, `apis`, `apis/<group>`), `version`, and two OIDC documents (`.well-known/openid-configuration`, `openid/v1/jwks`) with no `components.schemas`. Every document was normalized as `openapi-3.0`. The sample also has 186 Pod and 90 Deployment bodies, plus the four P44 scenarios. Per-document maxima for definitions, depth, ref chain, union branches and enum values were measured as the smallest policy value that normalizes. Nodes and retained bytes come from the normalized `Document`.

| Document (all 51 GroupVersions normalize under the measured policy) | Bytes | Definitions | Nodes | Depth | Ref chain | Union branches | Enum values | Retained bytes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `api/v1` | 1,604,476 | **258** | 1,912 | 4 | 1 | 2 | **65** | 2,318,454 |
| `apis/apps/v1` | 719,385 | 166 | 1,221 | 3 | 1 | 2 | **65** | 1,194,131 |
| `apis/batch/v1` | 440,237 | 155 | 1,101 | 3 | 1 | 2 | **65** | 876,997 |
| `apis/actions.github.com/v1alpha1` | **1,835,496** | 21 | **7,457** | 15 | 1 | 2 | 2 | **5,623,669** |
| `apis/monitoring.coreos.com/v1` | 1,748,865 | 30 | 6,252 | 13 | 1 | 2 | 22 | 4,602,494 |
| `apis/monitoring.coreos.com/v1alpha1` | 1,373,814 | 22 | 6,080 | 13 | 1 | 2 | 22 | 4,128,085 |
| `apis/stackgres.io/v1beta1` | 1,000,911 | 17 | 3,394 | 17 | 1 | 2 | 4 | 2,829,948 |
| `apis/stackgres.io/v1` | 1,244,668 | 38 | 3,257 | 14 | 1 | 2 | 4 | 2,801,906 |
| `apis/cilium.io/v2` | 830,318 | 29 | 2,485 | 14 | 1 | **4** | 12 | 1,898,758 |
| `apis/cert-manager.io/v1` | 547,942 | 21 | 1,533 | **19** | 1 | 2 | 23 | 1,369,748 |
| `apis/acme.cert-manager.io/v1` | 260,374 | 17 | 670 | 17 | 1 | 2 | 7 | 620,398 |
| other 40 GroupVersions (each) | ≤ 860,806 | ≤ 75 | ≤ 1,947 | ≤ 14 | 1 | ≤ 2 | ≤ 35 | ≤ 1,555,069 |
| discovery/version/OIDC documents (each) | ≤ 5,400 | ≤ 4 | ≤ 21 | ≤ 3 | ≤ 1 | ≤ 1 | 0 | ≤ 13,023 |
| P44 `cloud-discovered-schema` (2020-12, by reference) | 476 | 0 | 11 | 3 | 0 | 0 | 0 | 2,206 |
| P44 `hypervisor-openapi-vms` (OpenAPI 3.0) | 1,304 | 3 | 30 | 4 | 1 | 2 | 2 | 6,730 |
| **Maximum** | 1,835,496 | 258 | 7,457 | 19 | 1 | 4 | 65 | 5,623,669 |

- The 51 GroupVersions sum to 43,623,005 retained bytes.
- P44 `cloud-unavailable-schema` has no document (unavailable binding, `FORBIDDEN`). P44 `container-unsupported-dialect` is `UNSUPPORTED` before normalization (2019-09). Neither contributes a value.
- **Admission work (final implementation, 2026-11-01).** Replaced the earlier walker estimate with calls to the actual `resourcecatalog.Admit`, using complete coverage and binary search for the smallest successful `Policy.MaxAdmissionWork` for each admissible body. All other policy fields stayed at `DefaultPolicy()`. Read-only `kubectl --context admin@homelab get pods,deployments -A -o json` fetched 185 Pods and 89 Deployments into `/tmp`; read-only `/openapi/v3/api/v1` and `/openapi/v3/apis/apps/v1` supplied their corresponding schemas. All 89 Deployments admitted; maximum successful work was **1,459**, using root `#/components/schemas/io.k8s.api.apps.v1.Deployment`. No Pod admitted, so there is **no measured successful Pod maximum**, not a zero-work maximum. Every Pod returned `INVALID_REQUEST`: `value at "/status/conditions/0/lastProbeTime" has kind null, schema at "/components/schemas/io.k8s.apimachinery.pkg.apis.meta.v1.Time" allows string`. Pod root was `#/components/schemas/io.k8s.api.core.v1.Pod`. Bodies and schemas were not modified to bypass this mismatch.
  - **P44 policy sample.** All scenarios in the native corpus were exercised. Bundled cloud: 2/2 successful, maximum 41; bundled container: 2/2, 26; bundled hypervisor: 2/2, 20. The four schema-contract scenarios were: `cloud-discovered-schema`, 2/2 successful, maximum 41; `hypervisor-openapi-vms`, 3/3, maximum 71; `cloud-unavailable-schema`, no schema admission because the binding is unavailable (`FORBIDDEN`), with structural-only nil-schema admission measured separately at 14 for 2/2 bodies; `container-unsupported-dialect`, 2 bodies, rejected before admission with `UNSUPPORTED` / `unsupported schema dialect`. Remaining absent-schema scenarios admitted structurally, with maxima from 3 through 14. These structural-only results do not claim unavailable or unsupported schemas validated.
  - **Synthetic comparison accounting (not policy sample).** JSON Schema 2020-12 enum case: object enum `[{"x":[1,2]},{"x":[1,3]},{"x":[1,4]}]`, body `{"x":[1,4]}`, measured 17. Const case: object const `{"x":[1,2,3]}`, identical body, measured 11. Unique-items case: object property `x` has array `uniqueItems:true`, body `{"x":[{"v":[1,2]},{"v":[1,3]},{"v":[1,4]}]}`, measured 29. These use actual admission, including comparison charges omitted by the old walker.
  - **Reproduction and cleanup.** The temporary package-local measurement ran with `GOWORK=off GOFLAGS= go test -modfile=.local/hostmod/host.mod ./backend/pkg/resourcecatalog -run '^TestP07MeasureFinal$' -count=1 -v` and passed. The unmodified final policy remains `1<<20`: `resourcev2.MaxValueNodes` dominates the formula. Production policy files were never changed; budget changes were local policy copies only. Temporary SDK corpus exporter, measurement test, fetched schemas and bodies were removed. No permanent tests or commits were added. This receipt records the Pod schema/body blocker rather than claiming a complete successful Kubernetes admission sample.
- **SDK wire ceilings.** No sample document exceeds an SDK wire ceiling or any measured ceiling. The largest observed values are 1,835,496 bytes against 16<<20, and 7,457 nodes against 262144.
- **JSON nesting vs `MaxDepth`.** The SDK `resourcev2.ValidateJSON` caps JSON nesting at 64 levels (`RESOURCE_LIMIT` "JSON complexity limit") before normalization starts. Each structural schema level adds about two JSON levels (for example `properties` → name → schema). An inline-nested schema therefore reaches the JSON limit near 32 structural levels, before `MaxDepth` = 64 is reached. Documents that link through `$ref`, which includes every Kubernetes document, are unaffected because a `$ref` does not add depth. The observed maximum structural depth is 19 (inline-nested CRD schemas in `apis/cert-manager.io/v1`), so 64 = the smallest power of two ≥ 2 × 19 still holds with margin.
- **Protobuf wrappers vs Value depth.** Raw wire admission and decoded adapters share the existing protobuf-tree ceiling `MaxValueDepth*3+16` (208). The semantic Value depth limit remains 64. `TestActualGRPCUpdateValueDepth` covers valid map depths 21, 63 and 64, and rejects semantic depth 65. This prevents valid nested watch bodies from terminating the global update stream merely because protobuf wrappers add nesting.
- **`MaxRefChain` = 2.** Kubernetes and P44 documents never chain one `$ref` to another (the maximum is 1). A provider document that chains three `$ref` hops returns `RESOURCE_LIMIT`.

## 10. Removed APIs

| Removed | Replacement |
| --- | --- |
| `SchemaBinding.Validation` (SDK Go, JSON `validation`, proto field 5 reserved) | Host `Schema.Validation` / `Admission.Validation` |
| `SchemaBinding.Unvalidated` (SDK Go, JSON `unvalidated`, proto field 6 reserved) | Host `Schema.Unvalidated` |
| `EditorSchema.FileMatch` (proto field 2 reserved, `file_match`) | Host `EditorSchemaAssociation.FileMatch` |
| `EditorSchema.URI` (proto field 3 reserved, `uri`) | Host `ModelDirectory` / `DocumentID` |
| Provider-hardcoded editor associations (Kubernetes catalog-type loop and Helm placeholder in `GetEditorSchemas`) | Host-derived associations |
| Host pass-through `GetEditorSchemas` returning provider `EditorSchema` | New `GetEditorSchemas` returning `[]EditorSchemaAssociation` |
| Runtime `EditorSchema` TS type, `validation`/`unvalidated` on TS `SchemaBinding` | `EditorSchemaAssociation`, `EditorSchemaDocument` |

- Strict SDK JSON admission rejects a `SchemaBinding` carrying `validation` or `unvalidated` as an unknown key (`INVALID_REQUEST`). `UnmarshalJSON` requires only `state`.
- `EditorSchema` becomes `{Type, Key, Language, Binding}` (JSON `type`, `key`, `language`, `binding`; proto `string key = 6`). It describes auxiliary documents that are not catalog representations. Validation: non-empty `Type`; `Key` 1–256 UTF-8 bytes without control characters; `Language` ∈ {`yaml`,`json`}; valid `Binding`; duplicate (`Type`,`Key`) in one list → `INVALID_REQUEST` "duplicate auxiliary editor schema" on both client and server paths.
- SDK adds `DialectJSONSchema202012`, `DialectJSONSchemaDraft07`, `DialectOpenAPI30`.
- No compatibility shims or aliases remain.

### 10.1 Kubernetes adapter

- Catalog bindings: `native_catalog_assembly.go` sets `Dialect: resourcev2.DialectOpenAPI30` and a non-empty `#/components/schemas/<name>` `Root` on every available binding; documents stay raw OpenAPI v3 GroupVersion documents fetched by `DocumentRef`.
- Helm values auxiliary schemas: `Type: "helm:releases"`, `Key: "<release namespace>/<release name>"`, `Language: "yaml"`. `helmEditorSchema(document []byte, key string)` derives the dialect from the chart's `$schema`:
  - absent `$schema` → `DialectJSONSchemaDraft07`;
  - `$schema` matching draft-07 or 2020-12 after ignoring the `http`/`https` scheme and a trailing empty `#` → the matching SDK constant;
  - any other `$schema` (for example `http://json-schema.org/schema#`) → the raw `$schema` string, which the host reports truthfully as `unsupported`.
- Model-projection partial coverage in `native_read.go` sets `Paths: []string{"/metadata/managedFields"}` (§5).
- The Kubernetes provider no longer emits catalog-type editor schemas or the unavailable Helm placeholder; `GetEditorSchemas` returns only Helm auxiliary schemas and their errors unchanged.

## 11. Acceptance matrix

Test names refer to the plan's Verification section (V§1–V§6). Receipts are recorded in the PR bodies and the `tk` epic.

| #85 bullet | Evidence |
| --- | --- |
| A1 One host catalog owns identity/revision/type/scope, bounded navigation, explicit overlay | V§2 catalog tests (static/discovered/absent, isolation, shapes, limits); V§5 `TestActualSDKChildSchemaCatalog` (`GetSchemaFields` overlay `schemaChecked`/`dynamic`/`unavailable`/`unsupported`) |
| A1 Editor associations and field discovery derive from it | V§5 association statuses in `TestActualSDKChildSchemaCatalog`, `GetEditorSchemaDocument` cross-connection `NOT_FOUND`; V§5 runtime/UI vitest (`useEditorSchemas`, `useSchemaFields`, `ui/providers/monaco`); V§6 native smoke steps 3–6 |
| A1 Action input schema role stays separate | V§2 test (MUST): a `resourcev2.Catalog` type whose descriptor declares `NativeQueries` with `InputSchema` and an action yields `len(Snapshot.Entries())` equal to the number of declared representations, and its `GetSchemaFields` reports only representation schemas; V§5 `TestActualSDKChildSchemaCatalog` asserts no `EditorSchemaAssociation` is derived from an action/native-query input schema |
| A2 P44 static/discovered/absent schemas without GVK/OpenAPI | V§5 `cloud-bundled-pages`, `cloud-discovered-schema`, `cloud-absent-schema`, `cloud-unavailable-schema` over the real SDK child; V§2 static/discovered/absent unit tests |
| A2 Identical types in different scopes/revisions do not contaminate caches | V§2 isolation tests (different documents → different fields; identical → `Documents == 1`; DropConnection counts; revision change; `RESET_REQUIRED` after replacement); V§6 step 5 hex16 comparison |
| A3 Refs/unions/arrays/maps/null preserve anyOf/oneOf and coverage within limits | V§2 shapes (recursive `$ref` three levels, ref chain limit, nullable, overlapping anyOf, exclusive oneOf, map `mapValue`, array `item`), coverage complete/partial, limits boundary/boundary+1; V§5 `hypervisor-openapi-vms` conditions and admission |
| A3 Unsupported dialect/shapes not silently weakened | V§2 2019-09 → `UNSUPPORTED`, external `$ref` → reduced with `{pointer,"$ref"}`, `x-kubernetes-validations` → reduced, boolean schema `false` → reduced with `{pointer,"false"}`; V§5 `container-unsupported-dialect` → association `unsupported` and overlay `HostEvaluation:"unsupported"` |
| A4 Schema existence grants neither native filtering nor validation bypass | §6.2 `NativeFilter:"unsupported"`, overlay operations only from descriptor; V§2 admission rejects (closed object, enum precision, Pod `image: 5`); V§2 `OverlayFor` test (MUST): `NativeQueries` declared without `OperationNativeQuery` → empty `NativeQueryLanguages`, with it → sorted languages; V§5 `TestActualSDKChildSchemaCatalog` (MUST) asserts every P44 overlay has empty `NativeQueryLanguages` and every `FieldInfo.NativeFilter == "unsupported"` (P01 §8.4: P44 has no native filtering); V§5 hypervisor records admit `reduced`, not bypassed |
| A4 Superseded RPCs/duplicate truth replaced; raw schemas and provider fetches survive | V§1 SDK `validation` key rejection, `EditorSchema` `key` round trip, duplicate aux rejection over gRPC; V§5 `task check:bindings-check`, `GetSchemaDocument` unreferenced `NOT_FOUND` plus discovered-schema fetch over gRPC; K8s slice tests |
| A5 Repeated admissions retain no per-row schemas | V§3 10,000 `Admit`+`Navigate` with identical `Stats()` and HeapAlloc delta < 1 MiB |
| A5 Revision-bound metadata; bounded branch-view lifetime/reuse; measured memory/concurrency | V§3 `BranchViews` ≤ union nodes, `CELProviders` ≤ 1, 64×1,000 concurrent run under `-race`, cleanup to zero stats and `weak.Pointer` nil, benchmarks `BenchmarkNormalizeKubernetesCoreV1`, `BenchmarkAdmitPod`, `BenchmarkNavigatePodSpec`, `BenchmarkCELCompileEvalPod` |
| V1 Provider-neutral schema states and cross-scope/revision isolation | V§2 isolation; V§5 P44 connections (cloud/container/hypervisor, no Kubernetes keys) |
| V2 Refs/maps/arrays/null, overlapping anyOf, exclusive oneOf, unsupported constraints, partial representations | V§2 shapes and coverage; V§4 CEL union/nullable `dyn` evaluation; V§5 hypervisor scenario |
| V3 Repeated/concurrent admissions measure entries, physical heap and branch-view cleanup | V§3 retention, concurrency and cleanup tests. Assertion: `HeapAlloc` delta < 1 MiB after `runtime.GC()`. Receipt: the retention test also logs `HeapInuse` and `HeapSys` deltas and Linux RSS from `/proc/self/statm` (skipped on other OSes); the numbers are recorded in the host PR body. Measured, RSS recorded as receipt |
| V4 Link review/PRs and executed evidence; preserve workflows; update callers/docs; no fixture-only or forwarding-mock proof | Wave 5 reviewer receipts; draft PR bodies with commands and results; V§5 real SDK conformance child over gRPC; V§6 native smoke against the homelab (Monaco markers, field list); SDK docs `resource-v2-api.md`/`resource-v2-contracts.md`; ledger rows P07/C05 |
| CEL catalog-backed checking (contract §4, §8.4) | V§4: unknown field on a closed object (`additionalProperties: false`) is a checker error; on the real Pod schema (open objects: Kubernetes OpenAPI sets no `additionalProperties`) `resource.spec.containerz` types as `dyn` per the §8 open-object row, while wrong-typed uses of declared fields (`image + 1`, label `== 1`) fail checking; `containers.exists(...)` true, labels map lookup, int64 exactness, union/nullable `dyn`, absent `dyn`; `Environment.Revision` changes when only `RepresentationRevision` or snapshot revision changes while `ContentKey` stays equal |
