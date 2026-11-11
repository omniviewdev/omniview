package resource

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// GraphService owns finite and mounted demand over the same admitted projection.
// No process-global graph or another owner's retained bodies answer these reads.
type GraphService struct {
	ctrl              *controller
	realm             invocation.ContextScope
	boundary          *invocation.Boundary
	validateReference func(context.Context, string, resourcev2.AccessRoute, resourcev2.ResourceReference) error
	mu                sync.Mutex
	observations      map[graphObservationKey]*graphObservation
	closed            map[graphObservationKey]struct{}
	windows           map[invocation.WindowIdentity]*graphWindow
}

func NewGraphService(ctrl Controller, realm invocation.ContextScope, boundary *invocation.Boundary) *GraphService {
	implementation, _ := ctrl.(*controller)
	return &GraphService{ctrl: implementation, realm: realm, boundary: boundary, validateReference: ctrl.ValidateReference, observations: make(map[graphObservationKey]*graphObservation), closed: make(map[graphObservationKey]struct{})}
}

type graphQueryResult struct {
	HostGraphObservationSnapshot
	truncated bool
}

func (s *GraphService) finite(ctx context.Context, request HostGraphObservationRequest, relatedLimit int) (_ graphQueryResult, retErr error) {
	operation, err := request.operation()
	if err != nil {
		return graphQueryResult{}, err
	}
	ctx, end := h3StartOperation(
		ctx,
		operation,
		attribute.String("plugin_id", request.PluginID),
		attribute.String("connection_id", request.Route.Connection),
		attribute.String("resource_type", request.Reference.Address.Type),
		attribute.String("resource_id", request.Reference.Address.ID),
	)
	defer end(&retErr)
	ctx, err = s.admit(ctx, operation, request.PluginID, request.Reference, request.Route)
	if err != nil {
		return graphQueryResult{}, err
	}
	defer finishResource(ctx, &retErr)
	demand, err := s.newDemand(ctx, request)
	if err != nil {
		return graphQueryResult{}, err
	}
	defer demand.close()
	demand.relatedLimit = relatedLimit
	return demand.evaluate(ctx)
}

func (s *GraphService) GetRelated(ctx context.Context, request graph.RelatedRequest) (graph.RelatedResult, error) {
	if request.Limit < 0 || request.Limit > maxGraphResultItems {
		return graph.RelatedResult{}, resourcev2.NewError("INVALID_REQUEST", "Graph related limit must be between zero and 10000.")
	}
	result, err := s.finite(ctx, HostGraphObservationRequest{PluginID: request.PluginID, Reference: request.Reference, Route: request.Route, Kind: "related", Direction: request.Direction, RelationshipType: request.RelationshipType}, request.Limit)
	if err != nil {
		return graph.RelatedResult{}, err
	}
	return graph.RelatedResult{Edges: result.Edges, Truncated: result.truncated}, nil
}

func (s *GraphService) GetRelationshipChain(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, relType string, maxDepth int) ([][]graph.GraphEdge, error) {
	result, err := s.finite(ctx, HostGraphObservationRequest{PluginID: pluginID, Reference: reference, Route: route, Kind: "chain", RelationshipType: &relType, MaxDepth: maxDepth}, 0)
	return result.Chain, err
}

func (s *GraphService) GetDependencyTree(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, maxDepth int) (*graph.DependencyTree, error) {
	result, err := s.finite(ctx, HostGraphObservationRequest{PluginID: pluginID, Reference: reference, Route: route, Kind: "tree", MaxDepth: maxDepth}, 0)
	return result.Tree, err
}

func (s *GraphService) GetSubgraph(ctx context.Context, pluginID string, reference resourcev2.ResourceReference, route resourcev2.AccessRoute, upDepth, downDepth int) (*graph.Subgraph, error) {
	result, err := s.finite(ctx, HostGraphObservationRequest{PluginID: pluginID, Reference: reference, Route: route, Kind: "subgraph", UpDepth: upDepth, DownDepth: downDepth}, 0)
	return result.Subgraph, err
}

