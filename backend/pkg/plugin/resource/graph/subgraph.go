package graph

// maxSubgraphDepth caps how many hops GetSubgraph follows in each direction.
const maxSubgraphDepth = 5

// maxSubgraphNodes caps how many nodes GetSubgraph returns, so a busy Node or
// Namespace-wide selector cannot produce an unreadable graph.
const maxSubgraphNodes = 250

// SubgraphNode is a node in a Subgraph with its distance from the root:
// negative upstream (resources pointing at the root, such as owners and
// selectors), positive downstream (resources the root points at), 0 for the
// root itself.
type SubgraphNode struct {
	Node  GraphNode `json:"node"`
	Depth int       `json:"depth"`
}

// Subgraph is the neighbourhood of one resource: the nodes reached by
// following edges up and down from it, and every edge followed between them.
type Subgraph struct {
	Root  GraphNode      `json:"root"`
	Nodes []SubgraphNode `json:"nodes"`
	Edges []GraphEdge    `json:"edges"`
	// Truncated reports that maxSubgraphNodes was reached and some nodes and
	// their edges were left out.
	Truncated bool `json:"truncated"`
}

// GetSubgraph returns the resources around ref: up to upDepth hops against
// edge direction and downDepth hops along it. Unlike GetDependencyTree it
// keeps every edge between the nodes it reaches, so a Node shared by many
// Pods is linked to each of them. Depths are capped at maxSubgraphDepth.
func (g *RelationshipGraph) GetSubgraph(ref GraphNode, upDepth, downDepth int) *Subgraph {
	upDepth = min(max(upDepth, 0), maxSubgraphDepth)
	downDepth = min(max(downDepth, 0), maxSubgraphDepth)

	g.mu.RLock()
	defer g.mu.RUnlock()

	sg := &Subgraph{
		Root:      ref,
		Nodes:     []SubgraphNode{{Node: ref, Depth: 0}},
		Edges:     []GraphEdge{},
		Truncated: false,
	}
	seen := map[string]bool{ref.Key(): true}
	seenEdges := map[[4]string]bool{}

	addEdge := func(e GraphEdge) {
		ek := edgeKey(e)
		if !seenEdges[ek] {
			seenEdges[ek] = true
			sg.Edges = append(sg.Edges, cloneEdge(e))
		}
	}

	// walk follows edges breadth-first from the root, downstream along
	// g.forward or upstream along g.reverse.
	walk := func(depth int, downstream bool) {
		frontier := []string{ref.Key()}
		for step := 1; step <= depth && len(frontier) > 0; step++ {
			var next []string
			for _, key := range frontier {
				edges := g.reverse[key]
				if downstream {
					edges = g.forward[key]
				}
				for _, se := range edges {
					other := se.Source
					if downstream {
						other = se.Target
					}
					otherKey := other.Key()
					if !seen[otherKey] {
						if len(sg.Nodes) >= maxSubgraphNodes {
							sg.Truncated = true
							continue
						}
						seen[otherKey] = true
						d := step
						if !downstream {
							d = -step
						}
						sg.Nodes = append(sg.Nodes, SubgraphNode{Node: cloneNode(other), Depth: d})
						next = append(next, otherKey)
					}
					addEdge(se.GraphEdge)
				}
			}
			frontier = next
		}
	}

	walk(downDepth, true)
	walk(upDepth, false)

	return sg
}
