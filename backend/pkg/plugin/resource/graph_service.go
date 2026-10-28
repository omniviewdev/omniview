package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// GraphService exposes best-effort observed relationships, not a query planner.
type GraphService struct {
	graph             *graph.RelationshipGraph
	realm             *invocation.Scope
	boundary          *invocation.Boundary
	validateReference func(context.Context, string, resourcev2.AccessRoute, resourcev2.ResourceReference) error
}

func NewGraphService(g *graph.RelationshipGraph, realm *invocation.Scope, boundary *invocation.Boundary, validateReference func(context.Context, string, resourcev2.AccessRoute, resourcev2.ResourceReference) error) *GraphService {
	return &GraphService{graph: g, realm: realm, boundary: boundary, validateReference: validateReference}
}

func (s *GraphService) GetRelated(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, direction string, relType *string) (_result []graph.GraphEdge, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetRelated", pluginID, reference, route)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
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
	return s.graph.GetRelated(graph.GraphNode{PluginID: pluginID, Reference: reference, Route: route}, dir, rt)
}

func (s *GraphService) GetRelationshipChain(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, relType string, maxDepth int) (_result [][]graph.GraphEdge, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetRelationshipChain", pluginID, reference, route)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	return s.graph.GetRelationshipChain(graph.GraphNode{PluginID: pluginID, Reference: reference, Route: route}, graph.RelationshipType(relType), maxDepth)
}

func (s *GraphService) GetDependencyTree(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, maxDepth int) (_result *graph.DependencyTree, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetDependencyTree", pluginID, reference, route)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	return s.graph.GetDependencyTree(graph.GraphNode{PluginID: pluginID, Reference: reference, Route: route}, maxDepth)
}

func (s *GraphService) GetSubgraph(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, upDepth, downDepth int) (_result *graph.Subgraph, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetSubgraph", pluginID, reference, route)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	return s.graph.GetSubgraph(graph.GraphNode{PluginID: pluginID, Reference: reference, Route: route}, upDepth, downDepth), nil
}

func (s *GraphService) admit(ctx context.Context, operation, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute) (admitted context.Context, retErr error) {
	if s.realm != nil {
		ctx = s.realm.Context(ctx)
	}
	admitted, retErr = s.boundary.Admit(ctx, operation, referenceTarget(pluginID, route, reference))
	if retErr != nil {
		return admitted, retErr
	}
	defer finishResource(admitted, &retErr)
	if err := resourcev2.ValidateAddress(reference.Address); err != nil {
		return admitted, err
	}
	if route.Connection == "" {
		return admitted, resourcev2.NewError("INVALID_REQUEST", "connection route is required")
	}
	if s.validateReference == nil {
		return admitted, resourcev2.NewError("UNAVAILABLE", "graph route validation is unavailable")
	}
	if err := s.validateReference(admitted, pluginID, route, reference); err != nil {
		return admitted, err
	}
	return admitted, nil
}
