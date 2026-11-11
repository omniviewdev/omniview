package graph

import resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

const MaxResultItems = 10000
const MaxResultBytes = 8 << 20

// resultBudget bounds DTOs, traversal bookkeeping and conservative JSON/key
// expansion before cloning nodes or growing result slices. Limits fail closed.
type resultBudget struct{ items, bytes int }

func nodeResultBytes(node GraphNode) int {
	a := node.Reference.Address
	size := 1024 + 24*(len(node.PluginID)+len(node.Route.Connection)+len(a.Provider)+len(a.Authority)+len(a.Type)+len(a.ID))
	if node.Reference.Incarnation != nil {
		size += 24 * len(*node.Reference.Incarnation)
	}
	for _, scope := range a.Scope {
		size += 192 + 24*(len(scope.Dimension)+len(scope.Value))
	}
	return size
}

func (b *resultBudget) reserve(size int) error {
	if b.bytes == 0 {
		b.bytes = 2048
	}
	if size < 0 || size > MaxResultBytes-b.bytes {
		return resource.NewError("RESOURCE_LIMIT", "Graph result byte limit reached.")
	}
	b.bytes += size
	return nil
}

func (b *resultBudget) node(node GraphNode) error { return b.reserve(nodeResultBytes(node)) }

func (b *resultBudget) edge(edge GraphEdge) error {
	if b.items >= MaxResultItems {
		return resource.NewError("RESOURCE_LIMIT", "Graph result edge limit reached.")
	}
	if err := b.reserve(128 + 6*(len(edge.Type)+len(edge.Label)) + nodeResultBytes(edge.Source) + nodeResultBytes(edge.Target)); err != nil {
		return err
	}
	b.items++
	return nil
}
