package resourcecatalog

import (
	"slices"
	"sort"
	"sync"
	"sync/atomic"
)

// BranchView is the merged member table of one union node (a node with
// anyOf and/or oneOf). It is built once per union node, lives inside the
// immutable Document and is freed with it. Only navigation builds views;
// admission and CEL never do.
type BranchView struct {
	// members are every node reachable from the union's branches through
	// Ref, allOf and nested unions, each with the branch conditions that
	// select it (the first condition always names this union).
	members []viewMember
	// fields maps a property name to its declarations across members.
	fields map[string][]viewField
	// names are the keys of fields, sorted.
	names []string
	// cost counts member expansions and materialized property declarations.
	cost int
}

type viewMember struct {
	node       NodeID
	conditions []BranchCondition
}

// viewField is one declaration of a property inside a union branch.
// conditions is nil when the property is unconditional for the union: it is
// declared directly in every branch with the same type set.
type viewField struct {
	node       NodeID
	conditions []BranchCondition
	required   bool
}

const (
	combinatorAnyOf = "anyOf"
	combinatorOneOf = "oneOf"
)

// branchViewCache publishes at most one complete view. A budget-limited build
// leaves the slot empty so a later navigation can retry with a larger budget.
type branchViewCache struct {
	mu    sync.Mutex
	once  sync.Once
	built atomic.Bool
	view  *BranchView
}

// branchView charges each distinct node/condition expansion and each property
// declaration before allocating them. Incomplete views are never retained.
// Cached views cost the same visits as their initial build.
func (d *Document) branchView(node NodeID, visit func() bool) *BranchView {
	slot := d.views.slot(node)
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.built.Load() {
		for range slot.view.cost {
			if !visit() {
				return nil
			}
		}
		return slot.view
	}
	view := buildBranchView(d, node, visit)
	if view != nil {
		slot.once.Do(func() {
			slot.view = view
			slot.built.Store(true)
		})
	}
	return view
}

func buildBranchView(d *Document, union NodeID, visit func() bool) *BranchView {
	b := viewBuilder{
		doc: d, visit: visit, onStack: map[NodeID]bool{union: true},
		seen: map[viewMemberKey]bool{}, paths: map[viewPathKey]viewPath{},
	}
	n := &d.Nodes[union]
	branchCount := 0
	for _, group := range unionGroups(n) {
		for index, branch := range group.branches {
			branchCount++
			condition := BranchCondition{Pointer: n.Pointer, Branch: index, Combinator: group.combinator}
			b.expand(branch, viewPath{}, &condition)
			if b.exhausted {
				return nil
			}
		}
	}
	view := &BranchView{members: b.members, fields: map[string][]viewField{}, cost: len(b.members)}
	for _, m := range b.members {
		for _, p := range d.Nodes[m.node].Properties {
			if !visit() {
				return nil
			}
			view.cost++
			view.fields[p.Name] = append(view.fields[p.Name], viewField{
				node:       p.Node,
				conditions: m.conditions,
				required:   requiredUnder(d, b.members, m.conditions, p.Name),
			})
		}
	}
	for name, decls := range view.fields {
		view.names = append(view.names, name)
		if declaredInEveryBranch(d, decls, branchCount) {
			for i := range decls {
				decls[i].conditions = nil
			}
		}
	}
	sort.Strings(view.names)
	return view
}

type unionGroup struct {
	combinator string
	branches   []NodeID
}

func unionGroups(n *Node) []unionGroup {
	var groups []unionGroup
	if len(n.AnyOf) > 0 {
		groups = append(groups, unionGroup{combinatorAnyOf, n.AnyOf})
	}
	if len(n.OneOf) > 0 {
		groups = append(groups, unionGroup{combinatorOneOf, n.OneOf})
	}
	return groups
}

func isUnion(n *Node) bool { return len(n.AnyOf) > 0 || len(n.OneOf) > 0 }

// A path interns a complete sequence of conditions. Repeated references under
// that path share members; references selected by different paths stay distinct.
type viewPath struct {
	id         int
	conditions []BranchCondition
}

type viewPathKey struct {
	parent    int
	condition BranchCondition
}

type viewMemberKey struct {
	node NodeID
	path int
}

type viewBuilder struct {
	doc       *Document
	visit     func() bool
	exhausted bool
	onStack   map[NodeID]bool
	seen      map[viewMemberKey]bool
	paths     map[viewPathKey]viewPath
	members   []viewMember
}

// expand appends node and everything it contributes structurally. Cycles
// through Ref/allOf/unions are cut at the first repeat on the current path.
// Duplicate node/condition pairs cost no visits and cannot hide later branches.
func (b *viewBuilder) expand(id NodeID, path viewPath, condition *BranchCondition) {
	if id == 0 || b.onStack[id] || b.exhausted {
		return
	}
	var key viewPathKey
	knownPath := true
	if condition != nil {
		key = viewPathKey{parent: path.id, condition: *condition}
		var ok bool
		next, ok := b.paths[key]
		knownPath = ok
		if ok {
			path = next
		} else {
			path.id = len(b.paths) + 1
		}
	}
	member := viewMemberKey{node: id, path: path.id}
	if b.seen[member] {
		return
	}
	if !b.visit() {
		b.exhausted = true
		return
	}
	if !knownPath {
		path.conditions = append(slices.Clip(path.conditions), *condition)
		b.paths[key] = path
	}
	b.seen[member] = true
	b.onStack[id] = true
	defer delete(b.onStack, id)
	b.members = append(b.members, viewMember{node: id, conditions: path.conditions})
	n := &b.doc.Nodes[id]
	b.expand(n.Ref, path, nil)
	for _, branch := range n.AllOf {
		b.expand(branch, path, nil)
		if b.exhausted {
			return
		}
	}
	for _, group := range unionGroups(n) {
		for index, branch := range group.branches {
			condition := BranchCondition{Pointer: n.Pointer, Branch: index, Combinator: group.combinator}
			b.expand(branch, path, &condition)
			if b.exhausted {
				return
			}
		}
	}
}

// requiredUnder reports whether any member selected by exactly the same
// conditions lists name as required.
func requiredUnder(d *Document, members []viewMember, conditions []BranchCondition, name string) bool {
	for _, m := range members {
		if slices.Equal(m.conditions, conditions) && slices.Contains(d.Nodes[m.node].Required, name) {
			return true
		}
	}
	return false
}

// declaredInEveryBranch reports whether every top-level branch declares the
// property directly (one condition) and all declarations share one type set.
func declaredInEveryBranch(d *Document, decls []viewField, branchCount int) bool {
	branches := map[BranchCondition]bool{}
	types := effectiveTypes(d, decls[0].node)
	for _, decl := range decls {
		if len(decl.conditions) != 1 || effectiveTypes(d, decl.node) != types {
			return false
		}
		branches[decl.conditions[0]] = true
	}
	return len(branches) == branchCount
}
