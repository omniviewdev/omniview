package connshare

import (
	"context"
	"encoding/hex"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	v2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

type fixtureResources struct {
	Resources
	writes      atomic.Int64
	onMutate    func()
	catalog     v2.Catalog
	binding     v2.SchemaBinding
	schemaCalls atomic.Int64
	onSchema    func()
	onCatalog   func(v2.CatalogRequest)
}

func (f *fixtureResources) ObserveCatalog(context.Context, string, v2.AccessRoute) (v2.Catalog, resource.Observation, error) {
	return f.catalog, resource.Observation{}, nil
}

type fixtureRegistrar struct{}

func (fixtureRegistrar) Authorize(invocation.Principal, string, invocation.Target) error { return nil }
func (fixtureRegistrar) RegisterDelegation(context.Context, invocation.Delegation) (func(), error) {
	return func() {}, nil
}

func (f *fixtureResources) Catalog(_ context.Context, _ string, request v2.CatalogRequest) (v2.Catalog, error) {
	if f.onCatalog != nil {
		f.onCatalog(request)
	}
	return v2.Catalog{}, nil
}
func (f *fixtureResources) ResolveSchema(_ context.Context, _ string, request v2.SchemaRequest) (v2.SchemaBinding, error) {
	f.schemaCalls.Add(1)
	if f.onSchema != nil {
		f.onSchema()
	}
	if request.Type != "pods" {
		return v2.SchemaBinding{}, v2.NewError("FORBIDDEN", "Target denied.")
	}
	return f.binding, nil
}
func (f *fixtureResources) GetSchemaDocument(ctx context.Context, owner string, request v2.SchemaDocumentRequest) (v2.SchemaDocument, error) {
	binding, err := f.ResolveSchema(ctx, owner, request.Request)
	if err != nil {
		return v2.SchemaDocument{}, err
	}
	if binding.DocumentRef == nil || *binding.DocumentRef != request.Reference {
		return v2.SchemaDocument{}, v2.NewError("NOT_FOUND", "Target reference mismatch.")
	}
	return v2.SchemaDocument{Reference: request.Reference, Dialect: v2.DialectJSONSchema202012, Document: []byte(`{"type":"object"}`)}, nil
}
func (f *fixtureResources) Mutate(_ context.Context, _ string, req v2.MutationRequest) (v2.Record, error) {
	f.writes.Add(1)
	if f.onMutate != nil {
		f.onMutate()
	}
	return v2.Record{Reference: req.Reference}, nil
}

func TestEmptyGrantedCatalogPreservesPartialCoverage(t *testing.T) {
	consumer := config.PluginMeta{ID: "flux", Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{
		Plugin: "kubernetes", Operations: []string{"catalog"}, ResourceTypes: []string{"flux/*"},
	}}}}
	owner := config.PluginMeta{ID: "kubernetes", Exports: &config.ExportsSpec{Connections: &config.ConnectionExport{
		Operations: []string{"catalog"}, ResourceTypes: []string{"flux/*"},
	}}}
	grant, err := config.GrantConnections(consumer, owner)
	require.NoError(t, err)
	provider := &fixtureResources{catalog: v2.Catalog{Provider: "owner", Revision: "rev", Coverage: v2.Coverage{Kind: "partial", Reason: "discovery incomplete"}, Types: []v2.ResourceType{{Type: "other/items"}}}}
	refreshes := 0
	provider.onCatalog = func(request v2.CatalogRequest) {
		if request.Refresh {
			refreshes++
		}
	}
	boundary := invocation.NewBoundary(fixtureRegistrar{})
	ctx, err := boundary.Admit(invocation.HostContext(context.Background()), "tools.call", invocation.Target{Provider: "flux", Connection: "cluster"})
	require.NoError(t, err)
	service := New("flux", provider, boundary)
	token, stop, err := service.Begin(ctx, "kubernetes", v2.AccessRoute{Connection: "cluster"}, grant, true, func() error { return nil })
	require.NoError(t, err)
	defer stop()
	catalog, err := service.Catalog(context.Background(), token, "kubernetes", v2.CatalogRequest{Route: v2.AccessRoute{Connection: "cluster"}, Refresh: true})
	require.NoError(t, err)
	require.Empty(t, catalog.Types)
	require.Equal(t, "rev", catalog.Revision)
	require.Equal(t, provider.catalog.Coverage, catalog.Coverage)
	require.Equal(t, 1, refreshes, "explicit discovery intent must not disappear in the broker")
}

