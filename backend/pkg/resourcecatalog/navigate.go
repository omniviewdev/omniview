package resourcecatalog

import (
	"context"
	"slices"
	"sort"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Path segment kinds.
const (
	SegmentField    = "field"
	SegmentMapValue = "mapValue"
	SegmentItem     = "item"
)

// FieldInfo attribute values.
const (
	PresenceRequired = "required"
	PresenceOptional = "optional"
	PresenceUnknown  = "unknown"

	NullableYes     = "yes"
	NullableNo      = "no"
	NullableUnknown = "unknown"

	ApplicabilityUnconditional = "unconditional"
	ApplicabilityConditional   = "conditional"

	CELCheckingStatic  = "static"
	CELCheckingPartial = "partial"
	CELCheckingDynamic = "dynamic"

	NativeFilterUnsupported = "unsupported"

	TruncatedFields = "fields"
	TruncatedVisits = "visits"
)

// PathSegment is one navigation step from the schema root.
type PathSegment struct {
	Kind string // "field"|"mapValue"|"item"
	Name string `json:",omitempty"`
}

// BranchCondition names the union branch that makes a field applicable.
type BranchCondition struct {
	Pointer    string
	Branch     int
	Combinator string // "anyOf"|"oneOf"
}

// FieldInfo describes one child of the navigated position.
type FieldInfo struct {
	Segment       PathSegment
	Types         []string // sorted; empty = any
	Format        string
	Title         string
	Description   string
	Enum          []resourcev2.Value // first MaxEnumValues
	Presence      string             // "required"|"optional"|"unknown"
	Nullable      string             // "yes"|"no"|"unknown"
	Applicability string             // "unconditional"|"conditional"
	Conditions    []BranchCondition
	CELChecking   string // "static"|"partial"|"dynamic"
	HasChildren   bool
	NativeFilter  string // always "unsupported" in P07
}

// Navigation lists the next tier of fields below a path.
type Navigation struct {
	Fields           []FieldInfo
	Truncated        bool
	TruncationReason string // "fields"|"visits"
}

// Navigate walks path from the schema root and lists the children of the
// reached position. A nil schema (absent) returns an empty Navigation; the
// caller reports the type as dynamic. Navigate builds branch views but
// otherwise never writes to the Document.
func Navigate(ctx context.Context, schema *Schema, path []PathSegment, policy Policy) (Navigation, error) {
	if schema == nil {
		return Navigation{}, nil
	}
	nav := navigator{ctx: ctx, doc: schema.Document, policy: policy}
	positions := []position{{node: schema.Root, dynamic: celChecking(schema.Document, schema.Root) == CELCheckingDynamic}}
	for index, segment := range path {
		if ctx.Err() != nil {
			return Navigation{}, contextError(ctx)
		}
		next, err := nav.step(positions, segment)
		if err != nil {
			return Navigation{}, err
		}
		if nav.exhausted {
			return Navigation{Truncated: true, TruncationReason: TruncatedVisits}, nil
		}
		if len(next) == 0 {
			return Navigation{}, invalidf("schema path does not resolve at segment %d (%s %q)", index, segment.Kind, segment.Name)
		}
		positions = next
	}
	if ctx.Err() != nil {
		return Navigation{}, contextError(ctx)
	}
	return nav.list(positions), nil
}

// position is one member of the navigated position set: a node, the branch
// conditions accumulated on the way to it, and whether CEL checking of the
// path is already dynamic.
type position struct {
	node       NodeID
	conditions []BranchCondition
	dynamic    bool
}

type navigator struct {
	ctx       context.Context
	doc       *Document
	policy    Policy
	visits    int
	exhausted bool
}

// visit charges one node expansion or branch-view property declaration.
// It fails once the budget is spent.
func (n *navigator) visit() bool {
	if n.visits >= n.policy.MaxNavigationVisits {
		n.exhausted = true
		return false
	}
	n.visits++
	return true
}

// expansion is everything a position contributes: the nodes reached through
// Ref and allOf without a condition, and the union views met on the way.
type expansion struct {
	plain []NodeID
	views []viewUse
}

type viewUse struct {
	view   *BranchView
	prefix []BranchCondition
}

func (n *navigator) expand(p position) expansion {
	var out expansion
	seen := map[NodeID]bool{}
	var walk func(NodeID)
	walk = func(id NodeID) {
		if id == 0 || seen[id] || n.exhausted || !n.visit() {
			return
		}
		seen[id] = true
		out.plain = append(out.plain, id)
		node := &n.doc.Nodes[id]
		if isUnion(node) {
			view := n.doc.branchView(id, n.visit)
			if view == nil {
				return
			}
			out.views = append(out.views, viewUse{view: view, prefix: p.conditions})
		}
		walk(node.Ref)
		for _, branch := range node.AllOf {
			walk(branch)
		}
	}
	walk(p.node)
	return out
}

// declaration is one node contributing a child entry.
type declaration struct {
	node       NodeID
	conditions []BranchCondition
	plain      bool // declared without crossing a union at this tier
	required   bool
	dynamic    bool // CEL checking of the parent path is dynamic
}

func joinConditions(prefix, local []BranchCondition) []BranchCondition {
	if len(local) == 0 {
		return prefix
	}
	return append(slices.Clip(prefix), local...)
}

// fieldDeclarations returns the declarations of name contributed by one
// position: own and allOf properties first, then union branch properties.
func (n *navigator) fieldDeclarations(p position, exp expansion, name string) []declaration {
	required := false
	for _, id := range exp.plain {
		if slices.Contains(n.doc.Nodes[id].Required, name) {
			required = true
		}
	}
	var out []declaration
	for _, id := range exp.plain {
		if child, ok := propertyNode(&n.doc.Nodes[id], name); ok {
			out = append(out, declaration{node: child, conditions: p.conditions, plain: true, required: required, dynamic: p.dynamic})
		}
	}
	for _, use := range exp.views {
		for _, field := range use.view.fields[name] {
			out = append(out, declaration{
				node:       field.node,
				conditions: joinConditions(use.prefix, field.conditions),
				required:   required || field.required,
				dynamic:    true,
			})
		}
	}
	return out
}

func propertyNode(n *Node, name string) (NodeID, bool) {
	i, ok := slices.BinarySearchFunc(n.Properties, name, func(p Property, name string) int { return strings.Compare(p.Name, name) })
	if !ok {
		return 0, false
	}
	return n.Properties[i].Node, true
}

// edgeDeclarations follows the additional-properties (mapValue) or items
// edge of every contributing node.
func (n *navigator) edgeDeclarations(p position, exp expansion, kind string, mapsOnly bool) []declaration {
	edge := func(node *Node) NodeID {
		if kind == SegmentItem {
			return node.Items
		}
		if node.Additional != AdditionalSchema || (mapsOnly && len(node.Properties) > 0) {
			return 0
		}
		return node.AdditionalOf
	}
	var out []declaration
	for _, id := range exp.plain {
		if child := edge(&n.doc.Nodes[id]); child != 0 {
			out = append(out, declaration{node: child, conditions: p.conditions, plain: true, dynamic: p.dynamic})
		}
	}
	for _, use := range exp.views {
		for _, m := range use.view.members {
			if child := edge(&n.doc.Nodes[m.node]); child != 0 {
				out = append(out, declaration{node: child, conditions: joinConditions(use.prefix, m.conditions), dynamic: true})
			}
		}
	}
	return out
}

func (n *navigator) step(positions []position, segment PathSegment) ([]position, error) {
	var decls []declaration
	for _, p := range positions {
		exp := n.expand(p)
		if n.exhausted {
			return nil, nil
		}
		switch segment.Kind {
		case SegmentField:
			found := n.fieldDeclarations(p, exp, segment.Name)
			if len(found) == 0 {
				found = n.edgeDeclarations(p, exp, SegmentMapValue, false)
			}
			decls = append(decls, found...)
		case SegmentMapValue:
			decls = append(decls, n.edgeDeclarations(p, exp, SegmentMapValue, false)...)
		case SegmentItem:
			decls = append(decls, n.edgeDeclarations(p, exp, SegmentItem, false)...)
		default:
			return nil, invalidf("schema path segment kind %q is not field, mapValue or item", segment.Kind)
		}
	}
	next := make([]position, 0, len(decls))
	for _, decl := range decls {
		p := position{
			node:       decl.node,
			conditions: decl.conditions,
			dynamic:    decl.dynamic || len(decls) > 1 || celChecking(n.doc, decl.node) == CELCheckingDynamic,
		}
		if !slices.ContainsFunc(next, func(q position) bool {
			return q.node == p.node && slices.Equal(q.conditions, p.conditions)
		}) {
			next = append(next, p)
		}
	}
	return next, nil
}

// fieldGroup accumulates the declarations of one listed entry.
type fieldGroup struct {
	segment PathSegment
	decls   []declaration
}

func (n *navigator) list(positions []position) Navigation {
	byName := map[string]*fieldGroup{}
	var mapValues, items fieldGroup
	mapValues.segment = PathSegment{Kind: SegmentMapValue}
	items.segment = PathSegment{Kind: SegmentItem}
	for _, p := range positions {
		exp := n.expand(p)
		names := map[string]bool{}
		for _, id := range exp.plain {
			for _, prop := range n.doc.Nodes[id].Properties {
				names[prop.Name] = true
			}
		}
		for _, use := range exp.views {
			for _, name := range use.view.names {
				names[name] = true
			}
		}
		for name := range names {
			group, ok := byName[name]
			if !ok {
				group = &fieldGroup{segment: PathSegment{Kind: SegmentField, Name: name}}
				byName[name] = group
			}
			group.decls = append(group.decls, n.fieldDeclarations(p, exp, name)...)
		}
		mapValues.decls = append(mapValues.decls, n.edgeDeclarations(p, exp, SegmentMapValue, true)...)
		items.decls = append(items.decls, n.edgeDeclarations(p, exp, SegmentItem, false)...)
		if n.exhausted {
			break
		}
	}

	var own, branch []string
	for name, group := range byName {
		if slices.ContainsFunc(group.decls, func(d declaration) bool { return d.plain }) {
			own = append(own, name)
		} else {
			branch = append(branch, name)
		}
	}
	sort.Strings(own)
	sort.Strings(branch)

	var nav Navigation
	add := func(group *fieldGroup) {
		if len(group.decls) == 0 {
			return
		}
		if len(nav.Fields) >= n.policy.MaxNavigationFields {
			nav.Truncated, nav.TruncationReason = true, TruncatedFields
			return
		}
		nav.Fields = append(nav.Fields, n.fieldInfo(group))
	}
	for _, name := range own {
		add(byName[name])
	}
	for _, name := range branch {
		add(byName[name])
	}
	add(&mapValues)
	add(&items)
	if n.exhausted {
		nav.Truncated, nav.TruncationReason = true, TruncatedVisits
	}
	return nav
}

// fieldInfo merges the declarations of one entry. When the name is declared
// outside any union at this tier, those declarations are authoritative and
// branch redeclarations do not make it conditional.
func (n *navigator) fieldInfo(group *fieldGroup) FieldInfo {
	decls := group.decls
	if plain := slices.DeleteFunc(slices.Clone(decls), func(d declaration) bool { return !d.plain }); len(plain) > 0 {
		decls = plain
	}
	info := FieldInfo{Segment: group.segment, NativeFilter: NativeFilterUnsupported}

	var types TypeSet
	anyType := false
	for _, d := range decls {
		t := effectiveTypes(n.doc, d.node)
		if t == 0 {
			anyType = true
		}
		types |= t
	}
	if !anyType {
		info.Types = typeNames(types)
	}
	switch {
	case anyType:
		info.Nullable = NullableUnknown
	case types&TypeNull != 0:
		info.Nullable = NullableYes
	default:
		info.Nullable = NullableNo
	}

	first := annotationsOf(n.doc, decls[0].node, n.policy.MaxEnumValues)
	shared := first
	for _, d := range decls[1:] {
		other := annotationsOf(n.doc, d.node, n.policy.MaxEnumValues)
		if other.format != shared.format {
			shared.format = ""
		}
		if other.title != shared.title {
			shared.title = ""
		}
		if other.description != shared.description {
			shared.description = ""
		}
		if !slices.EqualFunc(other.enum, shared.enum, valuesEqual) {
			shared.enum = nil
		}
	}
	info.Format, info.Title, info.Description, info.Enum = shared.format, shared.title, shared.description, shared.enum

	switch {
	case group.segment.Kind != SegmentField || anyType:
		info.Presence = PresenceUnknown
	case !slices.ContainsFunc(decls, func(d declaration) bool { return !d.required }):
		info.Presence = PresenceRequired
	default:
		info.Presence = PresenceOptional
	}

	info.Conditions = mergedConditions(decls)
	info.Applicability = ApplicabilityUnconditional
	if len(info.Conditions) > 0 {
		info.Applicability = ApplicabilityConditional
	}

	distinct := map[NodeID]bool{}
	dynamic := false
	for _, d := range decls {
		distinct[d.node] = true
		dynamic = dynamic || d.dynamic
		info.HasChildren = info.HasChildren || hasChildren(n.doc, d.node)
	}
	if dynamic || len(distinct) > 1 || len(info.Conditions) > 0 {
		info.CELChecking = CELCheckingDynamic
	} else {
		info.CELChecking = celChecking(n.doc, decls[0].node)
	}
	return info
}

// mergedConditions returns nil when any declaration is unconditional,
// otherwise the union of all conditions sorted by (Pointer, Branch).
func mergedConditions(decls []declaration) []BranchCondition {
	var out []BranchCondition
	for _, d := range decls {
		if len(d.conditions) == 0 {
			return nil
		}
		out = append(out, d.conditions...)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Pointer != out[j].Pointer {
			return out[i].Pointer < out[j].Pointer
		}
		if out[i].Branch != out[j].Branch {
			return out[i].Branch < out[j].Branch
		}
		return out[i].Combinator < out[j].Combinator
	})
	return slices.Compact(out)
}

