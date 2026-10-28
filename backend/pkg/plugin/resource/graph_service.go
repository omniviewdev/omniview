package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// GraphService exposes observed relationships and rejects incomplete whole results.
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
	edges, err := s.graph.GetRelated(graph.GraphNode{PluginID: pluginID, Reference: reference, Route: route}, dir, rt)
	if err != nil {
		return nil, err
	}
	output := s.outputAdmission(ctx, "graph.GetRelated")
	if err := output.edges(edges); err != nil {
		return nil, err
	}
	return edges, nil
}

func (s *GraphService) GetRelationshipChain(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, relType string, maxDepth int) (_result [][]graph.GraphEdge, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetRelationshipChain", pluginID, reference, route)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	chain, err := s.graph.GetRelationshipChain(graph.GraphNode{PluginID: pluginID, Reference: reference, Route: route}, graph.RelationshipType(relType), maxDepth)
	if err != nil {
		return nil, err
	}
	output := s.outputAdmission(ctx, "graph.GetRelationshipChain")
	for _, edges := range chain {
		if err := output.edges(edges); err != nil {
			return nil, err
		}
	}
	return chain, nil
}

func (s *GraphService) GetDependencyTree(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, maxDepth int) (_result *graph.DependencyTree, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetDependencyTree", pluginID, reference, route)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	tree, err := s.graph.GetDependencyTree(graph.GraphNode{PluginID: pluginID, Reference: reference, Route: route}, maxDepth)
	if err != nil {
		return nil, err
	}
	output := s.outputAdmission(ctx, "graph.GetDependencyTree")
	if err := output.node(tree.Root); err != nil {
		return nil, err
	}
	if err := output.dependencies(tree.Children); err != nil {
		return nil, err
	}
	return tree, nil
}

func (s *GraphService) GetSubgraph(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, upDepth, downDepth int) (_result *graph.Subgraph, retErr error) {
	ctx, err := s.admit(ctx, "graph.GetSubgraph", pluginID, reference, route)
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	result := s.graph.GetSubgraph(graph.GraphNode{PluginID: pluginID, Reference: reference, Route: route}, upDepth, downDepth)
	output := s.outputAdmission(ctx, "graph.GetSubgraph")
	if err := output.node(result.Root); err != nil {
		return nil, err
	}
	for _, node := range result.Nodes {
		if err := output.node(node.Node); err != nil {
			return nil, err
		}
	}
	if err := output.edges(result.Edges); err != nil {
		return nil, err
	}
	return result, nil
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
	if err := s.graph.CheckComplete(pluginID, route); err != nil {
		return admitted, err
	}
	return admitted, nil
}

// A citation retains its original provider provenance and access route. Address
// identity alone is insufficient to cache admission across route aliases or
// known/unknown incarnations.
type graphCitation struct {
	pluginID         string
	connection       string
	addressKey       string
	incarnation      string
	incarnationKnown bool
}

type graphOutputAdmission struct {
	service   *GraphService
	ctx       context.Context
	operation string
	checked   map[graphCitation]struct{}
}

func (s *GraphService) outputAdmission(ctx context.Context, operation string) graphOutputAdmission {
	return graphOutputAdmission{service: s, ctx: ctx, operation: operation, checked: make(map[graphCitation]struct{})}
}

func (a *graphOutputAdmission) node(node graph.GraphNode) error {
	addressKey, err := registry.CanonicalAddressKey(node.Reference.Address)
	if err != nil {
		return err
	}
	citation := graphCitation{pluginID: node.PluginID, connection: node.Route.Connection, addressKey: addressKey}
	if node.Reference.Incarnation != nil {
		citation.incarnationKnown = true
		citation.incarnation = *node.Reference.Incarnation
	}
	if _, ok := a.checked[citation]; ok {
		return nil
	}
	// Resolve the cited target's own route/type against the current host catalog.
	// Never replace its authority with the root's authority or silently omit it.
	if _, err := a.service.admit(a.ctx, a.operation, node.PluginID, node.Reference, node.Route); err != nil {
		return err
	}
	a.checked[citation] = struct{}{}
	return nil
}

func (a *graphOutputAdmission) edges(edges []graph.GraphEdge) error {
	for _, edge := range edges {
		if err := a.node(edge.Source); err != nil {
			return err
		}
		if err := a.node(edge.Target); err != nil {
			return err
		}
	}
	return nil
}

func (a *graphOutputAdmission) dependencies(nodes []graph.DependencyNode) error {
	for _, node := range nodes {
		if err := a.node(node.Edge.Source); err != nil {
			return err
		}
		if err := a.node(node.Edge.Target); err != nil {
			return err
		}
		if err := a.dependencies(node.Children); err != nil {
			return err
		}
	}
	return nil
}
