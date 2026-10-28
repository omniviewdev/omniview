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
	decls := gi.graph.GetDeclarations(entry.PluginID, entry.Route, entry.Reference.Address.Type)
	if len(decls) == 0 {
		return
	}

	sourceNode := nodeFromEntry(entry)

	for _, decl := range decls {
		if decl.Extractor == nil {
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
		if !valid {
			continue
		}
		decl.TargetScope = scope
		switch decl.Extractor.Method {
		case MethodFieldPath:
			gi.extractFieldPath(sourceNode, entry, raw, decl)
		case MethodLabelSelector, MethodLabelSelectorObject:
			gi.extractLabelSelector(sourceNode, entry, raw, decl)
		}
	}
}

func (gi *Indexer) extractFieldPath(
	source GraphNode,
	entry registry.ResourceEntry,
	raw json.RawMessage,
	decl resource.RelationshipDescriptor,
) {
	path := decl.Extractor.FieldPath
	if path == "" {
		return
	}

	result := gjson.GetBytes(raw, path)
	if !result.Exists() || result.String() == "" {
		return
	}

	var targetIDs []string
	if result.IsArray() {
		result.ForEach(func(_, value gjson.Result) bool {
			if v := value.String(); v != "" {
				targetIDs = append(targetIDs, v)
			}
			return true
		})
	} else {
		targetIDs = []string{result.String()}
	}

	for _, targetID := range targetIDs {
		address := entry.Reference.Address
		address.Type = decl.TargetType
		address.Scope = decl.TargetScope
		address.ID = targetID
		if err := resource.ValidateAddress(address); err != nil {
			continue
		}
		target := GraphNode{
			PluginID:  entry.PluginID,
			Reference: resource.ResourceReference{Address: address},
			Route:     entry.Route,
		}

		// EdgeIncoming reverses edge direction (used for ownership). Either
		// way the declaring resource is the source node.
		if decl.Direction == resource.EdgeIncoming {
			gi.graph.AddDeclaredEdge(GraphEdge{
				Source: target,
				Target: source,
				Type:   decl.Type,
				Label:  decl.Label,
			}, source.Key(), false)
		} else {
			gi.graph.AddDeclaredEdge(GraphEdge{
				Source: source,
				Target: target,
				Type:   decl.Type,
				Label:  decl.Label,
			}, source.Key(), false)
		}
	}
}

func (gi *Indexer) extractLabelSelector(
	source GraphNode,
	entry registry.ResourceEntry,
	raw json.RawMessage,
	decl resource.RelationshipDescriptor,
) {
	if gi.store == nil {
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

	gi.graph.setSelector(source, decl, selector)

	// Narrow candidates by the exact-match labels when there are any.
	var candidates []registry.ResourceEntry
	if len(selector.matchLabels) > 0 {
		candidates = gi.store.ScanByLabel(
			entry.PluginID, entry.Route.Connection,
			decl.TargetType, selector.matchLabels,
		)
	} else {
		candidates = gi.store.ScanByResourceKey(entry.PluginID, entry.Route.Connection, decl.TargetType)
	}

	for _, match := range candidates {
		if match.Reference.Address.Provider != entry.Reference.Address.Provider ||
			match.Reference.Address.Authority != entry.Reference.Address.Authority ||
			!scopeMatches(decl.TargetScope, match.Reference.Address.Scope) || !selector.matches(match.Labels) {
			continue
		}
		gi.graph.AddDeclaredEdge(GraphEdge{
			Source: source,
			Target: nodeFromEntry(match),
			Type:   decl.Type,
			Label:  decl.Label,
		}, source.Key(), true)
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
		if selectorNode.PluginID != entry.PluginID || selectorNode.Route.Connection != entry.Route.Connection ||
			selectorNode.Reference.Address.Provider != entry.Reference.Address.Provider ||
			selectorNode.Reference.Address.Authority != entry.Reference.Address.Authority {
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

		gi.graph.AddDeclaredEdge(GraphEdge{
			Source: selectorNode,
			Target: entryNode,
			Type:   cached.decl.Type,
			Label:  cached.decl.Label,
		}, selectorNode.Key(), true)
	}
}

var _ interface{ Name() string } = (*Indexer)(nil)
