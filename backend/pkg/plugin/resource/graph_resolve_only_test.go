package resource

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

// The fixture below is shaped like the Kubernetes plugin's relationship table
// (omniview-plugin-kubernetes, resourcers/relationships.go): `k8s:<group>/<plural>`
// types, namespace scope taken from metadata.namespace, ownership declared by the
// child with EdgeIncoming and a gjson query, and "resolve-only" rows that carry
// no Extractor. Rows are copied for the types these tests need; row numbers in
// comments refer to that table.

const (
	k8sPods         = "k8s:/pods"
	k8sNodes        = "k8s:/nodes"
	k8sConfigMaps   = "k8s:/configmaps"
	k8sReplicaSets  = "k8s:apps/replicasets"
	k8sDeployments  = "k8s:apps/deployments"
	k8sDaemonSets   = "k8s:apps/daemonsets"
	k8sStatefulSets = "k8s:apps/statefulsets"
	k8sJobs         = "k8s:batch/jobs"
	k8sHPAs         = "k8s:autoscaling/horizontalpodautoscalers"
	k8sNamespace    = "default"
)

func k8sFixtureTypes() []string {
	return []string{k8sPods, k8sNodes, k8sConfigMaps, k8sReplicaSets, k8sDeployments, k8sDaemonSets, k8sStatefulSets, k8sJobs, k8sHPAs}
}

func k8sNamespaced(typ string) bool { return typ != k8sNodes }

func k8sFixtureCatalog() resourcev2.Catalog {
	types := k8sFixtureTypes()
	catalog := canonicalTestCatalog("p1", types[0])
	for _, typ := range types[1:] {
		catalog.Types = append(catalog.Types, canonicalTestCatalog("p1", typ).Types[0])
	}
	for i := range catalog.Types {
		catalog.Types[i].DefaultRepresentation = "native"
		catalog.Types[i].Capabilities = append(catalog.Types[i].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
		if !k8sNamespaced(catalog.Types[i].Type) {
			continue
		}
		catalog.Types[i].IdentityDimensions = []resourcev2.Dimension{{Name: "namespace"}}
		catalog.Types[i].QueryDimensions = []resourcev2.Dimension{{Name: "namespace"}}
		for j := range catalog.Types[i].Capabilities {
			catalog.Types[i].Capabilities[j].Scope = resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}}
		}
	}
	return catalog
}

func k8sNamespaceScope() []resourcev2.ScopeExtractor {
	return []resourcev2.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}}
}

