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

func setupIndexer() (*RelationshipGraph, *registry.MemoryStore, *Indexer) {
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

// TestGraphIndexer_FieldPathExtraction — Pod runs_on Node via spec.nodeName.
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
	// The ReplicaSet inherits the Pod's namespace since fieldPath extraction
	// defaults to the source entry's namespace.
	rsNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "apps::v1::ReplicaSet", ID: "nginx-rs", Namespace: "default",
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

// TestGraphIndexer_FieldPath_ClusterScopedTarget — TargetNamespaced=false gives empty namespace.
func TestGraphIndexer_FieldPath_ClusterScopedTarget(t *testing.T) {
	g, _, idx := setupIndexer()

	clusterScoped := false
	g.SetDeclarations("k8s", "core::v1::Pod", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelRunsOn,
			TargetResourceKey: "core::v1::Node",
			Label:             "runs on",
			TargetNamespaced:  &clusterScoped,
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
	if e.Target.Namespace != "" {
		t.Errorf("expected empty namespace for cluster-scoped target, got %q", e.Target.Namespace)
	}
	if e.Target.ID != "worker-1" {
		t.Errorf("expected target ID 'worker-1', got %q", e.Target.ID)
	}
}

// TestGraphIndexer_FieldPath_NamespacedTargetDefault — nil TargetNamespaced inherits source namespace.
func TestGraphIndexer_FieldPath_NamespacedTargetDefault(t *testing.T) {
	g, _, idx := setupIndexer()

	g.SetDeclarations("k8s", "core::v1::Pod", []resource.RelationshipDescriptor{
		{
			Type:              resource.RelUses,
			TargetResourceKey: "core::v1::ConfigMap",
			Label:             "uses",
			Extractor: &resource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: "spec.volumes.0.configMap.name",
			},
		},
	})

	pod := makeEntry("core::v1::Pod", "production", "app-pod")
	raw := json.RawMessage(`{"spec":{"volumes":[{"configMap":{"name":"app-config"}}]}}`)

	idx.OnAdd(pod, raw)

	podNode := GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Pod", ID: "app-pod", Namespace: "production",
	}
	edges := g.EdgesFrom(podNode.Key())
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
	if edges[0].Target.Namespace != "production" {
		t.Errorf("expected namespace 'production', got %q", edges[0].Target.Namespace)
	}
}

// declareK8sSubset declares the Pod/ReplicaSet/Service relationships the
// regression tests below rely on, mirroring the kubernetes plugin's table.
func declareK8sSubset(g *RelationshipGraph) {
	clusterScoped := false
	g.SetDeclarations("k8s", "core::v1::Pod", []resource.RelationshipDescriptor{
		{
			Type: resource.RelOwns, TargetResourceKey: "apps::v1::ReplicaSet",
			Label: "owned by", Direction: resource.EdgeIncoming,
			Extractor: &resource.RelationshipExtractor{
				Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="ReplicaSet").name`,
			},
		},
		{
			Type: resource.RelRunsOn, TargetResourceKey: "core::v1::Node",
			Label: "runs on", TargetNamespaced: &clusterScoped,
			Extractor: &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.nodeName"},
		},
	})
	g.SetDeclarations("k8s", "apps::v1::ReplicaSet", []resource.RelationshipDescriptor{
		{
			Type: resource.RelOwns, TargetResourceKey: "apps::v1::Deployment",
			Label: "owned by", Direction: resource.EdgeIncoming,
			Extractor: &resource.RelationshipExtractor{
				Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="Deployment").name`,
			},
		},
	})
	g.SetDeclarations("k8s", "core::v1::Service", []resource.RelationshipDescriptor{
		{
			Type: resource.RelSelects, TargetResourceKey: "core::v1::Pod", Label: "selects",
			Extractor: &resource.RelationshipExtractor{Method: "labelSelector", FieldPath: "spec.selector"},
		},
	})
}

const podOnWorker1 = `{"metadata":{"ownerReferences":[{"kind":"ReplicaSet","name":"web-abc"}]},"spec":{"nodeName":"worker-1"}}`

