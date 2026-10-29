package resource

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func TestUnissuedResourceInvocationCannotObserveOrSubscribe(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.Get(context.Background(), "supplied-actor", HostGetRequest{Request: resource.GetRequest{Route: resource.AccessRoute{Connection: "root"}, Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: "supplied-actor", Authority: "unissued", Type: "opaque", ID: "x", Scope: []resource.ScopeEntry{}}}, Representation: "native"}})
	if err == nil {
		t.Fatal("unissued request admitted")
	}
	if err := ctrl.SubscribeResource(context.Background(), "supplied-actor", HostSubscription{TargetID: "unissued", Target: resource.ReadTarget{Route: resource.AccessRoute{Connection: "root"}, Provider: "supplied-actor", Authority: "unissued", Type: "opaque", Scope: resource.QueryScope{}, Representation: "native"}}); err == nil {
		t.Fatal("unissued subscription admitted")
	}
	if ctrl.isSubscribed("supplied-actor", "root", "opaque") {
		t.Fatal("denial populated subscription state")
	}
}

func TestProviderDenialThroughRealGRPCDoesNotObserveResult(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{
		CatalogFunc: lifecycleTestCatalog("opaque"),
		GetFunc: func(_ context.Context, request resource.GetRequest) (resource.Record, error) {
			record := canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID)
			record.Body = resource.Value{Kind: "map", Map: map[string]resource.Value{"secret": {Kind: "string", String: "denied"}}}
			return record, &resource.ResourceOperationError{Code: "FORBIDDEN", Title: "private-title", Message: "private-body"}
		},
	}
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
	request := admittedGetRequest(t, ctrl, "cloud", "conn", "opaque", "secret")
	_, err := ctrl.Get(testInvocationContext(), "cloud", request)
	var app *apperror.AppError
	if !errors.As(err, &app) || app.Code != "FORBIDDEN" || app.RequestID == "" {
		t.Fatalf("denial lost through transport: %v", err)
	}
	if _, found := ctrl.registryStore.Get("cloud", request.Request.Reference, request.Request.Route); found {
		t.Fatal("denial populated registry")
	}
}

func TestDeniedNativeReadyOpenCreatesNoHandle(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{CatalogFunc: lifecycleTestCatalog("opaque")}
	provider.StreamActionFunc = func(context.Context, resource.ActionRequest, chan<- resource.ActionEvent) error {
		return &resource.ResourceOperationError{Code: "FORBIDDEN", Title: "private", Message: "private"}
	}
	registerMockPlugin(ctrl, "container", setupGRPCProvider(t, provider))
	id, err := ctrl.StreamAction(testInvocationContext(), "container", admittedActionRequest(t, ctrl, "container", "conn", "opaque", "start"))
	if err == nil || id != "" || actionCount(ctrl.actions) != 0 {
		t.Fatalf("denied open left handle: id=%q err=%v count=%d", id, err, actionCount(ctrl.actions))
	}
}

