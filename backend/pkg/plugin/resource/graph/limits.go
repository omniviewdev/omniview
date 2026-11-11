package graph

import resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

const maxProjectionMetadataBytes = 128 << 20

// SetMemoryBudget joins this demanded projection to its controller's existing
// accounting pool. The graph remains independently bounded without a callback.
// Configure before publishing declarations or observations.
func (g *RelationshipGraph) SetMemoryBudget(reserve func(int) bool, release func(int)) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.memory != 0 {
		panic("graph memory budget configured after publication")
	}
	g.reserve = reserve
	g.release = release
}

func (g *RelationshipGraph) reserveMemory(size int) bool {
	if size < 0 || size > maxProjectionMetadataBytes-g.memory || (g.reserve != nil && !g.reserve(size)) {
		g.limitErr = resource.NewError("RESOURCE_LIMIT", "Graph projection metadata is saturated.")
		return false
	}
	g.memory += size
	return true
}

func (g *RelationshipGraph) releaseMemory(size int) {
	if size < 0 || size > g.memory {
		panic("graph memory accounting underflow")
	}
	g.memory -= size
	if g.release != nil {
		g.release(size)
	}
}

func edgeMemory(edge GraphEdge) int {
	return 1024 + 2*(len(edge.Source.Key())+len(edge.Target.Key())+len(edge.Type)+len(edge.Label))
}

func selectorMemory(key, declaration string, selector labelSelector) int {
	size := 1024 + len(key) + len(declaration)
	for name, value := range selector.matchLabels {
		size += 128 + len(name) + len(value)
	}
	for _, expression := range selector.expressions {
		size += 128 + len(expression.key) + len(expression.operator)
		for _, value := range expression.values {
			size += 32 + len(value)
		}
	}
	return size
}

func (g *RelationshipGraph) deleteSelectorsLocked(key string) {
	g.selectorCount -= len(g.selectorCache[key])
	for _, entry := range g.selectorCache[key] {
		g.releaseMemory(entry.memory)
	}
	delete(g.selectorCache, key)
}

func (g *RelationshipGraph) CheckLimit() error {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.limitErr
}

// Close releases projection charges and all retained metadata. Body storage is
// never owned by this graph. No publication may follow Close.
func (g *RelationshipGraph) Close() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.releaseMemory(g.memory)
	g.selectorCount = 0
	g.strings = nil
	clear(g.forward)
	clear(g.reverse)
	clear(g.selectorCache)
	clear(g.boundDeclarations)
	clear(g.missingSnapshots)
	clear(g.declarationCatalogs)
	clear(g.declarationProblems)
	clear(g.unresolved)
}
