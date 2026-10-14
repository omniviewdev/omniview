package graph

import (
	"maps"
	"sync"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

type RelationshipGraph struct {
	mu            sync.RWMutex
	forward       map[string][]storedEdge
	reverse       map[string][]storedEdge
	declarations  map[declMapKey][]resource.RelationshipDescriptor
	pluginDecls   map[string][]declMapKey
	selectorCache map[string]selectorEntry
	strings       *stringInterner
}

// storedEdge is an edge plus where it came from, so that a change to one
// resource only withdraws the edges derived from that resource's own data.
type storedEdge struct {
	GraphEdge
	// declarer is the key of the node whose data produced the edge (the
	// declaring side, which may be the source or the target). Empty for edges
	// added directly with AddEdge.
	declarer string
	// selector marks edges produced by matching the declarer's label selector
	// against the target's labels; they also depend on the target's labels.
	selector bool
}

// selectorEntry is a cached label selector together with the node that owns
// it. The node is kept structured because node keys cannot be split back into
// their parts reliably (connection IDs may contain "/").
type selectorEntry struct {
	node     GraphNode
	selector map[string]string
}

func NewRelationshipGraph() *RelationshipGraph {
	return &RelationshipGraph{
		mu:            sync.RWMutex{},
		forward:       make(map[string][]storedEdge),
		reverse:       make(map[string][]storedEdge),
		declarations:  make(map[declMapKey][]resource.RelationshipDescriptor),
		pluginDecls:   make(map[string][]declMapKey),
		selectorCache: make(map[string]selectorEntry),
		strings:       newStringInterner(),
	}
}

func edgeKey(e GraphEdge) string {
	return e.Source.Key() + "->" + e.Target.Key() + ":" + string(e.Type) + ":" + e.Label
}

// AddEdge adds an edge that is not tied to any declaring node. It is removed
// only by RemoveEdgesForNode or RemoveEdgesForConnection.
func (g *RelationshipGraph) AddEdge(edge GraphEdge) {
	g.addEdge(storedEdge{GraphEdge: edge, declarer: "", selector: false})
}

// AddDeclaredEdge adds an edge derived from the data of the node with key
// declarerKey. viaSelector marks edges found by matching the declarer's label
// selector. Such edges are withdrawn by RemoveDerivedEdges.
func (g *RelationshipGraph) AddDeclaredEdge(edge GraphEdge, declarerKey string, viaSelector bool) {
	g.addEdge(storedEdge{GraphEdge: edge, declarer: declarerKey, selector: viaSelector})
}

func (g *RelationshipGraph) addEdge(se storedEdge) {
	g.mu.Lock()
	defer g.mu.Unlock()

	edge := se.GraphEdge
	srcKey := edge.Source.Key()
	tgtKey := edge.Target.Key()

	ek := edgeKey(edge)
	for _, existing := range g.forward[srcKey] {
		if edgeKey(existing.GraphEdge) == ek {
			return
		}
	}

	edge.Source.PluginID = g.strings.Intern(edge.Source.PluginID)
	edge.Source.ConnectionID = g.strings.Intern(edge.Source.ConnectionID)
	edge.Source.ResourceKey = g.strings.Intern(edge.Source.ResourceKey)
	edge.Target.PluginID = g.strings.Intern(edge.Target.PluginID)
	edge.Target.ConnectionID = g.strings.Intern(edge.Target.ConnectionID)
	edge.Target.ResourceKey = g.strings.Intern(edge.Target.ResourceKey)

	se.GraphEdge = edge
	g.forward[srcKey] = append(g.forward[srcKey], se)
	g.reverse[tgtKey] = append(g.reverse[tgtKey], se)
}

func (g *RelationshipGraph) EdgesFrom(nodeKey string) []GraphEdge {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return plainEdges(g.forward[nodeKey])
}

func (g *RelationshipGraph) EdgesTo(nodeKey string) []GraphEdge {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return plainEdges(g.reverse[nodeKey])
}

func (g *RelationshipGraph) RemoveEdgesForNode(nodeKey string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	for _, edge := range g.forward[nodeKey] {
		g.releaseEdgeStrings(edge.GraphEdge)
		tgtKey := edge.Target.Key()
		g.reverse[tgtKey] = removeEdgeFrom(g.reverse[tgtKey], nodeKey, true)
		if len(g.reverse[tgtKey]) == 0 {
			delete(g.reverse, tgtKey)
		}
	}
	delete(g.forward, nodeKey)

	for _, edge := range g.reverse[nodeKey] {
		g.releaseEdgeStrings(edge.GraphEdge)
		srcKey := edge.Source.Key()
		g.forward[srcKey] = removeEdgeFrom(g.forward[srcKey], nodeKey, false)
		if len(g.forward[srcKey]) == 0 {
			delete(g.forward, srcKey)
		}
	}
	delete(g.reverse, nodeKey)

	delete(g.selectorCache, nodeKey)
}

// RemoveDerivedEdges withdraws the edges derived from the given node's data:
// edges it declared (in either direction) and selector edges that matched its
// labels. Edges other nodes declared about it stay, so a change to a Node does
// not drop the Pods' "runs on" edges to it. Also drops the node's cached
// selector.
func (g *RelationshipGraph) RemoveDerivedEdges(nodeKey string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	derived := func(e storedEdge) bool {
		return e.declarer == nodeKey || (e.selector && e.Target.Key() == nodeKey)
	}
	g.removeMatching(g.forward, g.reverse, nodeKey, derived, true)
	g.removeMatching(g.reverse, g.forward, nodeKey, derived, false)

	delete(g.selectorCache, nodeKey)
}

// removeMatching drops the edges in idx[nodeKey] for which drop returns true,
// along with their copies in the opposite index. outgoing reports whether idx
// is the forward index.
func (g *RelationshipGraph) removeMatching(
	idx, opposite map[string][]storedEdge,
	nodeKey string,
	drop func(storedEdge) bool,
	outgoing bool,
) {
	edges, ok := idx[nodeKey]
	if !ok {
		return
	}
	kept := edges[:0]
	for _, e := range edges {
		if !drop(e) {
			kept = append(kept, e)
			continue
		}
		otherKey := e.Source.Key()
		if outgoing {
			otherKey = e.Target.Key()
		}
		dropEdgeByKey(opposite, otherKey, edgeKey(e.GraphEdge))
		g.releaseEdgeStrings(e.GraphEdge)
	}
	if len(kept) == 0 {
		delete(idx, nodeKey)
	} else {
		idx[nodeKey] = kept
	}
}

// dropEdgeByKey removes the first edge in idx[nodeKey] whose edgeKey is ek.
func dropEdgeByKey(idx map[string][]storedEdge, nodeKey, ek string) {
	edges := idx[nodeKey]
	for i, e := range edges {
		if edgeKey(e.GraphEdge) == ek {
			edges = append(edges[:i], edges[i+1:]...)
			break
		}
	}
	if len(edges) == 0 {
		delete(idx, nodeKey)
	} else {
		idx[nodeKey] = edges
	}
}

func (g *RelationshipGraph) RemoveEdgesForConnection(pluginID, connectionID string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Index entries are never left empty, so the first edge identifies the
	// node. Compare fields rather than key prefixes: connection IDs may
	// contain "/", which would let "a" match the keys of connection "a/b".
	inConn := func(n GraphNode) bool {
		return n.PluginID == pluginID && n.ConnectionID == connectionID
	}

	// Collect only source nodes that belong to this connection. We do NOT
	// remove edges whose source is outside the connection (even if the target
	// is inside), so that cross-connection forward edges are preserved.
	var sourceKeys []string
	for key, edges := range g.forward {
		if len(edges) > 0 && inConn(edges[0].Source) {
			sourceKeys = append(sourceKeys, key)
		}
	}

	for _, nodeKey := range sourceKeys {
		for _, edge := range g.forward[nodeKey] {
			g.releaseEdgeStrings(edge.GraphEdge)
			tgtKey := edge.Target.Key()
			g.reverse[tgtKey] = removeEdgeFrom(g.reverse[tgtKey], nodeKey, true)
			if len(g.reverse[tgtKey]) == 0 {
				delete(g.reverse, tgtKey)
			}
		}
		delete(g.forward, nodeKey)
	}

	for key, entry := range g.selectorCache {
		if inConn(entry.node) {
			delete(g.selectorCache, key)
		}
	}

	// Clean up remaining reverse-index entries for target nodes in this
	// connection. Phase 1 already handled edges originating from this
	// connection. What remains are edges from external sources pointing at
	// nodes in this connection. We keep the forward entries and their
	// interned strings (the external source still exists), but remove the
	// reverse-index bookkeeping since the target node is gone.
	for key, edges := range g.reverse {
		if len(edges) > 0 && inConn(edges[0].Target) {
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

func (g *RelationshipGraph) SetSelectorCache(node GraphNode, selector map[string]string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.selectorCache[node.Key()] = selectorEntry{node: node, selector: maps.Clone(selector)}
}

func (g *RelationshipGraph) GetSelectorCache(nodeKey string) (map[string]string, bool) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	entry, ok := g.selectorCache[nodeKey]
	if !ok {
		return nil, false
	}
	return maps.Clone(entry.selector), true
}

// selectorSnapshot returns a copy of the cached selectors. Selector maps are
// replaced, never mutated, so they are shared with the cache.
func (g *RelationshipGraph) selectorSnapshot() []selectorEntry {
	g.mu.RLock()
	defer g.mu.RUnlock()
	out := make([]selectorEntry, 0, len(g.selectorCache))
	for _, entry := range g.selectorCache {
		out = append(out, entry)
	}
	return out
}

func (g *RelationshipGraph) releaseEdgeStrings(edge GraphEdge) {
	g.strings.Release(edge.Source.PluginID)
	g.strings.Release(edge.Source.ConnectionID)
	g.strings.Release(edge.Source.ResourceKey)
	g.strings.Release(edge.Target.PluginID)
	g.strings.Release(edge.Target.ConnectionID)
	g.strings.Release(edge.Target.ResourceKey)
}

func plainEdges(edges []storedEdge) []GraphEdge {
	out := make([]GraphEdge, len(edges))
	for i, e := range edges {
		out[i] = e.GraphEdge
	}
	return out
}

func removeEdgeFrom(edges []storedEdge, nodeKey string, isSource bool) []storedEdge {
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
