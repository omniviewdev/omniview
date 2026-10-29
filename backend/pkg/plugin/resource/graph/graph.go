package graph

import (
	"encoding/json"
	"sync"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type RelationshipGraph struct {
	mu                  sync.RWMutex
	forward             map[string][]storedEdge
	reverse             map[string][]storedEdge
	boundDeclarations   map[declMapKey]*boundSet
	missingSnapshots    map[declMapKey]*boundSet
	declarationCatalogs map[ConnectionRef]declarationCatalog
	unresolved          map[string]unresolvedEntry
	declarationProblems map[declMapKey]error
	selectorCache       map[string]map[string]selectorEntry
	strings             *stringInterner

	// dirty holds the connections whose edges changed since the last
	// TakeChanged; changed is signalled (without blocking) when it becomes
	// non-empty.
	dirty   map[ConnectionRef]struct{}
	changed chan struct{}
}

// ConnectionRef identifies one connection of one plugin.
type ConnectionRef struct {
	PluginID     string
	ConnectionID string
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

// selectorEntry is a cached label selector with the node that declared it and
// the declaration it came from, so resources that appear later can be matched
// against it. The node is kept structured because node keys cannot be split
// back into their parts reliably (connection IDs may contain "/").
type selectorEntry struct {
	node     GraphNode
	decl     resource.RelationshipDescriptor
	binding  TargetBinding
	snapshot *boundSet
	selector labelSelector
}

func NewRelationshipGraph() *RelationshipGraph {
	return &RelationshipGraph{
		mu:            sync.RWMutex{},
		forward:       make(map[string][]storedEdge),
		reverse:       make(map[string][]storedEdge),
		selectorCache: make(map[string]map[string]selectorEntry),
		strings:       newStringInterner(),
		dirty:         make(map[ConnectionRef]struct{}),
		changed:       make(chan struct{}, 1),
	}
}

func edgeKey(e GraphEdge) [4]string {
	return [4]string{e.Source.Key(), e.Target.Key(), string(e.Type), e.Label}
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
	g.addEdgeLocked(se)
}

func (g *RelationshipGraph) addEdgeLocked(se storedEdge) {

	edge := se.GraphEdge
	srcKey := edge.Source.Key()
	tgtKey := edge.Target.Key()

	ek := edgeKey(edge)
	for _, existing := range g.forward[srcKey] {
		if edgeKey(existing.GraphEdge) == ek {
			return
		}
	}

	edge = cloneEdge(edge)
	edge.Source.addressKey = srcKey
	edge.Target.addressKey = tgtKey
	edge.Source.PluginID = g.strings.Intern(edge.Source.PluginID)
	edge.Source.Route.Connection = g.strings.Intern(edge.Source.Route.Connection)
	edge.Source.Reference.Address.Type = g.strings.Intern(edge.Source.Reference.Address.Type)
	edge.Target.PluginID = g.strings.Intern(edge.Target.PluginID)
	edge.Target.Route.Connection = g.strings.Intern(edge.Target.Route.Connection)
	edge.Target.Reference.Address.Type = g.strings.Intern(edge.Target.Reference.Address.Type)

	se.GraphEdge = edge
	g.forward[srcKey] = append(g.forward[srcKey], se)
	g.reverse[tgtKey] = append(g.reverse[tgtKey], se)
	g.markEdgeChanged(edge)
}

// Changed is signalled when edges change. Call TakeChanged to find out which
// connections changed. Signals coalesce: one receive may cover many changes.
func (g *RelationshipGraph) Changed() <-chan struct{} {
	return g.changed
}

// TakeChanged returns the connections whose edges changed since the last call
// and resets the set.
func (g *RelationshipGraph) TakeChanged() []ConnectionRef {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make([]ConnectionRef, 0, len(g.dirty))
	for ref := range g.dirty {
		out = append(out, ref)
	}
	clear(g.dirty)
	return out
}

// markChanged records a change for a connection. Callers hold g.mu.
func (g *RelationshipGraph) markChanged(pluginID, connectionID string) {
	g.dirty[ConnectionRef{PluginID: pluginID, ConnectionID: connectionID}] = struct{}{}
	select {
	case g.changed <- struct{}{}:
	default:
	}
}

// markEdgeChanged records a change for both ends of an edge. Callers hold g.mu.
func (g *RelationshipGraph) markEdgeChanged(e GraphEdge) {
	g.markChanged(e.Source.PluginID, e.Source.Route.Connection)
	g.markChanged(e.Target.PluginID, e.Target.Route.Connection)
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
		g.markEdgeChanged(edge.GraphEdge)
		g.releaseEdgeStrings(edge.GraphEdge)
		tgtKey := edge.Target.Key()
		g.reverse[tgtKey] = removeEdgeFrom(g.reverse[tgtKey], nodeKey, true)
		if len(g.reverse[tgtKey]) == 0 {
			delete(g.reverse, tgtKey)
		}
	}
	delete(g.forward, nodeKey)

	for _, edge := range g.reverse[nodeKey] {
		g.markEdgeChanged(edge.GraphEdge)
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
	delete(g.unresolved, nodeKey)
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
		g.markEdgeChanged(e.GraphEdge)
		g.releaseEdgeStrings(e.GraphEdge)
	}
	if len(kept) == 0 {
		delete(idx, nodeKey)
	} else {
		idx[nodeKey] = kept
	}
}

// dropEdgeByKey removes the first edge in idx[nodeKey] whose edgeKey is ek.
func dropEdgeByKey(idx map[string][]storedEdge, nodeKey string, ek [4]string) {
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
		return n.PluginID == pluginID && n.Route.Connection == connectionID
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

	if len(sourceKeys) > 0 {
		g.markChanged(pluginID, connectionID)
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

	for key, entries := range g.selectorCache {
		for _, entry := range entries {
			if inConn(entry.node) {
				delete(g.selectorCache, key)
			}
			break
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
	pluginID     string
	connectionID string
	resourceKey  string
}

func (g *RelationshipGraph) ClearDeclarationsForPlugin(pluginID string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for key := range g.declarationCatalogs {
		if key.PluginID == pluginID {
			delete(g.declarationCatalogs, key)
		}
	}
	for key := range g.missingSnapshots {
		if key.pluginID == pluginID {
			delete(g.missingSnapshots, key)
		}
	}
	for dk := range g.boundDeclarations {
		if dk.pluginID == pluginID {
			delete(g.boundDeclarations, dk)
		}
	}
	for key, entry := range g.unresolved {
		if entry.node.PluginID == pluginID {
			delete(g.unresolved, key)
		}
	}
	for key := range g.declarationProblems {
		if key.pluginID == pluginID {
			delete(g.declarationProblems, key)
		}
	}
	for key, entries := range g.selectorCache {
		for _, entry := range entries {
			if entry.node.PluginID == pluginID {
				delete(g.selectorCache, key)
			}
			break
		}
	}
}

// setSelector caches a label selector the node declared, replacing any
// earlier one for the same declaration.
func (g *RelationshipGraph) setSelector(node GraphNode, decl resource.RelationshipDescriptor, sel labelSelector, binding TargetBinding, snapshot *boundSet) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if snapshot != nil && !g.currentSnapshot(node, snapshot) {
		return
	}
	key := node.Key()
	if g.selectorCache[key] == nil {
		g.selectorCache[key] = make(map[string]selectorEntry)
	}
	node = cloneNode(node)
	node.addressKey = key
	g.selectorCache[key][declID(decl)] = selectorEntry{node: node, decl: decl, selector: sel, binding: binding, snapshot: snapshot}
}

// hasSelectors reports whether the node has cached selectors.
func (g *RelationshipGraph) hasSelectors(nodeKey string) bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.selectorCache[nodeKey]) > 0
}

// selectorSnapshot returns the cached selectors. Entries are replaced, never
// mutated, so they are shared with the cache.
func (g *RelationshipGraph) selectorSnapshot() []selectorEntry {
	g.mu.RLock()
	defer g.mu.RUnlock()
	var out []selectorEntry
	for _, entries := range g.selectorCache {
		for _, entry := range entries {
			out = append(out, entry)
		}
	}
	return out
}

// declID identifies a declaration among those of one resource type.
func declID(d resource.RelationshipDescriptor) string {
	key, _ := json.Marshal(d)
	return string(key)
}

func (g *RelationshipGraph) releaseEdgeStrings(edge GraphEdge) {
	g.strings.Release(edge.Source.PluginID)
	g.strings.Release(edge.Source.Route.Connection)
	g.strings.Release(edge.Source.Reference.Address.Type)
	g.strings.Release(edge.Target.PluginID)
	g.strings.Release(edge.Target.Route.Connection)
	g.strings.Release(edge.Target.Reference.Address.Type)
}

func plainEdges(edges []storedEdge) []GraphEdge {
	out := make([]GraphEdge, len(edges))
	for i, e := range edges {
		out[i] = cloneEdge(e.GraphEdge)
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