// TestGraphIndexer_UpdateKeepsEdgesDeclaredByOthers — omn-8jr8: a Node status
// update must not drop the Pods' "runs on" edges, and a ReplicaSet update must
// not drop the ownership edges its Pods declared.
func TestGraphIndexer_UpdateKeepsEdgesDeclaredByOthers(t *testing.T) {
	g, store, idx := setupIndexer()
	declareK8sSubset(g)

	nodeEntry := makeEntry("core::v1::Node", "", "worker-1")
	rs := makeEntry("apps::v1::ReplicaSet", "default", "web-abc")
	pod := makeEntry("core::v1::Pod", "default", "web-abc-1")
	rsRaw := json.RawMessage(`{"metadata":{"ownerReferences":[{"kind":"Deployment","name":"web"}]}}`)
	for _, e := range []registry.ResourceEntry{nodeEntry, rs, pod} {
		store.Put(e)
	}
	idx.OnAdd(nodeEntry, json.RawMessage(`{}`))
	idx.OnAdd(rs, rsRaw)
	idx.OnAdd(pod, json.RawMessage(podOnWorker1))

	idx.OnUpdate(nodeEntry, nodeEntry, json.RawMessage(`{"status":{"conditions":[]}}`))
	idx.OnUpdate(rs, rs, rsRaw)

	if got := g.EdgesTo(nodeEntry.EntryKey()); len(got) != 1 || got[0].Source.ID != "web-abc-1" {
		t.Errorf("after Node update: want pod->node edge, got %v", got)
	}
	if got := g.EdgesFrom(rs.EntryKey()); len(got) != 1 || got[0].Target.ID != "web-abc-1" {
		t.Errorf("after ReplicaSet update: want rs->pod ownership edge, got %v", got)
	}
	if got := g.EdgesTo(rs.EntryKey()); len(got) != 1 || got[0].Source.ID != "web" {
		t.Errorf("after ReplicaSet update: want deployment->rs edge re-derived once, got %v", got)
	}
}

// TestGraphIndexer_UpdateReplacesOwnIncomingDeclaration — a Pod that changes
// owner moves its incoming ownership edge instead of keeping the old one.
func TestGraphIndexer_UpdateReplacesOwnIncomingDeclaration(t *testing.T) {
	g, _, idx := setupIndexer()
	declareK8sSubset(g)

	pod := makeEntry("core::v1::Pod", "default", "p1")
	idx.OnAdd(pod, json.RawMessage(podOnWorker1))
	idx.OnUpdate(pod, pod, json.RawMessage(`{"metadata":{"ownerReferences":[{"kind":"ReplicaSet","name":"web-def"}]}}`))

	got := g.EdgesTo(pod.EntryKey())
	if len(got) != 1 || got[0].Source.ID != "web-def" {
		t.Fatalf("want only web-def->pod, got %v", got)
	}
	if out := g.EdgesFrom(pod.EntryKey()); len(out) != 0 {
		t.Fatalf("want runs-on edge gone after nodeName cleared, got %v", out)
	}
}

// TestGraphIndexer_DeleteKeepsEdgesDeclaredByOthers — deleting a Node keeps
// the Pods' references to it, so they resolve again if it comes back.
// Deleting a Pod removes its own edges and the selector edges matching it.
func TestGraphIndexer_DeleteKeepsEdgesDeclaredByOthers(t *testing.T) {
	g, store, idx := setupIndexer()
	declareK8sSubset(g)

	nodeEntry := makeEntry("core::v1::Node", "", "worker-1")
	pod := makeEntry("core::v1::Pod", "default", "web-abc-1")
	pod.Labels = map[string]string{"app": "web"}
	svc := makeEntry("core::v1::Service", "default", "web")
	for _, e := range []registry.ResourceEntry{nodeEntry, pod, svc} {
		store.Put(e)
	}
	idx.OnAdd(nodeEntry, json.RawMessage(`{}`))
	idx.OnAdd(pod, json.RawMessage(podOnWorker1))
	idx.OnAdd(svc, json.RawMessage(`{"spec":{"selector":{"app":"web"}}}`))

	store.Delete("k8s", "c1", "core::v1::Node", "", "worker-1")
	idx.OnDelete(nodeEntry)
	if got := g.EdgesFrom(pod.EntryKey()); len(got) != 1 || got[0].Target.ID != "worker-1" {
		t.Fatalf("after Node delete: want pod->node edge kept, got %v", got)
	}

	store.Delete("k8s", "c1", "core::v1::Pod", "default", "web-abc-1")
	idx.OnDelete(pod)
	if got := g.EdgesFrom(pod.EntryKey()); len(got) != 0 {
		t.Errorf("after Pod delete: want no pod edges, got %v", got)
	}
	if got := g.EdgesTo(pod.EntryKey()); len(got) != 0 {
		t.Errorf("after Pod delete: want no edges into pod, got %v", got)
	}
	if got := g.EdgesFrom(svc.EntryKey()); len(got) != 0 {
		t.Errorf("after Pod delete: want service selects nothing, got %v", got)
	}
	if n := g.strings.Len(); n != 0 {
		t.Errorf("after Pod delete: want all interned strings released, got %d", n)
	}
}

