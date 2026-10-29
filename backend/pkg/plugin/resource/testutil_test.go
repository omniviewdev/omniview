package resource

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ============================================================================
// recordingEmitter — captures emitted events for test assertions.
// ============================================================================

type emittedEvent struct {
	Key  string
	Data []any
}

type recordingEmitter struct {
	mu      sync.Mutex
	events  []emittedEvent
	changed chan struct{} // closed-and-recreated on each event to wake waiters
}

func newRecordingEmitter() *recordingEmitter {
	return &recordingEmitter{changed: make(chan struct{})}
}

func (e *recordingEmitter) Emit(key string, data ...any) {
	e.mu.Lock()
	e.events = append(e.events, emittedEvent{Key: key, Data: data})
	close(e.changed)
	e.changed = make(chan struct{})
	e.mu.Unlock()
}

func (e *recordingEmitter) Events() []emittedEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	cp := make([]emittedEvent, len(e.events))
	copy(cp, e.events)
	return cp
}

func (e *recordingEmitter) EventsWithKey(substring string) []emittedEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	var result []emittedEvent
	for _, ev := range e.events {
		if strings.Contains(ev.Key, substring) {
			result = append(result, ev)
		}
	}
	return result
}

func (e *recordingEmitter) CountEvents(substring string) int {
	return len(e.EventsWithKey(substring))
}

func (e *recordingEmitter) WaitForEvent(t *testing.T, substring string, timeout time.Duration) emittedEvent {
	t.Helper()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		e.mu.Lock()
		for _, ev := range e.events {
			if strings.Contains(ev.Key, substring) {
				e.mu.Unlock()
				return ev
			}
		}
		ch := e.changed
		e.mu.Unlock()
		select {
		case <-ch:
		case <-timer.C:
			t.Fatalf("timed out waiting for event matching %q", substring)
			return emittedEvent{}
		}
	}
}

func (e *recordingEmitter) WaitForNEvents(t *testing.T, substring string, n int, timeout time.Duration) []emittedEvent {
	t.Helper()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		e.mu.Lock()
		var matches []emittedEvent
		for _, ev := range e.events {
			if strings.Contains(ev.Key, substring) {
				matches = append(matches, ev)
			}
		}
		if len(matches) >= n {
			e.mu.Unlock()
			return matches[:n]
		}
		ch := e.changed
		e.mu.Unlock()
		select {
		case <-ch:
		case <-timer.C:
			t.Fatalf("timed out waiting for %d events matching %q, got %d", n, substring, len(matches))
			return nil
		}
	}
}

func (e *recordingEmitter) Reset() {
	e.mu.Lock()
	e.events = nil
	close(e.changed)
	e.changed = make(chan struct{})
	e.mu.Unlock()
}

