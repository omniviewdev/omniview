package graph

import (
	"encoding/json"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// makeEntry builds a ResourceEntry for tests.
func makeEntry(key, ns, id string) registry.ResourceEntry {
	return registry.ResourceEntry{
		PluginID:     "k8s",
		ConnectionID: "c1",
		ResourceKey:  key,
		ID:           id,
		Namespace:    ns,
		UID:          "uid-" + id,
		Labels:       map[string]string{},
	}
}

func setupIndexer() (*RelationshipGraph, *registry.MemoryStore, *GraphIndexer) {
	g := NewRelationshipGraph()
	s := registry.NewMemoryStore()
	idx := NewGraphIndexer(g, s)
	return g, s, idx
}

// TestGraphIndexer_Name verifies the indexer's name.
func TestGraphIndexer_Name(t *testing.T) {
	_, _, idx := setupIndexer()
	if idx.Name() != "relationship-graph" {
		t.Fatalf("expected 'relationship-graph', got %q", idx.Name())
	}
}

// TestGraphIndexer_FieldPathExtraction — Pod runs_on Node via spec.nodeName
func TestGraphIndexer_FieldPathExtraction(t *testing.T) {
	g, _, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Pod", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelRunsOn,
			TargetResourceKey: "core::v1::Node",
			Label:             "runs on",
			Extractor: &resource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: "spec.nodeName",
			},
		},
	})

	pod := makeEntry("core::v1::Pod", "default", "nginx")
	raw := json.RawMessage(`{"spec":{"nodeName":"worker-1"}}`)

	idx.OnAdd(pod, raw)

	podNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default",
	}
	edges := g.EdgesFrom(podNode.Key())
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
	e := edges[0]
	if e.Target.ID != "worker-1" {
		t.Errorf("expected target ID 'worker-1', got %q", e.Target.ID)
	}
	if e.Target.ResourceKey != "core::v1::Node" {
		t.Errorf("expected target ResourceKey 'core::v1::Node', got %q", e.Target.ResourceKey)
	}
	if e.Type != resource.RelRunsOn {
		t.Errorf("expected type RelRunsOn, got %q", e.Type)
	}
}

// TestGraphIndexer_FieldPathWithIncomingDirection — Pod owned by ReplicaSet via ownerReferences + EdgeIncoming.
// Edge should be ReplicaSet→owns→Pod (incoming direction reverses source/target).
func TestGraphIndexer_FieldPathWithIncomingDirection(t *testing.T) {
	g, _, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Pod", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelOwns,
			TargetResourceKey: "apps::v1::ReplicaSet",
			Label:             "owns",
			Direction:         resource.EdgeIncoming,
			Extractor: &resource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: "metadata.ownerReferences.0.name",
			},
		},
	})

	pod := makeEntry("core::v1::Pod", "default", "nginx-abc")
	raw := json.RawMessage(`{"metadata":{"ownerReferences":[{"name":"nginx-rs"}]}}`)

	idx.OnAdd(pod, raw)

	// With EdgeIncoming the edge should point FROM the ReplicaSet TO the Pod.
	rsNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "apps::v1::ReplicaSet", ID: "nginx-rs", Namespace: "",
	}
	edges := g.EdgesFrom(rsNode.Key())
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge from ReplicaSet, got %d", len(edges))
	}
	e := edges[0]
	if e.Source.ID != "nginx-rs" {
		t.Errorf("expected source ID 'nginx-rs', got %q", e.Source.ID)
	}
	if e.Target.ID != "nginx-abc" {
		t.Errorf("expected target ID 'nginx-abc', got %q", e.Target.ID)
	}
	if e.Type != resource.RelOwns {
		t.Errorf("expected type RelOwns, got %q", e.Type)
	}
}

