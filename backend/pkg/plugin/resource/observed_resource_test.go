package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

const observedProjectionSchema = `{"type":"object","properties":{"name":{"type":"string"},"profile":{"type":"object","properties":{"zone":{"type":"string"}}},"opaque":{"type":"string","writeOnly":true},"hidden":{"type":"string","x-sensitive":true},"masked":{"type":"string","format":"password"},"private":{"type":"object","writeOnly":true,"properties":{"zone":{"type":"string"}}},"items":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"}}}},"nullable":{"type":["string","null"]},"secret":{"type":"string"}},"additionalProperties":true}`

// Populate the production immutable wire cache through real snapshot admission,
// publication and replacement, rather than fabricating observation/revision fields.
func observedProjectionFixture(t *testing.T) (*controller, *scriptedSourceProvider, *sourceSession, resourcev2.Record, *int, *int) {
	t.Helper()
	docCalls, getCalls := new(int), new(int)
	documentRef := resourcev2.SchemaDocumentReference{ID: "observed-schema", Revision: "schema-1"}
	// Bind the schema before the first target/catalog admission. Changing a
	// schema under an already cached catalog revision correctly retires sources.
	ctrl, _, provider, target := sourceTestFixture(t, func(provider *scriptedSourceProvider) {
		provider.CatalogFunc = withReferencedSchema(provider.CatalogFunc, documentRef)
		provider.GetSchemaDocumentFunc = func(_ context.Context, route resourcev2.AccessRoute, reference resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
			require.Equal(t, resourcev2.AccessRoute{Connection: "conn-1"}, route)
			require.Equal(t, documentRef, reference)
			(*docCalls)++
			return resourcev2.SchemaDocument{Reference: reference, Dialect: resourcev2.DialectJSONSchema202012, Document: []byte(observedProjectionSchema)}, nil
		}
		provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
			(*getCalls)++
			return resourcev2.Record{}, errors.New("resource Get must not execute")
		}
	})
	admitted, err := ctrl.admit(testInvocationContext(), "resource.OpenSourceView", readTarget("p1", target.Target))
	require.NoError(t, err)
	_, generation, ctx, cancel, mode, owner, err := ctrl.sources.prepare(admitted, "p1", target.Target, "ifSupported")
	require.NoError(t, err)
	require.NotEmpty(t, owner, "source setup must retain the admitted observation owner")
	t.Cleanup(cancel)
	session := &sourceSession{coordinator: ctrl.sources, key: "observed", pluginID: "p1", owner: owner, target: target.Target, pluginGeneration: generation, ctx: ctx, cancel: cancel, mode: mode, generation: "observed-generation", members: map[string]sourceMember{}, staging: map[string]sourceMember{}, views: map[string]*sourceView{}}
	ctrl.sources.sessions[session.key] = session
	record := sourceTestRecord(target.Target, "pod", "uid-pod")
	record.Representation = ctx.Value(sourceBindingKey{}).(sourceBinding).Representation
	record.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"name":       {Kind: "string", String: "pod"},
		"profile":    {Kind: "map", Map: map[string]resourcev2.Value{"zone": {Kind: "string", String: "east"}}},
		"private":    {Kind: "map", Map: map[string]resourcev2.Value{"zone": {Kind: "string", String: "private-zone"}}},
		"opaque":     {Kind: "string", String: "private-value"},
		"hidden":     {Kind: "string", String: "private-value"},
		"masked":     {Kind: "string", String: "private-value"},
		"secret":     {Kind: "string", String: "private-value"},
		"undeclared": {Kind: "string", String: "not-schema-approved"},
		"nullable":   {Kind: "null"},
		"items":      {Kind: "list", List: []resourcev2.Value{{Kind: "map", Map: map[string]resourcev2.Value{"name": {Kind: "string", String: "nested"}}}}},
	}}
	_, err = session.applyLocked(resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	require.NoError(t, err)
	_, err = session.applyLocked(sourceBoundary(resourcev2.EnumerationExhausted))
	require.NoError(t, err)
	t.Cleanup(func() {
		for _, member := range session.members {
			member.release()
		}
		delete(ctrl.sources.sessions, session.key)
	})
	return ctrl, provider, session, record, docCalls, getCalls
}

func replaceObservedProjection(t *testing.T, session *sourceSession, record resourcev2.Record) {
	t.Helper()
	session.mu.Lock()
	defer session.mu.Unlock()
	_, err := session.applyLocked(resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}}}}})
	require.NoError(t, err)
}