// mockProvider exposes canonical operations through test closures.
type mockProvider struct {
	catalogEpochOnce           sync.Once
	catalogEpoch               string
	catalogEpochErr            error
	CatalogFunc                func(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error)
	GetFunc                    func(ctx context.Context, request resource.GetRequest) (resource.Record, error)
	EnumerateFunc              func(ctx context.Context, request resource.EnumerateRequest) (resource.SourcePage, error)
	NativeQueryFunc            func(ctx context.Context, request resource.NativeQueryRequest) (resource.SourcePage, error)
	MutateFunc                 func(ctx context.Context, request resource.MutationRequest) (resource.Record, error)
	ActionFunc                 func(ctx context.Context, request resource.ActionRequest) (resource.Value, error)
	StartConnectionFunc        func(ctx context.Context, id string) (types.ConnectionStatus, error)
	StopConnectionFunc         func(ctx context.Context, id string) (types.Connection, error)
	CheckConnectionFunc        func(ctx context.Context, id string) (types.ConnectionStatus, error)
	LoadConnectionsFunc        func(ctx context.Context) ([]types.Connection, error)
	ListConnectionsFunc        func(ctx context.Context) ([]types.Connection, error)
	NativeConnectionsFunc      func(context.Context) ([]types.Connection, error)
	ApplyConnectionOverlayFunc func(context.Context, resource.ConnectionOverlay) error
	connectionOverlayMu        sync.Mutex
	connectionOverlay          resource.ConnectionOverlay
	GetConnectionFunc          func(ctx context.Context, id string) (types.Connection, error)
	UpdateConnectionFunc       func(ctx context.Context, connection types.Connection) (types.Connection, error)
	DeleteConnectionFunc       func(ctx context.Context, id string) error
	WatchConnectionsFunc       func(ctx context.Context, stream chan<- []types.Connection) error
	StartConnectionWatchFunc   func(ctx context.Context, targets []resource.ReadTarget) error
	StopConnectionWatchFunc    func(ctx context.Context, route resource.AccessRoute) error
	HasWatchFunc               func(ctx context.Context, route resource.AccessRoute) bool
	GetWatchStateFunc          func(ctx context.Context, route resource.AccessRoute) (*resource.WatchConnectionSummary, error)
	ListenForEventsFunc        func(ctx context.Context, sink resource.WatchEventSink, onReady func() error) error
	EnsureResourceWatchFunc    func(ctx context.Context, target resource.ReadTarget) error
	StopResourceWatchFunc      func(ctx context.Context, route resource.AccessRoute, resourceType string) error
	RestartResourceWatchFunc   func(ctx context.Context, target resource.ReadTarget) error
	IsResourceWatchRunningFunc func(ctx context.Context, route resource.AccessRoute, resourceType string) (bool, error)
	GetResourceGroupsFunc      func(ctx context.Context, route resource.AccessRoute) ([]resource.ResourceGroup, error)
	GetResourceDefinitionFunc  func(ctx context.Context, route resource.AccessRoute, resourceType string) (resource.ResourceDefinition, error)
	ScopeValuesFunc            func(ctx context.Context, route resource.AccessRoute, dimension string) ([]string, error)
	GetActionsFunc             func(ctx context.Context, route resource.AccessRoute, resourceType string) ([]resource.ActionDescriptor, error)
	StreamActionFunc           func(ctx context.Context, request resource.ActionRequest, stream chan<- resource.ActionEvent) error
	GetEditorSchemasFunc       func(ctx context.Context, route resource.AccessRoute) ([]resource.EditorSchema, error)
	GetSchemaDocumentFunc      func(ctx context.Context, route resource.AccessRoute, reference resource.SchemaDocumentReference) (resource.SchemaDocument, error)
	GetRelationshipsFunc       func(ctx context.Context, route resource.AccessRoute, resourceType string) ([]resource.RelationshipDescriptor, error)
	ResolveRelationshipsFunc   func(ctx context.Context, request resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error)
	GetHealthFunc              func(ctx context.Context, request resource.GetRequest, body resource.Value) (*resource.ResourceHealth, error)
	GetResourceEventsFunc      func(ctx context.Context, request resource.GetRequest, limit uint32) ([]resource.ResourceEvent, error)
}

var _ resource.Provider = (*mockProvider)(nil)

type catalogOnlyProvider struct {
	CatalogFunc      func(context.Context, resource.CatalogRequest) (resource.Catalog, error)
	catalogEpochOnce sync.Once
	catalogEpoch     string
	catalogEpochErr  error
}

func (p *catalogOnlyProvider) Catalog(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
	catalog, err := p.CatalogFunc(ctx, request)
	if err != nil {
		return resource.Catalog{}, err
	}
	if _, err := resource.CatalogBindingEpoch(catalog.Revision); err == nil {
		return catalog, nil
	}
	p.catalogEpochOnce.Do(func() { p.catalogEpoch, p.catalogEpochErr = resource.NewCatalogBindingEpoch() })
	if p.catalogEpochErr != nil {
		return resource.Catalog{}, p.catalogEpochErr
	}
	catalog.Revision, err = resource.BindCatalogRevision(p.catalogEpoch, catalog.Revision)
	return catalog, err
}