// TestGraphIndexer_PodLabelChangeAloneUpdatesSelectorEdges — a Pod that stops
// (and then starts again) matching a Service's selector is unlinked (and
// relinked) without the Service being re-processed.
func TestGraphIndexer_PodLabelChangeAloneUpdatesSelectorEdges(t *testing.T) {
	g, store, idx := setupIndexer()
	declareK8sSubset(g)

	pod := makeEntry("core::v1::Pod", "default", "p1")
	pod.Labels = map[string]string{"app": "web"}
	svc := makeEntry("core::v1::Service", "default", "web")
	store.Put(pod)
	store.Put(svc)
	idx.OnAdd(pod, json.RawMessage(`{}`))
	idx.OnAdd(svc, json.RawMessage(`{"spec":{"selector":{"app":"web"}}}`))

	relabeled := makeEntry("core::v1::Pod", "default", "p1")
	relabeled.Labels = map[string]string{"app": "other"}
	store.Put(relabeled)
	idx.OnUpdate(pod, relabeled, json.RawMessage(`{}`))
	if got := g.EdgesFrom(svc.EntryKey()); len(got) != 0 {
		t.Fatalf("after relabel away: want 0 selector edges, got %v", got)
	}

	store.Put(pod)
	idx.OnUpdate(relabeled, pod, json.RawMessage(`{}`))
	if got := g.EdgesFrom(svc.EntryKey()); len(got) != 1 {
		t.Fatalf("after relabel back: want 1 selector edge, got %v", got)
	}
}

// TestGraphIndexer_ServiceSelectorRemoved — a Service whose selector is
// removed stops matching Pods that appear later.
func TestGraphIndexer_ServiceSelectorRemoved(t *testing.T) {
	g, store, idx := setupIndexer()
	declareK8sSubset(g)

	svc := makeEntry("core::v1::Service", "default", "web")
	store.Put(svc)
	idx.OnAdd(svc, json.RawMessage(`{"spec":{"selector":{"app":"web"}}}`))
	idx.OnUpdate(svc, svc, json.RawMessage(`{"spec":{}}`))

	pod := makeEntry("core::v1::Pod", "default", "p1")
	pod.Labels = map[string]string{"app": "web"}
	store.Put(pod)
	idx.OnAdd(pod, json.RawMessage(`{}`))

	if got := g.EdgesFrom(svc.EntryKey()); len(got) != 0 {
		t.Fatalf("want 0 selector edges, got %v", got)
	}
	if g.hasSelectors(svc.EntryKey()) {
		t.Fatal("want selector cache cleared")
	}
}

// TestGraphIndexer_LabelSelector_SameNamespaceOnly — omn-odo8: a Service only
// selects Pods in its own namespace, whichever of the two is seen first.
func TestGraphIndexer_LabelSelector_SameNamespaceOnly(t *testing.T) {
	for _, svcFirst := range []bool{true, false} {
		g, store, idx := setupIndexer()
		declareK8sSubset(g)

		svc := makeEntry("core::v1::Service", "default", "web")
		svcRaw := json.RawMessage(`{"spec":{"selector":{"app":"web"}}}`)
		var pods []registry.ResourceEntry
		for _, ns := range []string{"default", "other"} {
			p := makeEntry("core::v1::Pod", ns, "web-1")
			p.Labels = map[string]string{"app": "web"}
			pods = append(pods, p)
		}

		if svcFirst {
			store.Put(svc)
			idx.OnAdd(svc, svcRaw)
		}
		for _, p := range pods {
			store.Put(p)
			idx.OnAdd(p, json.RawMessage(`{}`))
		}
		if !svcFirst {
			store.Put(svc)
			idx.OnAdd(svc, svcRaw)
		}

		got := g.EdgesFrom(svc.EntryKey())
		if len(got) != 1 || got[0].Target.Namespace != "default" {
			t.Errorf("svcFirst=%v: want only the default/web-1 pod selected, got %v", svcFirst, got)
		}
	}
}