func TestObservedProjectionUsesSchemaCacheWithoutResourceGet(t *testing.T) {
	ctrl, _, session, record, documents, gets := observedProjectionFixture(t)
	paths := []string{"/name", "/profile/zone"}
	body, guard, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, record.Reference, paths)
	require.NoError(t, err)
	require.Equal(t, "pod", body.Map["name"].String)
	require.Equal(t, "east", body.Map["profile"].Map["zone"].String)
	require.Len(t, body.Map, 2, "only approved leaves leave the observation reader")
	require.NoError(t, guard(testInvocationContext()))
	body.Map["name"] = resourcev2.Value{Kind: "string", String: "caller mutation"}
	paths[0] = "/opaque"
	again, _, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, record.Reference, []string{"/name"})
	require.NoError(t, err)
	require.Equal(t, "pod", again.Map["name"].String)
	require.NoError(t, guard(testInvocationContext()), "caller path mutation must not retarget retained guards")
	require.Equal(t, 1, *documents, "external schema documents must use the existing metadata cache")
	require.Zero(t, *gets)
}

func TestObservedProjectionRejectsPrivateUndeclaredAndNonScalarPaths(t *testing.T) {
	ctrl, _, session, record, _, gets := observedProjectionFixture(t)
	for _, path := range []string{"/opaque", "/hidden", "/masked", "/private/zone", "/secret", "/undeclared", "/items", "/items/0/name", "/profile", "/nullable", "/name/child", "/name~2", "/data/value"} {
		t.Run(path, func(t *testing.T) {
			body, guard, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, record.Reference, []string{path})
			require.Error(t, err)
			require.Nil(t, body)
			require.Nil(t, guard)
		})
	}
	require.Zero(t, *gets)
}

func TestObservedProjectionGuardFencesEqualBodyReplacement(t *testing.T) {
	ctrl, _, session, record, _, gets := observedProjectionFixture(t)
	_, guard, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, record.Reference, []string{"/name"})
	require.NoError(t, err)
	identity, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", session.target.Route, record.Reference)
	require.NoError(t, err)
	replaceObservedProjection(t, session, record)
	require.Error(t, guard(testInvocationContext()), "wire/member replacement retires projection even with identical values")
	require.NoError(t, identity(testInvocationContext()), "identity-only reads allow same-incarnation body updates")
	session.generation = "replacement-generation"
	require.Error(t, identity(testInvocationContext()))
	require.Zero(t, *gets)
}

func TestObservedProjectionGuardReauthorizesOwnerAndPolicy(t *testing.T) {
	ctrl, _, session, record, _, gets := observedProjectionFixture(t)
	deny := false
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, _ invocation.Target) error {
		if deny && operation == "resource.Get" {
			return errors.New("policy changed")
		}
		return nil
	}))
	_, guard, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, record.Reference, []string{"/name"})
	require.NoError(t, err)
	foreign := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	require.Error(t, guard(foreign))
	_, _, err = ctrl.ReadObservedResource(foreign, "p1", session.target.Route, record.Reference, []string{"/name"})
	require.Error(t, err)
	deny = true
	require.Error(t, guard(testInvocationContext()))
	identity, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", session.target.Route, record.Reference)
	require.NoError(t, err, "native identity must not require resource.Get permission")
	require.NoError(t, identity(testInvocationContext()))
	require.Zero(t, *gets)
}

func TestObservedProjectionMissingAndRetiredSourcesNeverFetchResource(t *testing.T) {
	ctrl, provider, session, record, _, gets := observedProjectionFixture(t)
	missing := record.Reference
	missing.Address.ID = "not-observed"
	_, _, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, missing, []string{"/name"})
	require.Error(t, err)
	_, guard, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, record.Reference, []string{"/name"})
	require.NoError(t, err)
	original := provider.CatalogFunc
	provider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog, err := original(ctx, request)
		catalog.Revision += "-new-schema"
		revision := "schema-2"
		catalog.Types[0].Representations[0].Schema.Revision = &revision
		return catalog, err
	}
	require.Error(t, guard(testInvocationContext()), "catalog/schema changes retire old source projections")
	require.Zero(t, *gets)
}

