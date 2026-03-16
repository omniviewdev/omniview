package graph

import (
	"encoding/json"
	"strings"

	"github.com/tidwall/gjson"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

type GraphIndexer struct {
	graph *RelationshipGraph
	store registry.RegistryStore
}

func NewGraphIndexer(graph *RelationshipGraph, store registry.RegistryStore) *GraphIndexer {
	return &GraphIndexer{graph: graph, store: store}
}

func (gi *GraphIndexer) Name() string { return "relationship-graph" }

func (gi *GraphIndexer) OnAdd(entry registry.ResourceEntry, raw json.RawMessage) {
	gi.extractEdges(entry, raw)
	gi.CheckLabelSelectorsForEntry(entry)
}

func (gi *GraphIndexer) OnUpdate(old, new_ registry.ResourceEntry, raw json.RawMessage) {
	gi.graph.RemoveEdgesForNode(old.EntryKey())
	gi.extractEdges(new_, raw)
	gi.CheckLabelSelectorsForEntry(new_)
}

func (gi *GraphIndexer) OnDelete(entry registry.ResourceEntry) {
	gi.graph.RemoveEdgesForNode(entry.EntryKey())
}

func (gi *GraphIndexer) extractEdges(entry registry.ResourceEntry, raw json.RawMessage) {
	decls := gi.graph.GetDeclarations(entry.ResourceKey)
	if len(decls) == 0 {
		return
	}

	sourceNode := GraphNode{
		PluginID:     entry.PluginID,
		ConnectionID: entry.ConnectionID,
		ResourceKey:  entry.ResourceKey,
		ID:           entry.ID,
		Namespace:    entry.Namespace,
	}

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

func (gi *GraphIndexer) extractFieldPath(source GraphNode, entry registry.ResourceEntry, raw json.RawMessage, decl resource.RelationshipDescriptor) {
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

		// EdgeIncoming reverses edge direction (used for ownership)
		if decl.Direction == resource.EdgeIncoming {
			gi.graph.AddEdge(GraphEdge{
				Source: target,
				Target: source,
				Type:   decl.Type,
				Label:  decl.Label,
			})
		} else {
			gi.graph.AddEdge(GraphEdge{
				Source: source,
				Target: target,
				Type:   decl.Type,
				Label:  decl.Label,
			})
		}
	}
}

func (gi *GraphIndexer) extractLabelSelector(source GraphNode, entry registry.ResourceEntry, raw json.RawMessage, decl resource.RelationshipDescriptor) {
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

	gi.graph.SetSelectorCache(source.Key(), selector)

	matches := gi.store.ScanByLabel(
		entry.PluginID, entry.ConnectionID,
		decl.TargetResourceKey, selector,
	)

	for _, match := range matches {
		target := GraphNode{
			PluginID:     match.PluginID,
			ConnectionID: match.ConnectionID,
			ResourceKey:  match.ResourceKey,
			ID:           match.ID,
			Namespace:    match.Namespace,
		}
		gi.graph.AddEdge(GraphEdge{
			Source: source,
			Target: target,
			Type:   decl.Type,
			Label:  decl.Label,
		})
	}
}

// CheckLabelSelectorsForEntry checks if any cached selectors match the labels
// on a newly added/updated entry.
func (gi *GraphIndexer) CheckLabelSelectorsForEntry(entry registry.ResourceEntry) {
	if gi.store == nil || len(entry.Labels) == 0 {
		return
	}

	entryNode := GraphNode{
		PluginID:     entry.PluginID,
		ConnectionID: entry.ConnectionID,
		ResourceKey:  entry.ResourceKey,
		ID:           entry.ID,
		Namespace:    entry.Namespace,
	}

	gi.graph.mu.RLock()
	cache := make(map[string]map[string]string, len(gi.graph.selectorCache))
	for k, v := range gi.graph.selectorCache {
		cache[k] = v
	}
	gi.graph.mu.RUnlock()

	for selectorNodeKey, selector := range cache {
		if !matchesSelector(entry.Labels, selector) {
			continue
		}

		parts := strings.SplitN(selectorNodeKey, "/", 5)
		if len(parts) < 5 {
			continue
		}

		// Only match selectors within the same plugin and connection.
		if parts[0] != entry.PluginID || parts[1] != entry.ConnectionID {
			continue
		}

		selectorResourceKey := parts[2]

		decls := gi.graph.GetDeclarations(selectorResourceKey)
		for _, decl := range decls {
			if decl.Extractor == nil || decl.Extractor.Method != "labelSelector" {
				continue
			}
			if decl.TargetResourceKey != entry.ResourceKey {
				continue
			}

			selectorNode := GraphNode{
				PluginID:     parts[0],
				ConnectionID: parts[1],
				ResourceKey:  parts[2],
				Namespace:    parts[3],
				ID:           parts[4],
			}

			gi.graph.AddEdge(GraphEdge{
				Source: selectorNode,
				Target: entryNode,
				Type:   decl.Type,
				Label:  decl.Label,
			})
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

var _ interface{ Name() string } = (*GraphIndexer)(nil)
