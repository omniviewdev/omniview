package graph

import "testing"

func node(plugin, conn, key, ns, id string) GraphNode {
	return GraphNode{
		PluginID: plugin, ConnectionID: conn,
		ResourceKey: key, ID: id, Namespace: ns,
	}
}

func TestGraph_AddAndGetEdges(t *testing.T) {
	g := NewRelationshipGraph()
	src := node("k8s", "c1", "core::v1::Pod", "default", "nginx")
	tgt := node("k8s", "c1", "core::v1::Node", "", "worker-1")
	edge := GraphEdge{Source: src, Target: tgt, Type: RelRunsOn, Label: "runs on"}

	g.AddEdge(edge)

	fwd := g.EdgesFrom(src.Key())
	if len(fwd) != 1 || fwd[0].Target.ID != "worker-1" {
		t.Fatalf("expected 1 forward edge to worker-1, got %v", fwd)
	}

	rev := g.EdgesTo(tgt.Key())
	if len(rev) != 1 || rev[0].Source.ID != "nginx" {
		t.Fatalf("expected 1 reverse edge from nginx, got %v", rev)
	}
}

func TestGraph_RemoveEdgesForNode(t *testing.T) {
	g := NewRelationshipGraph()
	pod := node("k8s", "c1", "core::v1::Pod", "default", "nginx")
	nodeN := node("k8s", "c1", "core::v1::Node", "", "worker-1")
	svc := node("k8s", "c1", "core::v1::Service", "default", "web")

	g.AddEdge(GraphEdge{Source: pod, Target: nodeN, Type: RelRunsOn, Label: "runs on"})
	g.AddEdge(GraphEdge{Source: svc, Target: pod, Type: RelExposes, Label: "exposes"})

	g.RemoveEdgesForNode(pod.Key())

	if len(g.EdgesFrom(pod.Key())) != 0 {
		t.Fatal("expected no forward edges after removal")
	}
	if len(g.EdgesTo(pod.Key())) != 0 {
		t.Fatal("expected no reverse edges after removal")
	}
	if len(g.EdgesFrom(svc.Key())) != 0 {
		t.Fatal("expected svc forward edge to pod removed")
	}
}

func TestGraph_RemoveEdgesForConnection(t *testing.T) {
	g := NewRelationshipGraph()
	pod1 := node("k8s", "c1", "core::v1::Pod", "default", "p1")
	pod2 := node("k8s", "c1", "core::v1::Pod", "default", "p2")
	pod3 := node("k8s", "c2", "core::v1::Pod", "default", "p3")
	nodeN := node("k8s", "c1", "core::v1::Node", "", "worker")

	g.AddEdge(GraphEdge{Source: pod1, Target: nodeN, Type: RelRunsOn, Label: "runs on"})
	g.AddEdge(GraphEdge{Source: pod2, Target: nodeN, Type: RelRunsOn, Label: "runs on"})
	g.AddEdge(GraphEdge{Source: pod3, Target: nodeN, Type: RelRunsOn, Label: "runs on"})

	g.RemoveEdgesForConnection("k8s", "c1")

	if len(g.EdgesFrom(pod1.Key())) != 0 || len(g.EdgesFrom(pod2.Key())) != 0 {
		t.Fatal("expected c1 edges removed")
	}
	if len(g.EdgesFrom(pod3.Key())) != 1 {
		t.Fatal("expected c2 edge to survive")
	}
}

func TestGraph_DuplicateEdge(t *testing.T) {
	g := NewRelationshipGraph()
	src := node("k8s", "c1", "core::v1::Pod", "default", "nginx")
	tgt := node("k8s", "c1", "core::v1::Node", "", "worker-1")
	edge := GraphEdge{Source: src, Target: tgt, Type: RelRunsOn, Label: "runs on"}

	g.AddEdge(edge)
	g.AddEdge(edge) // duplicate

	fwd := g.EdgesFrom(src.Key())
	if len(fwd) != 1 {
		t.Fatalf("expected dedup to 1 edge, got %d", len(fwd))
	}
}
