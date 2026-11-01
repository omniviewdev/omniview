package resourcecatalog

import (
	"crypto/sha256"
	"math/big"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// nodeOverheadBytes is the fixed per-node retention charge (spec §2.3).
const nodeOverheadBytes = 128

// documentDigest is the content address of one normalized document.
func documentDigest(dialect string, raw []byte) [32]byte {
	h := sha256.New()
	h.Write([]byte("omniview.schema-doc.v1\x00"))
	h.Write([]byte(dialect))
	h.Write([]byte{0})
	h.Write(raw)
	var digest [32]byte
	h.Sum(digest[:0])
	return digest
}

// Keyword classes of spec §3.2 that carry no structural or enforced meaning.
var (
	annotationKeywords = map[string]bool{
		"default": true, "examples": true, "readOnly": true, "writeOnly": true,
		"deprecated": true, "$comment": true, "$schema": true, "xml": true,
		"externalDocs": true, "example": true,
		// Anchor declarations only matter when a $ref targets them; such
		// refs are recorded as unvalidated "$ref" constraints.
		"$anchor": true, "$dynamicAnchor": true, "$recursiveAnchor": true,
	}
	kubernetesAnnotationKeywords = map[string]bool{
		"x-kubernetes-embedded-resource":  true,
		"x-kubernetes-list-map-keys":      true,
		"x-kubernetes-map-type":           true,
		"x-kubernetes-group-version-kind": true,
	}
	unionKeywords = []string{"allOf", "anyOf", "oneOf"}
)

// normalizer builds one Document. It first scans every schema-valued source
// location (budgets for depth and definitions, ref target set), then
// normalizes roots and their reachable locations through a FIFO work queue so
// node numbering is deterministic and recursion never follows $ref chains.
type normalizer struct {
	rules     dialectRules
	policy    Policy
	locations map[string]any // schema-valued source locations by pointer
	doc       *Document
	queue     []pendingNode
	defs      int
}

type pendingNode struct {
	id      NodeID
	pointer string
	raw     any
}

// normalizeDocument parses and normalizes raw bytes under dialect and policy.
func normalizeDocument(dialect string, raw []byte, policy Policy) (*Document, error) {
	rules, err := dialectRulesFor(dialect)
	if err != nil {
		return nil, err
	}
	if len(raw) > policy.MaxDocumentBytes {
		return nil, limitf("MaxDocumentBytes", int64(policy.MaxDocumentBytes), "")
	}
	tree, err := decodeDocument(raw)
	if err != nil {
		return nil, err
	}
	n := &normalizer{
		rules:     rules,
		policy:    policy,
		locations: map[string]any{},
		doc: &Document{
			Digest:           documentDigest(dialect, raw),
			Dialect:          dialect,
			Nodes:            make([]Node, 1),
			pointers:         map[string]NodeID{},
			maxDocumentBytes: policy.MaxDocumentBytes,
		},
	}
	roots, err := n.scanDocument(tree)
	if err != nil {
		return nil, err
	}
	for _, pointer := range roots {
		if _, err := n.nodeAt(pointer); err != nil {
			return nil, err
		}
	}
	for i := 0; i < len(n.queue); i++ {
		p := n.queue[i]
		node, err := n.normalize(p.pointer, p.raw)
		if err != nil {
			return nil, err
		}
		n.doc.Nodes[p.id] = node
	}
	n.queue = nil
	if err := n.checkLinks(); err != nil {
		return nil, err
	}
	n.doc.retainedBytes = retainedSize(n.doc, len(raw))
	return n.doc, nil
}

// scanDocument validates the document envelope and returns the
// normalization roots in deterministic order.
func (n *normalizer) scanDocument(tree any) ([]string, error) {
	if n.rules.openAPI {
		root, ok := tree.(map[string]any)
		if !ok {
			return nil, invalidf("OpenAPI schema document must be an object")
		}
		components, ok := root["components"]
		if !ok {
			return nil, nil
		}
		componentsObject, ok := components.(map[string]any)
		if !ok {
			return nil, invalidf("OpenAPI components at /components must be an object")
		}
		schemas, ok := componentsObject["schemas"]
		if !ok {
			return nil, nil
		}
		if err := n.scanDefinitions("/components/schemas", schemas, 1); err != nil {
			return nil, err
		}
		return definitionRoots("/components/schemas", schemas), nil
	}
	if root, ok := tree.(map[string]any); ok {
		if declared, ok := root["$schema"]; ok {
			s, ok := declared.(string)
			if !ok {
				return nil, invalidf("schema keyword \"$schema\" at the document root must be a string")
			}
			if !sameSchemaDialect(s, n.rules.dialect) {
				return nil, invalidf("schema document dialect does not match binding")
			}
		}
	}
	if err := n.scan("", tree, 0); err != nil {
		return nil, err
	}
	roots := []string{""}
	if root, ok := tree.(map[string]any); ok {
		if defs, ok := root[n.rules.rootDefinitions]; ok {
			roots = append(roots, definitionRoots(childPointer("", n.rules.rootDefinitions), defs)...)
		}
	}
	return roots, nil
}

func definitionRoots(container string, raw any) []string {
	entries, _ := raw.(map[string]any)
	names := sortedKeys(entries)
	roots := make([]string, len(names))
	for i, name := range names {
		roots[i] = childPointer(container, name)
	}
	return roots
}

func (n *normalizer) scanDefinitions(container string, raw any, depth int) error {
	entries, ok := raw.(map[string]any)
	if !ok {
		return invalidf("schema definitions at %s must be an object", container)
	}
	n.defs += len(entries)
	if n.defs > n.policy.MaxDefinitions {
		return limitf("MaxDefinitions", int64(n.policy.MaxDefinitions), container)
	}
	for _, name := range sortedKeys(entries) {
		if err := n.scan(childPointer(container, name), entries[name], depth); err != nil {
			return err
		}
	}
	return nil
}

// scan records one schema-valued location and descends into its structural
// children. It enforces MaxDepth, MaxDefinitions and MaxUnionBranches and the
// shape of the structural keywords.
func (n *normalizer) scan(pointer string, raw any, depth int) error {
	if depth > n.policy.MaxDepth {
		return limitf("MaxDepth", int64(n.policy.MaxDepth), pointer)
	}
	n.locations[pointer] = raw
	if _, ok := raw.(bool); ok {
		return nil
	}
	m, ok := raw.(map[string]any)
	if !ok {
		return invalidf("schema at %q must be an object or a boolean", pointer)
	}
	// Definition containers hold ref targets, not constraints, so they are
	// scanned even next to a $ref whose siblings the dialect ignores.
	if !n.rules.openAPI {
		for _, container := range []string{"$defs", "definitions"} {
			if defs, ok := m[container]; ok {
				if err := n.scanDefinitions(childPointer(pointer, container), defs, depth+1); err != nil {
					return err
				}
			}
		}
	}
	if props, ok := m["properties"]; ok {
		entries, ok := props.(map[string]any)
		if !ok {
			return invalidf("schema keyword \"properties\" at %q must be an object", pointer)
		}
		for _, name := range sortedKeys(entries) {
			if err := n.scan(childPointer(pointer, "properties", name), entries[name], depth+1); err != nil {
				return err
			}
		}
	}
	if additional, ok := m["additionalProperties"]; ok {
		switch additional.(type) {
		case bool:
		case map[string]any:
			if err := n.scan(childPointer(pointer, "additionalProperties"), additional, depth+1); err != nil {
				return err
			}
		default:
			return invalidf("schema keyword \"additionalProperties\" at %q must be a boolean or a schema", pointer)
		}
	}
	if items, ok := m["items"]; ok {
		switch items.(type) {
		case bool, map[string]any:
			if err := n.scan(childPointer(pointer, "items"), items, depth+1); err != nil {
				return err
			}
		case []any: // array form: unvalidated, never a structural location
		default:
			return invalidf("schema keyword \"items\" at %q must be a schema or an array", pointer)
		}
	}
	for _, keyword := range unionKeywords {
		raw, ok := m[keyword]
		if !ok {
			continue
		}
		branches, ok := raw.([]any)
		if !ok || len(branches) == 0 {
			return invalidf("schema keyword %q at %q must be a non-empty array", keyword, pointer)
		}
		if len(branches) > n.policy.MaxUnionBranches {
			return limitf("MaxUnionBranches", int64(n.policy.MaxUnionBranches), childPointer(pointer, keyword))
		}
		for i, branch := range branches {
			if err := n.scan(childPointer(pointer, keyword, strconv.Itoa(i)), branch, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

// nodeAt returns the node for a scanned location, allocating and queueing it
// on first use.
func (n *normalizer) nodeAt(pointer string) (NodeID, error) {
	if id, ok := n.doc.pointers[pointer]; ok {
		return id, nil
	}
	raw, ok := n.locations[pointer]
	if !ok {
		return 0, invalidf("schema reference %q does not resolve to a schema", "#"+pointer)
	}
	id, err := n.allocate(pointer)
	if err != nil {
		return 0, err
	}
	n.queue = append(n.queue, pendingNode{id: id, pointer: pointer, raw: raw})
	return id, nil
}

func (n *normalizer) allocate(pointer string) (NodeID, error) {
	if len(n.doc.Nodes)-1 >= n.policy.MaxDocumentNodes {
		return 0, limitf("MaxDocumentNodes", int64(n.policy.MaxDocumentNodes), pointer)
	}
	id := NodeID(len(n.doc.Nodes))
	n.doc.Nodes = append(n.doc.Nodes, Node{Pointer: pointer})
	n.doc.pointers[pointer] = id
	return id, nil
}

// synthesize allocates a node that has no source location of its own.
func (n *normalizer) synthesize(pointer string, types TypeSet) (NodeID, error) {
	id, err := n.allocate(pointer)
	if err != nil {
		return 0, err
	}
	n.doc.Nodes[id].Types = types
	return id, nil
}

// nodeBuilder accumulates one node. Children are allocated through the
// normalizer, so the node is written back only after it is complete.
type nodeBuilder struct {
	n       *normalizer
	node    Node
	pointer string
}

func (b *nodeBuilder) unvalidated(keyword string) {
	b.node.Unvalidated = append(b.node.Unvalidated, Constraint{Pointer: b.pointer, Keyword: keyword})
}

func (n *normalizer) normalize(pointer string, raw any) (Node, error) {
	b := &nodeBuilder{n: n, node: Node{Pointer: pointer}, pointer: pointer}
	if accept, ok := raw.(bool); ok {
		if !accept {
			b.unvalidated("false")
		}
		return b.node, nil
	}
	m := raw.(map[string]any)
	if ref, ok := m["$ref"]; ok {
		if err := b.ref(ref); err != nil {
			return Node{}, err
		}
		if b.node.Ref == 0 || !n.rules.keepsRefSiblings {
			return b.node, nil
		}
	}
	if err := b.keywords(m); err != nil {
		return Node{}, err
	}
	return b.node, nil
}

func (b *nodeBuilder) ref(raw any) error {
	ref, ok := raw.(string)
	if !ok {
		return invalidf("schema keyword \"$ref\" at %q must be a string", b.pointer)
	}
	pointer, local := fragmentPointer(ref)
	if !local {
		// External, relative-URL or anchor references are never fetched.
		b.unvalidated("$ref")
		return nil
	}
	if _, ok := b.n.locations[pointer]; !ok {
		return invalidf("schema reference %q at %q does not resolve to a schema", ref, b.pointer)
	}
	id, err := b.n.nodeAt(pointer)
	if err != nil {
		return err
	}
	b.node.Ref = id
	return nil
}

// keywords applies the spec §3.2 keyword table to one schema object.
func (b *nodeBuilder) keywords(m map[string]any) error {
	rules := b.n.rules
	preserveUnknown := m["x-kubernetes-preserve-unknown-fields"] == true
	intOrString := ""
	if m["x-kubernetes-int-or-string"] == true {
		intOrString = "x-kubernetes-int-or-string"
	} else if rules.openAPI && m["type"] == "string" && m["format"] == "int-or-string" {
		intOrString = "format"
	}
	var nullable, hasType bool
	var exclusiveMin, exclusiveMax any
	for _, keyword := range sortedKeys(m) {
		value := m[keyword]
		var err error
		switch keyword {
		case "$ref", "x-kubernetes-preserve-unknown-fields", "x-kubernetes-int-or-string":
		case "type":
			hasType = true
			b.node.Types, err = parseTypes(value, b.pointer)
		case "nullable":
			if !rules.openAPI {
				b.unvalidated(keyword)
				continue
			}
			flag, ok := value.(bool)
			if !ok {
				return invalidf("schema keyword \"nullable\" at %q must be a boolean", b.pointer)
			}
			nullable = flag
		case "properties":
			err = b.properties(value.(map[string]any))
		case "required":
			b.node.Required, err = parseRequired(value, b.pointer)
		case "additionalProperties":
			if !preserveUnknown {
				err = b.additional(value)
			}
		case "items":
			if _, tuple := m["prefixItems"]; tuple {
				// Tuple positions and their tail cannot be enforced as
				// homogeneous items; prefixItems records the unsupported constraint.
				continue
			}
			if _, ok := value.([]any); ok {
				b.unvalidated(keyword)
				continue
			}
			b.node.Items, err = b.n.nodeAt(childPointer(b.pointer, "items"))
		case "allOf":
			b.node.AllOf, err = b.branches(keyword, value)
		case "anyOf":
			b.node.AnyOf, err = b.branches(keyword, value)
		case "oneOf":
			b.node.OneOf, err = b.branches(keyword, value)
		case "enum":
			err = b.enum(value)
		case "const":
			var v resourcev2.Value
			v, err = jsonValue(value, childPointer(b.pointer, keyword))
			b.node.Const = &v
		case "format":
			s, ok := value.(string)
			if !ok {
				return invalidf("schema keyword \"format\" at %q must be a string", b.pointer)
			}
			b.node.Format = s
		case "minimum":
			b.node.Minimum, err = numberRat(value, b.pointer, keyword)
		case "maximum":
			b.node.Maximum, err = numberRat(value, b.pointer, keyword)
		case "exclusiveMinimum":
			exclusiveMin = value
		case "exclusiveMaximum":
			exclusiveMax = value
		case "multipleOf":
			b.node.MultipleOf, err = numberRat(value, b.pointer, keyword)
			if err == nil && b.node.MultipleOf.Sign() <= 0 {
				return invalidf("schema keyword \"multipleOf\" at %q must be greater than zero", b.pointer)
			}
		case "minLength":
			b.node.MinLength, err = numberUint32(value, b.pointer, keyword)
		case "maxLength":
			b.node.MaxLength, err = numberUint32(value, b.pointer, keyword)
		case "minItems":
			b.node.MinItems, err = numberUint32(value, b.pointer, keyword)
		case "maxItems":
			b.node.MaxItems, err = numberUint32(value, b.pointer, keyword)
		case "minProperties":
			b.node.MinProperties, err = numberUint32(value, b.pointer, keyword)
		case "maxProperties":
			b.node.MaxProperties, err = numberUint32(value, b.pointer, keyword)
		case "pattern":
			s, ok := value.(string)
			if !ok {
				return invalidf("schema keyword \"pattern\" at %q must be a string", b.pointer)
			}
			if re, compileErr := regexp.Compile(s); compileErr == nil {
				b.node.Pattern = re
			} else {
				b.unvalidated(keyword)
			}
		case "uniqueItems":
			flag, ok := value.(bool)
			if !ok {
				return invalidf("schema keyword \"uniqueItems\" at %q must be a boolean", b.pointer)
			}
			b.node.UniqueItems = flag
		case "title", "description":
			s, ok := value.(string)
			if !ok {
				return invalidf("schema keyword %q at %q must be a string", keyword, b.pointer)
			}
			if keyword == "title" {
				b.node.Title = s
			} else {
				b.node.Description = s
			}
		case "$id":
			if b.pointer != "" {
				b.unvalidated(keyword)
			}
		case "discriminator":
			if !rules.openAPI {
				b.unvalidated(keyword)
			}
		case "$defs", "definitions":
			if rules.openAPI {
				b.unvalidated(keyword)
			}
		case "x-kubernetes-list-type":
			if value == "set" || value == "map" {
				b.unvalidated(keyword)
			}
		case "x-kubernetes-validations", "x-kubernetes-unions":
			b.unvalidated(keyword)
		default:
			switch {
			case annotationKeywords[keyword], kubernetesAnnotationKeywords[keyword],
				strings.HasPrefix(keyword, "x-kubernetes-patch-"):
			case strings.HasPrefix(keyword, "x-"):
				// any other extension keyword is an annotation
			default:
				// not, if/then/else, dependentSchemas, patternProperties,
				// contains, unevaluated*, $dynamicRef, $recursiveRef and
				// every unknown keyword.
				b.unvalidated(keyword)
			}
		}
		if err != nil {
			return err
		}
	}
	if nullable && hasType {
		b.node.Types |= TypeNull
	}
	if err := b.exclusiveBounds(exclusiveMin, exclusiveMax); err != nil {
		return err
	}
	if preserveUnknown {
		b.node.Additional, b.node.AdditionalOf = AdditionalAny, 0
	}
	if intOrString != "" {
		return b.intOrString(intOrString)
	}
	return nil
}

func (b *nodeBuilder) properties(entries map[string]any) error {
	names := sortedKeys(entries)
	b.node.Properties = make([]Property, len(names))
	for i, name := range names {
		id, err := b.n.nodeAt(childPointer(b.pointer, "properties", name))
		if err != nil {
			return err
		}
		b.node.Properties[i] = Property{Name: name, Node: id}
	}
	return nil
}

func (b *nodeBuilder) additional(value any) error {
	switch v := value.(type) {
	case bool:
		if v {
			b.node.Additional = AdditionalAny
		} else {
			b.node.Additional = AdditionalForbidden
		}
		return nil
	default:
		id, err := b.n.nodeAt(childPointer(b.pointer, "additionalProperties"))
		if err != nil {
			return err
		}
		b.node.Additional, b.node.AdditionalOf = AdditionalSchema, id
		return nil
	}
}

func (b *nodeBuilder) branches(keyword string, value any) ([]NodeID, error) {
	raw := value.([]any)
	ids := make([]NodeID, len(raw))
	for i := range raw {
		id, err := b.n.nodeAt(childPointer(b.pointer, keyword, strconv.Itoa(i)))
		if err != nil {
			return nil, err
		}
		ids[i] = id
	}
	return ids, nil
}

func (b *nodeBuilder) enum(value any) error {
	raw, ok := value.([]any)
	if !ok || len(raw) == 0 {
		return invalidf("schema keyword \"enum\" at %q must be a non-empty array", b.pointer)
	}
	if len(raw) > b.n.policy.MaxEnumValues {
		return limitf("MaxEnumValues", int64(b.n.policy.MaxEnumValues), childPointer(b.pointer, "enum"))
	}
	b.node.Enum = make([]resourcev2.Value, len(raw))
	for i, item := range raw {
		v, err := jsonValue(item, childPointer(b.pointer, "enum", strconv.Itoa(i)))
		if err != nil {
			return err
		}
		b.node.Enum[i] = v
	}
	return nil
}

// exclusiveBounds applies boolean (OpenAPI) or numeric (JSON Schema)
// exclusive bounds; with a numeric bound and an inclusive one, the stricter
// bound wins.
func (b *nodeBuilder) exclusiveBounds(minimum, maximum any) error {
	apply := func(raw any, keyword string, bound **big.Rat, exclusive *bool, stricter func(candidate, current *big.Rat) bool) error {
		if raw == nil {
			return nil
		}
		if b.n.rules.openAPI {
			flag, ok := raw.(bool)
			if !ok {
				return invalidf("schema keyword %q at %q must be a boolean", keyword, b.pointer)
			}
			*exclusive = flag && *bound != nil
			return nil
		}
		value, err := numberRat(raw, b.pointer, keyword)
		if err != nil {
			return err
		}
		if *bound == nil || stricter(value, *bound) || value.Cmp(*bound) == 0 {
			*bound, *exclusive = value, true
		}
		return nil
	}
	if err := apply(minimum, "exclusiveMinimum", &b.node.Minimum, &b.node.ExclusiveMinimum,
		func(candidate, current *big.Rat) bool { return candidate.Cmp(current) > 0 }); err != nil {
		return err
	}
	return apply(maximum, "exclusiveMaximum", &b.node.Maximum, &b.node.ExclusiveMaximum,
		func(candidate, current *big.Rat) bool { return candidate.Cmp(current) < 0 })
}

// intOrString synthesizes integer and string alternatives for the Kubernetes
// extension or OpenAPI string format convention, preserving existing unions.
func (b *nodeBuilder) intOrString(keyword string) error {
	if b.n.policy.MaxUnionBranches < 2 {
		return limitf("MaxUnionBranches", int64(b.n.policy.MaxUnionBranches), childPointer(b.pointer, keyword))
	}
	integer, err := b.n.synthesize(childPointer(b.pointer, keyword, "0"), TypeInteger)
	if err != nil {
		return err
	}
	textTypes := TypeString | (b.node.Types & TypeNull)
	text, err := b.n.synthesize(childPointer(b.pointer, keyword, "1"), textTypes)
	if err != nil {
		return err
	}
	b.node.Types = 0
	if len(b.node.AnyOf) == 0 {
		b.node.AnyOf = []NodeID{integer, text}
	} else {
		union, err := b.n.synthesize(childPointer(b.pointer, keyword), 0)
		if err != nil {
			return err
		}
		b.n.doc.Nodes[union].AnyOf = []NodeID{integer, text}
		b.node.AllOf = append(b.node.AllOf, union)
	}
	return nil
}

func parseTypes(value any, pointer string) (TypeSet, error) {
	var names []any
	switch v := value.(type) {
	case string:
		names = []any{v}
	case []any:
		if len(v) == 0 {
			return 0, invalidf("schema keyword \"type\" at %q must not be empty", pointer)
		}
		names = v
	default:
		return 0, invalidf("schema keyword \"type\" at %q must be a string or an array", pointer)
	}
	var set TypeSet
	for _, raw := range names {
		name, _ := raw.(string)
		switch name {
		case "null":
			set |= TypeNull
		case "boolean":
			set |= TypeBoolean
		case "string":
			set |= TypeString
		case "integer":
			set |= TypeInteger
		case "number":
			set |= TypeNumber
		case "object":
			set |= TypeObject
		case "array":
			set |= TypeArray
		default:
			return 0, invalidf("schema keyword \"type\" at %q names an unknown type", pointer)
		}
	}
	return set, nil
}

func parseRequired(value any, pointer string) ([]string, error) {
	raw, ok := value.([]any)
	if !ok {
		return nil, invalidf("schema keyword \"required\" at %q must be an array of strings", pointer)
	}
	names := make([]string, 0, len(raw))
	for _, item := range raw {
		name, ok := item.(string)
		if !ok {
			return nil, invalidf("schema keyword \"required\" at %q must be an array of strings", pointer)
		}
		names = append(names, name)
	}
	sort.Strings(names)
	names = slices.Compact(names)
	if len(names) == 0 {
		return nil, nil
	}
	return names, nil
}

// checkLinks rejects $ref cycles without structural descent and enforces
// MaxRefChain. Value-preserving edges ($ref and combinator branches) never
// consume the admitted value, so a cycle over them is a document error.
func (n *normalizer) checkLinks() error {
	nodes := n.doc.Nodes
	const (
		unvisited = iota
		active
		finished
	)
	state := make([]uint8, len(nodes))
	type frame struct {
		id   NodeID
		edge int
	}
	for start := 1; start < len(nodes); start++ {
		if state[start] != unvisited {
			continue
		}
		stack := []frame{{id: NodeID(start)}}
		state[start] = active
		for len(stack) > 0 {
			top := &stack[len(stack)-1]
			next, ok := valuePreservingEdge(&nodes[top.id], top.edge)
			if !ok {
				state[top.id] = finished
				stack = stack[:len(stack)-1]
				continue
			}
			top.edge++
			switch state[next] {
			case active:
				return invalidf("schema $ref cycle without structural descent at %q", nodes[next].Pointer)
			case unvisited:
				state[next] = active
				stack = append(stack, frame{id: next})
			}
		}
	}
	chain := make([]int32, len(nodes)) // cached hop count to the first non-$ref target; -1 unknown
	for i := range chain {
		chain[i] = -1
	}
	for id := 1; id < len(nodes); id++ {
		var path []NodeID
		cur := NodeID(id)
		for chain[cur] < 0 && nodes[cur].Ref != 0 {
			path = append(path, cur)
			cur = nodes[cur].Ref
		}
		if chain[cur] < 0 {
			chain[cur] = 0
		}
		hops := chain[cur]
		for i := len(path) - 1; i >= 0; i-- {
			hops++
			if int(hops) > n.policy.MaxRefChain {
				return limitf("MaxRefChain", int64(n.policy.MaxRefChain), nodes[path[i]].Pointer)
			}
			chain[path[i]] = hops
		}
	}
	return nil
}

func valuePreservingEdge(node *Node, edge int) (NodeID, bool) {
	if node.Ref != 0 {
		if edge == 0 {
			return node.Ref, true
		}
		edge--
	}
	for _, group := range [][]NodeID{node.AllOf, node.AnyOf, node.OneOf} {
		if edge < len(group) {
			return group[edge], true
		}
		edge -= len(group)
	}
	return 0, false
}

// retainedSize charges raw bytes, a fixed per-node overhead and node strings.
func retainedSize(d *Document, rawBytes int) int64 {
	size := int64(rawBytes) + int64(len(d.Nodes)-1)*nodeOverheadBytes
	for i := 1; i < len(d.Nodes); i++ {
		node := &d.Nodes[i]
		size += int64(len(node.Pointer) + len(node.Format) + len(node.Title) + len(node.Description))
		for _, p := range node.Properties {
			size += int64(len(p.Name))
		}
		for _, r := range node.Required {
			size += int64(len(r))
		}
		if node.Pattern != nil {
			size += int64(len(node.Pattern.String()))
		}
		for _, value := range node.Enum {
			size += retainedValueStrings(value)
		}
		if node.Const != nil {
			size += retainedValueStrings(*node.Const)
		}
		for _, c := range node.Unvalidated {
			size += int64(len(c.Pointer) + len(c.Keyword))
		}
	}
	return size
}

// retainedValueStrings charges strings held by a normalized enum or const.
func retainedValueStrings(value resourcev2.Value) int64 {
	size := int64(len(value.Kind) + len(value.String) + len(value.Int) + len(value.Uint) + len(value.Timestamp))
	for _, item := range value.List {
		size += retainedValueStrings(item)
	}
	for key, item := range value.Map {
		size += int64(len(key)) + retainedValueStrings(item)
	}
	return size
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