// effectiveNode follows Ref and single-branch allOf links of nodes that add
// no type or properties of their own.
func effectiveNode(d *Document, id NodeID) NodeID {
	for range len(d.Nodes) {
		n := &d.Nodes[id]
		if n.Types != 0 || len(n.Properties) > 0 || isUnion(n) {
			return id
		}
		switch {
		case n.Ref != 0 && len(n.AllOf) == 0:
			id = n.Ref
		case n.Ref == 0 && len(n.AllOf) == 1:
			id = n.AllOf[0]
		default:
			return id
		}
	}
	return id
}

func effectiveTypes(d *Document, id NodeID) TypeSet {
	return d.Nodes[effectiveNode(d, id)].Types
}

type annotations struct {
	format, title, description string
	enum                       []resourcev2.Value
}

// annotationsOf takes each annotation from the first node that sets it on
// the Ref/allOf chain from id to its effective node.
func annotationsOf(d *Document, id NodeID, maxEnum int) annotations {
	var a annotations
	target := effectiveNode(d, id)
	for range len(d.Nodes) {
		n := &d.Nodes[id]
		if a.format == "" {
			a.format = n.Format
		}
		if a.title == "" {
			a.title = n.Title
		}
		if a.description == "" {
			a.description = n.Description
		}
		if a.enum == nil && len(n.Enum) > 0 {
			a.enum = n.Enum[:min(len(n.Enum), maxEnum)]
		}
		if id == target {
			break
		}
		if n.Ref != 0 {
			id = n.Ref
		} else {
			id = n.AllOf[0]
		}
	}
	return a
}

