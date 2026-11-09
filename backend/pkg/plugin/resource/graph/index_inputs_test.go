package graph

import (
	"encoding/json"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestIndexInputsPreserveDeclaredDependenciesAndEviction(t *testing.T) {
	g, store, idx := setupIndexer()
	declareK8sSubset(g, resource.AccessRoute{Connection: "c1"})
	pod := makeEntry("core::v1::Pod", "default", "child")
	pod.Labels = map[string]string{"app": "web"}
	raw := json.RawMessage(`{"spec":{"nodeName":"worker-1"},"metadata":{"ownerReferences":[{"kind":"ReplicaSet","name":"parent-1"}]}}`)
	store.Put(pod)
	idx.OnAdd(pod, raw)
	independent := GraphEdge{Source: node("k8s", "c1", "core::v1::Node", "", "outside"), Target: nodeFromEntry(pod), Type: resource.RelUses, Label: "independent"}
	g.AddEdge(independent)
	g.TakeChanged()
	idx.OnUpdate(pod, pod, json.RawMessage(`{"spec":{"nodeName":"worker-1"},"metadata":{"ownerReferences":[{"kind":"ReplicaSet","name":"parent-1"}]},"status":{"ready":true}}`))
	require.Empty(t, g.TakeChanged(), "status delivery must not emit graph changes")
	require.Len(t, g.EdgesTo(pod.EntryKey()), 2)
	// Both configured field and owner-reference change, with identical labels.
	idx.OnUpdate(pod, pod, json.RawMessage(`{"spec":{"nodeName":"worker-2"},"metadata":{"ownerReferences":[{"kind":"ReplicaSet","name":"parent-2"}]}}`))
	require.Equal(t, "worker-2", g.EdgesFrom(pod.EntryKey())[0].Target.Reference.Address.ID)
	parents := g.EdgesTo(pod.EntryKey())
	require.Len(t, parents, 2)
	found := false
	for _, edge := range parents {
		if edge.Source.Reference.Address.ID == "parent-2" {
			found = true
		}
	}
	require.True(t, found)
	// Direct eviction must invalidate witnesses even without a registry delete.
	g.RemoveDerivedEdges(pod.EntryKey())
	idx.OnUpdate(pod, pod, raw)
	require.Equal(t, "worker-1", g.EdgesFrom(pod.EntryKey())[0].Target.Reference.Address.ID)
	idx.OnDelete(pod)
	incarnation := "new"
	recreated := pod
	recreated.Reference.Incarnation = &incarnation
	store.Put(recreated)
	idx.OnAdd(recreated, raw)
	require.Equal(t, &incarnation, g.EdgesFrom(pod.EntryKey())[0].Source.Reference.Incarnation)
	require.Len(t, g.EdgesTo(pod.EntryKey()), 2)
	// Rebinding an identical payload must use the new declaration snapshot.
	setTestDeclarations(g, "k8s", pod.Route, pod.Reference.Address.Type, []resource.RelationshipDescriptor{{Type: resource.RelRunsOn, TargetType: "core::v1::Node", Extractor: &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "other"}}})
	idx.OnUpdate(recreated, recreated, json.RawMessage(`{"other":"worker-3"}`))
	require.Equal(t, "worker-3", g.EdgesFrom(pod.EntryKey())[0].Target.Reference.Address.ID)
}

func TestIndexInputsScopeExtractorChangesTarget(t *testing.T) {
	g, _, idx := setupIndexer()
	pod := makeEntry("core::v1::Pod", "default", "child")
	setTestDeclarations(g, "k8s", pod.Route, pod.Reference.Address.Type, []resource.RelationshipDescriptor{{Type: resource.RelUses, TargetType: "apps::v1::ReplicaSet", ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "placement"}}, Extractor: &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "owner"}}})
	idx.OnAdd(pod, json.RawMessage(`{"owner":"parent","placement":"west"}`))
	require.Equal(t, "west", g.EdgesFrom(pod.EntryKey())[0].Target.Reference.Address.Scope[0].Value)
	idx.OnUpdate(pod, pod, json.RawMessage(`{"owner":"parent","placement":"east"}`))
	require.Equal(t, "east", g.EdgesFrom(pod.EntryKey())[0].Target.Reference.Address.Scope[0].Value)
}

func TestIndexInputsTargetEvictionInvalidatesDeclarer(t *testing.T) {
	g, _, idx := setupIndexer()
	declareK8sSubset(g, resource.AccessRoute{Connection: "c1"})
	pod := makeEntry("core::v1::Pod", "default", "child")
	raw := json.RawMessage(`{"spec":{"nodeName":"worker"}}`)
	idx.OnAdd(pod, raw)
	targetKey := g.EdgesFrom(pod.EntryKey())[0].Target.Key()
	g.RemoveEdgesForNode(targetKey)
	require.Empty(t, g.EdgesFrom(pod.EntryKey()))
	idx.OnUpdate(pod, pod, raw)
	require.Len(t, g.EdgesFrom(pod.EntryKey()), 1)
	require.Equal(t, targetKey, g.EdgesFrom(pod.EntryKey())[0].Target.Key())
}