func canonicalTestRepresentation() resource.Representation {
	return resource.Representation{ID: "native", Revision: "r1", Schema: resource.SchemaBinding{State: "absent", Validation: "none", Unvalidated: []string{}}}
}

func canonicalTestCatalog(provider, resourceType string) resource.Catalog {
	return resource.Catalog{Provider: provider, Revision: "r1", Coverage: resource.Coverage{Kind: "complete", Paths: []string{}}, Types: []resource.ResourceType{{
		Type: resourceType, DisplayName: resourceType, IdentityDimensions: []resource.Dimension{}, QueryDimensions: []resource.Dimension{},
		Representations: []resource.Representation{canonicalTestRepresentation()},
		Capabilities:    []resource.Capability{{Operation: resource.OperationGet}, {Operation: resource.OperationEnumerate}, {Operation: resource.OperationNativeQuery}, {Operation: resource.OperationCreate}, {Operation: resource.OperationMutationUpdate}, {Operation: resource.OperationDelete}, {Operation: resource.OperationAction}},
	}}}
}

func canonicalTestRecord(provider, authority, resourceType, id string) resource.Record {
	return resource.Record{
		Reference:      resource.ResourceReference{Address: resource.ResourceAddress{Provider: provider, Authority: authority, Type: resourceType, Scope: []resource.ScopeEntry{}, ID: id}},
		Body:           resource.Value{Kind: "map", Map: map[string]resource.Value{"name": {Kind: "string", String: id}}},
		Representation: canonicalTestRepresentation(), Coverage: resource.Coverage{Kind: "complete", Paths: []string{}},
	}
}

func admittedReadTarget(t *testing.T, ctrl *controller, pluginID, connectionID, resourceType string) ResolvedTarget {
	t.Helper()
	route := resource.AccessRoute{Connection: connectionID}
	catalog, err := ctrl.Catalog(testInvocationContext(), pluginID, resource.CatalogRequest{Route: route})
	require.NoError(t, err)
	representation := ""
	for _, descriptor := range catalog.Types {
		if descriptor.Type == resourceType {
			require.Len(t, descriptor.Representations, 1, "test must select one explicit representation")
			representation = descriptor.Representations[0].ID
			break
		}
	}
	require.NotEmpty(t, representation, "test resource type must exist in catalog")
	target, err := ctrl.ResolveTarget(testInvocationContext(), pluginID, ResolveTargetRequest{Route: route, Type: resourceType, Representation: representation, Scope: resource.QueryScope{}})
	require.NoError(t, err)
	return target
}

func admittedGetRequest(t *testing.T, ctrl *controller, pluginID, connectionID, resourceType, id string) HostGetRequest {
	t.Helper()
	resolved := admittedReadTarget(t, ctrl, pluginID, connectionID, resourceType)
	return HostGetRequest{TargetID: resolved.TargetID, Request: resource.GetRequest{
		Route: resolved.Target.Route, Representation: resolved.Target.Representation,
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{
			Provider: resolved.Target.Provider, Authority: resolved.Target.Authority, Type: resolved.Target.Type, ID: id, Scope: []resource.ScopeEntry{},
		}},
	}}
}

func admittedActionRequest(t *testing.T, ctrl *controller, pluginID, connectionID, resourceType, action string) resource.ActionRequest {
	t.Helper()
	request := admittedGetRequest(t, ctrl, pluginID, connectionID, resourceType, "private-object").Request
	return resource.ActionRequest{Route: request.Route, Reference: request.Reference, Action: action, Input: resource.Value{Kind: "null"}}
}

func admittedSubscription(t *testing.T, ctrl *controller, pluginID, connectionID, resourceType string) HostSubscription {
	t.Helper()
	resolved := admittedReadTarget(t, ctrl, pluginID, connectionID, resourceType)
	return HostSubscription{TargetID: resolved.TargetID, Target: resolved.Target}
}

