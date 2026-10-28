package resource

import (
	"context"
	"testing"

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
