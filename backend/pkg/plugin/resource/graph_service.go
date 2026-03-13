package resource

import (
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
)

// GraphService exposes graph query methods to the frontend via Wails binding.
type GraphService struct {
	graph *graph.RelationshipGraph
}

// NewGraphService creates a new GraphService.
func NewGraphService(g *graph.RelationshipGraph) *GraphService {
	return &GraphService{graph: g}
}

// GetRelated returns edges connected to the given node.
func (s *GraphService) GetRelated(
	pluginID, connectionID, resourceKey, namespace, id string,
	direction string, // "outgoing", "incoming", "both"
	relType *string, // optional filter
) ([]graph.GraphEdge, error) {
	ref := graph.GraphNode{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, ID: id, Namespace: namespace,
	}

	var dir graph.Direction
	switch direction {
	case "incoming":
		dir = graph.Incoming
	case "both":
		dir = graph.Both
	default:
		dir = graph.Outgoing
	}

	var rt *graph.RelationshipType
	if relType != nil {
		t := graph.RelationshipType(*relType)
		rt = &t
	}

	return s.graph.GetRelated(ref, dir, rt)
}

// GetRelationshipChain follows edges of a specific type up to maxDepth hops.
func (s *GraphService) GetRelationshipChain(
	pluginID, connectionID, resourceKey, namespace, id string,
	relType string, maxDepth int,
) ([][]graph.GraphEdge, error) {
	ref := graph.GraphNode{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, ID: id, Namespace: namespace,
	}
	return s.graph.GetRelationshipChain(ref, graph.RelationshipType(relType), maxDepth)
}

// GetDependencyTree follows all outgoing edges recursively.
func (s *GraphService) GetDependencyTree(
	pluginID, connectionID, resourceKey, namespace, id string,
	maxDepth int,
) (*graph.DependencyTree, error) {
	ref := graph.GraphNode{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, ID: id, Namespace: namespace,
	}
	return s.graph.GetDependencyTree(ref, maxDepth)
}