func (m *mockProvider) Catalog(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
	if m.CatalogFunc != nil {
		catalog, err := m.CatalogFunc(ctx, request)
		if err != nil {
			return resource.Catalog{}, err
		}
		if _, err := resource.CatalogBindingEpoch(catalog.Revision); err == nil {
			return catalog, nil
		}
		m.catalogEpochOnce.Do(func() {
			m.catalogEpoch, m.catalogEpochErr = resource.NewCatalogBindingEpoch()
		})
		if m.catalogEpochErr != nil {
			return resource.Catalog{}, m.catalogEpochErr
		}
		catalog.Revision, err = resource.BindCatalogRevision(m.catalogEpoch, catalog.Revision)
		return catalog, err
	}
	var zero resource.Catalog
	return zero, nil
}

func (m *mockProvider) Get(ctx context.Context, request resource.GetRequest) (resource.Record, error) {
	if m.GetFunc != nil {
		return m.GetFunc(ctx, request)
	}
	var zero resource.Record
	return zero, nil
}

func (m *mockProvider) Enumerate(ctx context.Context, request resource.EnumerateRequest) (resource.SourcePage, error) {
	if m.EnumerateFunc != nil {
		return m.EnumerateFunc(ctx, request)
	}
	var zero resource.SourcePage
	return zero, nil
}

func (m *mockProvider) NativeQuery(ctx context.Context, request resource.NativeQueryRequest) (resource.SourcePage, error) {
	if m.NativeQueryFunc != nil {
		return m.NativeQueryFunc(ctx, request)
	}
	var zero resource.SourcePage
	return zero, nil
}

func (m *mockProvider) Mutate(ctx context.Context, request resource.MutationRequest) (resource.Record, error) {
	if m.MutateFunc != nil {
		return m.MutateFunc(ctx, request)
	}
	var zero resource.Record
	return zero, nil
}

func (m *mockProvider) Action(ctx context.Context, request resource.ActionRequest) (resource.Value, error) {
	if m.ActionFunc != nil {
		return m.ActionFunc(ctx, request)
	}
	var zero resource.Value
	return zero, nil
}

func (m *mockProvider) StartConnection(ctx context.Context, id string) (types.ConnectionStatus, error) {
	if m.StartConnectionFunc != nil {
		return m.StartConnectionFunc(ctx, id)
	}
	var zero types.ConnectionStatus
	return zero, nil
}

func (m *mockProvider) StopConnection(ctx context.Context, id string) (types.Connection, error) {
	if m.StopConnectionFunc != nil {
		return m.StopConnectionFunc(ctx, id)
	}
	var zero types.Connection
	return zero, nil
}

func (m *mockProvider) CheckConnection(ctx context.Context, id string) (types.ConnectionStatus, error) {
	if m.CheckConnectionFunc != nil {
		return m.CheckConnectionFunc(ctx, id)
	}
	return types.ConnectionStatus{Status: types.ConnectionStatusConnected}, nil
}

func (m *mockProvider) LoadConnections(ctx context.Context) ([]types.Connection, error) {
	if m.LoadConnectionsFunc != nil {
		connections, err := m.LoadConnectionsFunc(ctx)
		if err != nil {
			return nil, err
		}
		return m.effectiveConnections(connections), nil
	}
	return m.ListConnections(ctx)
}

func (m *mockProvider) ListConnections(ctx context.Context) ([]types.Connection, error) {
	var connections []types.Connection
	var err error
	if m.ListConnectionsFunc != nil {
		connections, err = m.ListConnectionsFunc(ctx)
	} else {
		connections, err = m.NativeConnections(ctx)
	}
	if err != nil {
		return nil, err
	}
	return m.effectiveConnections(connections), nil
}