func TestObservedIdentityDoesNotRequireGetCapability(t *testing.T) {
	ctrl, provider, session, record, _, gets := observedProjectionFixture(t)
	original := provider.CatalogFunc
	provider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog, err := original(ctx, request)
		var capabilities []resourcev2.Capability
		for _, capability := range catalog.Types[0].Capabilities {
			if capability.Operation != resourcev2.OperationGet {
				capabilities = append(capabilities, capability)
			}
		}
		catalog.Types[0].Capabilities = capabilities
		return catalog, err
	}
	guard, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", session.target.Route, record.Reference)
	require.NoError(t, err)
	require.NoError(t, guard(testInvocationContext()))
	_, _, err = ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, record.Reference, []string{"/name"})
	require.Error(t, err)
	require.Zero(t, *gets)
}

func TestObservedIdentityGuardRejectsIncarnationReplacement(t *testing.T) {
	ctrl, _, session, record, _, gets := observedProjectionFixture(t)
	guard, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", session.target.Route, record.Reference)
	require.NoError(t, err)
	newIncarnation := "uid-recreated"
	replacement := record
	replacement.Reference.Incarnation = &newIncarnation
	replaceObservedProjection(t, session, replacement)
	require.Error(t, guard(testInvocationContext()))
	_, _, err = ctrl.ReadObservedResource(testInvocationContext(), "p1", session.target.Route, record.Reference, []string{"/name"})
	require.Error(t, err, "a recreated resource must not satisfy the old admitted reference")
	require.Zero(t, *gets)
}

func TestObservedProjectionFollowsSchemaRefsWithoutLosingPrivacyAnnotations(t *testing.T) {
	for _, dialect := range []string{resourcev2.DialectJSONSchemaDraft07, resourcev2.DialectJSONSchema202012} {
		t.Run(dialect, func(t *testing.T) {
			catalog := canonicalTestCatalog("p1", "native::Pod")
			revision := "schema-ref-1"
			catalog.Types[0].Representations[0].Schema = resourcev2.SchemaBinding{
				State: "available", Revision: &revision, Dialect: dialect,
				Document: []byte(`{"type":"object","properties":{"public":{"$ref":"#/definitions/plain"},"alias":{"$ref":"#/definitions/private"},"sibling":{"$ref":"#/definitions/plain","writeOnly":true}},"definitions":{"plain":{"type":"string"},"private":{"allOf":[{"type":"string"},{"x-sensitive":true}]}}}`),
			}
			cache := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
			snapshot := cache.Observe(resourcecatalog.ConnectionKey{PluginID: "p1", Generation: "generation", Connection: "conn"}, catalog)
			entry, err := snapshot.Entry("native::Pod", "native")
			require.NoError(t, err)
			schema, err := entry.Resolve(context.Background(), nil)
			require.NoError(t, err)
			body := resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
				"public":  {Kind: "string", String: "allowed"},
				"alias":   {Kind: "string", String: "denied"},
				"sibling": {Kind: "string", String: "denied"},
			}}
			projected, err := projectObservedScalars(context.Background(), schema, body, []string{"/public"})
			require.NoError(t, err)
			require.Equal(t, "allowed", projected.Map["public"].String)
			for _, path := range []string{"/alias", "/sibling"} {
				_, err := projectObservedScalars(context.Background(), schema, body, []string{path})
				require.Error(t, err, path)
			}
			cache.DropConnection("p1", "conn")
			_, err = entry.Resolve(context.Background(), nil)
			require.Error(t, err, "retired schema snapshots must not authorize new projection")
		})
	}
}

func TestObservedIdentityRejectsConflictingRetainedSourceIncarnations(t *testing.T) {
	ctrl, _, first, record, _, gets := observedProjectionFixture(t)
	second := &sourceSession{
		coordinator: ctrl.sources, key: "observed-other", pluginID: first.pluginID, owner: first.owner,
		target: first.target, pluginGeneration: first.pluginGeneration, ctx: first.ctx,
		mode: first.mode, generation: "other-source-generation",
		members: map[string]sourceMember{}, staging: map[string]sourceMember{}, views: map[string]*sourceView{},
	}
	ctrl.sources.sessions[second.key] = second
	t.Cleanup(func() {
		for _, member := range second.members {
			member.release()
		}
		delete(ctrl.sources.sessions, second.key)
	})
	replacement := record
	incarnation := "uid-other"
	replacement.Reference.Incarnation = &incarnation
	_, err := second.applyLocked(resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(replacement)}}}})
	require.NoError(t, err)
	_, err = second.applyLocked(sourceBoundary(resourcev2.EnumerationExhausted))
	require.NoError(t, err)
	guard, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", first.target.Route, replacement.Reference)
	require.Error(t, err, "source-key order cannot establish which conflicting retained incarnation is current")
	require.Nil(t, guard)
	require.Zero(t, *gets)
}
