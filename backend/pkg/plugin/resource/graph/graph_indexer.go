package graph

import (
	"encoding/json"

	"github.com/tidwall/gjson"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
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
		PluginID:     entry.PluginID,
		ConnectionID: entry.ConnectionID,
		ResourceKey:  entry.ResourceKey,
		ID:           entry.ID,
		Namespace:    entry.Namespace,
	}
}

// selectorReaches reports whether a selector declared in selectorNS may match
// a resource in targetNS. Kubernetes selectors (Service, NetworkPolicy) only
// match within their own namespace; a cluster-scoped declarer is unrestricted.
func selectorReaches(selectorNS, targetNS string) bool {
	return selectorNS == "" || selectorNS == targetNS
}

func (gi *Indexer) extractEdges(entry registry.ResourceEntry, raw json.RawMessage) {
	decls := gi.graph.GetDeclarations(entry.ResourceKey)
	if len(decls) == 0 {
		return
	}

	sourceNode := nodeFromEntry(entry)

	for _, decl := range decls {
		if decl.Extractor == nil {
			continue
		}
		switch decl.Extractor.Method {
		case "fieldPath":
			gi.extractFieldPath(sourceNode, entry, raw, decl)
		case "labelSelector":
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
		targetNS := entry.Namespace
		if decl.TargetNamespaced != nil && !*decl.TargetNamespaced {
			targetNS = ""
		}

		target := GraphNode{
			PluginID:     entry.PluginID,
			ConnectionID: entry.ConnectionID,
			ResourceKey:  decl.TargetResourceKey,
			ID:           targetID,
			Namespace:    targetNS,
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
	if !result.Exists() || !result.IsObject() {
		return
	}

	selector := make(map[string]string)
	result.ForEach(func(key, value gjson.Result) bool {
		selector[key.String()] = value.String()
		return true
	})

	if len(selector) == 0 {
		return
	}

	gi.graph.SetSelectorCache(source, selector)

	matches := gi.store.ScanByLabel(
		entry.PluginID, entry.ConnectionID,
		decl.TargetResourceKey, selector,
	)

	for _, match := range matches {
		if !selectorReaches(source.Namespace, match.Namespace) {
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

// CheckLabelSelectorsForEntry checks if any cached selectors match the labels
// on a newly added/updated entry.
func (gi *Indexer) CheckLabelSelectorsForEntry(entry registry.ResourceEntry) {
	if gi.store == nil || len(entry.Labels) == 0 {
		return
	}

	entryNode := nodeFromEntry(entry)

	for _, cached := range gi.graph.selectorSnapshot() {
		selectorNode := cached.node

		// Only match selectors within the same plugin, connection and namespace.
		if selectorNode.PluginID != entry.PluginID || selectorNode.ConnectionID != entry.ConnectionID {
			continue
		}
		if !selectorReaches(selectorNode.Namespace, entry.Namespace) {
			continue
		}
		if !matchesSelector(entry.Labels, cached.selector) {
			continue
		}

		decls := gi.graph.GetDeclarations(selectorNode.ResourceKey)
		for _, decl := range decls {
			if decl.Extractor == nil || decl.Extractor.Method != "labelSelector" {
				continue
			}
			if decl.TargetResourceKey != entry.ResourceKey {
				continue
			}

			gi.graph.AddDeclaredEdge(GraphEdge{
				Source: selectorNode,
				Target: entryNode,
				Type:   decl.Type,
				Label:  decl.Label,
			}, selectorNode.Key(), true)
		}
	}
}

func matchesSelector(labels, selector map[string]string) bool {
	for k, v := range selector {
		if labels[k] != v {
			return false
		}
	}
	return true
}

var _ interface{ Name() string } = (*Indexer)(nil)
