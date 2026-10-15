package graph

import (
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

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

// TestGraph_RemoveEdgesForConnection_SlashInID — omn-vsqj: tearing down
// connection "a" must not touch connection "a/b", whose keys share the prefix.
func TestGraph_RemoveEdgesForConnection_SlashInID(t *testing.T) {
	g := NewRelationshipGraph()
	for _, conn := range []string{"a", "a/b"} {
		g.AddEdge(GraphEdge{
			Source: node("k8s", conn, "core::v1::Pod", "default", "p1"),
			Target: node("k8s", conn, "core::v1::Node", "", "n1"),
			Type:   RelRunsOn,
		})
		g.setSelector(
			node("k8s", conn, "core::v1::Service", "default", "s1"),
			resource.RelationshipDescriptor{Type: resource.RelSelects, TargetResourceKey: "core::v1::Pod"},
			labelSelector{matchLabels: map[string]string{"app": "web"}},
		)
	}

	g.RemoveEdgesForConnection("k8s", "a")

	kept := node("k8s", "a/b", "core::v1::Pod", "default", "p1")
	if len(g.EdgesFrom(kept.Key())) != 1 {
		t.Error("edges of connection a/b were removed")
	}
	if len(g.EdgesTo(node("k8s", "a/b", "core::v1::Node", "", "n1").Key())) != 1 {
		t.Error("reverse index of connection a/b was removed")
	}
	if !g.hasSelectors(node("k8s", "a/b", "core::v1::Service", "default", "s1").Key()) {
		t.Error("selector cache of connection a/b was removed")
	}
	if len(g.EdgesFrom(node("k8s", "a", "core::v1::Pod", "default", "p1").Key())) != 0 {
		t.Error("edges of connection a were kept")
	}
	if g.hasSelectors(node("k8s", "a", "core::v1::Service", "default", "s1").Key()) {
		t.Error("selector cache of connection a was kept")
	}
}

// TestGraph_RemoveDerivedEdges_ReleasesStrings — withdrawing every edge frees
// the interned strings.
func TestGraph_RemoveDerivedEdges_ReleasesStrings(t *testing.T) {
	g := NewRelationshipGraph()
	pod := node("k8s", "c1", "core::v1::Pod", "default", "p1")
	g.AddDeclaredEdge(GraphEdge{Source: pod, Target: node("k8s", "c1", "core::v1::Node", "", "n1"), Type: RelRunsOn}, pod.Key(), false)
	g.AddDeclaredEdge(GraphEdge{Source: node("k8s", "c1", "apps::v1::ReplicaSet", "default", "rs"), Target: pod, Type: RelOwns}, pod.Key(), false)

	g.RemoveDerivedEdges(pod.Key())

	if n := g.strings.Len(); n != 0 {
		t.Fatalf("want 0 interned strings, got %d", n)
	}
	if len(g.forward) != 0 || len(g.reverse) != 0 {
		t.Fatalf("want empty indexes, got forward=%v reverse=%v", g.forward, g.reverse)
	}
}

// TestGraph_ChangeTracking — omn-gvuy: edge changes record the connections
// at both ends and signal Changed; duplicate adds do not.
func TestGraph_ChangeTracking(t *testing.T) {
	g := NewRelationshipGraph()
	pod := node("k8s", "c1", "core::v1::Pod", "default", "p1")
	edge := GraphEdge{Source: pod, Target: node("k8s", "c2", "core::v1::Node", "", "n1"), Type: RelRunsOn}

	g.AddDeclaredEdge(edge, pod.Key(), false)
	select {
	case <-g.Changed():
	default:
		t.Fatal("want a change signal after adding an edge")
	}
	got := g.TakeChanged()
	if len(got) != 2 {
		t.Fatalf("want both connections reported, got %v", got)
	}
	if len(g.TakeChanged()) != 0 {
		t.Fatal("TakeChanged did not reset")
	}

	g.AddDeclaredEdge(edge, pod.Key(), false)
	select {
	case <-g.Changed():
		t.Fatal("duplicate edge must not signal a change")
	default:
	}

	g.RemoveDerivedEdges(pod.Key())
	if got := g.TakeChanged(); len(got) != 2 {
		t.Fatalf("want both connections reported after removal, got %v", got)
	}

	// Removing nothing is not a change.
	g.RemoveDerivedEdges(pod.Key())
	if got := g.TakeChanged(); len(got) != 0 {
		t.Fatalf("want no change when nothing was removed, got %v", got)
	}
}
