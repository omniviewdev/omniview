package graph

import (
	"fmt"
	"testing"
)

// deploymentGraph builds Deployment -> ReplicaSet -> 3 Pods, all on one Node,
// with a Service selecting the Pods and each Pod using one ConfigMap.
func deploymentGraph() (*RelationshipGraph, GraphNode, GraphNode, []GraphNode) {
	g := NewRelationshipGraph()
	deploy := node("k8s", "c1", "apps::v1::Deployment", "default", "web")
	rs := node("k8s", "c1", "apps::v1::ReplicaSet", "default", "web-abc")
	worker := node("k8s", "c1", "core::v1::Node", "", "worker-1")
	svc := node("k8s", "c1", "core::v1::Service", "default", "web")
	cm := node("k8s", "c1", "core::v1::ConfigMap", "default", "web-config")

	g.AddEdge(GraphEdge{Source: deploy, Target: rs, Type: RelOwns})
	var pods []GraphNode
	for i := range 3 {
		pod := node("k8s", "c1", "core::v1::Pod", "default", fmt.Sprintf("web-abc-%d", i))
		pods = append(pods, pod)
		g.AddEdge(GraphEdge{Source: rs, Target: pod, Type: RelOwns})
		g.AddEdge(GraphEdge{Source: pod, Target: worker, Type: RelRunsOn})
		g.AddEdge(GraphEdge{Source: pod, Target: cm, Type: RelUses})
		g.AddEdge(GraphEdge{Source: svc, Target: pod, Type: "selects"})
	}
	return g, deploy, rs, pods
}

func depths(sg *Subgraph) map[string]int {
	out := make(map[string]int, len(sg.Nodes))
	for _, n := range sg.Nodes {
		out[n.Node.Reference.Address.Type+"/"+n.Node.Reference.Address.ID] = n.Depth
	}
	return out
}

// TestGetSubgraph_KeepsSharedEdges — every Pod keeps its edge to the shared
// Node and ConfigMap, unlike GetDependencyTree which lists each target once.
func TestGetSubgraph_KeepsSharedEdges(t *testing.T) {
	g, deploy, _, _ := deploymentGraph()

	sg := g.GetSubgraph(deploy, 2, 3)

	d := depths(sg)
	want := map[string]int{
		"apps::v1::Deployment/web":       0,
		"apps::v1::ReplicaSet/web-abc":   1,
		"core::v1::Pod/web-abc-0":        2,
		"core::v1::Node/worker-1":        3,
		"core::v1::ConfigMap/web-config": 3,
	}
	for k, v := range want {
		if got, ok := d[k]; !ok || got != v {
			t.Errorf("%s: want depth %d, got %d (present=%v)", k, v, got, ok)
		}
	}
	// The Service points at the Pods, but the walk upstream starts from the
	// Deployment, which nothing points at.
	if _, ok := d["core::v1::Service/web"]; ok {
		t.Error("Service is not upstream of the Deployment")
	}

	runsOn := 0
	for _, e := range sg.Edges {
		if e.Type == RelRunsOn {
			runsOn++
		}
	}
	if runsOn != 3 {
		t.Fatalf("want 3 runs_on edges (one per Pod), got %d", runsOn)
	}
	if len(sg.Edges) != 1+3+3+3 {
		t.Fatalf("want 10 edges, got %d: %v", len(sg.Edges), sg.Edges)
	}
}

// TestGetSubgraph_Upstream — from a Pod, owners and selectors are upstream.
func TestGetSubgraph_Upstream(t *testing.T) {
	g, _, _, pods := deploymentGraph()

	sg := g.GetSubgraph(pods[0], 2, 1)

	d := depths(sg)
	for k, v := range map[string]int{
		"apps::v1::ReplicaSet/web-abc": -1,
		"core::v1::Service/web":        -1,
		"apps::v1::Deployment/web":     -2,
		"core::v1::Node/worker-1":      1,
	} {
		if got, ok := d[k]; !ok || got != v {
			t.Errorf("%s: want depth %d, got %d (present=%v)", k, v, got, ok)
		}
	}
	// Sibling Pods are not reached: the walks only go up or down from the root.
	if _, ok := d["core::v1::Pod/web-abc-1"]; ok {
		t.Error("sibling Pod should not be in the subgraph")
	}
	if sg.Truncated {
		t.Error("unexpectedly truncated")
	}
}

func TestGetSubgraph_DepthZeroAndCaps(t *testing.T) {
	g, deploy, _, _ := deploymentGraph()

	sg := g.GetSubgraph(deploy, 0, 0)
	if len(sg.Nodes) != 1 || len(sg.Edges) != 0 {
		t.Fatalf("want only the root, got %v / %v", sg.Nodes, sg.Edges)
	}

	sg = g.GetSubgraph(deploy, -3, 99)
	// Deployment, ReplicaSet, 3 Pods, Node, ConfigMap.
	if len(sg.Nodes) != 7 {
		t.Fatalf("want all 7 nodes, got %d", len(sg.Nodes))
	}
}

func TestGetSubgraph_Truncates(t *testing.T) {
	g := NewRelationshipGraph()
	worker := node("k8s", "c1", "core::v1::Node", "", "busy")
	for i := range maxSubgraphNodes + 20 {
		pod := node("k8s", "c1", "core::v1::Pod", "default", fmt.Sprintf("p%d", i))
		g.AddEdge(GraphEdge{Source: pod, Target: worker, Type: RelRunsOn})
	}

	sg := g.GetSubgraph(worker, 1, 0)

	if !sg.Truncated || len(sg.Nodes) != maxSubgraphNodes {
		t.Fatalf("want %d nodes and truncated, got %d (truncated=%v)", maxSubgraphNodes, len(sg.Nodes), sg.Truncated)
	}
	if len(sg.Edges) != maxSubgraphNodes-1 {
		t.Fatalf("want one edge per included Pod, got %d", len(sg.Edges))
	}
}
