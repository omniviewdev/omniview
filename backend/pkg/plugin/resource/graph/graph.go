package graph

import (
	"strings"
	"sync"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

type RelationshipGraph struct {
	mu            sync.RWMutex
	forward       map[string][]GraphEdge
	reverse       map[string][]GraphEdge
	declarations  map[string][]resource.RelationshipDescriptor
	pluginDecls   map[string][]string
	selectorCache map[string]map[string]string
	deferredEdges map[string][]deferredEdge
	strings       *stringInterner
}

func NewRelationshipGraph() *RelationshipGraph {
	return &RelationshipGraph{
		forward:       make(map[string][]GraphEdge),
		reverse:       make(map[string][]GraphEdge),
		declarations:  make(map[string][]resource.RelationshipDescriptor),
		pluginDecls:   make(map[string][]string),
		selectorCache: make(map[string]map[string]string),
		deferredEdges: make(map[string][]deferredEdge),
		strings:       newStringInterner(),
	}
}

func edgeKey(e GraphEdge) string {
	return e.Source.Key() + "->" + e.Target.Key() + ":" + string(e.Type)
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
	return g.forward[nodeKey]
}

func (g *RelationshipGraph) EdgesTo(nodeKey string) []GraphEdge {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.reverse[nodeKey]
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

	// Also remove stale reverse-index entries for target nodes in this
	// connection (edges from other connections pointing at now-removed nodes
	// are not touched — only the reverse-index bookkeeping is cleaned up).
	for key := range g.reverse {
		if strings.HasPrefix(key, prefix) {
			delete(g.reverse, key)
		}
	}
}

func (g *RelationshipGraph) SetDeclarations(pluginID, resourceKey string, decls []resource.RelationshipDescriptor) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.declarations[resourceKey] = decls
	g.pluginDecls[pluginID] = append(g.pluginDecls[pluginID], resourceKey)
}

func (g *RelationshipGraph) GetDeclarations(resourceKey string) []resource.RelationshipDescriptor {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.declarations[resourceKey]
}

func (g *RelationshipGraph) ClearDeclarationsForPlugin(pluginID string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, rk := range g.pluginDecls[pluginID] {
		delete(g.declarations, rk)
	}
	delete(g.pluginDecls, pluginID)
}

func (g *RelationshipGraph) SetSelectorCache(nodeKey string, selector map[string]string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.selectorCache[nodeKey] = selector
}

func (g *RelationshipGraph) GetSelectorCache(nodeKey string) (map[string]string, bool) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	sel, ok := g.selectorCache[nodeKey]
	return sel, ok
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
