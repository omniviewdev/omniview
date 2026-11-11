package resourcecatalog

import (
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"sort"
	"sync"
	"sync/atomic"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// NodeID indexes Document.Nodes. Zero means "no node".
type NodeID uint32

// TypeSet is a bit set of JSON types. The zero TypeSet admits any type.
type TypeSet uint8

// TypeSet bits.
const (
	TypeNull TypeSet = 1 << iota
	TypeBoolean
	TypeString
	TypeInteger
	TypeNumber
	TypeObject
	TypeArray
)

// AdditionalKind classifies how an object treats undeclared property names.
type AdditionalKind uint8

const (
	// AdditionalAny admits undeclared names with any value.
	AdditionalAny AdditionalKind = iota
	// AdditionalForbidden rejects undeclared names (closed object).
	AdditionalForbidden
	// AdditionalSchema admits undeclared names whose values match AdditionalOf.
	AdditionalSchema
)

// Constraint names one source keyword that admission does not enforce.
// Pointer is an RFC6901 pointer into the source document.
type Constraint struct {
	Pointer string
	Keyword string
}

// Property is one declared object property.
type Property struct {
	Name string
	Node NodeID
}

// Node is one normalized schema location. Nodes are immutable after
// normalization and shared across connections by document digest.
type Node struct {
	Pointer      string
	Types        TypeSet
	Properties   []Property // sorted by Name, unique
	Required     []string   // sorted, unique
	Additional   AdditionalKind
	AdditionalOf NodeID // valid when Additional == AdditionalSchema
	Items        NodeID // 0 = items unconstrained
	AllOf        []NodeID
	AnyOf        []NodeID
	OneOf        []NodeID
	Ref          NodeID // resolved local $ref target
	Enum         []resourcev2.Value
	Const        *resourcev2.Value
	Format       string
	// Sensitive marks annotations that forbid host public-scalar projection.
	// This is projection policy, not a resource admission constraint.
	Sensitive bool `json:"-"`

	Minimum          *big.Rat
	Maximum          *big.Rat
	ExclusiveMinimum bool
	ExclusiveMaximum bool
	MultipleOf       *big.Rat

	MinLength     *uint32
	MaxLength     *uint32
	MinItems      *uint32
	MaxItems      *uint32
	MinProperties *uint32
	MaxProperties *uint32

	Pattern     *regexp.Regexp
	UniqueItems bool
	Title       string
	Description string
	// Unvalidated lists constraints present on this node that admission does
	// not enforce.
	Unvalidated []Constraint
}

// Document is one immutable normalized schema document. It is shared by every
// snapshot whose binding carries byte-identical bytes under the same dialect.
// Only the build-once caches below change after normalization.
type Document struct {
	Digest  [32]byte // sha256("omniview.schema-doc.v1\x00" + dialect + "\x00" + raw bytes)
	Dialect string
	Nodes   []Node          // index = NodeID; Nodes[0] unused
	raw     json.RawMessage // immutable exact bytes; already included in retainedBytes

	pointers map[string]NodeID

	// store owns the document's retention accounting. It is set before the
	// document is published and never changes.
	store *store
	// retainedBytes is guarded by store.mu (see addRetainedBytes).
	retainedBytes int64
	// maxDocumentBytes is the policy MaxDocumentBytes the document was
	// normalized under; it also bounds the rendered editor JSON (editor.go).
	maxDocumentBytes int

	// views holds lazily built branch views, one slot per union node
	// (branchview.go). Admission and CEL never create views.
	views branchViews
	// editorJSON caches the rendered draft-07 editor document (editor.go).
	// Rendered bytes are added through addRetainedBytes.
	editorJSON documentCache
	// celProvider caches the celtypes provider (see LoadCELProvider).
	celProvider documentCache
}

// RawJSON returns the immutable exact schema bytes held by this document.
func (d *Document) RawJSON() json.RawMessage { return d.raw }

// Lookup returns the node normalized at an RFC6901 pointer (percent-decoded,
// without the leading "#"; "" is the document root).
func (d *Document) Lookup(pointer string) (NodeID, bool) {
	id, ok := d.pointers[pointer]
	return id, ok
}

// LoadCELProvider is the resourcecatalog/celtypes hook: it builds the
// document's CEL type provider at most once and returns the same value for
// the document's lifetime. A successful build counts toward
// Stats().CELProviders. No other caller may use it.
func (d *Document) LoadCELProvider(build func() (any, error)) (any, error) {
	return d.celProvider.load(build)
}

// documentCache is a build-once slot whose value lives exactly as long as its
// Document.
type documentCache struct {
	mu       sync.Mutex
	complete bool
	built    atomic.Bool
	value    any
	err      error
}

func (c *documentCache) load(build func() (any, error)) (any, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.complete {
		c.value, c.err = build()
		var capacity *capacityError
		c.complete = !errors.As(c.err, &capacity)
		if c.err == nil {
			c.built.Store(true)
		}
	}
	return c.value, c.err
}

// branchViews maps union nodes to build-once view slots. The slot count is
// bounded by the number of union nodes in the document.
type branchViews struct {
	mu    sync.Mutex
	slots map[NodeID]*branchViewCache
}

// slot returns the build-once slot of one union node, creating it on first use.
func (v *branchViews) slot(node NodeID) *branchViewCache {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.slots == nil {
		v.slots = map[NodeID]*branchViewCache{}
	}
	s, ok := v.slots[node]
	if !ok {
		s = &branchViewCache{}
		v.slots[node] = s
	}
	return s
}

// built counts successfully built views.
func (v *branchViews) built() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	n := 0
	for _, s := range v.slots {
		if s.built.Load() {
			n++
		}
	}
	return n
}

// reachableUnvalidated returns the unvalidated constraints of every node
// reachable from root, sorted by (Pointer, Keyword) and deduplicated.
func (d *Document) reachableUnvalidated(root NodeID) []Constraint {
	seen := map[NodeID]struct{}{root: {}}
	stack := []NodeID{root}
	var out []Constraint
	push := func(id NodeID) {
		if id == 0 {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		stack = append(stack, id)
	}
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		n := &d.Nodes[id]
		out = append(out, n.Unvalidated...)
		for _, p := range n.Properties {
			push(p.Node)
		}
		push(n.AdditionalOf)
		push(n.Items)
		push(n.Ref)
		for _, group := range [][]NodeID{n.AllOf, n.AnyOf, n.OneOf} {
			for _, b := range group {
				push(b)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Pointer != out[j].Pointer {
			return out[i].Pointer < out[j].Pointer
		}
		return out[i].Keyword < out[j].Keyword
	})
	unique := out[:0]
	for i, c := range out {
		if i == 0 || c != out[i-1] {
			unique = append(unique, c)
		}
	}
	if len(unique) == 0 {
		return nil
	}
	return unique
}
