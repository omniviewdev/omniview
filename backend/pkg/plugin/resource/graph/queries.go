package graph

// GetRelated returns edges connected to the given node, filtered by direction and type.
func (g *RelationshipGraph) GetRelated(ref GraphNode, direction Direction, relType *RelationshipType) ([]GraphEdge, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var edges []GraphEdge
	nodeKey := ref.Key()

	if direction == Outgoing || direction == Both {
		for _, e := range g.forward[nodeKey] {
			if relType == nil || e.Type == *relType {
				edges = append(edges, e)
			}
		}
	}

	if direction == Incoming || direction == Both {
		for _, e := range g.reverse[nodeKey] {
			if relType == nil || e.Type == *relType {
				edges = append(edges, e)
			}
		}
	}

	return edges, nil
}

// GetRelationshipChain follows edges of a specific type up to maxDepth hops.
// Returns edges organized by depth level. Uses BFS with visited-set cycle detection.
func (g *RelationshipGraph) GetRelationshipChain(ref GraphNode, relType RelationshipType, maxDepth int) ([][]GraphEdge, error) {
	if maxDepth <= 0 {
		return nil, nil
	}

	g.mu.RLock()
	defer g.mu.RUnlock()

	var result [][]GraphEdge
	visited := map[string]bool{ref.Key(): true}
	frontier := []string{ref.Key()}

	for depth := 0; depth < maxDepth && len(frontier) > 0; depth++ {
		var depthEdges []GraphEdge
		var nextFrontier []string

		for _, nodeKey := range frontier {
			for _, e := range g.forward[nodeKey] {
				if e.Type != relType {
					continue
				}
				tgtKey := e.Target.Key()
				if visited[tgtKey] {
					continue
				}
				visited[tgtKey] = true
				depthEdges = append(depthEdges, e)
				nextFrontier = append(nextFrontier, tgtKey)
			}
		}

		if len(depthEdges) == 0 {
			break
		}
		result = append(result, depthEdges)
		frontier = nextFrontier
	}

	return result, nil
}

// GetDependencyTree follows ALL outgoing edge types recursively from root.
// maxDepth is capped at 5 to prevent explosion.
func (g *RelationshipGraph) GetDependencyTree(ref GraphNode, maxDepth int) (*DependencyTree, error) {
	if maxDepth > 5 {
		maxDepth = 5
	}

	g.mu.RLock()
	defer g.mu.RUnlock()

	visited := map[string]bool{ref.Key(): true}
	children := g.buildChildren(ref.Key(), maxDepth, 0, visited)

	return &DependencyTree{
		Root:     ref,
		Children: children,
	}, nil
}

func (g *RelationshipGraph) buildChildren(nodeKey string, maxDepth, currentDepth int, visited map[string]bool) []DependencyNode {
	if currentDepth >= maxDepth {
		return nil
	}

	var children []DependencyNode
	for _, e := range g.forward[nodeKey] {
		tgtKey := e.Target.Key()
		if visited[tgtKey] {
			continue
		}
		visited[tgtKey] = true

		child := DependencyNode{
			Edge:     e,
			Children: g.buildChildren(tgtKey, maxDepth, currentDepth+1, visited),
		}
		children = append(children, child)
	}
	return children
}
