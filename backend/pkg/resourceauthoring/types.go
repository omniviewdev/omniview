package resourceauthoring

import (
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
)

// Wire constants of the completion contract.
const (
	// Version names the authoring DTO family (P01 §2/§4).
	Version = "omniview.authoring.v1"
	// PredicateProfile is the only language profile this service completes.
	PredicateProfile = "omniview.resource-predicate.v1"
	// UnitUTF8Byte is the only offset unit on the wire.
	UnitUTF8Byte = "utf8-byte"
	// ImplementationRevision is folded into the environment revision, so a
	// behavioural change of the completion engine invalidates cached answers.
	ImplementationRevision = "omniview.authoring-completion/1"
)

// Context kinds: the grammatical role of the cursor.
const (
	ContextMember     = "member"     // after "." on an operand
	ContextIndex      = "index"      // inside "[ ]" on an operand
	ContextValue      = "value"      // right operand of a comparison, or an "in [...]" element
	ContextOperator   = "operator"   // after a complete operand
	ContextExpression = "expression" // start of an expression
	ContextNone       = "none"       // nothing can be suggested here
)

// Draft states of the whole source, informational only.
const (
	DraftValid      = "valid"
	DraftIncomplete = "incomplete"
)

// Operand roots.
const (
	RootResource  = "resource"
	RootParameter = "parameter"
	RootElement   = "element"  // a macro element variable bound to an array item
	RootImplicit  = "implicit" // a document path typed without its "resource." root
)

// Item kinds.
const (
	KindField     = "field"
	KindRoot      = "root"
	KindParameter = "parameter"
	KindVariable  = "variable"
	KindOperator  = "operator"
	KindMethod    = "method"
	KindMacro     = "macro"
	KindFunction  = "function"
	KindEnumValue = "enumValue"
	KindLiteral   = "literal"
)

// Operator arities.
const (
	ArityBinary = "binary" // "<operand> op <operand>"; the edit selects the operand placeholder
	ArityMethod = "method" // ".name(args)" on the operand
	ArityState  = "state"  // replaces the operand clause with a unary form
	ArityLogic  = "logic"  // joins two complete clauses
)

// Completion states.
const (
	CompletionComplete  = "complete"
	CompletionTruncated = "truncated"

	TruncatedItems     = "itemBudget"
	TruncatedBytes     = "byteBudget"
	TruncatedTraversal = "traversalBudget"
)

// Cursor is a position in the request source.
type Cursor struct {
	Offset int    `json:"offset"`
	Unit   string `json:"unit"`
}

// Range is a zero-based, half-open span. In an Edit it addresses the source
// of the request's document revision; in Edit.Selection it addresses Edit.Text.
type Range struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Unit  string `json:"unit"`
}

// Target names the resource type being queried. The host admits every field
// against its own catalog and connection state; none confers trust.
type Target struct {
	Route resourcev2.AccessRoute `json:"route"`
	Type  string                 `json:"type"`
	// Representation is optional; empty selects the type's default.
	Representation string `json:"representation,omitempty"`
	// Scope is validated against the type's query dimensions. Omitted
	// dimensions mean "any" within the route, exactly as ResolveTarget.
	Scope resourcev2.QueryScope `json:"scope"`
}

// CompletionRequest asks for edits at one cursor of one document revision.
//
// The five optional identity members carry what the caller last observed in a
// response. A non-empty member that no longer matches the host's admitted state
// rejects the request with RESET_REQUIRED, so a caller can never apply
// suggestions computed under a different schema, environment or access than it
// believes. Omit them on the first request or to resynchronize.
type CompletionRequest struct {
	Version          string `json:"version"`
	RequestID        string `json:"requestId"`
	DocumentID       string `json:"documentId"`
	DocumentRevision uint64 `json:"documentRevision"`
	Source           string `json:"source"`
	Cursor           Cursor `json:"cursor"`
	Profile          string `json:"profile"`
	// Declarations are the typed parameters saved with the query. They are
	// types only: execution values are neither needed nor accepted.
	Declarations map[string]query.BindingType `json:"declarations,omitempty"`
	Target       Target                       `json:"target"`

	CatalogRevision        string `json:"catalogRevision,omitempty"`
	RepresentationRevision string `json:"representationRevision,omitempty"`
	SchemaRevision         string `json:"schemaRevision,omitempty"`
	EnvironmentRevision    string `json:"environmentRevision,omitempty"`
	AccessGeneration       string `json:"accessGeneration,omitempty"`

	// MaxSuggestions is positive; the host clamps it to its ceiling and
	// reports the effective value in the response.
	MaxSuggestions int `json:"maxSuggestions"`
}

// Identity names everything a completion depends on. A client may apply a
// response only while every member still matches its own state; a member that
// changed means the suggestions are stale.
type Identity struct {
	// Plugin is the provider routing key; Provider is the catalog's canonical
	// provider id used in resource addresses.
	Plugin         string `json:"plugin"`
	Provider       string `json:"provider"`
	Connection     string `json:"connection"`
	Type           string `json:"type"`
	Representation string `json:"representation"`
	// ScopeKey is an opaque digest of the normalized query scope.
	ScopeKey               string `json:"scopeKey"`
	CatalogRevision        string `json:"catalogRevision"`
	RepresentationRevision string `json:"representationRevision"`
	SchemaRevision         string `json:"schemaRevision,omitempty"`
	// EnvironmentRevision covers the parameter declarations, the profile and
	// completion implementation, and the catalog-bound CEL environment.
	EnvironmentRevision string `json:"environmentRevision"`
	// AccessGeneration is an opaque equality token for the host-admitted
	// provider generation, connection epoch and invocation principal.
	AccessGeneration string `json:"accessGeneration"`
}

