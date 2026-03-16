package graph

import (
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

func buildTestGraph() *RelationshipGraph {
	g := NewRelationshipGraph()

	deploy := node("k8s", "c1", "apps::v1::Deployment", "default", "web")
	rs := node("k8s", "c1", "apps::v1::ReplicaSet", "default", "web-abc")
	pod1 := node("k8s", "c1", "core::v1::Pod", "default", "web-abc-1")
	pod2 := node("k8s", "c1", "core::v1::Pod", "default", "web-abc-2")
	nodeN := node("k8s", "c1", "core::v1::Node", "", "worker-1")
	svc := node("k8s", "c1", "core::v1::Service", "default", "web-svc")
	secret := node("k8s", "c1", "core::v1::Secret", "default", "db-creds")

	g.AddEdge(GraphEdge{Source: deploy, Target: rs, Type: resource.RelOwns, Label: "owns"})
	g.AddEdge(GraphEdge{Source: rs, Target: pod1, Type: resource.RelOwns, Label: "owns"})
	g.AddEdge(GraphEdge{Source: rs, Target: pod2, Type: resource.RelOwns, Label: "owns"})
	g.AddEdge(GraphEdge{Source: pod1, Target: nodeN, Type: resource.RelRunsOn, Label: "runs on"})
	g.AddEdge(GraphEdge{Source: pod2, Target: nodeN, Type: resource.RelRunsOn, Label: "runs on"})
	g.AddEdge(GraphEdge{Source: svc, Target: pod1, Type: resource.RelExposes, Label: "exposes"})
	g.AddEdge(GraphEdge{Source: svc, Target: pod2, Type: resource.RelExposes, Label: "exposes"})
	g.AddEdge(GraphEdge{Source: pod1, Target: secret, Type: resource.RelUses, Label: "uses"})

	return g
}

func TestGetRelated_Outgoing(t *testing.T) {
	g := buildTestGraph()
	rs := node("k8s", "c1", "apps::v1::ReplicaSet", "default", "web-abc")
	edges, err := g.GetRelated(rs, Outgoing, nil)
	if err != nil { t.Fatal(err) }
	if len(edges) != 2 { t.Fatalf("expected 2, got %d", len(edges)) }
}

func TestGetRelated_Incoming(t *testing.T) {
	g := buildTestGraph()
	rs := node("k8s", "c1", "apps::v1::ReplicaSet", "default", "web-abc")
	edges, err := g.GetRelated(rs, Incoming, nil)
	if err != nil { t.Fatal(err) }
	if len(edges) != 1 { t.Fatalf("expected 1, got %d", len(edges)) }
}

func TestGetRelated_Both(t *testing.T) {
	g := buildTestGraph()
	rs := node("k8s", "c1", "apps::v1::ReplicaSet", "default", "web-abc")
	edges, err := g.GetRelated(rs, Both, nil)
	if err != nil { t.Fatal(err) }
	if len(edges) != 3 { t.Fatalf("expected 3, got %d", len(edges)) }
}

func TestGetRelated_FilterByType(t *testing.T) {
	g := buildTestGraph()
	pod1 := node("k8s", "c1", "core::v1::Pod", "default", "web-abc-1")
	relType := resource.RelRunsOn
	edges, err := g.GetRelated(pod1, Outgoing, &relType)
	if err != nil { t.Fatal(err) }
	if len(edges) != 1 { t.Fatalf("expected 1, got %d", len(edges)) }
}

func TestGetRelated_EmptyGraph(t *testing.T) {
	g := NewRelationshipGraph()
	n := node("k8s", "c1", "core::v1::Pod", "default", "nonexistent")
	edges, err := g.GetRelated(n, Both, nil)
	if err != nil { t.Fatal(err) }
	if len(edges) != 0 { t.Fatalf("expected 0, got %d", len(edges)) }
}

func TestGetRelationshipChain(t *testing.T) {
	g := buildTestGraph()
	deploy := node("k8s", "c1", "apps::v1::Deployment", "default", "web")
	chain, err := g.GetRelationshipChain(deploy, resource.RelOwns, 3)
	if err != nil { t.Fatal(err) }
	if len(chain) < 2 { t.Fatalf("expected >= 2 levels, got %d", len(chain)) }
	if len(chain[0]) != 1 { t.Fatalf("depth 0: expected 1, got %d", len(chain[0])) }
	if len(chain[1]) != 2 { t.Fatalf("depth 1: expected 2, got %d", len(chain[1])) }
}

func TestGetRelationshipChain_MaxDepth(t *testing.T) {
	g := buildTestGraph()
	deploy := node("k8s", "c1", "apps::v1::Deployment", "default", "web")
	chain, err := g.GetRelationshipChain(deploy, resource.RelOwns, 1)
	if err != nil { t.Fatal(err) }
	if len(chain) != 1 { t.Fatalf("expected 1 level, got %d", len(chain)) }
}

func TestGetDependencyTree(t *testing.T) {
	g := buildTestGraph()
	deploy := node("k8s", "c1", "apps::v1::Deployment", "default", "web")
	tree, err := g.GetDependencyTree(deploy, 3)
	if err != nil { t.Fatal(err) }
	if tree.Root.ID != "web" { t.Fatalf("expected root=web, got %s", tree.Root.ID) }
	if len(tree.Children) != 1 { t.Fatalf("expected 1 child (rs), got %d", len(tree.Children)) }
	rsNode := tree.Children[0]
	if len(rsNode.Children) != 2 { t.Fatalf("expected 2 children of RS, got %d", len(rsNode.Children)) }
}

func TestGetDependencyTree_MaxDepthCap(t *testing.T) {
	g := buildTestGraph()
	deploy := node("k8s", "c1", "apps::v1::Deployment", "default", "web")
	tree, err := g.GetDependencyTree(deploy, 100)
	if err != nil { t.Fatal(err) }
	if tree == nil { t.Fatal("expected non-nil tree") }
}