// k8sOwnedBy is the child-declared ownership row (rows 1-4 and 13).
func k8sOwnedBy(target, kind string) resourcev2.RelationshipDescriptor {
	return resourcev2.RelationshipDescriptor{
		Type: resourcev2.RelOwns, TargetType: target, ScopeExtractors: k8sNamespaceScope(),
		Label: "owned by", Direction: resourcev2.EdgeIncoming,
		Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="` + kind + `").name`},
	}
}

// k8sResolveOnly is a parent-declared row without an Extractor (rows 15, 18 and 21).
func k8sResolveOnly(relationship resourcev2.RelationshipType, target, label, inverse string) resourcev2.RelationshipDescriptor {
	return resourcev2.RelationshipDescriptor{
		Type: relationship, TargetType: target, ScopeExtractors: k8sNamespaceScope(),
		Label: label, InverseLabel: inverse, Cardinality: "one-to-many",
	}
}

func k8sFixtureRelationships(typ string) []resourcev2.RelationshipDescriptor {
	switch typ {
	case k8sPods:
		return []resourcev2.RelationshipDescriptor{
			k8sOwnedBy(k8sReplicaSets, "ReplicaSet"),
			k8sOwnedBy(k8sDaemonSets, "DaemonSet"),
			k8sOwnedBy(k8sStatefulSets, "StatefulSet"),
			k8sOwnedBy(k8sJobs, "Job"),
			{
				Type: resourcev2.RelRunsOn, TargetType: k8sNodes, Label: "runs on", TargetScope: []resourcev2.ScopeEntry{},
				Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.nodeName"},
			},
		}
	case k8sNodes:
		// Row 12: resolve-only, the inverse presentation of the Pod's runs_on row.
		return []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelRunsOn, TargetType: k8sPods, Label: "runs", InverseLabel: "runs on", Cardinality: "one-to-many"}}
	case k8sReplicaSets:
		return []resourcev2.RelationshipDescriptor{k8sOwnedBy(k8sDeployments, "Deployment")}
	case k8sDeployments:
		return []resourcev2.RelationshipDescriptor{
			// Row 15: resolve-only, and no extractor-backed row declares `manages`.
			k8sResolveOnly(resourcev2.RelManages, k8sReplicaSets, "manages", "managed by"),
			{
				Type: resourcev2.RelUses, TargetType: k8sConfigMaps, ScopeExtractors: k8sNamespaceScope(), Label: "uses",
				Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.configMap.name"},
			},
		}
	case k8sDaemonSets, k8sStatefulSets:
		// Rows 18 and 21: resolve-only, the inverse presentation of the Pod's owner rows.
		return []resourcev2.RelationshipDescriptor{k8sResolveOnly(resourcev2.RelOwns, k8sPods, "owns", "owned by")}
	case k8sHPAs:
		// Rows 30 and 31: resolve-only, the HPA resourcer reads scaleTargetRef.kind at runtime.
		return []resourcev2.RelationshipDescriptor{
			{Type: resourcev2.RelManages, TargetType: k8sDeployments, ScopeExtractors: k8sNamespaceScope(), Label: "manages"},
			{Type: resourcev2.RelManages, TargetType: k8sStatefulSets, ScopeExtractors: k8sNamespaceScope(), Label: "manages"},
		}
	}
	return nil
}

type k8sObject struct {
	name string
	body map[string]any
}

func k8sNamespacedObject(name string, owner, spec map[string]any) k8sObject {
	metadata := map[string]any{"name": name, "namespace": k8sNamespace}
	if owner != nil {
		metadata["ownerReferences"] = []any{owner}
	}
	body := map[string]any{"metadata": metadata}
	if spec != nil {
		body["spec"] = spec
	}
	return k8sObject{name: name, body: body}
}

func k8sOwnerReference(kind, name string) map[string]any {
	return map[string]any{"kind": kind, "name": name}
}

func k8sFixtureCluster() map[string][]k8sObject {
	onNode := map[string]any{"nodeName": "node-1"}
	return map[string][]k8sObject{
		k8sNodes:        {{name: "node-1", body: map[string]any{"metadata": map[string]any{"name": "node-1"}}}},
		k8sPods:         {k8sNamespacedObject("agent-x1", k8sOwnerReference("DaemonSet", "agent"), onNode), k8sNamespacedObject("db-0", k8sOwnerReference("StatefulSet", "db"), onNode)},
		k8sDaemonSets:   {k8sNamespacedObject("agent", nil, nil)},
		k8sStatefulSets: {k8sNamespacedObject("db", nil, nil)},
		k8sReplicaSets:  {k8sNamespacedObject("web-5d", k8sOwnerReference("Deployment", "web"), nil)},
		k8sDeployments: {k8sNamespacedObject("web", nil, map[string]any{"template": map[string]any{"spec": map[string]any{
			"volumes": []any{map[string]any{"configMap": map[string]any{"name": "web-config"}}},
		}}})},
		k8sHPAs: {k8sNamespacedObject("web", nil, nil)},
	}
}

func k8sRecord(target resourcev2.ReadTarget, object k8sObject) (resourcev2.Record, error) {
	record := sourceTestRecord(target, object.name, "uid-"+object.name)
	if k8sNamespaced(target.Type) {
		record.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: k8sNamespace}}
	}
	body, err := resourcev2.ValueFromNative(object.body)
	if err != nil {
		return resourcev2.Record{}, err
	}
	record.Body = body
	return record, nil
}

// serveK8sCluster answers every demanded source population from the fixture
// cluster, the way the plugin's informers would, so a test only calls the graph.
func serveK8sCluster(t *testing.T, provider *scriptedSourceProvider, cluster map[string][]k8sObject) {
	t.Helper()
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for {
			select {
			case <-stop:
				return
			case open := <-provider.opens:
				observations := make([]resourcev2.SourceObservation, 0, len(cluster[open.request.Target.Type]))
				for _, object := range cluster[open.request.Target.Type] {
					record, err := k8sRecord(open.request.Target, object)
					if err != nil {
						t.Errorf("fixture object %s: %v", object.name, err)
						return
					}
					observations = append(observations, resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)})
				}
				sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: observations}})
				sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
			}
		}
	}()
}

type k8sGraphFixture struct {
	ctrl    *controller
	service *GraphService
}

func newK8sGraphFixture(t *testing.T) k8sGraphFixture {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		return k8sFixtureCatalog(), nil
	}
	provider.GetRelationshipsFunc = func(_ context.Context, _ resourcev2.AccessRoute, typ string) ([]resourcev2.RelationshipDescriptor, error) {
		return k8sFixtureRelationships(typ), nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	serveK8sCluster(t, provider.scriptedSourceProvider, k8sFixtureCluster())
	return k8sGraphFixture{ctrl: ctrl, service: NewGraphService(ctrl, nil, nil)}
}

func (f k8sGraphFixture) root(t *testing.T, typ, name string) (resourcev2.ResourceReference, resourcev2.AccessRoute) {
	t.Helper()
	target := admittedReadTarget(t, f.ctrl, "p1", "conn-1", typ)
	reference := sourceTestRecord(target.Target, name, "uid-"+name).Reference
	if k8sNamespaced(typ) {
		reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: k8sNamespace}}
	}
	return reference, target.Target.Route
}

func (f k8sGraphFixture) related(t *testing.T, typ, name, direction string, relationshipType *string) (graph.RelatedResult, error) {
	t.Helper()
	reference, route := f.root(t, typ, name)
	ctx, cancel := context.WithTimeout(testInvocationContext(), 10*time.Second)
	defer cancel()
	return f.service.GetRelated(ctx, graph.RelatedRequest{PluginID: "p1", Reference: reference, Route: route, Direction: direction, RelationshipType: relationshipType})
}

func k8sEdges(edges []graph.GraphEdge) []string {
	out := make([]string, 0, len(edges))
	for _, edge := range edges {
		source, target := edge.Source.Reference.Address, edge.Target.Reference.Address
		out = append(out, fmt.Sprintf("%s/%s -%s-> %s/%s", source.Type, source.ID, edge.Type, target.Type, target.ID))
	}
	sort.Strings(out)
	return out
}

func relationshipFilter(value resourcev2.RelationshipType) *string {
	filter := string(value)
	return &filter
}

// A resolve-only declaration is normally the inverse presentation of an edge the
// other type's extractor already produces. Matching one must not fail the query.
func TestGraphDemandResolveOnlyInverseDeclarationsDoNotFailQueries(t *testing.T) {
	for _, scenario := range []struct {
		name             string
		typ, object      string
		direction        string
		relationshipType *string
		want             []string
	}{
		// Pod incoming matches the extractor rows 1-4 and the resolve-only rows 12, 18 and 21.
		{name: "pod incoming", typ: k8sPods, object: "agent-x1", direction: "incoming", want: []string{"k8s:apps/daemonsets/agent -owns-> k8s:/pods/agent-x1"}},
		{name: "pod both", typ: k8sPods, object: "agent-x1", direction: "both", want: []string{
			"k8s:apps/daemonsets/agent -owns-> k8s:/pods/agent-x1",
			"k8s:/pods/agent-x1 -runs_on-> k8s:/nodes/node-1",
		}},
		// Node outgoing matches only the resolve-only row 12.
		{name: "node outgoing", typ: k8sNodes, object: "node-1", direction: "outgoing", want: []string{}},
		{name: "node incoming", typ: k8sNodes, object: "node-1", direction: "incoming", want: []string{
			"k8s:/pods/agent-x1 -runs_on-> k8s:/nodes/node-1",
			"k8s:/pods/db-0 -runs_on-> k8s:/nodes/node-1",
		}},
		{name: "pod incoming owns", typ: k8sPods, object: "db-0", direction: "incoming", relationshipType: relationshipFilter(resourcev2.RelOwns), want: []string{"k8s:apps/statefulsets/db -owns-> k8s:/pods/db-0"}},
		{name: "pod both owns", typ: k8sPods, object: "db-0", direction: "both", relationshipType: relationshipFilter(resourcev2.RelOwns), want: []string{"k8s:apps/statefulsets/db -owns-> k8s:/pods/db-0"}},
		// Pod incoming runs_on matches only row 12; the real edge is the Pod's outgoing one.
		{name: "pod incoming runs_on", typ: k8sPods, object: "agent-x1", direction: "incoming", relationshipType: relationshipFilter(resourcev2.RelRunsOn), want: []string{}},
		{name: "pod both runs_on", typ: k8sPods, object: "agent-x1", direction: "both", relationshipType: relationshipFilter(resourcev2.RelRunsOn), want: []string{"k8s:/pods/agent-x1 -runs_on-> k8s:/nodes/node-1"}},
		// The parents' resolve-only rows 18 and 21 are answered by the Pod's own owner rows.
		{name: "daemonset outgoing", typ: k8sDaemonSets, object: "agent", direction: "outgoing", want: []string{"k8s:apps/daemonsets/agent -owns-> k8s:/pods/agent-x1"}},
		{name: "statefulset outgoing", typ: k8sStatefulSets, object: "db", direction: "outgoing", want: []string{"k8s:apps/statefulsets/db -owns-> k8s:/pods/db-0"}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newK8sGraphFixture(t)
			related, err := fixture.related(t, scenario.typ, scenario.object, scenario.direction, scenario.relationshipType)
			require.NoError(t, err)
			require.ElementsMatch(t, scenario.want, k8sEdges(related.Edges))
			require.False(t, related.Truncated, "every edge a resolve-only row could describe is computed from its inverse row")
		})
	}
}

// A resolve-only row with no extractor-backed inverse cannot be computed by the
// host. The computable edges are still returned and the result says it may be
// incomplete through the response's existing truncation flag.
func TestGraphDemandUncoveredResolveOnlyDeclarationReturnsComputableEdgesAsTruncated(t *testing.T) {
	fixture := newK8sGraphFixture(t)
	related, err := fixture.related(t, k8sDeployments, "web", "outgoing", nil)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{
		"k8s:apps/deployments/web -owns-> k8s:apps/replicasets/web-5d",
		"k8s:apps/deployments/web -uses-> k8s:/configmaps/web-config",
	}, k8sEdges(related.Edges))
	require.True(t, related.Truncated, "row 15 (manages) has no extractor, so the host cannot say the result is complete")
}

func TestGraphDemandSubgraphMarksUncoveredResolveOnlyDeclarationTruncated(t *testing.T) {
	fixture := newK8sGraphFixture(t)
	reference, route := fixture.root(t, k8sDeployments, "web")
	ctx, cancel := context.WithTimeout(testInvocationContext(), 10*time.Second)
	defer cancel()
	subgraph, err := fixture.service.GetSubgraph(ctx, "p1", reference, route, 0, 1)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{
		"k8s:apps/deployments/web -owns-> k8s:apps/replicasets/web-5d",
		"k8s:apps/deployments/web -uses-> k8s:/configmaps/web-config",
	}, k8sEdges(subgraph.Edges))
	require.True(t, subgraph.Truncated)
}

// Nothing the host can compute satisfies these queries, so an empty edge list would
// be indistinguishable from "no relationships". They stay UNSUPPORTED.
func TestGraphDemandOnlyUncoveredResolveOnlyDeclarationsStayUnsupported(t *testing.T) {
	for _, scenario := range []struct {
		name             string
		typ, object      string
		direction        string
		relationshipType *string
	}{
		{name: "deployment manages", typ: k8sDeployments, object: "web", direction: "outgoing", relationshipType: relationshipFilter(resourcev2.RelManages)},
		{name: "hpa outgoing", typ: k8sHPAs, object: "web", direction: "outgoing"},
		{name: "hpa both", typ: k8sHPAs, object: "web", direction: "both"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newK8sGraphFixture(t)
			related, err := fixture.related(t, scenario.typ, scenario.object, scenario.direction, scenario.relationshipType)
			require.Error(t, err)
			require.Equal(t, "UNSUPPORTED", requireAppError(t, err).Code)
			require.Empty(t, related.Edges)
		})
	}
}

// The Related tab reads the same demand through a mounted observation, so the
// reported failure must also clear there.
func TestGraphObservationResolveOnlyInverseDeclarationsReachReady(t *testing.T) {
	fixture := newK8sGraphFixture(t)
	reference, route := fixture.root(t, k8sPods, "agent-x1")
	life, cancel := context.WithCancel(context.Background())
	defer cancel()
	snapshots := make(chan HostGraphObservationSnapshot, 16)
	request := HostGraphObservationRequest{ClientToken: uuid.NewString(), PluginID: "p1", Reference: reference, Route: route, Kind: "related", Direction: "both"}
	opened, err := fixture.service.openObservation(testInvocationContext(), life, request, func(snapshot HostGraphObservationSnapshot) { snapshots <- snapshot })
	require.NoError(t, err)
	t.Cleanup(func() { _ = fixture.service.closeObservation(testInvocationContext(), opened.ObservationID) })
	require.NoError(t, fixture.service.syncObservation(testInvocationContext(), opened.ObservationID))
	for {
		select {
		case snapshot := <-snapshots:
			switch snapshot.State {
			case "failed":
				t.Fatalf("observation failed: %+v", snapshot.Error)
			case "ready":
				require.ElementsMatch(t, []string{
					"k8s:apps/daemonsets/agent -owns-> k8s:/pods/agent-x1",
					"k8s:/pods/agent-x1 -runs_on-> k8s:/nodes/node-1",
				}, k8sEdges(snapshot.Edges))
				return
			}
		case <-time.After(10 * time.Second):
			t.Fatal("graph observation did not settle")
		}
	}
}
