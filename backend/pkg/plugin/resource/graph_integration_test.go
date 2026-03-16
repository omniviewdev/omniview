package resource

import (
	"encoding/json"
	"testing"

	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
)

func TestIntegration_WatchEventToGraphQuery(t *testing.T) {
	// Setup: registry + graph + dispatcher + sink
	store := registry.NewMemoryStore()
	g := graph.NewRelationshipGraph()
	graphIdx := graph.NewGraphIndexer(g, store)
	disp := indexer.NewDispatcher([]indexer.ResourceIndexer{graphIdx})
	disp.Start()
	defer disp.Stop()

	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.registryStore = store
	ctrl.dispatcher = disp
	ctrl.graph = g

	sink := &engineWatchSink{
		pluginID:   "k8s",
		ctrl:       ctrl,
		store:      store,
		dispatcher: disp,
	}

	// Declare: Pod runs_on Node via spec.nodeName
	g.SetDeclarations("k8s", "core::v1::Pod", []sdkresource.RelationshipDescriptor{
		{
			Type:              sdkresource.RelRunsOn,
			TargetResourceKey: "core::v1::Node",
			Label:             "runs on",
			Extractor: &sdkresource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: "spec.nodeName",
			},
		},
	})

	// Simulate watch events
	sink.OnAdd(sdkresource.WatchAddPayload{
		Key: "core::v1::Pod", Connection: "c1",
		ID: "nginx", Namespace: "default",
		Metadata: sdkresource.ResourceMetadata{UID: "pod-uid-1"},
		Data: json.RawMessage(`{
			"metadata": {"name":"nginx","namespace":"default","uid":"pod-uid-1"},
			"spec": {"nodeName": "worker-1"}
		}`),
	})

	disp.Flush()

	// Verify: registry has the entry
	entry, ok := store.Get("k8s", "c1", "core::v1::Pod", "default", "nginx")
	if !ok || entry == nil {
		t.Fatal("expected registry entry")
	}

	// Verify: graph has the edge
	podNode := graph.GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::Pod", ID: "nginx", Namespace: "default",
	}
	edges, err := g.GetRelated(podNode, graph.Outgoing, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge (runs_on), got %d", len(edges))
	}
	if edges[0].Target.ID != "worker-1" {
		t.Fatalf("expected target worker-1, got %s", edges[0].Target.ID)
	}

	// Simulate delete
	sink.OnDelete(sdkresource.WatchDeletePayload{
		Key: "core::v1::Pod", Connection: "c1",
		ID: "nginx", Namespace: "default",
		Data: json.RawMessage(`{"metadata":{"name":"nginx","namespace":"default","uid":"pod-uid-1"}}`),
	})

	disp.Flush()

	// Verify: registry entry removed
	_, ok = store.Get("k8s", "c1", "core::v1::Pod", "default", "nginx")
	if ok {
		t.Fatal("expected registry entry removed after delete")
	}

	// Verify: graph edges removed
	edges, _ = g.GetRelated(podNode, graph.Outgoing, nil)
	if len(edges) != 0 {
		t.Fatalf("expected 0 edges after delete, got %d", len(edges))
	}
}

func TestIntegration_OwnershipChain(t *testing.T) {
	store := registry.NewMemoryStore()
	g := graph.NewRelationshipGraph()
	graphIdx := graph.NewGraphIndexer(g, store)
	disp := indexer.NewDispatcher([]indexer.ResourceIndexer{graphIdx})
	disp.Start()
	defer disp.Stop()

	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.registryStore = store
	ctrl.dispatcher = disp
	ctrl.graph = g

	sink := &engineWatchSink{
		pluginID: "k8s", ctrl: ctrl,
		store: store, dispatcher: disp,
	}

	// Declare: Pod owned by ReplicaSet via fieldPath + EdgeIncoming
	g.SetDeclarations("k8s", "core::v1::Pod", []sdkresource.RelationshipDescriptor{
		{
			Type:              sdkresource.RelOwns,
			TargetResourceKey: "apps::v1::ReplicaSet",
			Label:             "owned by",
			Direction:         sdkresource.EdgeIncoming,
			Extractor: &sdkresource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: `metadata.ownerReferences.#(kind=="ReplicaSet").name`,
			},
		},
	})

	// Add Pod with ownerReference to ReplicaSet
	sink.OnAdd(sdkresource.WatchAddPayload{
		Key: "core::v1::Pod", Connection: "c1",
		ID: "web-abc-1", Namespace: "default",
		Data: json.RawMessage(`{
			"metadata": {
				"name": "web-abc-1",
				"namespace": "default",
				"uid": "pod-uid-1",
				"ownerReferences": [
					{"apiVersion":"apps/v1","kind":"ReplicaSet","name":"web-abc","uid":"rs-uid-1"}
				]
			}
		}`),
		Metadata: sdkresource.ResourceMetadata{UID: "pod-uid-1"},
	})

	disp.Flush()

	// Verify: ownership edge exists (ReplicaSet → Pod)
	// The extractor inherits the Pod's namespace ("default") for the target.
	rsNode := graph.GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "apps::v1::ReplicaSet", ID: "web-abc", Namespace: "default",
	}
	edges, _ := g.GetRelated(rsNode, graph.Outgoing, nil)
	if len(edges) != 1 {
		t.Fatalf("expected 1 owns edge from RS, got %d", len(edges))
	}
	if edges[0].Target.ID != "web-abc-1" || edges[0].Type != sdkresource.RelOwns {
		t.Fatalf("unexpected edge: %+v", edges[0])
	}
}

