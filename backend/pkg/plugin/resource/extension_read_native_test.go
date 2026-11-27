package resource

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/extensionread"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	brokerOwnerID        = "evidence"
	brokerRootType       = "native::Object"
	brokerRelatedType    = "native::Related"
	brokerRestrictedType = "native::Restricted"
)

// The fixture replaces only the plugin process and Wails window, not source
// membership, native root admission, per-object policy, or the selected broker.
type brokerOwner struct {
	*scriptedSourceProvider
	families      []string
	read          func(context.Context, extensionread.Request) (extensionread.Page, error)
	calls         atomic.Int32
	lookups       atomic.Int32
	deniedLookups atomic.Int32
}

func (b *brokerOwner) RelatedSourcesV1(context.Context, extensionread.Request) ([]string, error) {
	return b.families, nil
}

func (b *brokerOwner) ReadRelatedV1(ctx context.Context, in extensionread.Request) (extensionread.Page, error) {
	return b.read(ctx, in)
}

type brokerScope struct {
	invocation.AuthorizeFunc
	all atomic.Bool
}

func (p *brokerScope) CoversResourceGets(invocation.Principal, invocation.Target) bool {
	return p.all.Load()
}

func newCitationBroker(requester string) *brokerOwner {
	provider := &brokerOwner{
		scriptedSourceProvider: &scriptedSourceProvider{mockProvider: &mockProvider{}, opens: make(chan scriptedSourceOpen, 1)},
		families:               []string{brokerRootType, brokerRelatedType, brokerRestrictedType},
	}
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog(brokerOwnerID, brokerRootType)
		catalog.Types[0].Capabilities = append(catalog.Types[0].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
		for _, typ := range []string{brokerRelatedType, brokerRestrictedType} {
			catalog.Types = append(catalog.Types, canonicalTestCatalog(brokerOwnerID, typ).Types[0])
		}
		for i := range catalog.Types {
			catalog.Types[i].DefaultRepresentation = "native"
		}
		return catalog, nil
	}
	provider.GetFunc = func(_ context.Context, get resourcev2.GetRequest) (resourcev2.Record, error) {
		a := get.Reference.Address
		if a.ID == "secret" {
			provider.deniedLookups.Add(1)
		}
		if a.Type == brokerRelatedType {
			provider.lookups.Add(1)
		}
		record := canonicalTestRecord(a.Provider, a.Authority, a.Type, a.ID)
		record.Reference.Incarnation = get.Reference.Incarnation
		if a.ID == "same-name" {
			uid := "replacement"
			record.Reference.Incarnation = &uid
		}
		return record, nil
	}
	provider.read = func(ctx context.Context, in extensionread.Request) (extensionread.Page, error) {
		provider.calls.Add(1)
		session, ok := resourcev2.SessionFromContext(ctx)
		if !ok || session.RequesterID != requester || in.Operation != brokerOwnerID+"/links@1" || in.Route.Connection != "west" || in.Root.Address.ID != "selected" ||
			len(in.Sources) != 2 || in.Sources[0].Type != brokerRootType || in.Sources[1].Type != brokerRelatedType {
			return extensionread.Page{}, errors.New("incorrectly admitted native request")
		}
		target := in.Sources[1]
		ref := func(id, uid string) resourcev2.ResourceReference { return sourceTestRecord(target, id, uid).Reference }
		root := in.Root
		page := extensionread.Page{Sources: []string{brokerRootType, brokerRelatedType}, Coverage: "complete", Rows: []extensionread.Candidate{
			readCandidate("in", ref("witness", "seen"), root), readCandidate("out", root, ref("neighbor", "present")),
			readCandidate("hidden neighbor", root, ref("secret", "private")), readCandidate("hidden evidence", ref("secret", "private"), root),
			readCandidate("replaced UID", root, ref("same-name", "old")), readCandidate("forged root", root, sourceTestRecord(in.Sources[0], "not-selected", *root.Incarnation).Reference),
			{Row: map[string]any{"label": "address-only"}, Evidence: []resourcev2.ResourceReference{ref("witness", "seen")}},
		}}
		for i := range 12 {
			page.Rows = append(page.Rows, readCandidate("lookup", root, ref("lookup-"+strconv.Itoa(i), "uid")))
		}
		return page, nil
	}
	return provider
}