// hasChildren reports whether navigation below id can list anything.
func hasChildren(d *Document, id NodeID) bool {
	seen := map[NodeID]bool{}
	var walk func(NodeID) bool
	walk = func(id NodeID) bool {
		if id == 0 || seen[id] {
			return false
		}
		seen[id] = true
		n := &d.Nodes[id]
		if len(n.Properties) > 0 || n.Additional == AdditionalSchema || n.Items != 0 {
			return true
		}
		for _, next := range append(append(append([]NodeID{n.Ref}, n.AllOf...), n.AnyOf...), n.OneOf...) {
			if walk(next) {
				return true
			}
		}
		return false
	}
	return walk(id)
}

var typeNameOrder = []struct {
	bit  TypeSet
	name string
}{ // alphabetical
	{TypeArray, "array"},
	{TypeBoolean, "boolean"},
	{TypeInteger, "integer"},
	{TypeNull, "null"},
	{TypeNumber, "number"},
	{TypeObject, "object"},
	{TypeString, "string"},
}

// typeNames returns the sorted JSON type names of a set; nil for any.
func typeNames(types TypeSet) []string {
	var out []string
	for _, t := range typeNameOrder {
		if types&t.bit != 0 {
			out = append(out, t.name)
		}
	}
	return out
}

// celChecking classifies how the CEL checker types a value at node id under
// mapping omniview.schema-cel.v1 (spec §8).
func celChecking(d *Document, id NodeID) string {
	id, ok := CELShape(d, id)
	if !ok {
		return CELCheckingDynamic
	}
	n := &d.Nodes[id]
	switch n.Types {
	case TypeObject:
		switch {
		case n.Additional == AdditionalForbidden:
			return CELCheckingStatic
		case len(n.Properties) > 0:
			return CELCheckingPartial
		case n.Additional == AdditionalSchema:
			return CELCheckingStatic
		default:
			return CELCheckingPartial
		}
	case TypeArray:
		if n.Items != 0 {
			return CELCheckingStatic
		}
		return CELCheckingPartial
	case TypeString:
		if n.Format == "date-time" {
			return CELCheckingPartial
		}
		return CELCheckingStatic
	case TypeInteger:
		switch n.Format {
		case "int32", "int64", "uint32", "uint64":
			return CELCheckingStatic
		}
		return CELCheckingPartial
	case TypeNumber:
		return CELCheckingPartial
	case TypeBoolean:
		return CELCheckingStatic
	default:
		// any, null alone, nullable or multi-type sets.
		return CELCheckingDynamic
	}
}

// CELShape resolves the structural node used by the CEL checker. Annotation-only
// allOf branches are ignored; multiple shapes, unions and cycles are dynamic.
func CELShape(d *Document, id NodeID) (NodeID, bool) {
	for range len(d.Nodes) {
		if id == 0 || int(id) >= len(d.Nodes) {
			return 0, false
		}
		n := &d.Nodes[id]
		if isUnion(n) {
			return 0, false
		}
		var shape NodeID
		count := 0
		if celHasOwnShape(n) {
			shape, count = id, 1
		}
		if n.Ref != 0 {
			shape, count = n.Ref, count+1
		}
		for _, branch := range n.AllOf {
			b := &d.Nodes[branch]
			if celHasOwnShape(b) || b.Ref != 0 || len(b.AllOf) > 0 || isUnion(b) {
				shape, count = branch, count+1
			}
		}
		if count != 1 {
			return 0, false
		}
		if shape == id {
			return id, true
		}
		id = shape
	}
	return 0, false
}

func celHasOwnShape(n *Node) bool {
	return n.Types != 0 || len(n.Properties) > 0 || n.Items != 0 || n.Additional != AdditionalAny
}
