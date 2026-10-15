package resource

import (
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
)

type emitted struct {
	mu   sync.Mutex
	keys []string
}

func (e *emitted) emit(key string, _ ...any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.keys = append(e.keys, key)
}

func (e *emitted) snapshot() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.keys...)
}

func edgeIn(conn, pod string) graph.GraphEdge {
	return graph.GraphEdge{
		Source: graph.GraphNode{PluginID: "k8s", ConnectionID: conn, ResourceKey: "core::v1::Pod", Namespace: "default", ID: pod},
		Target: graph.GraphNode{PluginID: "k8s", ConnectionID: conn, ResourceKey: "core::v1::Node", ID: "n1"},
		Type:   graph.RelRunsOn,
	}
}

// TestGraphChangeNotifier_DebouncesPerConnection — omn-gvuy: a burst of
// changes yields one event per connection.
func TestGraphChangeNotifier_DebouncesPerConnection(t *testing.T) {
	g := graph.NewRelationshipGraph()
	var out emitted
	n := newGraphChangeNotifier(g, out.emit, 50*time.Millisecond)
	n.Start()
	defer n.Stop()

	for i := range 20 {
		g.AddEdge(edgeIn("c1", "p"+string(rune('a'+i))))
	}
	g.AddEdge(edgeIn("a/b", "p1"))

	deadline := time.Now().Add(2 * time.Second)
	for len(out.snapshot()) < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(120 * time.Millisecond) // anything extra would arrive by now

	got := out.snapshot()
	want := map[string]bool{"k8s/c1/graph/CHANGED": true, "k8s/a/b/graph/CHANGED": true}
	if len(got) != 2 || !want[got[0]] || !want[got[1]] || got[0] == got[1] {
		t.Fatalf("want one event each for c1 and a/b, got %v", got)
	}
}

func TestGraphChangeNotifier_StopIsSafe(t *testing.T) {
	var nilNotifier *graphChangeNotifier
	nilNotifier.Start()
	nilNotifier.Stop()

	n := newGraphChangeNotifier(graph.NewRelationshipGraph(), func(string, ...any) {}, time.Millisecond)
	n.Stop() // before Start
	n.Start()
	n.Stop()

	m := newGraphChangeNotifier(graph.NewRelationshipGraph(), func(string, ...any) {}, time.Millisecond)
	m.Start()
	m.Stop()
	m.Stop()
}