func TestCapabilitiesFenceReadWriteAndReplay(t *testing.T) {
	consumer := config.PluginMeta{ID: "flux", Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{Plugin: "kubernetes", Operations: []string{"catalog", "get", "update"}, ResourceTypes: []string{"flux/*"}}}}}
	owner := config.PluginMeta{ID: "kubernetes", Exports: &config.ExportsSpec{Connections: &config.ConnectionExport{Operations: []string{"catalog", "get", "update"}, ResourceTypes: []string{"flux/*"}}}}
	grant, err := config.GrantConnections(consumer, owner)
	require.NoError(t, err)
	provider := &fixtureResources{}
	s := New("flux", provider, nil)
	readToken, writeToken := make([]byte, 32), make([]byte, 32)
	readToken[0] = 1
	writeToken[0] = 2
	values := []string{"team"}
	target := v2.ReadTarget{Route: v2.AccessRoute{Connection: "cluster"}, Provider: "provider", Authority: "authority", Type: "flux/items", Scope: v2.QueryScope{{Dimension: "namespace", Match: v2.ScopeOneOf, Values: &values}}, Representation: "json"}
	newCall := func(readonly bool) *call {
		ctx, cancel := context.WithCancel(context.Background())
		return &call{ctx: ctx, cancel: cancel, owner: "kubernetes", route: target.Route, grant: grant, readonly: readonly, validate: func() error { return nil }, unregister: func() {}, targets: map[string]v2.ReadTarget{"target": target}}
	}
	read, write := newCall(true), newCall(false)
	s.calls[hex.EncodeToString(readToken)] = read
	s.calls[hex.EncodeToString(writeToken)] = write
	revision := "rev"
	req := v2.MutationRequest{Route: target.Route, Reference: v2.ResourceReference{Address: v2.ResourceAddress{Provider: "provider", Authority: "authority", Type: "flux/items", ID: "object", Scope: []v2.ScopeEntry{{Dimension: "namespace", Value: "team"}}}}, Operation: "update", ExpectedRevision: &revision}
	_, err = s.Update(context.Background(), readToken, "kubernetes", "target", req)
	require.Error(t, err)
	require.Zero(t, provider.writes.Load())
	_, err = s.Update(context.Background(), writeToken, "kubernetes", "wrong", req)
	require.Error(t, err)
	_, err = s.Update(context.Background(), writeToken, "other", "target", req)
	require.Error(t, err)
	wrong := req
	wrong.Reference.Address.Authority = "other"
	_, err = s.Update(context.Background(), writeToken, "kubernetes", "target", wrong)
	require.Error(t, err)
	wrong = req
	wrong.Reference.Address.Scope = []v2.ScopeEntry{{Dimension: "namespace", Value: "other"}}
	_, err = s.Update(context.Background(), writeToken, "kubernetes", "target", wrong)
	require.Error(t, err)
	require.Zero(t, provider.writes.Load())
	otherProcess := New("other", provider, nil)
	_, err = otherProcess.Update(context.Background(), writeToken, "kubernetes", "target", req)
	require.Error(t, err)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = s.Update(cancelled, writeToken, "kubernetes", "target", req)
	require.Error(t, err)
	write.validate = func() error { return denied() }
	_, err = s.Update(context.Background(), writeToken, "kubernetes", "target", req)
	require.Error(t, err)
	require.Zero(t, provider.writes.Load())
	write.validate = func() error { return nil }
	_, err = s.Update(context.Background(), writeToken, "kubernetes", "target", req)
	require.NoError(t, err)
	require.EqualValues(t, 1, provider.writes.Load())
	provider.onMutate = func() { write.validate = func() error { return denied() } }
	_, err = s.Update(context.Background(), writeToken, "kubernetes", "target", req)
	require.Error(t, err)
	require.EqualValues(t, 2, provider.writes.Load())
	s.retire(hex.EncodeToString(writeToken), write)
	_, err = s.Update(context.Background(), writeToken, "kubernetes", "target", req)
	require.Error(t, err)
	require.EqualValues(t, 2, provider.writes.Load())
	s.RetireOwner("kubernetes")
	_, err = s.Update(context.Background(), readToken, "kubernetes", "target", req)
	require.Error(t, err)
	s.Close()
}

func schemaCatalogGrant(t *testing.T) config.ConnectionGrant {
	t.Helper()
	consumer := config.PluginMeta{ID: "flux", Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{Plugin: "kubernetes", Operations: []string{"catalog"}, ResourceTypes: []string{"pods"}}}}}
	owner := config.PluginMeta{ID: "kubernetes", Exports: &config.ExportsSpec{Connections: &config.ConnectionExport{Operations: []string{"catalog"}, ResourceTypes: []string{"pods"}}}}
	grant, err := config.GrantConnections(consumer, owner)
	require.NoError(t, err)
	return grant
}

