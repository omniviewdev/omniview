package graph

import (
	"encoding/json"

	"github.com/tidwall/gjson"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type Indexer struct {
	graph *RelationshipGraph
	store registry.Store
}

func NewGraphIndexer(graph *RelationshipGraph, store registry.Store) *Indexer {
	return &Indexer{graph: graph, store: store}
}

func (gi *Indexer) Name() string { return "relationship-graph" }

func (gi *Indexer) OnAdd(entry registry.ResourceEntry, raw json.RawMessage) {
	gi.graph.RemoveDerivedEdges(entry.EntryKey())
	gi.extractEdges(entry, raw)
	gi.CheckLabelSelectorsForEntry(entry)
}

// OnUpdate re-derives the edges that come from this resource's data. Edges
// other resources declared about it (a Pod's "runs on" edge to an updated
// Node, a Pod's ownership edge from an updated ReplicaSet) are left alone.
func (gi *Indexer) OnUpdate(old, updated registry.ResourceEntry, raw json.RawMessage) {
	gi.graph.RemoveDerivedEdges(old.EntryKey())
	gi.extractEdges(updated, raw)
	gi.CheckLabelSelectorsForEntry(updated)
}

// OnDelete withdraws the edges derived from this resource's data. Field-path
// edges other resources declared to it stay, like references to resources
// that do not exist yet, and resolve again if it is recreated.
func (gi *Indexer) OnDelete(entry registry.ResourceEntry) {
	gi.graph.RemoveDerivedEdges(entry.EntryKey())
}

func nodeFromEntry(entry registry.ResourceEntry) GraphNode {
	return GraphNode{
		PluginID:  entry.PluginID,
		Reference: entry.Reference,
		Route:     entry.Route,
	}
}

// scopeMatches compares explicit canonical scope dimensions, never metadata.
func scopeMatches(scope, target []resource.ScopeEntry) bool {
	if len(scope) != len(target) {
		return false
	}
	for _, expected := range scope {
		found := false
		for _, actual := range target {
			if expected == actual {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func (gi *Indexer) extractEdges(entry registry.ResourceEntry, raw json.RawMessage) {
	snapshot, bound := gi.graph.boundSnapshot(entry.PluginID, entry.Route, entry.Reference.Address.Type)
	// A nil witness means a complete current catalog excludes this Type.
	if snapshot == nil {
		return
	}
	if bound && snapshot.noRules {
		return
	}
	if !bound {
		gi.graph.unresolvedNode(nodeFromEntry(entry), "source declaration binding unavailable", snapshot)
		return
	}
	// A queued observation outside the admitted source belongs to retired or
	// unbound input, not to this declaration snapshot's coverage.
	if !bindingMatches(snapshot.bindings.Source, nodeFromEntry(entry)) {
		return
	}
	if !exactScope(snapshot.bindings.Source, entry.Reference.Address.Scope) {
		gi.graph.unresolvedNode(nodeFromEntry(entry), "source identity dimensions do not match admitted declarations", snapshot)
		return
	}
	decls, bindings := snapshot.declarations, snapshot.bindings

	sourceNode := nodeFromEntry(entry)

	for _, decl := range decls {
		if decl.Extractor == nil {
			continue
		}
		// Optional absent relationship fields are known absence, not failed mapping.
		field := gjson.GetBytes(raw, decl.Extractor.FieldPath)
		if !field.Exists() || (decl.Extractor.Method == MethodFieldPath && field.Type == gjson.String && field.String() == "") {
			continue
		}
		if decl.Extractor.Method == MethodFieldPath && field.IsArray() && len(field.Array()) == 0 {
			continue
		}
		if decl.Extractor.Method == MethodLabelSelector && field.IsObject() && len(field.Map()) == 0 {
			continue
		}
		var targetBinding TargetBinding
		found := false
		for _, candidate := range bindings.Targets {
			if candidate.Target.Type == decl.TargetType {
				if found {
					found = false
					break
				}
				targetBinding, found = candidate, true
			}
		}
		if !found || targetBinding.Target.Provider == "" || targetBinding.Target.Authority == "" || targetBinding.Target.Route.Connection == "" {
			gi.graph.unresolvedNode(sourceNode, "target declaration binding unavailable or ambiguous", snapshot)
			continue
		}
		scope := append([]resource.ScopeEntry(nil), decl.TargetScope...)
		seen := make(map[string]bool, len(scope)+len(decl.ScopeExtractors))
		valid := true
		for _, item := range scope {
			if seen[item.Dimension] {
				valid = false
				break
			}
			seen[item.Dimension] = true
		}
		for _, extractor := range decl.ScopeExtractors {
			value := gjson.GetBytes(raw, extractor.FieldPath)
			if seen[extractor.Dimension] || !value.Exists() || value.Type != gjson.String {
				valid = false
				break
			}
			seen[extractor.Dimension] = true
			scope = append(scope, resource.ScopeEntry{Dimension: extractor.Dimension, Value: value.String()})
		}
		if !valid || !exactScope(targetBinding, scope) || !queryScopeMatches(targetBinding.Target.Scope, scope) {
			gi.graph.unresolvedNode(sourceNode, "target identity scope mapping incomplete", snapshot)
			continue
		}
		decl.TargetScope = scope
		switch decl.Extractor.Method {
		case MethodFieldPath:
			gi.extractFieldPath(sourceNode, entry, raw, decl, targetBinding, snapshot)
		case MethodLabelSelector, MethodLabelSelectorObject:
			gi.extractLabelSelector(sourceNode, entry, raw, decl, targetBinding, snapshot)
		}
	}
}

func (gi *Indexer) extractFieldPath(
	source GraphNode,
	entry registry.ResourceEntry,
	raw json.RawMessage,
	decl resource.RelationshipDescriptor,
	binding TargetBinding,
	snapshot *boundSet,
) {
	path := decl.Extractor.FieldPath
	if path == "" {
		return
	}

	result := gjson.GetBytes(raw, path)
	if !result.Exists() || (result.Type == gjson.String && result.String() == "") {
		return
	}

	var targetIDs []string
	if result.IsArray() {
		result.ForEach(func(_, value gjson.Result) bool {
			if value.Type != gjson.String {
				gi.graph.unresolvedNode(source, "target ID must be a native string", snapshot)
			} else if v := value.String(); v != "" {
				targetIDs = append(targetIDs, v)
			}
			return true
		})
	} else if result.Type == gjson.String {
		targetIDs = []string{result.String()}
	} else {
		gi.graph.unresolvedNode(source, "target ID must be a native string", snapshot)
		return
	}

	for _, targetID := range targetIDs {
		address := resource.ResourceAddress{
			Provider: binding.Target.Provider, Authority: binding.Target.Authority,
			Type: binding.Target.Type, Scope: decl.TargetScope, ID: targetID,
		}
		if err := resource.ValidateAddress(address, binding.IdentityDimensions); err != nil {
			gi.graph.unresolvedNode(source, "target address is invalid", snapshot)
			continue
		}
		target := GraphNode{
			PluginID:  entry.PluginID,
			Reference: resource.ResourceReference{Address: address},
			Route:     binding.Target.Route,
		}
		if !bindingMatches(binding, target) {
			gi.graph.unresolvedNode(source, "target scope exceeds admitted query scope", snapshot)
			continue
		}

		// EdgeIncoming reverses edge direction (used for ownership). Either
		// way the declaring resource is the source node.
		if decl.Direction == resource.EdgeIncoming {
			gi.graph.addBoundEdge(GraphEdge{
				Source: target,
				Target: source,
				Type:   decl.Type,
				Label:  decl.Label,
			}, source, false, snapshot)
		} else {
			gi.graph.addBoundEdge(GraphEdge{
				Source: source,
				Target: target,
				Type:   decl.Type,
				Label:  decl.Label,
			}, source, false, snapshot)
		}
	}
}

func (gi *Indexer) extractLabelSelector(
	source GraphNode,
	entry registry.ResourceEntry,
	raw json.RawMessage,
	decl resource.RelationshipDescriptor,
	binding TargetBinding,
	snapshot *boundSet,
) {
	if gi.store == nil {
		gi.graph.unresolvedNode(source, "selector registry unavailable", snapshot)
		return
	}

	selectorPath := decl.Extractor.FieldPath
	if selectorPath == "" {
		return
	}

	result := gjson.GetBytes(raw, selectorPath)
	if !result.Exists() {
		return
	}

	var selector labelSelector
	if decl.Extractor.Method == MethodLabelSelectorObject {
		sel, ok := parseLabelSelectorObject(result)
		if !ok {
			gi.graph.unresolvedNode(source, "invalid label selector object", snapshot)
			return
		}
		selector = sel
	} else {
		// A plain label map selects nothing when empty (a Service without
		// a selector).
		selector = parseLabelMap(result)
		if selector.isEmpty() {
			return
		}
	}

	gi.graph.setSelector(source, decl, selector, binding, snapshot)

	// Narrow candidates by the exact-match labels when there are any.
	var candidates []registry.ResourceEntry
	if len(selector.matchLabels) > 0 {
		candidates = gi.store.ScanByLabel(
			entry.PluginID, binding.Target.Route.Connection,
			binding.Target.Type, selector.matchLabels,
		)
	} else {
		candidates = gi.store.ScanByResourceKey(entry.PluginID, binding.Target.Route.Connection, binding.Target.Type)
	}

	for _, match := range candidates {
		if !bindingMatches(binding, nodeFromEntry(match)) ||
			!scopeMatches(decl.TargetScope, match.Reference.Address.Scope) || !selector.matches(match.Labels) {
			continue
		}
		gi.graph.addBoundEdge(GraphEdge{
			Source: source,
			Target: nodeFromEntry(match),
			Type:   decl.Type,
			Label:  decl.Label,
		}, source, true, snapshot)
	}
}

// CheckLabelSelectorsForEntry matches a newly added or updated entry against
// the cached selectors. Entries without labels are checked too: empty
// selectors and NotIn/DoesNotExist expressions can match them.
func (gi *Indexer) CheckLabelSelectorsForEntry(entry registry.ResourceEntry) {
	if gi.store == nil {
		return
	}

	entryNode := nodeFromEntry(entry)

	for _, cached := range gi.graph.selectorSnapshot() {
		selectorNode := cached.node

		// Match only the declared provider authority, type and exact scope.
		if selectorNode.PluginID != entry.PluginID || !bindingMatches(cached.binding, entryNode) {
			continue
		}
		if cached.decl.TargetType != entry.Reference.Address.Type {
			continue
		}
		if !scopeMatches(cached.decl.TargetScope, entry.Reference.Address.Scope) {
			continue
		}
		if !cached.selector.matches(entry.Labels) {
			continue
		}

		gi.graph.addBoundEdge(GraphEdge{
			Source: selectorNode,
			Target: entryNode,
			Type:   cached.decl.Type,
			Label:  cached.decl.Label,
		}, selectorNode, true, cached.snapshot)
	}
}

var _ interface{ Name() string } = (*Indexer)(nil)