func (m *mockProvider) NativeConnections(ctx context.Context) ([]types.Connection, error) {
	if m.NativeConnectionsFunc != nil {
		return m.NativeConnectionsFunc(ctx)
	}
	if m.LoadConnectionsFunc != nil {
		return m.LoadConnectionsFunc(ctx)
	}
	if m.ListConnectionsFunc != nil {
		return m.ListConnectionsFunc(ctx)
	}
	return nil, nil
}

func (m *mockProvider) ApplyConnectionOverlay(ctx context.Context, overlay resource.ConnectionOverlay) error {
	if m.ApplyConnectionOverlayFunc != nil {
		return m.ApplyConnectionOverlayFunc(ctx, overlay)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := resource.ValidateConnectionOverlay(overlay); err != nil {
		return err
	}
	m.connectionOverlayMu.Lock()
	defer m.connectionOverlayMu.Unlock()
	m.connectionOverlay = resource.ConnectionOverlay{
		Upserts:     append([]types.Connection(nil), overlay.Upserts...),
		DisabledIDs: append([]string(nil), overlay.DisabledIDs...),
	}
	return nil
}

func (m *mockProvider) effectiveConnections(native []types.Connection) []types.Connection {
	m.connectionOverlayMu.Lock()
	defer m.connectionOverlayMu.Unlock()
	disabled := make(map[string]bool, len(m.connectionOverlay.DisabledIDs))
	for _, id := range m.connectionOverlay.DisabledIDs {
		disabled[id] = true
	}
	upserts := make(map[string]types.Connection, len(m.connectionOverlay.Upserts))
	for _, connection := range m.connectionOverlay.Upserts {
		upserts[connection.ID] = connection
	}
	effective := make([]types.Connection, 0, len(native)+len(upserts))
	seen := make(map[string]bool, len(native))
	for _, connection := range native {
		if disabled[connection.ID] {
			continue
		}
		if replacement, found := upserts[connection.ID]; found {
			connection = replacement
		}
		effective = append(effective, connection)
		seen[connection.ID] = true
	}
	for _, connection := range m.connectionOverlay.Upserts {
		if !seen[connection.ID] {
			effective = append(effective, connection)
		}
	}
	return effective
}

func connectionOverlayTestProvider(native ...types.Connection) *mockProvider {
	snapshot := append([]types.Connection(nil), native...)
	return &mockProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		return resource.Catalog{Provider: "connection-fixture", Revision: "inventory-1", Coverage: resource.Coverage{Kind: "complete", Paths: []string{}}, Types: []resource.ResourceType{}}, nil
	}, NativeConnectionsFunc: func(context.Context) ([]types.Connection, error) {
		return append([]types.Connection(nil), snapshot...), nil
	}}
}

func (m *mockProvider) GetConnection(ctx context.Context, id string) (types.Connection, error) {
	if m.GetConnectionFunc != nil {
		return m.GetConnectionFunc(ctx, id)
	}
	var zero types.Connection
	return zero, nil
}

func (m *mockProvider) UpdateConnection(ctx context.Context, connection types.Connection) (types.Connection, error) {
	if m.UpdateConnectionFunc != nil {
		return m.UpdateConnectionFunc(ctx, connection)
	}
	var zero types.Connection
	return zero, nil
}

func (m *mockProvider) DeleteConnection(ctx context.Context, id string) error {
	if m.DeleteConnectionFunc != nil {
		return m.DeleteConnectionFunc(ctx, id)
	}
	return nil
}

func (m *mockProvider) WatchConnections(ctx context.Context, stream chan<- []types.Connection) error {
	if m.WatchConnectionsFunc != nil {
		return m.WatchConnectionsFunc(ctx, stream)
	}
	<-ctx.Done()
	return nil
}

func (m *mockProvider) StartConnectionWatch(ctx context.Context, targets []resource.ReadTarget) error {
	if m.StartConnectionWatchFunc != nil {
		return m.StartConnectionWatchFunc(ctx, targets)
	}
	return nil
}

