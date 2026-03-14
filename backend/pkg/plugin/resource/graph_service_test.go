package resource

import (
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

func TestGraphService_GetRelated(t *testing.T) {
	g := graph.NewRelationshipGraph()
	svc := NewGraphService(g)

	src := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default"}
	tgt := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Node", ID: "worker-1"}
	g.AddEdge(graph.GraphEdge{Source: src, Target: tgt, Type: sdkresource.RelRunsOn, Label: "runs on"})

	edges, err := svc.GetRelated("k8s", "c1", "core::v1::Pod", "default", "nginx", "outgoing", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
}

func TestGraphService_GetRelated_Incoming(t *testing.T) {
	g := graph.NewRelationshipGraph()
	svc := NewGraphService(g)

	src := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default"}
	tgt := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Node", ID: "worker-1"}
	g.AddEdge(graph.GraphEdge{Source: src, Target: tgt, Type: sdkresource.RelRunsOn, Label: "runs on"})

	// Query from target's perspective — incoming
	edges, err := svc.GetRelated("k8s", "c1", "core::v1::Node", "", "worker-1", "incoming", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
}

func TestGraphService_GetRelated_FilterByType(t *testing.T) {
	g := graph.NewRelationshipGraph()
	svc := NewGraphService(g)

	src := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default"}
	tgt1 := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Node", ID: "worker-1"}
	tgt2 := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Service", ID: "svc-1", Namespace: "default"}
	g.AddEdge(graph.GraphEdge{Source: src, Target: tgt1, Type: sdkresource.RelRunsOn, Label: "runs on"})
	g.AddEdge(graph.GraphEdge{Source: src, Target: tgt2, Type: sdkresource.RelExposes, Label: "exposed by"})

	relType := string(sdkresource.RelRunsOn)
	edges, err := svc.GetRelated("k8s", "c1", "core::v1::Pod", "default", "nginx", "outgoing", &relType)
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
	svc := NewGraphService(g)

	pod := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default"}
	node := graph.GraphNode{PluginID: "k8s", ConnectionID: "c1", ResourceKey: "core::v1::Node", ID: "worker-1"}
	g.AddEdge(graph.GraphEdge{Source: pod, Target: node, Type: sdkresource.RelRunsOn, Label: "runs on"})

	tree, err := svc.GetDependencyTree("k8s", "c1", "core::v1::Pod", "default", "nginx", 3)
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
