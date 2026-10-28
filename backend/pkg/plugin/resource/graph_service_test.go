package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func graphTestNode(plugin, connection, resourceType, namespace, id string) graph.GraphNode {
	scope := []sdkresource.ScopeEntry{}
	if namespace != "" {
		scope = append(scope, sdkresource.ScopeEntry{Dimension: "namespace", Value: namespace})
	}
	return graph.GraphNode{PluginID: plugin, Route: sdkresource.AccessRoute{Connection: connection},
		Reference: sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{Provider: plugin, Authority: "authority:" + connection, Type: resourceType, Scope: scope, ID: id}}}
}

func validateGraphTestReference(_ context.Context, plugin string, route sdkresource.AccessRoute, reference sdkresource.ResourceReference) error {
	if err := sdkresource.ValidateAddress(reference.Address); err != nil {
		return err
	}
	if reference.Address.Provider != plugin || reference.Address.Authority != "authority:"+route.Connection {
		return sdkresource.NewError("INVALID_REQUEST", "route authority mismatch")
	}
	return nil
}

func TestGraphService_GetRelated(t *testing.T) {
	g := graph.NewRelationshipGraph()
	svc := NewGraphService(g, nil, nil, validateGraphTestReference)

	src := graphTestNode("k8s", "c1", "core::v1::Pod", "default", "nginx")
	tgt := graphTestNode("k8s", "c1", "core::v1::Node", "", "worker-1")
	g.AddEdge(graph.GraphEdge{Source: src, Target: tgt, Type: sdkresource.RelRunsOn, Label: "runs on"})

	edges, err := svc.GetRelated(testInvocationContext(), "k8s", graphTestNode("k8s", "c1", "core::v1::Pod", "default", "nginx").Reference, sdkresource.AccessRoute{Connection: "c1"}, "outgoing", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
}

func TestGraphService_GetRelated_Incoming(t *testing.T) {
	g := graph.NewRelationshipGraph()
	svc := NewGraphService(g, nil, nil, validateGraphTestReference)

	src := graphTestNode("k8s", "c1", "core::v1::Pod", "default", "nginx")
	tgt := graphTestNode("k8s", "c1", "core::v1::Node", "", "worker-1")
	g.AddEdge(graph.GraphEdge{Source: src, Target: tgt, Type: sdkresource.RelRunsOn, Label: "runs on"})

	// Query from target's perspective — incoming
	edges, err := svc.GetRelated(testInvocationContext(), "k8s", graphTestNode("k8s", "c1", "core::v1::Node", "", "worker-1").Reference, sdkresource.AccessRoute{Connection: "c1"}, "incoming", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
}

func TestGraphService_GetRelated_FilterByType(t *testing.T) {
	g := graph.NewRelationshipGraph()
	svc := NewGraphService(g, nil, nil, validateGraphTestReference)

	src := graphTestNode("k8s", "c1", "core::v1::Pod", "default", "nginx")
	tgt1 := graphTestNode("k8s", "c1", "core::v1::Node", "", "worker-1")
	tgt2 := graphTestNode("k8s", "c1", "core::v1::Service", "default", "svc-1")
	g.AddEdge(graph.GraphEdge{Source: src, Target: tgt1, Type: sdkresource.RelRunsOn, Label: "runs on"})
	g.AddEdge(graph.GraphEdge{Source: src, Target: tgt2, Type: sdkresource.RelExposes, Label: "exposed by"})

	relType := string(sdkresource.RelRunsOn)
	edges, err := svc.GetRelated(testInvocationContext(), "k8s", graphTestNode("k8s", "c1", "core::v1::Pod", "default", "nginx").Reference, sdkresource.AccessRoute{Connection: "c1"}, "outgoing", &relType)
	if err != nil {
		t.Fatal(err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
	if edges[0].Type != sdkresource.RelRunsOn {
		t.Fatalf("expected RelRunsOn, got %s", edges[0].Type)
	}
}

func TestGraphService_GetDependencyTree(t *testing.T) {
	g := graph.NewRelationshipGraph()
	svc := NewGraphService(g, nil, nil, validateGraphTestReference)

	pod := graphTestNode("k8s", "c1", "core::v1::Pod", "default", "nginx")
	node := graphTestNode("k8s", "c1", "core::v1::Node", "", "worker-1")
	g.AddEdge(graph.GraphEdge{Source: pod, Target: node, Type: sdkresource.RelRunsOn, Label: "runs on"})

	tree, err := svc.GetDependencyTree(testInvocationContext(), "k8s", graphTestNode("k8s", "c1", "core::v1::Pod", "default", "nginx").Reference, sdkresource.AccessRoute{Connection: "c1"}, 3)
	if err != nil {
		t.Fatal(err)
	}
	if tree == nil {
		t.Fatal("expected non-nil tree")
	}
	if len(tree.Children) != 1 {
		t.Fatalf("expected 1 child, got %d", len(tree.Children))
	}
}

func TestGraphService_RejectsForeignAuthority(t *testing.T) {
	g := graph.NewRelationshipGraph()
	source := graphTestNode("plugin", "route", "type", "", "id")
	target := graphTestNode("plugin", "route", "other-type", "", "target")
	g.AddEdge(graph.GraphEdge{Source: source, Target: target, Type: sdkresource.RelUses})
	service := NewGraphService(g, nil, nil, validateGraphTestReference)
	wrongRoute := sdkresource.AccessRoute{Connection: "other-route"}
	result, err := service.GetSubgraph(testInvocationContext(), "plugin", source.Reference, wrongRoute, 1, 1)
	if err == nil || result != nil {
		t.Fatal("foreign authority returned graph data")
	}
}

func TestGraphService_RequiresRouteValidator(t *testing.T) {
	node := graphTestNode("plugin", "route", "type", "", "id")
	service := NewGraphService(graph.NewRelationshipGraph(), nil, nil, nil)
	result, err := service.GetRelated(testInvocationContext(), "plugin", node.Reference, node.Route, "outgoing", nil)
	if err == nil || result != nil {
		t.Fatal("graph query bypassed route validation")
	}
}

func newGraphPeerFixture(t *testing.T) (*controller, graph.GraphNode, graph.GraphNode, *sdkresource.Catalog) {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	sourceCatalog := canonicalTestCatalog("source-provider", "source/type")
	peerCatalog := canonicalTestCatalog("peer-provider", "peer/type")
	registerMockPlugin(ctrl, "source-plugin", &mockProvider{CatalogFunc: func(context.Context, sdkresource.CatalogRequest) (sdkresource.Catalog, error) {
		return sourceCatalog, nil
	}})
	registerMockPlugin(ctrl, "peer-plugin", &mockProvider{CatalogFunc: func(context.Context, sdkresource.CatalogRequest) (sdkresource.Catalog, error) {
		return peerCatalog, nil
	}})
	sourceRequest := admittedGetRequest(t, ctrl, "source-plugin", "source-route", "source/type", "source-id").Request
	peerRequest := admittedGetRequest(t, ctrl, "peer-plugin", "peer-route", "peer/type", "peer-id").Request
	source := graph.GraphNode{PluginID: "source-plugin", Route: sourceRequest.Route, Reference: sourceRequest.Reference}
	peer := graph.GraphNode{PluginID: "peer-plugin", Route: peerRequest.Route, Reference: peerRequest.Reference}
	ctrl.graph.AddEdge(graph.GraphEdge{Source: source, Target: peer, Type: sdkresource.RelUses, Label: "uses peer"})
	return ctrl, source, peer, &peerCatalog
}

type graphPeerQuery struct {
	name  string
	query func(*GraphService, graph.GraphNode) (bool, error)
}

func graphPeerQueries() []graphPeerQuery {
	return []graphPeerQuery{
		{name: "related", query: func(service *GraphService, root graph.GraphNode) (bool, error) {
			result, err := service.GetRelated(testInvocationContext(), root.PluginID, root.Reference, root.Route, "both", nil)
			return result != nil, err
		}},
		{name: "chain", query: func(service *GraphService, root graph.GraphNode) (bool, error) {
			result, err := service.GetRelationshipChain(testInvocationContext(), root.PluginID, root.Reference, root.Route, string(sdkresource.RelUses), 2)
			return result != nil, err
		}},
		{name: "dependency tree", query: func(service *GraphService, root graph.GraphNode) (bool, error) {
			result, err := service.GetDependencyTree(testInvocationContext(), root.PluginID, root.Reference, root.Route, 2)
			return result != nil, err
		}},
		{name: "subgraph", query: func(service *GraphService, root graph.GraphNode) (bool, error) {
			result, err := service.GetSubgraph(testInvocationContext(), root.PluginID, root.Reference, root.Route, 2, 2)
			return result != nil, err
		}},
	}
}

func TestGraphService_PeerDenialRejectsWholeResult(t *testing.T) {
	for _, query := range graphPeerQueries() {
		t.Run(query.name, func(t *testing.T) {
			ctrl, root, peer, _ := newGraphPeerFixture(t)
			peerAdmitted := false
			boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, _ string, target invocation.Target) error {
				if target.Provider == peer.PluginID && target.Connection == peer.Route.Connection && target.ResourceType == peer.Reference.Address.Type {
					peerAdmitted = true
					return errors.New("peer access denied")
				}
				return nil
			}))
			service := NewGraphService(ctrl.graph, nil, boundary, ctrl.ValidateReference)
			present, err := query.query(service, root)
			if err == nil || present || !peerAdmitted {
				t.Fatalf("peer denial did not reject complete result: present=%v admitted=%v err=%v", present, peerAdmitted, err)
			}
		})
	}
}

func TestGraphService_StalePeerTypeRejectsWholeResult(t *testing.T) {
	for _, query := range graphPeerQueries() {
		t.Run(query.name, func(t *testing.T) {
			ctrl, root, peer, catalog := newGraphPeerFixture(t)
			catalog.Types = canonicalTestCatalog(catalog.Provider, "replacement/type").Types
			catalog.Revision = "replacement-cohort"
			service := NewGraphService(ctrl.graph, nil, nil, ctrl.ValidateReference)
			present, err := query.query(service, root)
			if err == nil || present {
				t.Fatalf("stale peer type escaped: present=%v err=%v", present, err)
			}
			cached := ctrl.graph.EdgesFrom(root.Key())
			if len(cached) != 1 || cached[0].Target.Key() != peer.Key() {
				t.Fatalf("validation silently changed cached citation: %v", cached)
			}
		})
	}
}

func TestGraphService_StalePeerAuthorityRejectsWholeResult(t *testing.T) {
	for _, query := range graphPeerQueries() {
		t.Run(query.name, func(t *testing.T) {
			ctrl, root, peer, catalog := newGraphPeerFixture(t)
			catalog.Provider = "replacement-provider"
			catalog.Revision = "replacement-cohort"
			service := NewGraphService(ctrl.graph, nil, nil, ctrl.ValidateReference)
			present, err := query.query(service, root)
			if err == nil || present {
				t.Fatalf("stale peer authority escaped: present=%v err=%v", present, err)
			}
			cached := ctrl.graph.EdgesFrom(root.Key())
			if len(cached) != 1 || cached[0].Target.Key() != peer.Key() {
				t.Fatalf("validation silently rekeyed cached citation: %v", cached)
			}
		})
	}
}

func TestGraphService_CurrentPeerCohortRetainsIndependentCitation(t *testing.T) {
	ctrl, root, peer, catalog := newGraphPeerFixture(t)
	catalog.Revision = "current-cohort"
	peerValidations := 0
	service := NewGraphService(ctrl.graph, nil, nil, func(ctx context.Context, pluginID string, route sdkresource.AccessRoute, reference sdkresource.ResourceReference) error {
		if pluginID == peer.PluginID {
			peerValidations++
			if route != peer.Route || reference.Address.Authority != peer.Reference.Address.Authority || reference.Address.Type != peer.Reference.Address.Type {
				return errors.New("peer citation was replaced with source identity")
			}
		}
		return ctrl.ValidateReference(ctx, pluginID, route, reference)
	})
	result, err := service.GetSubgraph(testInvocationContext(), root.PluginID, root.Reference, root.Route, 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if peerValidations != 1 || len(result.Edges) != 1 {
		t.Fatalf("peer target was not independently resolved once: validations=%d result=%v", peerValidations, result)
	}
	actual := result.Edges[0].Target
	if actual.Key() != peer.Key() || actual.Route != peer.Route || actual.Reference.Address.Authority == root.Reference.Address.Authority || actual.Reference.Address.Provider != peer.Reference.Address.Provider {
		t.Fatalf("current peer cohort did not retain original citation: %v", actual)
	}
}

func TestGraphService_DeclarationFailureRejectsWholeResults(t *testing.T) {
	g := graph.NewRelationshipGraph()
	svc := NewGraphService(g, nil, nil, validateGraphTestReference)
	root := graphTestNode("provider", "route", "source", "", "one")
	g.RecordDeclarationError(root.PluginID, root.Route, root.Reference.Address.Type, errors.New("target binding missing"))
	if result, err := svc.GetRelated(testInvocationContext(), root.PluginID, root.Reference, root.Route, "both", nil); err == nil || result != nil {
		t.Fatalf("incomplete related result returned as complete: %v %v", result, err)
	}
	if result, err := svc.GetRelationshipChain(testInvocationContext(), root.PluginID, root.Reference, root.Route, string(sdkresource.RelUses), 3); err == nil || result != nil {
		t.Fatalf("incomplete chain returned as complete: %v %v", result, err)
	}
	if result, err := svc.GetDependencyTree(testInvocationContext(), root.PluginID, root.Reference, root.Route, 3); err == nil || result != nil {
		t.Fatalf("incomplete tree returned as complete: %v %v", result, err)
	}
	if result, err := svc.GetSubgraph(testInvocationContext(), root.PluginID, root.Reference, root.Route, 3, 3); err == nil || result != nil {
		t.Fatalf("incomplete subgraph returned as complete: %v %v", result, err)
	}
	g.ClearDeclarationsForConnection(root.PluginID, root.Route)
	if _, err := svc.GetRelated(testInvocationContext(), root.PluginID, root.Reference, root.Route, "both", nil); err != nil {
		t.Fatal(err)
	}
}