func (m *mockProvider) StopConnectionWatch(ctx context.Context, route resource.AccessRoute) error {
	if m.StopConnectionWatchFunc != nil {
		return m.StopConnectionWatchFunc(ctx, route)
	}
	return nil
}

func (m *mockProvider) HasWatch(ctx context.Context, route resource.AccessRoute) bool {
	if m.HasWatchFunc != nil {
		return m.HasWatchFunc(ctx, route)
	}
	return false
}

func (m *mockProvider) GetWatchState(ctx context.Context, route resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
	if m.GetWatchStateFunc != nil {
		return m.GetWatchStateFunc(ctx, route)
	}
	var zero *resource.WatchConnectionSummary
	return zero, nil
}

func (m *mockProvider) ListenForEvents(ctx context.Context, sink resource.WatchEventSink, onReady func() error) error {
	if m.ListenForEventsFunc != nil {
		return m.ListenForEventsFunc(ctx, sink, onReady)
	}
	if onReady != nil {
		if err := onReady(); err != nil {
			return err
		}
	}
	<-ctx.Done()
	return nil
}

func (m *mockProvider) EnsureResourceWatch(ctx context.Context, target resource.ReadTarget) error {
	if m.EnsureResourceWatchFunc != nil {
		return m.EnsureResourceWatchFunc(ctx, target)
	}
	return nil
}

func (m *mockProvider) StopResourceWatch(ctx context.Context, route resource.AccessRoute, resourceType string) error {
	if m.StopResourceWatchFunc != nil {
		return m.StopResourceWatchFunc(ctx, route, resourceType)
	}
	return nil
}

func (m *mockProvider) RestartResourceWatch(ctx context.Context, target resource.ReadTarget) error {
	if m.RestartResourceWatchFunc != nil {
		return m.RestartResourceWatchFunc(ctx, target)
	}
	return nil
}

func (m *mockProvider) IsResourceWatchRunning(ctx context.Context, route resource.AccessRoute, resourceType string) (bool, error) {
	if m.IsResourceWatchRunningFunc != nil {
		return m.IsResourceWatchRunningFunc(ctx, route, resourceType)
	}
	var zero bool
	return zero, nil
}

func (m *mockProvider) GetResourceGroups(ctx context.Context, route resource.AccessRoute) ([]resource.ResourceGroup, error) {
	if m.GetResourceGroupsFunc != nil {
		return m.GetResourceGroupsFunc(ctx, route)
	}
	var zero []resource.ResourceGroup
	return zero, nil
}

func (m *mockProvider) GetResourceDefinition(ctx context.Context, route resource.AccessRoute, resourceType string) (resource.ResourceDefinition, error) {
	if m.GetResourceDefinitionFunc != nil {
		return m.GetResourceDefinitionFunc(ctx, route, resourceType)
	}
	var zero resource.ResourceDefinition
	return zero, nil
}

func (m *mockProvider) ScopeValues(ctx context.Context, route resource.AccessRoute, dimension string) ([]string, error) {
	if m.ScopeValuesFunc != nil {
		return m.ScopeValuesFunc(ctx, route, dimension)
	}
	var zero []string
	return zero, nil
}

func (m *mockProvider) GetActions(ctx context.Context, route resource.AccessRoute, resourceType string) ([]resource.ActionDescriptor, error) {
	if m.GetActionsFunc != nil {
		return m.GetActionsFunc(ctx, route, resourceType)
	}
	var zero []resource.ActionDescriptor
	return zero, nil
}

func (m *mockProvider) StreamAction(ctx context.Context, request resource.ActionRequest, stream chan<- resource.ActionEvent) error {
	if m.StreamActionFunc != nil {
		return m.StreamActionFunc(ctx, request, stream)
	}
	return nil
}

func (m *mockProvider) GetEditorSchemas(ctx context.Context, route resource.AccessRoute) ([]resource.EditorSchema, error) {
	if m.GetEditorSchemasFunc != nil {
		return m.GetEditorSchemasFunc(ctx, route)
	}
	var zero []resource.EditorSchema
	return zero, nil
}