// TestGraphIndexer_LabelSelector_SlashInConnectionID — omn-vsqj: connection
// IDs are kube context names, and EKS contexts are ARNs containing "/". Pods
// that appear after their Service must still be linked.
func TestGraphIndexer_LabelSelector_SlashInConnectionID(t *testing.T) {
	g, store, idx := setupIndexer()
	declareK8sSubset(g)

	const conn = "arn:aws:eks:us-east-1:123456789012:cluster/prod"
	svc := makeEntry("core::v1::Service", "default", "web")
	svc.ConnectionID = conn
	store.Put(svc)
	idx.OnAdd(svc, json.RawMessage(`{"spec":{"selector":{"app":"web"}}}`))

	pod := makeEntry("core::v1::Pod", "default", "web-1")
	pod.ConnectionID = conn
	pod.Labels = map[string]string{"app": "web"}
	store.Put(pod)
	idx.OnAdd(pod, json.RawMessage(`{}`))

	got := g.EdgesFrom(svc.EntryKey())
	if len(got) != 1 || got[0].Target.ConnectionID != conn || got[0].Target.ID != "web-1" {
		t.Fatalf("want 1 selector edge to %s/web-1, got %v", conn, got)
	}
}

// declareNetworkPolicy declares NetworkPolicy -> Pod via a full LabelSelector.
func declareNetworkPolicy(g *RelationshipGraph) {
	g.SetDeclarations("k8s", "networking::v1::NetworkPolicy", []resource.RelationshipDescriptor{
		{
			Type: resource.RelSelects, TargetResourceKey: "core::v1::Pod", Label: "selects",
			Extractor: &resource.RelationshipExtractor{Method: MethodLabelSelectorObject, FieldPath: "spec.podSelector"},
		},
	})
}

func addPod(store *registry.MemoryStore, idx *Indexer, ns, id string, labels map[string]string) registry.ResourceEntry {
	pod := makeEntry("core::v1::Pod", ns, id)
	pod.Labels = labels
	store.Put(pod)
	idx.OnAdd(pod, json.RawMessage(`{}`))
	return pod
}

func targetIDs(edges []GraphEdge) map[string]bool {
	ids := make(map[string]bool, len(edges))
	for _, e := range edges {
		ids[e.Target.Namespace+"/"+e.Target.ID] = true
	}
	return ids
}

// TestGraphIndexer_SelectorObject_EmptySelectsNamespace — omn-bhrc: an empty
// podSelector selects every Pod in the policy's namespace, including Pods
// without labels and Pods created later, and none in other namespaces.
func TestGraphIndexer_SelectorObject_EmptySelectsNamespace(t *testing.T) {
	g, store, idx := setupIndexer()
	declareNetworkPolicy(g)

	addPod(store, idx, "default", "labelled", map[string]string{"app": "web"})
	addPod(store, idx, "other", "elsewhere", map[string]string{"app": "web"})

	np := makeEntry("networking::v1::NetworkPolicy", "default", "deny-all")
	store.Put(np)
	idx.OnAdd(np, json.RawMessage(`{"spec":{"podSelector":{}}}`))

	addPod(store, idx, "default", "unlabelled", nil)

	got := targetIDs(g.EdgesFrom(np.EntryKey()))
	want := map[string]bool{"default/labelled": true, "default/unlabelled": true}
	if len(got) != len(want) || !got["default/labelled"] || !got["default/unlabelled"] {
		t.Fatalf("want %v, got %v", want, got)
	}
}

