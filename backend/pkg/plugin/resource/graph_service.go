package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
)

// GraphService exposes graph query methods to the frontend via Wails binding.
type GraphService struct {
	graph    *graph.RelationshipGraph
	realm    *invocation.Scope
	boundary *invocation.Boundary
}

// NewGraphService creates a new GraphService.
func NewGraphService(g *graph.RelationshipGraph, realm *invocation.Scope, boundary *invocation.Boundary) *GraphService {
	return &GraphService{graph: g, realm: realm, boundary: boundary}
}

// GetRelated returns edges connected to the given node.
func (s *GraphService) GetRelated(
	ctx context.Context,
	pluginID, connectionID, resourceKey, namespace, id string,
	direction string,
	relType *string,
) (_result []graph.GraphEdge, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetRelated", pluginID, connectionID, resourceKey, namespace, id)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	ref := graph.GraphNode{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, ID: id, Namespace: namespace,
	}

	var dir graph.Direction
	switch direction {
	case "outgoing":
		dir = graph.Outgoing
	case "incoming":
		dir = graph.Incoming
	case "both":
		dir = graph.Both
	default:
		return nil, apperror.New(apperror.TypeValidation, 400, "Invalid direction", "Direction must be outgoing, incoming, or both.")
	}

	var rt *graph.RelationshipType
	if relType != nil {
		t := graph.RelationshipType(*relType)
		rt = &t
	}

	return s.graph.GetRelated(ref, dir, rt)
}

// GetRelationshipChain follows edges of a specific type up to maxDepth hops.
func (s *GraphService) GetRelationshipChain(ctx context.Context, pluginID, connectionID, resourceKey, namespace, id string,
	relType string, maxDepth int) (_result [][]graph.GraphEdge, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetRelationshipChain", pluginID, connectionID, resourceKey, namespace, id)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	ref := graph.GraphNode{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, ID: id, Namespace: namespace,
	}
	return s.graph.GetRelationshipChain(ref, graph.RelationshipType(relType), maxDepth)
}

// GetDependencyTree follows all outgoing edges recursively.
func (s *GraphService) GetDependencyTree(ctx context.Context, pluginID, connectionID, resourceKey, namespace, id string,
	maxDepth int) (_result *graph.DependencyTree, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetDependencyTree", pluginID, connectionID, resourceKey, namespace, id)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	ref := graph.GraphNode{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, ID: id, Namespace: namespace,
	}
	return s.graph.GetDependencyTree(ref, maxDepth)
}

// GetSubgraph returns the resources around one resource: up to upDepth hops
// against edge direction (owners, selectors) and downDepth hops along it
// (dependencies), with every edge between them.
func (s *GraphService) GetSubgraph(ctx context.Context, pluginID, connectionID, resourceKey, namespace, id string,
	upDepth, downDepth int) (_result *graph.Subgraph, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetSubgraph", pluginID, connectionID, resourceKey, namespace, id)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	ref := graph.GraphNode{
		PluginID: pluginID, ConnectionID: connectionID,
		ResourceKey: resourceKey, ID: id, Namespace: namespace,
	}
	return s.graph.GetSubgraph(ref, upDepth, downDepth), nil
}

func (s *GraphService) admit(ctx context.Context, operation, provider, connection, key, namespace, id string) (context.Context, error) {
	if s.realm != nil {
		ctx = s.realm.Context(ctx)
	}
	return s.boundary.Admit(ctx, operation, invocation.Target{Provider: provider, Connection: connection, ResourceType: key, Object: id, Scope: namespaceScope(namespace)})
}