func (m *mockProvider) GetSchemaDocument(ctx context.Context, route resource.AccessRoute, reference resource.SchemaDocumentReference) (resource.SchemaDocument, error) {
	if m.GetSchemaDocumentFunc != nil {
		return m.GetSchemaDocumentFunc(ctx, route, reference)
	}
	var zero resource.SchemaDocument
	return zero, nil
}

func (m *mockProvider) GetRelationships(ctx context.Context, route resource.AccessRoute, resourceType string) ([]resource.RelationshipDescriptor, error) {
	if m.GetRelationshipsFunc != nil {
		return m.GetRelationshipsFunc(ctx, route, resourceType)
	}
	var zero []resource.RelationshipDescriptor
	return zero, nil
}

func (m *mockProvider) ResolveRelationships(ctx context.Context, request resource.RelationshipResolutionRequest) ([]resource.ResolvedRelationship, error) {
	if m.ResolveRelationshipsFunc != nil {
		return m.ResolveRelationshipsFunc(ctx, request)
	}
	var zero []resource.ResolvedRelationship
	return zero, nil
}

func (m *mockProvider) GetHealth(ctx context.Context, request resource.GetRequest, body resource.Value) (*resource.ResourceHealth, error) {
	if m.GetHealthFunc != nil {
		return m.GetHealthFunc(ctx, request, body)
	}
	var zero *resource.ResourceHealth
	return zero, nil
}

func (m *mockProvider) GetResourceEvents(ctx context.Context, request resource.GetRequest, limit uint32) ([]resource.ResourceEvent, error) {
	if m.GetResourceEventsFunc != nil {
		return m.GetResourceEventsFunc(ctx, request, limit)
	}
	var zero []resource.ResourceEvent
	return zero, nil
}

// ============================================================================
// recordingEmitter standalone tests
// ============================================================================

func TestRecordingEmitter_EmitAndEvents(t *testing.T) {
	e := newRecordingEmitter()
	e.Emit("key-1", "data-1")
	e.Emit("key-2", "data-2")

	events := e.Events()
	require.Len(t, events, 2)
	assert.Equal(t, "key-1", events[0].Key)
	assert.Equal(t, []any{"data-1"}, events[0].Data)
	assert.Equal(t, "key-2", events[1].Key)
	assert.Equal(t, []any{"data-2"}, events[1].Data)
}

func TestRecordingEmitter_CountEvents(t *testing.T) {
	e := newRecordingEmitter()
	e.Emit("resource/ADD", nil)
	e.Emit("resource/UPDATE", nil)
	e.Emit("resource/ADD", nil)

	assert.Equal(t, 2, e.CountEvents("ADD"))
	assert.Equal(t, 1, e.CountEvents("UPDATE"))
	assert.Equal(t, 0, e.CountEvents("DELETE"))
	assert.Equal(t, 3, e.CountEvents("resource"))
}

func TestRecordingEmitter_EventsWithKey(t *testing.T) {
	e := newRecordingEmitter()
	e.Emit("p1/conn/pods/ADD", "a")
	e.Emit("p1/conn/pods/UPDATE", "b")
	e.Emit("p2/conn/pods/ADD", "c")

	adds := e.EventsWithKey("ADD")
	require.Len(t, adds, 2)
	assert.Equal(t, []any{"a"}, adds[0].Data)
	assert.Equal(t, []any{"c"}, adds[1].Data)

	p1 := e.EventsWithKey("p1")
	assert.Len(t, p1, 2)
}

func TestRecordingEmitter_WaitForEvent_Immediate(t *testing.T) {
	e := newRecordingEmitter()
	e.Emit("target/event", "payload")

	ev := e.WaitForEvent(t, "target", 100*time.Millisecond)
	assert.Equal(t, "target/event", ev.Key)
	assert.Equal(t, []any{"payload"}, ev.Data)
}