// TestGraphIndexer_OnDelete — edges removed after delete.
func TestGraphIndexer_OnDelete(t *testing.T) {
	g, _, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Pod", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelRunsOn,
			TargetResourceKey: "core::v1::Node",
			Label:             "runs on",
			Extractor: &resource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: "spec.nodeName",
			},
		},
	})

	pod := makeEntry("core::v1::Pod", "default", "nginx")
	raw := json.RawMessage(`{"spec":{"nodeName":"worker-1"}}`)

	idx.OnAdd(pod, raw)

	podNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default",
	}
	if len(g.EdgesFrom(podNode.Key())) != 1 {
		t.Fatal("expected 1 edge before delete")
	}

	idx.OnDelete(pod)

	if len(g.EdgesFrom(podNode.Key())) != 0 {
		t.Fatal("expected 0 edges after delete")
	}
}

// TestGraphIndexer_OnUpdate — edge target changes from worker-1 to worker-2.
func TestGraphIndexer_OnUpdate(t *testing.T) {
	g, _, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Pod", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelRunsOn,
			TargetResourceKey: "core::v1::Node",
			Label:             "runs on",
			Extractor: &resource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: "spec.nodeName",
			},
		},
	})

	pod := makeEntry("core::v1::Pod", "default", "nginx")
	raw1 := json.RawMessage(`{"spec":{"nodeName":"worker-1"}}`)
	idx.OnAdd(pod, raw1)

	podNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default",
	}
	edges := g.EdgesFrom(podNode.Key())
	if len(edges) != 1 || edges[0].Target.ID != "worker-1" {
		t.Fatalf("expected edge to worker-1, got %v", edges)
	}

	raw2 := json.RawMessage(`{"spec":{"nodeName":"worker-2"}}`)
	idx.OnUpdate(pod, pod, raw2)

	edges = g.EdgesFrom(podNode.Key())
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge after update, got %d", len(edges))
	}
	if edges[0].Target.ID != "worker-2" {
		t.Errorf("expected edge to worker-2, got %q", edges[0].Target.ID)
	}
}

// TestGraphIndexer_FieldPath_EmptyValue — no edge when field is missing.
func TestGraphIndexer_FieldPath_EmptyValue(t *testing.T) {
	g, _, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Pod", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelRunsOn,
			TargetResourceKey: "core::v1::Node",
			Label:             "runs on",
			Extractor: &resource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: "spec.nodeName",
			},
		},
	})

	pod := makeEntry("core::v1::Pod", "default", "nginx")
	raw := json.RawMessage(`{"spec":{}}`)

	idx.OnAdd(pod, raw)

	podNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default",
	}
	if len(g.EdgesFrom(podNode.Key())) != 0 {
		t.Fatal("expected no edges when field is missing")
	}
}

// TestGraphIndexer_LabelSelector_SelectorBeforePods — Service arrives first, then Pod.
func TestGraphIndexer_LabelSelector_SelectorBeforePods(t *testing.T) {
	g, store, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Service", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelSelects,
			TargetResourceKey: "core::v1::Pod",
			Label:             "selects",
			Extractor: &resource.RelationshipExtractor{
				Method:    "labelSelector",
				FieldPath: "spec.selector",
			},
		},
	})

	// Service arrives first.
	svc := makeEntry("core::v1::Service", "default", "web-svc")
	svcRaw := json.RawMessage(`{"spec":{"selector":{"app":"web"}}}`)
	store.Put(svc)
	idx.OnAdd(svc, svcRaw)

	svcNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Service", ID: "web-svc", Namespace: "default",
	}
	// No pods yet — no edges.
	if len(g.EdgesFrom(svcNode.Key())) != 0 {
		t.Fatal("expected no edges before pods arrive")
	}

	// Now a matching Pod arrives.
	pod := makeEntry("core::v1::Pod", "default", "web-pod-1")
	pod.Labels = map[string]string{"app": "web"}
	store.Put(pod)
	idx.OnAdd(pod, json.RawMessage(`{}`))

	edges := g.EdgesFrom(svcNode.Key())
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge from Service to Pod, got %d", len(edges))
	}
	if edges[0].Target.ID != "web-pod-1" {
		t.Errorf("expected target ID 'web-pod-1', got %q", edges[0].Target.ID)
	}
	if edges[0].Type != resource.RelSelects {
		t.Errorf("expected type RelSelects, got %q", edges[0].Type)
	}
}

