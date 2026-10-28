package graph

import (
	"encoding/json"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func node(plugin, conn, key, ns, id string) GraphNode {
	scope := []resource.ScopeEntry{}
	if ns != "" {
		scope = append(scope, resource.ScopeEntry{Dimension: "namespace", Value: ns})
	}
	return GraphNode{PluginID: plugin, Route: resource.AccessRoute{Connection: conn},
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: plugin, Authority: "authority:" + conn, Type: key, Scope: scope, ID: id}}}
}

func testNamespace(ref resource.ResourceReference) string {
	for _, item := range ref.Address.Scope {
		if item.Dimension == "namespace" {
			return item.Value
		}
	}
	return ""
}

func TestGraph_AddAndGetEdges(t *testing.T) {
	g := NewRelationshipGraph()
	src := node("k8s", "c1", "core::v1::Pod", "default", "nginx")
	tgt := node("k8s", "c1", "core::v1::Node", "", "worker-1")
	edge := GraphEdge{Source: src, Target: tgt, Type: RelRunsOn, Label: "runs on"}

	g.AddEdge(edge)

	fwd := g.EdgesFrom(src.Key())
	if len(fwd) != 1 || fwd[0].Target.Reference.Address.ID != "worker-1" {
		t.Fatalf("expected 1 forward edge to worker-1, got %v", fwd)
	}

	rev := g.EdgesTo(tgt.Key())
	if len(rev) != 1 || rev[0].Source.Reference.Address.ID != "nginx" {
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
			resource.RelationshipDescriptor{Type: resource.RelSelects, TargetType: "core::v1::Pod"},
			labelSelector{matchLabels: map[string]string{"app": "web"}},
			TargetBinding{},
			nil,
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

func TestGraph_CanonicalAddressKeyIgnoresScopeOrderAndRoute(t *testing.T) {
	first := node("provider", "route/one", "opaque/type", "", "opaque/id")
	first.Reference.Address.Scope = []resource.ScopeEntry{{Dimension: "zone", Value: "a/b"}, {Dimension: "account", Value: "雪"}}
	second := first
	second.Route.Connection = "another-route"
	second.Reference.Address.Scope = []resource.ScopeEntry{{Dimension: "account", Value: "雪"}, {Dimension: "zone", Value: "a/b"}}
	if first.Key() != second.Key() {
		t.Fatal("canonical address identity depends on scope order or route")
	}
	second.Reference.Address.ID = "other/id"
	if first.Key() == second.Key() {
		t.Fatal("different opaque identifiers collided")
	}
}

func TestGraph_DeclarationsStayWithPlugin(t *testing.T) {
	g := NewRelationshipGraph()
	setTestDeclarations(g, "one", resource.AccessRoute{Connection: "c1"}, "shared/type", []resource.RelationshipDescriptor{{Type: resource.RelUses, TargetType: "one/target"}})
	setTestDeclarations(g, "two", resource.AccessRoute{Connection: "c1"}, "shared/type", []resource.RelationshipDescriptor{{Type: resource.RelUses, TargetType: "two/target"}})
	decls, _, _ := g.GetBoundDeclarations("one", resource.AccessRoute{Connection: "c1"}, "shared/type")
	if len(decls) != 1 || decls[0].TargetType != "one/target" {
		t.Fatalf("cross-plugin declarations leaked: %v", decls)
	}
}

func TestGraph_CanonicalReferenceSnapshots(t *testing.T) {
	g := NewRelationshipGraph()
	source := node("p", "route", "source/type", "source-scope", "source")
	target := node("p", "route", "target/type", "target-scope", "target")
	token := "incarnation-one"
	target.Reference.Incarnation = &token
	key := source.Key()
	g.AddEdge(GraphEdge{Source: source, Target: target, Type: RelUses})
	source.Reference.Address.Scope[0].Value = "changed-input"
	token = "changed-input"
	edges := g.EdgesFrom(key)
	if len(edges) != 1 || testNamespace(edges[0].Source.Reference) != "source-scope" || *edges[0].Target.Reference.Incarnation != "incarnation-one" {
		t.Fatalf("stored references alias caller memory: %v", edges)
	}
	edges[0].Source.Reference.Address.Scope[0].Value = "changed-output"
	*edges[0].Target.Reference.Incarnation = "changed-output"
	fresh := g.EdgesFrom(key)
	if testNamespace(fresh[0].Source.Reference) != "source-scope" || *fresh[0].Target.Reference.Incarnation != "incarnation-one" {
		t.Fatalf("query output aliases graph storage: %v", fresh)
	}
}

func TestGraphNode_JSONContainsHostKey(t *testing.T) {
	n := node("p", "route/one", "opaque/type", "scope/one", "opaque/id")
	encoded, err := json.Marshal(n)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Key       string                     `json:"key"`
		Reference resource.ResourceReference `json:"reference"`
		Route     resource.AccessRoute       `json:"route"`
	}
	if err = json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	if result.Key != n.Key() || result.Reference.Address.ID != "opaque/id" || result.Route != n.Route {
		t.Fatalf("missing canonical graph identity: %s", encoded)
	}
}

func TestGraph_DeclarationsStayWithExactRoute(t *testing.T) {
	g := NewRelationshipGraph()
	for _, connection := range []string{"route", "route/child"} {
		setTestDeclarations(g, "plugin", resource.AccessRoute{Connection: connection}, "shared/type", []resource.RelationshipDescriptor{{Type: resource.RelUses, TargetType: connection + "/target"}})
	}
	for _, connection := range []string{"route", "route/child"} {
		decls, _, _ := g.GetBoundDeclarations("plugin", resource.AccessRoute{Connection: connection}, "shared/type")
		if len(decls) != 1 || decls[0].TargetType != connection+"/target" {
			t.Fatalf("route %q received another route's declarations: %v", connection, decls)
		}
	}
}