func TestRecordingEmitter_WaitForEvent_Async(t *testing.T) {
	e := newRecordingEmitter()

	go func() {
		time.Sleep(20 * time.Millisecond)
		e.Emit("async/event", "arrived")
	}()

	ev := e.WaitForEvent(t, "async", 2*time.Second)
	assert.Equal(t, "async/event", ev.Key)
	assert.Equal(t, []any{"arrived"}, ev.Data)
}

func TestRecordingEmitter_WaitForNEvents(t *testing.T) {
	e := newRecordingEmitter()

	go func() {
		for i := 0; i < 5; i++ {
			e.Emit("batch/item", i)
			time.Sleep(5 * time.Millisecond)
		}
	}()

	events := e.WaitForNEvents(t, "batch", 3, 2*time.Second)
	require.Len(t, events, 3)
}

func TestRecordingEmitter_Reset(t *testing.T) {
	e := newRecordingEmitter()
	e.Emit("a", nil)
	e.Emit("b", nil)
	assert.Len(t, e.Events(), 2)

	e.Reset()
	assert.Empty(t, e.Events())

	// Can emit again after reset.
	e.Emit("c", nil)
	assert.Len(t, e.Events(), 1)
}

// ============================================================================
// Test helpers
// ============================================================================

// newTestControllerWithEmitter creates a controller with a recording emitter
// and no-op logger. Suitable for unit tests.
func newTestControllerWithEmitter(t *testing.T) (*controller, *recordingEmitter) {
	t.Helper()
	emitter := newRecordingEmitter()
	store := registry.NewMemoryStore()
	g := graph.NewRelationshipGraph()
	graphIndexer := graph.NewGraphIndexer(g, store)
	disp := indexer.NewDispatcher([]indexer.ResourceIndexer{graphIndexer})
	disp.Start()
	t.Cleanup(disp.Stop)

	svc := appstate.NewTestService(t)
	ctrl := &controller{
		logger:              logging.NewNop(),
		plugins:             make(map[string]*pluginState),
		connections:         make(map[string][]types.Connection),
		autoConnectAttempts: make(map[string]string),
		subs:                newSubscriptionManager(),
		actions:             newActionRegistry(),
		emitter:             emitter,
		registryStore:       store,
		dispatcher:          disp,
		graph:               g,
		pluginStoreFn:       svc.PluginStore,
		watchAfterFunc:      func(d time.Duration, fn func()) actionTimer { return time.AfterFunc(d, fn) },
	}
	ctrl.actions.emit = func(id string, snapshot ActionSnapshot) { emitter.Emit("action/stream/"+id, snapshot) }
	t.Cleanup(ctrl.actions.stopAll)
	t.Cleanup(func() {
		ctrl.pluginsMu.Lock()
		defer ctrl.pluginsMu.Unlock()
		for _, state := range ctrl.plugins {
			if state.watchCancel != nil {
				state.watchCancel()
			}
		}
	})
	return ctrl, emitter
}

// registerMockPlugin registers a mockProvider under a pluginID with a default
// watch cancel context.
func registerMockPlugin(ctrl *controller, pluginID string, provider resource.Provider) {
	ctx, cancel := context.WithCancel(context.Background())
	ctrl.pluginsMu.Lock()
	if existing, ok := ctrl.plugins[pluginID]; ok {
		existing.watchCancel()
	}
	ctrl.plugins[pluginID] = &pluginState{
		provider:     provider,
		version:      1,
		watchCancel:  cancel,
		ctx:          ctx,
		generationID: uuid.NewString(),
	}
	ctrl.pluginsMu.Unlock()
	ctrl.connsMu.Lock()
	if ctrl.connections[pluginID] == nil {
		ctrl.connections[pluginID] = []types.Connection{}
	}
	ctrl.connsMu.Unlock()
}

func testInvocationContext() context.Context { return invocation.HostContext(context.Background()) }

func actionCount(registry *actionRegistry) int {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	return len(registry.entries) + len(registry.pending)
}