// TestGraphIndexer_LabelSelector_PodsBeforeSelector — Pods arrive first, then Service.
func TestGraphIndexer_LabelSelector_PodsBeforeSelector(t *testing.T) {
	g, store, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Service", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelSelects,
			TargetResourceKey: "core::v1::Pod",
			Label:             "selects",
			Extractor: &resource.RelationshipExtractor{
				Method:    "labelSelector",
				FieldPath: "spec.selector",
			},
		},
	})

	// Pods arrive first.
	pod1 := makeEntry("core::v1::Pod", "default", "web-pod-1")
	pod1.Labels = map[string]string{"app": "web"}
	store.Put(pod1)
	idx.OnAdd(pod1, json.RawMessage(`{}`))

	pod2 := makeEntry("core::v1::Pod", "default", "web-pod-2")
	pod2.Labels = map[string]string{"app": "web"}
	store.Put(pod2)
	idx.OnAdd(pod2, json.RawMessage(`{}`))

	// Service arrives after pods.
	svc := makeEntry("core::v1::Service", "default", "web-svc")
	svcRaw := json.RawMessage(`{"spec":{"selector":{"app":"web"}}}`)
	store.Put(svc)
	idx.OnAdd(svc, svcRaw)

	svcNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Service", ID: "web-svc", Namespace: "default",
	}
	edges := g.EdgesFrom(svcNode.Key())
	if len(edges) != 2 {
		t.Fatalf("expected 2 edges from Service to Pods, got %d", len(edges))
	}

	targetIDs := map[string]bool{}
	for _, e := range edges {
		targetIDs[e.Target.ID] = true
	}
	if !targetIDs["web-pod-1"] || !targetIDs["web-pod-2"] {
		t.Errorf("expected edges to web-pod-1 and web-pod-2, got %v", targetIDs)
	}
}

// TestGraphIndexer_LabelSelector_LabelUpdateBreaksMatch — Pod label change removes selector edge.
func TestGraphIndexer_LabelSelector_LabelUpdateBreaksMatch(t *testing.T) {
	g, store, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Service", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelSelects,
			TargetResourceKey: "core::v1::Pod",
			Label:             "selects",
			Extractor: &resource.RelationshipExtractor{
				Method:    "labelSelector",
				FieldPath: "spec.selector",
			},
		},
	})

	// Pod with matching labels.
	pod := makeEntry("core::v1::Pod", "default", "web-pod-1")
	pod.Labels = map[string]string{"app": "web"}
	store.Put(pod)
	idx.OnAdd(pod, json.RawMessage(`{}`))

	// Service with selector matching pod.
	svc := makeEntry("core::v1::Service", "default", "web-svc")
	svcRaw := json.RawMessage(`{"spec":{"selector":{"app":"web"}}}`)
	store.Put(svc)
	idx.OnAdd(svc, svcRaw)

	svcNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Service", ID: "web-svc", Namespace: "default",
	}
	if len(g.EdgesFrom(svcNode.Key())) != 1 {
		t.Fatal("expected 1 edge before label change")
	}

	// Update pod with non-matching labels — simulate by updating the store and calling OnUpdate.
	updatedPod := makeEntry("core::v1::Pod", "default", "web-pod-1")
	updatedPod.Labels = map[string]string{"app": "other"}
	store.Put(updatedPod)
	idx.OnUpdate(pod, updatedPod, json.RawMessage(`{}`))

	// Re-process the service to rebuild selector edges since pod labels changed.
	// Remove old svc edges and re-add.
	idx.OnUpdate(svc, svc, svcRaw)

	edges := g.EdgesFrom(svcNode.Key())
	if len(edges) != 0 {
		t.Fatalf("expected 0 edges after pod label change, got %d: %v", len(edges), edges)
	}
}