func TestIntegration_ClusterScopedTarget(t *testing.T) {
	store := registry.NewMemoryStore()
	g := graph.NewRelationshipGraph()
	graphIdx := graph.NewGraphIndexer(g, store)
	disp := indexer.NewDispatcher([]indexer.ResourceIndexer{graphIdx})
	disp.Start()
	defer disp.Stop()

	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.registryStore = store
	ctrl.dispatcher = disp
	ctrl.graph = g

	sink := &engineWatchSink{
		pluginID: "k8s", ctrl: ctrl,
		store: store, dispatcher: disp,
	}

	clusterScoped := false
	g.SetDeclarations("k8s", "core::v1::PersistentVolumeClaim", []sdkresource.RelationshipDescriptor{
		{
			Type:              sdkresource.RelUses,
			TargetResourceKey: "core::v1::PersistentVolume",
			Label:             "uses",
			TargetNamespaced:  &clusterScoped,
			Extractor: &sdkresource.RelationshipExtractor{
				Method:    "fieldPath",
				FieldPath: "spec.volumeName",
			},
		},
	})

	sink.OnAdd(sdkresource.WatchAddPayload{
		Key: "core::v1::PersistentVolumeClaim", Connection: "c1",
		ID: "data-pvc", Namespace: "default",
		Metadata: sdkresource.ResourceMetadata{UID: "pvc-uid-1"},
		Data:     json.RawMessage(`{"spec":{"volumeName":"pv-0001"}}`),
	})

	disp.Flush()

	pvcNode := graph.GraphNode{
		PluginID: "k8s", ConnectionID: "c1",
		ResourceKey: "core::v1::PersistentVolumeClaim", ID: "data-pvc", Namespace: "default",
	}
	edges, err := g.GetRelated(pvcNode, graph.Outgoing, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
	if edges[0].Target.Namespace != "" {
		t.Errorf("expected empty namespace for PV target, got %q", edges[0].Target.Namespace)
	}
	if edges[0].Target.ID != "pv-0001" {
		t.Errorf("expected target pv-0001, got %s", edges[0].Target.ID)
	}
}

func TestIntegration_ConnectionTeardown(t *testing.T) {
	store := registry.NewMemoryStore()
	g := graph.NewRelationshipGraph()
	graphIdx := graph.NewGraphIndexer(g, store)
	disp := indexer.NewDispatcher([]indexer.ResourceIndexer{graphIdx})
	disp.Start()
	defer disp.Stop()

	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.registryStore = store
	ctrl.dispatcher = disp
	ctrl.graph = g
	sink := &engineWatchSink{
		pluginID: "k8s", ctrl: ctrl,
		store: store, dispatcher: disp,
	}

	g.SetDeclarations("k8s", "core::v1::Pod", []sdkresource.RelationshipDescriptor{
		{
			Type: sdkresource.RelRunsOn, TargetResourceKey: "core::v1::Node",
			Label: "runs on",
			Extractor: &sdkresource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.nodeName"},
		},
	})

	// Add 3 pods
	for i, name := range []string{"p1", "p2", "p3"} {
		sink.OnAdd(sdkresource.WatchAddPayload{
			Key: "core::v1::Pod", Connection: "c1",
			ID: name, Namespace: "default",
			Metadata: sdkresource.ResourceMetadata{UID: "uid-" + string(rune('0'+i))},
			Data:     json.RawMessage(`{"metadata":{"name":"` + name + `","namespace":"default","uid":"uid-` + string(rune('0'+i)) + `"},"spec":{"nodeName":"worker-1"}}`),
		})
	}

	disp.Flush()

	// Verify 3 entries + 3 edges
	results := store.ScanByResourceKey("k8s", "c1", "core::v1::Pod")
	if len(results) != 3 {
		t.Fatalf("expected 3 registry entries, got %d", len(results))
	}

	// Tear down connection
	removed := store.DeleteByConnection("k8s", "c1")
	for _, entry := range removed {
		disp.Enqueue(indexer.Event{Type: indexer.EventDelete, Entry: entry})
	}
	g.RemoveEdgesForConnection("k8s", "c1")

	disp.Flush()

	// Verify all cleaned up
	results = store.ScanByResourceKey("k8s", "c1", "core::v1::Pod")
	if len(results) != 0 {
		t.Fatalf("expected 0 entries after teardown, got %d", len(results))
	}
}
