package graph

import resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

// GetRelated is the whole-result form used by bounded traversal planning.
func (g *RelationshipGraph) GetRelated(ref GraphNode, direction Direction, relType *RelationshipType) ([]GraphEdge, error) {
	result, err := g.QueryRelated(ref, direction, relType, 0, nil)
	return result.Edges, err
}

// QueryRelated materializes only the requested edges. Admission also visits
// omitted matching citations, so truncation cannot hide a denied object. The
// callback receives immutable graph metadata and must not modify this graph.
func (g *RelationshipGraph) QueryRelated(ref GraphNode, direction Direction, relType *RelationshipType, limit int, admit func(GraphEdge) error) (RelatedResult, error) {
	if limit < 0 || limit > MaxResultItems {
		return RelatedResult{}, resource.NewError("INVALID_REQUEST", "Graph related limit must be between zero and 10000.")
	}
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.limitErr != nil {
		return RelatedResult{}, g.limitErr
	}
	result := RelatedResult{Edges: []GraphEdge{}}
	budget := resultBudget{}
	visit := func(edge GraphEdge) error {
		if relType != nil && edge.Type != *relType {
			return nil
		}
		if admit != nil {
			if err := admit(edge); err != nil {
				return err
			}
		}
		if limit > 0 && len(result.Edges) >= limit {
			result.Truncated = true
			return nil
		}
		if err := budget.edge(edge); err != nil {
			return err
		}
		result.Edges = append(result.Edges, cloneEdge(edge))
		return nil
	}
	key := ref.Key()
	if direction == Outgoing || direction == Both {
		for _, edge := range g.forward[key] {
			if err := visit(edge.GraphEdge); err != nil {
				return RelatedResult{}, err
			}
		}
	}
	if direction == Incoming || direction == Both {
		for _, edge := range g.reverse[key] {
			if err := visit(edge.GraphEdge); err != nil {
				return RelatedResult{}, err
			}
		}
	}
	return result, nil
}

// GetRelationshipChain follows one relationship type breadth-first. Both output
// and visited/frontier storage are bounded before each new result is cloned.
func (g *RelationshipGraph) GetRelationshipChain(ref GraphNode, relType RelationshipType, maxDepth int) ([][]GraphEdge, error) {
	if maxDepth <= 0 {
		return nil, nil
	}
	maxDepth = min(maxDepth, maxDependencyTreeDepth)
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.limitErr != nil {
		return nil, g.limitErr
	}
	var result [][]GraphEdge
	visited := map[string]bool{ref.Key(): true}
	frontier := []string{ref.Key()}
	budget := resultBudget{}
	for depth := 0; depth < maxDepth && len(frontier) > 0; depth++ {
		var depthEdges []GraphEdge
		var next []string
		for _, key := range frontier {
			for _, edge := range g.forward[key] {
				if edge.Type != relType {
					continue
				}
				target := edge.Target.Key()
				if visited[target] {
					continue
				}
				if err := budget.edge(edge.GraphEdge); err != nil {
					return nil, err
				}
				visited[target] = true
				depthEdges = append(depthEdges, cloneEdge(edge.GraphEdge))
				if depth+1 < maxDepth {
					next = append(next, target)
				}
			}
		}
		if len(depthEdges) == 0 {
			break
		}
		result = append(result, depthEdges)
		frontier = next
	}
	return result, nil
}

const maxDependencyTreeDepth = 5

func (g *RelationshipGraph) GetDependencyTree(ref GraphNode, maxDepth int) (*DependencyTree, error) {
	maxDepth = min(maxDepth, maxDependencyTreeDepth)
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.limitErr != nil {
		return nil, g.limitErr
	}
	budget := resultBudget{}
	if err := budget.node(ref); err != nil {
		return nil, err
	}
	visited := map[string]bool{ref.Key(): true}
	children, err := g.buildChildren(ref.Key(), maxDepth, 0, visited, &budget)
	if err != nil {
		return nil, err
	}
	return &DependencyTree{Root: cloneNode(ref), Children: children}, nil
}

func (g *RelationshipGraph) buildChildren(key string, maxDepth, depth int, visited map[string]bool, budget *resultBudget) ([]DependencyNode, error) {
	if depth >= maxDepth {
		return nil, nil
	}
	var children []DependencyNode
	for _, edge := range g.forward[key] {
		target := edge.Target.Key()
		if visited[target] {
			continue
		}
		if err := budget.edge(edge.GraphEdge); err != nil {
			return nil, err
		}
		visited[target] = true
		nested, err := g.buildChildren(target, maxDepth, depth+1, visited, budget)
		if err != nil {
			return nil, err
		}
		children = append(children, DependencyNode{Edge: cloneEdge(edge.GraphEdge), Children: nested})
	}
	return children, nil
}