func TestSchemaDocumentsRequireGrantedTargetAndExactAssociation(t *testing.T) {
	ref := v2.SchemaDocumentReference{ID: "shared/group-version", Revision: "revision"}
	provider := &fixtureResources{binding: v2.SchemaBinding{State: "available", Revision: new("schema/1"), Dialect: v2.DialectJSONSchema202012, DocumentRef: &ref}}
	s := New("flux", provider, nil)
	token := make([]byte, 32)
	token[0] = 3
	ctx, cancel := context.WithCancel(context.Background())
	entry := &call{ctx: ctx, cancel: cancel, owner: "kubernetes", route: v2.AccessRoute{Connection: "cluster"},
		grant:    schemaCatalogGrant(t),
		validate: func() error { return nil }, unregister: func() {},
		catalog: v2.Catalog{Provider: "kubernetes", Types: []v2.ResourceType{{Type: "pods", Representations: []v2.Representation{{ID: "native", Revision: "format/1"}}}}},
	}
	s.calls[hex.EncodeToString(token)] = entry
	defer s.Close()
	request := v2.SchemaDocumentRequest{Request: v2.SchemaRequest{Route: entry.route, Type: "pods", Target: v2.SchemaTarget{Representation: &v2.Representation{ID: "native", Revision: "format/1"}}}, Reference: ref}
	wrongTarget := request
	wrongTarget.Request.Type = "secrets"
	_, err := s.GetSchemaDocument(context.Background(), token, "kubernetes", wrongTarget)
	require.Equal(t, "GRANT_DENIED", v2.ErrorCode(err))
	require.Zero(t, provider.schemaCalls.Load(), "a shared document reference cannot trigger denied target access")
	wrongFormat := request
	wrongFormat.Request.Target.Representation = &v2.Representation{ID: "native", Revision: "old"}
	_, err = s.GetSchemaDocument(context.Background(), token, "kubernetes", wrongFormat)
	require.Equal(t, "GRANT_DENIED", v2.ErrorCode(err))
	require.Zero(t, provider.schemaCalls.Load(), "an old selected format cannot recover content by shared reference")
	stale := request
	stale.Reference.Revision = "stale"
	_, err = s.GetSchemaDocument(context.Background(), token, "kubernetes", stale)
	require.Equal(t, "NOT_FOUND", v2.ErrorCode(err))
	doc, err := s.GetSchemaDocument(context.Background(), token, "kubernetes", request)
	require.NoError(t, err)
	require.Equal(t, ref, doc.Reference)
}

func TestSchemaCompletionRevalidatesTokenAndGrant(t *testing.T) {
	for _, retire := range []bool{false, true} {
		t.Run(map[bool]string{false: "grant", true: "token"}[retire], func(t *testing.T) {
			ref := v2.SchemaDocumentReference{ID: "shared", Revision: "r1"}
			provider := &fixtureResources{binding: v2.SchemaBinding{State: "available", Revision: new("schema/1"), Dialect: v2.DialectJSONSchema202012, DocumentRef: &ref}}
			s := New("flux", provider, nil)
			token := make([]byte, 32)
			token[0] = 4
			ctx, cancel := context.WithCancel(context.Background())
			allowed := true
			entry := &call{ctx: ctx, cancel: cancel, owner: "kubernetes", route: v2.AccessRoute{Connection: "cluster"},
				grant: schemaCatalogGrant(t),
				validate: func() error {
					if !allowed {
						return denied()
					}
					return nil
				}, unregister: func() {},
				catalog: v2.Catalog{Types: []v2.ResourceType{{Type: "pods", Representations: []v2.Representation{{ID: "native", Revision: "format/1"}}}}},
			}
			key := hex.EncodeToString(token)
			s.calls[key] = entry
			defer s.Close()
			provider.onSchema = func() {
				if retire {
					s.retire(key, entry)
				} else {
					allowed = false
				}
			}
			request := v2.SchemaRequest{Route: entry.route, Type: "pods", Target: v2.SchemaTarget{Representation: &v2.Representation{ID: "native", Revision: "format/1"}}}
			_, err := s.ResolveSchema(context.Background(), token, "kubernetes", request)
			require.Error(t, err, "in-flight result cannot outlive its invocation capability")
		})
	}
}