// SchemaSummary reports how the type's schema participates, with the same
// distinct states the catalog overlay keeps.
type SchemaSummary struct {
	// State is the provider binding state: absent, available or unavailable.
	State   string `json:"state"`
	Dialect string `json:"dialect,omitempty"`
	// Validation is full, reduced or none.
	Validation string `json:"validation"`
	// HostEvaluation is schemaChecked, dynamic, unavailable or unsupported.
	HostEvaluation     string `json:"hostEvaluation"`
	HostEvaluationCode string `json:"hostEvaluationCode,omitempty"`
}

// PathSegment is one schema navigation step from the document root.
type PathSegment struct {
	// Kind is "field", "mapValue" or "item".
	Kind string `json:"kind"`
	Name string `json:"name,omitempty"`
}

// Condition names the union branch that makes a field applicable. It is an
// applicability fact, never a claim that CEL narrows the type.
type Condition struct {
	Pointer string `json:"pointer"`
	Branch  int    `json:"branch"`
	// Combinator is "anyOf" or "oneOf".
	Combinator string `json:"combinator"`
}

// TypeInfo is the declared JSON type of a field.
type TypeInfo struct {
	// Names are sorted JSON Schema type names; empty means any.
	Names  []string `json:"names"`
	Format string   `json:"format,omitempty"`
}

// Ancestor describes a path ancestor that is not guaranteed: optional,
// nullable or unknown, or reached only through a union branch. A value
// predicate below it needs a guard for each such ancestor.
type Ancestor struct {
	Path          []PathSegment `json:"path"`
	Presence      string        `json:"presence"`
	Nullable      string        `json:"nullable"`
	Applicability string        `json:"applicability"`
	Conditions    []Condition   `json:"conditions,omitempty"`
}

// Operand is the schema-resolved expression the cursor operates on.
type Operand struct {
	Range         Range       `json:"range"`
	Type          *TypeInfo   `json:"type,omitempty"`
	Checking      string      `json:"checking,omitempty"`
	Presence      string      `json:"presence,omitempty"`
	Nullable      string      `json:"nullable,omitempty"`
	Applicability string      `json:"applicability,omitempty"`
	Conditions    []Condition `json:"conditions,omitempty"`
}

// Context is the parser context the suggestions were derived from.
type Context struct {
	// Kind is member, index, value, operator, expression or none.
	Kind string `json:"kind"`
	// Draft is valid or incomplete for the whole source; completion never
	// requires a valid draft.
	Draft string `json:"draft"`
	// Prefix is the decoded text before the cursor inside the replaced token.
	Prefix string `json:"prefix"`
	// Replace is the token the default edit replaces, including text after
	// the cursor, so mid-token edits stay valid.
	Replace Range `json:"replace"`
	// Root is resource, parameter, element or implicit.
	Root string `json:"root,omitempty"`
	// Path is the schema path of the operand, empty for the document root.
	Path    []PathSegment `json:"path,omitempty"`
	Operand *Operand      `json:"operand,omitempty"`
	// Ancestors applies to every field suggestion of this response.
	Ancestors []Ancestor `json:"ancestors,omitempty"`
	// Keys is "dynamic" when the operand is a map whose keys the schema does
	// not name. Observed-key discovery (P17) fills such positions.
	Keys string `json:"keys,omitempty"`
}

// Edit replaces Start..End of the request source with Text. Selection, when
// present, addresses Text and marks where the user supplies the next operand;
// a zero-width selection is a caret.
type Edit struct {
	Start     int    `json:"start"`
	End       int    `json:"end"`
	Unit      string `json:"unit"`
	Text      string `json:"text"`
	Selection *Range `json:"selection,omitempty"`
}

// Item is one suggestion.
type Item struct {
	Label         string      `json:"label"`
	Kind          string      `json:"kind"`
	Detail        string      `json:"detail,omitempty"`
	Documentation string      `json:"documentation,omitempty"`
	Type          *TypeInfo   `json:"type,omitempty"`
	Checking      string      `json:"checking,omitempty"`
	Presence      string      `json:"presence,omitempty"`
	Nullable      string      `json:"nullable,omitempty"`
	Applicability string      `json:"applicability,omitempty"`
	Conditions    []Condition `json:"conditions,omitempty"`
	HasChildren   bool        `json:"hasChildren,omitempty"`
	// Arity is set on operators, methods, macros and functions.
	Arity string `json:"arity,omitempty"`
	// Rootless marks a field typed without its "resource." root; its edit
	// supplies the root.
	Rootless bool `json:"rootless,omitempty"`
	Edit     Edit `json:"edit"`
}

// Completeness states whether Items is everything applicable. Truncated is
// not absence: more suggestions may exist, and the client must not narrow the
// list locally as if it were complete.
type Completeness struct {
	Kind   string `json:"kind"`
	Reason string `json:"reason,omitempty"`
}

// CompletionResponse answers one request and echoes its identities.
type CompletionResponse struct {
	Version          string        `json:"version"`
	RequestID        string        `json:"requestId"`
	DocumentID       string        `json:"documentId"`
	DocumentRevision uint64        `json:"documentRevision"`
	Cursor           Cursor        `json:"cursor"`
	Identity         Identity      `json:"identity"`
	Schema           SchemaSummary `json:"schema"`
	Context          Context       `json:"context"`
	Items            []Item        `json:"items"`
	Completion       Completeness  `json:"completion"`
	// MaxSuggestions is the effective ceiling applied to this request.
	MaxSuggestions int `json:"maxSuggestions"`
}