func (s *GraphService) graphResult(ctx context.Context, g *graph.RelationshipGraph, request HostGraphObservationRequest, relatedLimit int) (graphQueryResult, error) {
	result := graphQueryResult{HostGraphObservationSnapshot: HostGraphObservationSnapshot{State: "ready"}}
	root := graph.GraphNode{PluginID: request.PluginID, Reference: request.Reference, Route: request.Route}
	operation, err := request.operation()
	if err != nil {
		return graphQueryResult{}, err
	}
	checkedLimit := 2*maxGraphResultItems + 1
	if relatedLimit > 0 {
		checkedLimit = relatedLimit + 1
	}
	// One fresh sequential citation pass, never retained across deliveries.
	ctx = context.WithValue(ctx, admissionBatchContextKey{}, &admissionBatch{})
	output := graphOutputAdmission{service: s, ctx: ctx, operation: operation, checked: make(map[graphCitation]struct{}), checkedLimit: checkedLimit}
	if err := g.CheckComplete(root.PluginID, root.Route); err != nil {
		return graphQueryResult{}, err
	}
	if err := output.node(root); err != nil {
		return graphQueryResult{}, err
	}
	switch request.Kind {
	case "related":
		direction := graph.Outgoing
		if request.Direction == "incoming" {
			direction = graph.Incoming
		} else if request.Direction == "both" {
			direction = graph.Both
		}
		var relType *graph.RelationshipType
		if request.RelationshipType != nil {
			value := graph.RelationshipType(*request.RelationshipType)
			relType = &value
		}
		var related graph.RelatedResult
		related, err = g.QueryRelated(root, direction, relType, relatedLimit, func(edge graph.GraphEdge) error {
			if err := output.node(edge.Source); err != nil {
				return err
			}
			return output.node(edge.Target)
		})
		result.Edges, result.truncated = related.Edges, related.Truncated
	case "chain":
		result.Chain, err = g.GetRelationshipChain(root, graph.RelationshipType(*request.RelationshipType), request.MaxDepth)
		if err == nil {
			for _, edges := range result.Chain {
				if err = output.edges(edges); err != nil {
					break
				}
			}
		}
	case "tree":
		result.Tree, err = g.GetDependencyTree(root, request.MaxDepth)
		if err == nil {
			err = output.node(result.Tree.Root)
		}
		if err == nil {
			err = output.dependencies(result.Tree.Children)
		}
	case "subgraph":
		result.Subgraph = g.GetSubgraph(root, request.UpDepth, request.DownDepth)
		if result.Subgraph.Truncated {
			return graphQueryResult{}, resourcev2.NewError("RESOURCE_LIMIT", "Graph subgraph limit reached.")
		}
		if err = output.node(result.Subgraph.Root); err == nil {
			for _, node := range result.Subgraph.Nodes {
				if err = output.node(node.Node); err != nil {
					break
				}
			}
		}
		if err == nil {
			err = output.edges(result.Subgraph.Edges)
		}
	}
	if err != nil {
		return graphQueryResult{}, err
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
	return admitted, nil
}

type graphCitation struct {
	pluginID, connection, addressKey, incarnation string
	incarnationKnown                              bool
}

type graphOutputAdmission struct {
	service      *GraphService
	ctx          context.Context
	operation    string
	checked      map[graphCitation]struct{}
	checkedLimit int
}

func (a *graphOutputAdmission) node(node graph.GraphNode) error {
	key, err := registry.CanonicalAddressKey(node.Reference.Address)
	if err != nil {
		return err
	}
	citation := graphCitation{pluginID: node.PluginID, connection: node.Route.Connection, addressKey: key}
	if node.Reference.Incarnation != nil {
		citation.incarnationKnown, citation.incarnation = true, *node.Reference.Incarnation
	}
	if _, checked := a.checked[citation]; checked {
		return nil
	}
	if _, err := a.service.admit(a.ctx, a.operation, node.PluginID, node.Reference, node.Route); err != nil {
		return err
	}
	if len(a.checked) < a.checkedLimit {
		a.checked[citation] = struct{}{}
	}
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