func TestReadyFastTerminalIsReconciledAndForeignOwnerCannotAttach(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	provider := &mockProvider{CatalogFunc: lifecycleTestCatalog("opaque")}
	provider.StreamActionFunc = func(ctx context.Context, _ resource.ActionRequest, ch chan<- resource.ActionEvent) error {
		for _, ev := range []resource.ActionEvent{{Type: "ready"}, {Type: "complete", Data: &resource.Value{Kind: "map", Map: map[string]resource.Value{"message": {Kind: "string", String: "complete"}}}}} {
			select {
			case ch <- ev:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	registerMockPlugin(ctrl, "hypervisor", setupGRPCProvider(t, provider))
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx := owner.Context(context.Background())
	id, err := ctrl.StreamAction(ctx, "hypervisor", admittedActionRequest(t, ctrl, "hypervisor", "conn", "opaque", "start"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ctrl.AttachStreamAction(invocation.NewScope(invocation.TrustedUI).Context(context.Background()), id); err == nil {
		t.Fatal("foreign owner attached")
	}
	if len(emitter.EventsWithKey("action/stream/"+id)) != 0 {
		t.Fatal("event emitted before attachment")
	}
	deadline := time.After(time.Second)
	for {
		snapshot, err := ctrl.AttachStreamAction(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Terminal {
			if snapshot.Event.Type != "complete" {
				t.Fatalf("wrong terminal: %+v", snapshot)
			}
			break
		}
		select {
		case <-deadline:
			t.Fatal("terminal outcome was lost")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if err := ctrl.CancelStreamAction(ctx, id); err != nil {
		t.Fatal(err)
	}
	if actionCount(ctrl.actions) != 0 {
		t.Fatal("owning close leaked handle")
	}
}

func TestRegisteredSDKResourcerPreservesHostCorrelationThroughGRPC(t *testing.T) {
	seen := make(chan resource.Session, 1)
	provider, err := resource.NewController(resource.Config[string]{
		Catalog: lifecycleTestCatalog("cloud::v1::Machine"),
		Lifecycle: &resource.Lifecycle[string]{
			LoadConnections: func(context.Context) ([]types.Connection, error) { return []types.Connection{{ID: "conn-1"}}, nil },
			CreateClient:    func(context.Context, types.Connection) (*string, error) { client := "native"; return &client, nil },
			DestroyClient:   func(context.Context, *string) error { return nil },
		},
		Registrations: []resource.Registration[string]{{Type: "cloud::v1::Machine", Get: func(ctx context.Context, _ *string, _ resource.GetRequest) (resource.Record, error) {
			session, ok := resource.SessionFromContext(ctx)
			if !ok {
				return resource.Record{}, errors.New("missing host session")
			}
			seen <- session
			return resource.Record{}, &resource.ResourceOperationError{Code: "FORBIDDEN", Title: "secret-title", Message: "secret-body"}
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer provider.Close()
	if _, err = provider.LoadConnections(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err = provider.StartConnection(context.Background(), "conn-1"); err != nil {
		t.Fatal(err)
	}
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
	_, err = ctrl.Get(testInvocationContext(), "cloud", admittedGetRequest(t, ctrl, "cloud", "conn-1", "cloud::v1::Machine", "opaque"))
	app := requireAppError(t, err)
	session := <-seen
	if session.RequestID == "" || session.RequestID != app.RequestID || session.RequesterID != "host" {
		t.Fatalf("actual resourcer correlation lost: session=%+v error=%s", session, app.Error())
	}
	if strings.Contains(app.Error(), "secret") {
		t.Fatal("native denial leaked provider fields")
	}
}

func TestResourceDiscoveryTransportFailureIsNotEmptySuccess(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{}
	provider.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		return canonicalTestCatalog("proof", "secret"), &resource.ResourceOperationError{Code: "FORBIDDEN", Title: "secret-title", Message: "secret-body"}
	}
	registerMockPlugin(ctrl, "container", setupGRPCProvider(t, provider))
	result, err := ctrl.Catalog(testInvocationContext(), "container", resource.CatalogRequest{Route: resource.AccessRoute{Connection: "route"}})
	if result.Provider != "" || requireAppError(t, err).Code != "FORBIDDEN" {
		t.Fatal("denied discovery became empty/successful inventory")
	}
}

func TestOpenCancellationBeforeReadyLeavesNoHandle(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	started := make(chan struct{})
	provider := &mockProvider{CatalogFunc: lifecycleTestCatalog("opaque")}
	provider.StreamActionFunc = func(ctx context.Context, _ resource.ActionRequest, _ chan<- resource.ActionEvent) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	registerMockPlugin(ctrl, "flat", setupGRPCProvider(t, provider))
	ctx, cancel := context.WithCancel(testInvocationContext())
	result := make(chan error, 1)
	go func() {
		_, err := ctrl.StreamAction(ctx, "flat", admittedActionRequest(t, ctrl, "flat", "route", "opaque", "start"))
		result <- err
	}()
	<-started
	cancel()
	select {
	case err := <-result:
		if requireAppError(t, err).Code != "CANCELLED" {
			t.Fatal("open cancellation became internal failure")
		}
	case <-time.After(time.Second):
		t.Fatal("pending open did not cancel")
	}
	if actionCount(ctrl.actions) != 0 {
		t.Fatal("canceled open left pending or public state")
	}
}

func TestAcceptedProducerSurvivesCompletedOpenRequestCancellation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	stopped := make(chan struct{})
	provider := &mockProvider{CatalogFunc: lifecycleTestCatalog("opaque")}
	provider.StreamActionFunc = func(ctx context.Context, _ resource.ActionRequest, events chan<- resource.ActionEvent) error {
		events <- resource.ActionEvent{Type: "ready"}
		<-ctx.Done()
		close(stopped)
		return ctx.Err()
	}
	registerMockPlugin(ctrl, "flat", setupGRPCProvider(t, provider))
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx, cancel := context.WithCancel(owner.Context(context.Background()))
	id, err := ctrl.StreamAction(ctx, "flat", admittedActionRequest(t, ctrl, "flat", "route", "opaque", "start"))
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	live := owner.Context(context.Background())
	if _, err = ctrl.AttachStreamAction(live, id); err != nil {
		t.Fatal("completed open cancellation killed accepted stream")
	}
	select {
	case <-stopped:
		t.Fatal("producer inherited completed Wails call lifetime")
	default:
	}
	if err = ctrl.CancelStreamAction(live, id); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("owning cancellation did not reach native stream")
	}
}

// readinessTestProvider opts individual aggregate fixtures into SDK readiness.
// The shared mock intentionally does not implement this optional trait.
type readinessTestProvider struct {
	*mockProvider
	status types.ConnectionStatus
}

var _ resource.ConnectionReadinessProvider = (*readinessTestProvider)(nil)

func (p *readinessTestProvider) GetConnectionStatus(context.Context, string) (types.ConnectionStatus, error) {
	return p.status, nil
}

func TestConnectionStateAggregatePreservesUnstartedNativeConnection(t *testing.T) {
	provider, err := resource.NewController(resource.Config[string]{
		Catalog: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
			t.Error("stopped native connection read Catalogue")
			catalog := canonicalTestCatalog("cloud", "cloud::v1::Machine")
			catalog.Types[0].DefaultRepresentation = "native"
			catalog.Types[0].Capabilities = []resource.Capability{{
				Operation: resource.OperationUpdate,
				Scope:     resource.QueryScope{},
				Guarantee: resource.BestEffortGuarantee,
			}}
			return catalog, nil
		},
		Lifecycle: &resource.Lifecycle[string]{
			LoadConnections: func(context.Context) ([]types.Connection, error) { return []types.Connection{{ID: "conn-1"}}, nil },
			CreateClient: func(context.Context, types.Connection) (*string, error) {
				t.Error("aggregate auto-started stopped native connection")
				client := "native"
				return &client, nil
			},
			DestroyClient: func(context.Context, *string) error { return nil },
		},
		Registrations: []resource.Registration[string]{{Type: "cloud::v1::Machine", Watch: func(context.Context, *string, resource.ReadTarget, resource.Representation, resource.WatchEventSink) error {
			t.Error("unstarted native connection opened an update source")
			return errors.New("unstarted native update source")
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer provider.Close()
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
	ctx := testInvocationContext()
	connections, err := ctrl.LoadConnections(ctx, "cloud")
	if err != nil || len(connections) == 0 {
		t.Fatalf("native connections unavailable: %v", err)
	}
	states, err := ctrl.GetAllConnectionStates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(states["cloud"]) != len(connections) {
		t.Fatal("unstarted native connections disappeared")
	}
	for _, state := range states["cloud"] {
		if state.Readiness != types.ConnectionStatusDisconnected || state.ReadinessError != nil || len(state.Resources) != 0 || len(state.ResourceCounts) != 0 {
			t.Fatalf("stopped native connection gained readiness or watch state: %+v", state)
		}
	}
}

func TestConnectionStateAggregateKeepsUnsupportedReadinessUnknown(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	unsupported := &mockProvider{
		CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
			t.Error("unknown readiness triggered Catalogue")
			return resource.Catalog{}, errors.New("unexpected Catalogue")
		},
		CheckConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
			t.Error("unknown readiness triggered health probe")
			return types.ConnectionStatus{}, errors.New("unexpected probe")
		},
		StartConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
			t.Error("unknown readiness triggered auto-start")
			return types.ConnectionStatus{}, errors.New("unexpected start")
		},
		GetWatchStateFunc: func(context.Context, resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
			t.Error("unknown readiness triggered watch read")
			return nil, errors.New("unexpected watch read")
		},
	}
	registerMockPlugin(ctrl, "unsupported", setupGRPCProvider(t, unsupported))
	connected := &mockProvider{
		CatalogFunc: lifecycleTestCatalog("cloud::v1::Machine"),
		GetWatchStateFunc: func(_ context.Context, route resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
			return &resource.WatchConnectionSummary{
				Route:          route,
				Resources:      map[string]resource.WatchState{"cloud::v1::Machine": resource.WatchStateSynced},
				ResourceCounts: map[string]resource.Count{"cloud::v1::Machine": {Kind: "unknown"}},
				Scope:          resource.QueryScope{},
				Guarantee:      resource.BestEffortGuarantee,
			}, nil
		},
	}
	registerMockPlugin(ctrl, "connected", setupGRPCProvider(t, &readinessTestProvider{
		mockProvider: connected,
		status:       types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: "live"}},
	}))
	ctrl.connections["unsupported"] = []types.Connection{{ID: "saved", LastRefresh: time.Now()}}
	ctrl.connections["connected"] = []types.Connection{{ID: "live"}}
	states, err := ctrl.GetAllConnectionStates(testInvocationContext())
	if err != nil {
		t.Fatal(err)
	}
	if len(states["unsupported"]) != 1 || len(states["connected"]) != 1 {
		t.Fatalf("aggregate hid provider members: %+v", states)
	}
	unknown := states["unsupported"][0]
	if unknown.Readiness != "UNKNOWN" || unknown.ReadinessError == nil || unknown.ReadinessError.Code != "UNSUPPORTED" {
		t.Fatalf("unsupported readiness became known: %+v", unknown)
	}
	if unknown.ReadinessError.RequestID == "" || len(unknown.Resources) != 0 || len(unknown.ResourceCounts) != 0 {
		t.Fatalf("unsupported readiness lost safe correlation or gained watch state: %+v", unknown)
	}
	live := states["connected"][0]
	if live.Readiness != types.ConnectionStatusConnected || live.ReadinessError != nil || live.Resources["cloud::v1::Machine"] != resource.WatchStateSynced {
		t.Fatalf("unsupported peer prevented connected watch summary: %+v", live)
	}
}

func TestConnectionStateAggregateFailsClosedThroughTransport(t *testing.T) {
	for _, code := range []string{"FORBIDDEN", "UNAUTHORIZED", "CANCELLED", "PARTIAL_RESULT", "PROVIDER_ERROR", "INTERNAL"} {
		t.Run(code, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			provider := &mockProvider{CatalogFunc: lifecycleTestCatalog("cloud::v1::Machine")}
			provider.GetWatchStateFunc = func(context.Context, resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
				return &resource.WatchConnectionSummary{Resources: map[string]resource.WatchState{"secret": resource.WatchStateSynced}}, &resource.ResourceOperationError{Code: code, Title: "private", Message: "private"}
			}
			registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, &readinessTestProvider{
				mockProvider: provider,
				status:       types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: "conn"}},
			}))
			ctrl.connections["cloud"] = []types.Connection{{ID: "conn"}}
			states, err := ctrl.GetAllConnectionStates(testInvocationContext())
			if states != nil || requireAppError(t, err).Code != code {
				t.Fatalf("aggregate swallowed %s: %v", code, err)
			}
		})
	}
}

func TestConnectionStateAggregateCancellationStopsNativeRead(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{CatalogFunc: lifecycleTestCatalog("cloud::v1::Machine")}
	started, stopped := make(chan struct{}), make(chan struct{})
	provider.GetWatchStateFunc = func(ctx context.Context, _ resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
		close(started)
		<-ctx.Done()
		close(stopped)
		return nil, ctx.Err()
	}
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, &readinessTestProvider{
		mockProvider: provider,
		status:       types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: "conn"}},
	}))
	ctrl.connections["cloud"] = []types.Connection{{ID: "conn"}}
	ctx, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		states, err := ctrl.GetAllConnectionStates(ctx)
		if states != nil {
			t.Error("cancelled aggregate returned a successful inventory")
		}
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("native watch read did not start")
	}
	cancel()
	select {
	case err := <-done:
		if requireAppError(t, err).Code != "CANCELLED" {
			t.Fatal("aggregate cancellation lost classification")
		}
	case <-time.After(time.Second):
		t.Fatal("aggregate did not cancel")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("native watch read did not cancel")
	}
}