func TestExtensionReadNativeDispatchUsesRealWindowAndIndependentlyAuthorizedCitations(t *testing.T) {
	ctrl, emitted := newTestControllerWithEmitter(t)
	realm := invocation.NewWindowRealm(nil)
	caller := func(id uint, client string) context.Context {
		return context.WithValue(context.Background(), application.WindowKey, &graphPageWindow{id: id, client: client})
	}
	window := caller(1, "page-one")
	ctx := realm.Context(window)
	trusted, err := invocation.NewBoundary(nil).Admit(ctx, "fixture", invocation.Target{})
	require.NoError(t, err)
	actor, ok := invocation.FromContext(trusted)
	require.True(t, ok)
	var deniedRoot atomic.Bool
	policy := &brokerScope{}
	policy.AuthorizeFunc = func(p invocation.Principal, op string, target invocation.Target) error {
		if p.Origin() != invocation.TrustedUI || (op == "resource.Get" && ((!policy.all.Load() && target.Object == "secret") || (deniedRoot.Load() && target.ResourceType == brokerRootType))) || (op == "resource.Enumerate" && target.ResourceType == brokerRestrictedType) {
			return errors.New("private denial reason")
		}
		return nil
	}
	ctrl.boundary = invocation.NewBoundary(policy)
	provider := newCitationBroker(actor.Principal().Owner())
	registerMockPlugin(ctrl, brokerOwnerID, provider)
	route := resourcev2.AccessRoute{Connection: "west"}
	resolved, err := ctrl.ResolveTarget(ctx, brokerOwnerID, ResolveTargetRequest{Route: route, Type: brokerRootType, Scope: resourcev2.QueryScope{}, Representation: "native"})
	require.NoError(t, err)
	view, err := ctrl.OpenSourceView(ctx, brokerOwnerID, HostSourceViewRequest{TargetID: resolved.TargetID, Target: resolved.Target, Updates: "ifSupported"})
	require.NoError(t, err)
	t.Cleanup(func() { _ = ctrl.CloseSourceView(ctx, brokerOwnerID, view.ViewID) })
	require.NoError(t, ctrl.SyncSourceView(ctx, brokerOwnerID, view.ViewID))
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	record := sourceTestRecord(resolved.Target, "selected", "native-uid")
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	snapshot := waitSourceView(t, emitted, view.Topic, func(e HostSourceViewEvent) bool { return e.Kind == "snapshot" && len(e.Records) == 1 })
	waitSourceView(t, emitted, view.Topic, func(e HostSourceViewEvent) bool {
		return e.Kind == "snapshotEnd" && e.Status != nil && e.Status.State == "following"
	})
	key := extensionread.Binding{Point: brokerOwnerID + "/tabs", Offer: "peer/body", Read: "read-pin", Continuity: "issued"}
	proof := ExtensionRootProof{Owner: brokerOwnerID, Connection: route.Connection, ViewID: view.ViewID, ViewGeneration: snapshot.ViewGeneration + ":" + snapshot.MemberRevisions[0], RowKey: snapshot.Records[0].Key, Reference: snapshot.Records[0].Record.Reference}
	service, _ := NewExtensionReadService(ctrl, realm, ctrl.boundary, func(binding extensionread.Binding) (extensionread.Contract, bool) {
		return extensionread.Contract{Operation: brokerOwnerID + "/links@1", Row: map[string]string{"label": "string"}, OwnerLife: context.Background(), ContributorLife: context.Background()}, binding == key
	})
	run := func(ctx context.Context, binding extensionread.Binding, root ExtensionRootProof) ExtensionReadResult {
		data, encodeErr := json.Marshal(extensionReadRequest{Binding: binding, Root: root})
		require.NoError(t, encodeErr)
		return service.ReadRelatedV1(ctx, string(data))
	}
	for _, forged := range []context.Context{context.Background(), caller(2, "other-page"), caller(1, "reconnected-page")} {
		require.Equal(t, ExtensionReadResult{State: "unavailable"}, run(forged, key, proof))
	}
	noGrant := key
	noGrant.Continuity = "replaced"
	require.Equal(t, ExtensionReadResult{State: "unavailable"}, run(window, noGrant, proof))
	changed := proof
	changed.Connection = "east"
	require.Equal(t, ExtensionReadResult{State: "unavailable"}, run(window, key, changed))
	changed = proof
	wrongUID := "replacement"
	changed.Reference.Incarnation = &wrongUID
	require.Equal(t, ExtensionReadResult{State: "unavailable"}, run(window, key, changed))
	deniedRoot.Store(true)
	require.Equal(t, ExtensionReadResult{State: "unavailable"}, run(window, key, proof))
	deniedRoot.Store(false)
	require.Zero(t, provider.calls.Load(), "lookalikes, wrong windows, missing grants and denied root Gets must not reach owner acquisition")
	result := run(window, key, proof)
	require.Equal(t, "ready", result.State)
	require.NotNil(t, result.Page)
	require.Equal(t, "partial", result.Page.Coverage)
	require.False(t, result.Page.Truncated, "a missing right or acquisition limit cannot prove one extra authorized row")
	require.Len(t, result.Page.Rows, 8)
	require.Equal(t, []map[string]any{{"label": "in"}, {"label": "out"}, {"label": "address-only"}}, result.Page.Rows[:3])
	for _, row := range result.Page.Rows[3:] {
		require.Equal(t, map[string]any{"label": "lookup"}, row)
	}
	require.EqualValues(t, 1, provider.calls.Load())
	require.Zero(t, provider.deniedLookups.Load())
	require.EqualValues(t, maxEvidenceLookups, provider.lookups.Load(), "citation deduplication and total lookup budget must both hold")

	// Collection listing is allowed, but an object filter remains. A denied
	// neighbor must change neither coverage nor any other disclosed bit.
	provider.families = []string{brokerRootType, brokerRelatedType}
	hidden := false
	provider.read = func(_ context.Context, in extensionread.Request) (extensionread.Page, error) {
		page := extensionread.Page{Sources: []string{brokerRootType, brokerRelatedType}, Coverage: "complete", Rows: []extensionread.Candidate{}}
		if hidden {
			page.Rows = append(page.Rows, readCandidate("private", in.Root, sourceTestRecord(in.Sources[1], "secret", "uid").Reference))
		}
		return page, nil
	}
	absent := run(window, key, proof)
	require.Equal(t, &ExtensionReadPage{Rows: []map[string]any{}, Coverage: "partial"}, absent.Page)
	hidden = true
	require.Equal(t, absent, run(window, key, proof))
	hidden = false
	policy.all.Store(true)
	require.Equal(t, &ExtensionReadPage{Rows: []map[string]any{}, Coverage: "complete"}, run(window, key, proof).Page)
}

func TestRelatedReadDoesNotWidenRootIdentityScope(t *testing.T) {
	root := []resourcev2.ScopeEntry{{Dimension: "project", Value: "authorized"}}
	typ := resourcev2.ResourceType{IdentityDimensions: []resourcev2.Dimension{{Name: "project"}}, QueryDimensions: []resourcev2.Dimension{{Name: "project"}, {Name: "selector"}}}
	scope, ok := relatedScope(root, typ)
	require.True(t, ok)
	values := []string{"authorized"}
	require.Equal(t, resourcev2.QueryScope{{Dimension: "project", Match: resourcev2.ScopeOneOf, Values: &values}, {Dimension: "selector", Match: resourcev2.ScopeAny}}, scope)
	for _, dims := range [][]resourcev2.ScopeEntry{nil, {{Dimension: "different", Value: "authorized"}}, {{Dimension: "project", Value: "authorized"}, {Dimension: "extra", Value: "required"}}} {
		_, accepted := relatedScope(dims, typ)
		require.False(t, accepted)
	}
}
