package graph

import (
	"maps"
	"strings"
	"sync"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

type RelationshipGraph struct {
	mu            sync.RWMutex
	forward       map[string][]GraphEdge
	reverse       map[string][]GraphEdge
	declarations  map[declMapKey][]resource.RelationshipDescriptor
	pluginDecls   map[string][]declMapKey
	selectorCache map[string]map[string]string
	strings       *stringInterner
}

func NewRelationshipGraph() *RelationshipGraph {
	return &RelationshipGraph{
		forward:       make(map[string][]GraphEdge),
		reverse:       make(map[string][]GraphEdge),
		declarations:  make(map[declMapKey][]resource.RelationshipDescriptor),
		pluginDecls:   make(map[string][]declMapKey),
		selectorCache: make(map[string]map[string]string),
		strings:       newStringInterner(),
	}
}

func edgeKey(e GraphEdge) string {
	return e.Source.Key() + "->" + e.Target.Key() + ":" + string(e.Type) + ":" + e.Label
}

func (g *RelationshipGraph) AddEdge(edge GraphEdge) {
	g.mu.Lock()
	defer g.mu.Unlock()

	srcKey := edge.Source.Key()
	tgtKey := edge.Target.Key()

	ek := edgeKey(edge)
	for _, existing := range g.forward[srcKey] {
		if edgeKey(existing) == ek {
			return
		}
	}

	edge.Source.PluginID = g.strings.Intern(edge.Source.PluginID)
	edge.Source.ConnectionID = g.strings.Intern(edge.Source.ConnectionID)
	edge.Source.ResourceKey = g.strings.Intern(edge.Source.ResourceKey)
	edge.Target.PluginID = g.strings.Intern(edge.Target.PluginID)
	edge.Target.ConnectionID = g.strings.Intern(edge.Target.ConnectionID)
	edge.Target.ResourceKey = g.strings.Intern(edge.Target.ResourceKey)

	g.forward[srcKey] = append(g.forward[srcKey], edge)
	g.reverse[tgtKey] = append(g.reverse[tgtKey], edge)
}

func (g *RelationshipGraph) EdgesFrom(nodeKey string) []GraphEdge {
	g.mu.RLock()
	defer g.mu.RUnlock()
	src := g.forward[nodeKey]
	out := make([]GraphEdge, len(src))
	copy(out, src)
	return out
}

func (g *RelationshipGraph) EdgesTo(nodeKey string) []GraphEdge {
	g.mu.RLock()
	defer g.mu.RUnlock()
	src := g.reverse[nodeKey]
	out := make([]GraphEdge, len(src))
	copy(out, src)
	return out
}

func (g *RelationshipGraph) RemoveEdgesForNode(nodeKey string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	for _, edge := range g.forward[nodeKey] {
		g.releaseEdgeStrings(edge)
		tgtKey := edge.Target.Key()
		g.reverse[tgtKey] = removeEdgeFrom(g.reverse[tgtKey], nodeKey, true)
		if len(g.reverse[tgtKey]) == 0 {
			delete(g.reverse, tgtKey)
		}
	}
	delete(g.forward, nodeKey)

	for _, edge := range g.reverse[nodeKey] {
		g.releaseEdgeStrings(edge)
		srcKey := edge.Source.Key()
		g.forward[srcKey] = removeEdgeFrom(g.forward[srcKey], nodeKey, false)
		if len(g.forward[srcKey]) == 0 {
			delete(g.forward, srcKey)
		}
	}
	delete(g.reverse, nodeKey)

	delete(g.selectorCache, nodeKey)
}

func (g *RelationshipGraph) RemoveEdgesForConnection(pluginID, connectionID string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	prefix := pluginID + "/" + connectionID + "/"

	// Collect only source nodes that belong to this connection. We do NOT
	// remove edges whose source is outside the connection (even if the target
	// is inside), so that cross-connection forward edges are preserved.
	var sourceKeys []string
	for key := range g.forward {
		if strings.HasPrefix(key, prefix) {
			sourceKeys = append(sourceKeys, key)
		}
	}

	for _, nodeKey := range sourceKeys {
		for _, edge := range g.forward[nodeKey] {
			g.releaseEdgeStrings(edge)
			tgtKey := edge.Target.Key()
			g.reverse[tgtKey] = removeEdgeFrom(g.reverse[tgtKey], nodeKey, true)
			if len(g.reverse[tgtKey]) == 0 {
				delete(g.reverse, tgtKey)
			}
		}
		delete(g.forward, nodeKey)
		delete(g.selectorCache, nodeKey)
	}

	// Clean up remaining reverse-index entries for target nodes in this
	// connection. Phase 1 already handled edges originating from this
	// connection. What remains are edges from external sources pointing at
	// nodes in this connection. We keep the forward entries and their
	// interned strings (the external source still exists), but remove the
	// reverse-index bookkeeping since the target node is gone.
	for key := range g.reverse {
		if strings.HasPrefix(key, prefix) {
			delete(g.reverse, key)
		}
	}
}

type declMapKey struct {
	pluginID    string
	resourceKey string
}

func (g *RelationshipGraph) SetDeclarations(pluginID, resourceKey string, decls []resource.RelationshipDescriptor) {
	g.mu.Lock()
	defer g.mu.Unlock()
	dk := declMapKey{pluginID, resourceKey}
	g.declarations[dk] = decls
	g.pluginDecls[pluginID] = append(g.pluginDecls[pluginID], dk)
}

// GetDeclarations returns declarations for a resource key across all plugins.
func (g *RelationshipGraph) GetDeclarations(resourceKey string) []resource.RelationshipDescriptor {
	g.mu.RLock()
	defer g.mu.RUnlock()
	var result []resource.RelationshipDescriptor
	for dk, decls := range g.declarations {
		if dk.resourceKey == resourceKey {
			result = append(result, decls...)
		}
	}
	return result
}

func (g *RelationshipGraph) ClearDeclarationsForPlugin(pluginID string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, dk := range g.pluginDecls[pluginID] {
		delete(g.declarations, dk)
	}
	delete(g.pluginDecls, pluginID)
}

func (g *RelationshipGraph) SetSelectorCache(nodeKey string, selector map[string]string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.selectorCache[nodeKey] = maps.Clone(selector)
}

func (g *RelationshipGraph) GetSelectorCache(nodeKey string) (map[string]string, bool) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	sel, ok := g.selectorCache[nodeKey]
	if !ok {
		return nil, false
	}
	return maps.Clone(sel), true
}

func (g *RelationshipGraph) releaseEdgeStrings(edge GraphEdge) {
	g.strings.Release(edge.Source.PluginID)
	g.strings.Release(edge.Source.ConnectionID)
	g.strings.Release(edge.Source.ResourceKey)
	g.strings.Release(edge.Target.PluginID)
	g.strings.Release(edge.Target.ConnectionID)
	g.strings.Release(edge.Target.ResourceKey)
}

func removeEdgeFrom(edges []GraphEdge, nodeKey string, isSource bool) []GraphEdge {
	n := 0
	for _, e := range edges {
		matchKey := e.Target.Key()
		if isSource {
			matchKey = e.Source.Key()
		}
		if matchKey != nodeKey {
			edges[n] = e
			n++
		}
	}
	return edges[:n]
}