// TestGraphIndexer_SelectorObject_Expressions — matchExpressions are applied
// to existing Pods and to Pods that appear or change later.
func TestGraphIndexer_SelectorObject_Expressions(t *testing.T) {
	g, store, idx := setupIndexer()
	declareNetworkPolicy(g)

	addPod(store, idx, "default", "prod", map[string]string{"app": "web", "env": "prod"})
	addPod(store, idx, "default", "dev", map[string]string{"app": "web", "env": "dev"})

	np := makeEntry("networking::v1::NetworkPolicy", "default", "web-not-prod")
	store.Put(np)
	idx.OnAdd(np, json.RawMessage(`{"spec":{"podSelector":{
		"matchLabels":{"app":"web"},
		"matchExpressions":[{"key":"env","operator":"NotIn","values":["prod"]}]}}}`))

	noEnv := addPod(store, idx, "default", "no-env", map[string]string{"app": "web"})

	got := targetIDs(g.EdgesFrom(np.EntryKey()))
	if len(got) != 2 || !got["default/dev"] || !got["default/no-env"] {
		t.Fatalf("want dev and no-env, got %v", got)
	}

	// Relabelling a Pod into the excluded set unlinks it.
	promoted := makeEntry("core::v1::Pod", "default", "no-env")
	promoted.Labels = map[string]string{"app": "web", "env": "prod"}
	store.Put(promoted)
	idx.OnUpdate(noEnv, promoted, json.RawMessage(`{}`))

	got = targetIDs(g.EdgesFrom(np.EntryKey()))
	if len(got) != 1 || !got["default/dev"] {
		t.Fatalf("after relabel: want only dev, got %v", got)
	}
}

// TestGraphIndexer_SelectorObject_AbsentOrInvalidSelectsNothing — an absent
// or invalid selector must not fall back to selecting everything.
func TestGraphIndexer_SelectorObject_AbsentOrInvalidSelectsNothing(t *testing.T) {
	for name, raw := range map[string]string{
		"absent":  `{"spec":{}}`,
		"invalid": `{"spec":{"podSelector":{"matchExpressions":[{"key":"env","operator":"Equals","values":["x"]}]}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			g, store, idx := setupIndexer()
			declareNetworkPolicy(g)
			addPod(store, idx, "default", "p1", nil)

			np := makeEntry("networking::v1::NetworkPolicy", "default", "np")
			store.Put(np)
			idx.OnAdd(np, json.RawMessage(raw))
			addPod(store, idx, "default", "p2", nil)

			if got := g.EdgesFrom(np.EntryKey()); len(got) != 0 {
				t.Fatalf("want no edges, got %v", got)
			}
		})
	}
}

// TestGraphIndexer_PlainSelectorStillNeedsLabels — a Service with an empty
// selector selects nothing, unlike an empty LabelSelector object.
func TestGraphIndexer_PlainSelectorStillNeedsLabels(t *testing.T) {
	g, store, idx := setupIndexer()
	declareK8sSubset(g)
	addPod(store, idx, "default", "p1", nil)

	svc := makeEntry("core::v1::Service", "default", "headless")
	store.Put(svc)
	idx.OnAdd(svc, json.RawMessage(`{"spec":{"selector":{}}}`))
	addPod(store, idx, "default", "p2", nil)

	if got := g.EdgesFrom(svc.EntryKey()); len(got) != 0 {
		t.Fatalf("want no edges, got %v", got)
	}
}

// TestGraphIndexer_TwoSelectorDeclarations — a resource with two selector
// declarations keeps both cached (they used to overwrite each other).
func TestGraphIndexer_TwoSelectorDeclarations(t *testing.T) {
	g, store, idx := setupIndexer()
	g.SetDeclarations("k8s", "example::v1::Group", []resource.RelationshipDescriptor{
		{
			Type: resource.RelSelects, TargetResourceKey: "core::v1::Pod", Label: "selects",
			Extractor: &resource.RelationshipExtractor{Method: MethodLabelSelector, FieldPath: "spec.pods"},
		},
		{
			Type: resource.RelSelects, TargetResourceKey: "core::v1::Service", Label: "selects",
			Extractor: &resource.RelationshipExtractor{Method: MethodLabelSelector, FieldPath: "spec.services"},
		},
	})

	grp := makeEntry("example::v1::Group", "default", "g")
	store.Put(grp)
	idx.OnAdd(grp, json.RawMessage(`{"spec":{"pods":{"app":"web"},"services":{"app":"web"}}}`))

	addPod(store, idx, "default", "p1", map[string]string{"app": "web"})
	svc := makeEntry("core::v1::Service", "default", "s1")
	svc.Labels = map[string]string{"app": "web"}
	store.Put(svc)
	idx.OnAdd(svc, json.RawMessage(`{}`))

	if got := g.EdgesFrom(grp.EntryKey()); len(got) != 2 {
		t.Fatalf("want edges to the pod and the service, got %v", got)
	}
}