func TestConnectionStateAggregateDoesNotHideMissingProvider(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.connections["missing"] = []types.Connection{{ID: "conn"}}
	states, err := ctrl.GetAllConnectionStates(testInvocationContext())
	if states != nil || requireAppError(t, err).Type != apperror.TypePluginNotFound {
		t.Fatal("missing provider became a stopped connection")
	}
}

func TestConnectionStateAggregateRejectsDeniedMemberBeforeNativeRead(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, _ invocation.Target) error {
		if operation == "resource.GetWatchState" {
			return errors.New("denied")
		}
		return nil
	}))
	provider := &mockProvider{}
	provider.GetWatchStateFunc = func(context.Context, resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
		t.Error("denied member reached native watch read")
		return nil, errors.New("unexpected native read")
	}
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, &readinessTestProvider{
		mockProvider: provider,
		status:       types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: "conn"}},
	}))
	ctrl.connections["cloud"] = []types.Connection{{ID: "conn"}}
	states, err := ctrl.GetAllConnectionStates(testInvocationContext())
	if states != nil || requireAppError(t, err).Code != "FORBIDDEN" {
		t.Fatal("denied member became a successful aggregate")
	}
}

func TestConnectionStateAggregateRejectsDeniedReadinessBeforeNativeRead(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
		if operation == "resource.GetConnectionStatus" {
			if target.Provider != "cloud" || target.Connection != "conn" {
				t.Errorf("readiness admission lost member target: %+v", target)
			}
			return errors.New("denied")
		}
		return nil
	}))
	provider := &mockProvider{
		CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
			t.Error("denied readiness reached Catalogue")
			return resource.Catalog{}, errors.New("unexpected Catalogue")
		},
		GetWatchStateFunc: func(context.Context, resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
			t.Error("denied readiness reached native watch read")
			return nil, errors.New("unexpected native read")
		},
	}
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, &readinessTestProvider{
		mockProvider: provider,
		status:       types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: "conn"}},
	}))
	ctrl.connections["cloud"] = []types.Connection{{ID: "conn"}}
	states, err := ctrl.GetAllConnectionStates(testInvocationContext())
	if states != nil || requireAppError(t, err).Code != "FORBIDDEN" {
		t.Fatal("denied readiness became a successful aggregate")
	}
}
