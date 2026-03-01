package resource

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ============================================================================
// recordingEmitter — captures emitted events for test assertions.
// ============================================================================

type emittedEvent struct {
	Key  string
	Data interface{}
}

type recordingEmitter struct {
	mu      sync.Mutex
	events  []emittedEvent
	changed chan struct{} // closed-and-recreated on each event to wake waiters
}

func newRecordingEmitter() *recordingEmitter {
	return &recordingEmitter{changed: make(chan struct{})}
}

func (e *recordingEmitter) Emit(key string, data interface{}) {
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

// ============================================================================
// mockProvider — implements ResourceProvider with configurable func fields.
// Every method has a corresponding *Func field. If nil, returns zero values.
// ============================================================================

type mockProvider struct {
	GetFunc                    func(ctx context.Context, key string, input resource.GetInput) (*resource.GetResult, error)
	ListFunc                   func(ctx context.Context, key string, input resource.ListInput) (*resource.ListResult, error)
	FindFunc                   func(ctx context.Context, key string, input resource.FindInput) (*resource.FindResult, error)
	CreateFunc                 func(ctx context.Context, key string, input resource.CreateInput) (*resource.CreateResult, error)
	UpdateFunc                 func(ctx context.Context, key string, input resource.UpdateInput) (*resource.UpdateResult, error)
	DeleteFunc                 func(ctx context.Context, key string, input resource.DeleteInput) (*resource.DeleteResult, error)
	StartConnectionFunc        func(ctx context.Context, connectionID string) (types.ConnectionStatus, error)
	StopConnectionFunc         func(ctx context.Context, connectionID string) (types.Connection, error)
	LoadConnectionsFunc        func(ctx context.Context) ([]types.Connection, error)
	ListConnectionsFunc        func(ctx context.Context) ([]types.Connection, error)
	GetConnectionFunc          func(ctx context.Context, id string) (types.Connection, error)
	GetConnectionNamespacesFunc func(ctx context.Context, id string) ([]string, error)
	UpdateConnectionFunc       func(ctx context.Context, connection types.Connection) (types.Connection, error)
	DeleteConnectionFunc       func(ctx context.Context, id string) error
	WatchConnectionsFunc       func(ctx context.Context, stream chan<- []types.Connection) error
	StartConnectionWatchFunc   func(ctx context.Context, connectionID string) error
	StopConnectionWatchFunc    func(ctx context.Context, connectionID string) error
	HasWatchFunc               func(ctx context.Context, connectionID string) bool
	GetWatchStateFunc          func(ctx context.Context, connectionID string) (*resource.WatchConnectionSummary, error)
	ListenForEventsFunc        func(ctx context.Context, sink resource.WatchEventSink) error
	EnsureResourceWatchFunc    func(ctx context.Context, connectionID, resourceKey string) error
	StopResourceWatchFunc      func(ctx context.Context, connectionID, resourceKey string) error
	RestartResourceWatchFunc   func(ctx context.Context, connectionID, resourceKey string) error
	IsResourceWatchRunningFunc func(ctx context.Context, connectionID, resourceKey string) (bool, error)
	GetResourceGroupsFunc      func(ctx context.Context, connectionID string) map[string]resource.ResourceGroup
	GetResourceGroupFunc       func(ctx context.Context, id string) (resource.ResourceGroup, error)
	GetResourceTypesFunc       func(ctx context.Context, connectionID string) map[string]resource.ResourceMeta
	GetResourceTypeFunc        func(ctx context.Context, id string) (*resource.ResourceMeta, error)
	HasResourceTypeFunc        func(ctx context.Context, id string) bool
	GetResourceDefinitionFunc  func(ctx context.Context, id string) (resource.ResourceDefinition, error)
	GetResourceCapabilitiesFunc func(ctx context.Context, resourceKey string) (*resource.ResourceCapabilities, error)
	GetResourceSchemaFunc      func(ctx context.Context, connectionID, resourceKey string) (json.RawMessage, error)
	GetFilterFieldsFunc        func(ctx context.Context, connectionID, resourceKey string) ([]resource.FilterField, error)
	GetActionsFunc             func(ctx context.Context, key string) ([]resource.ActionDescriptor, error)
	ExecuteActionFunc          func(ctx context.Context, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error)
	StreamActionFunc           func(ctx context.Context, key, actionID string, input resource.ActionInput, stream chan<- resource.ActionEvent) error
	GetEditorSchemasFunc       func(ctx context.Context, connectionID string) ([]resource.EditorSchema, error)
	GetRelationshipsFunc       func(ctx context.Context, resourceKey string) ([]resource.RelationshipDescriptor, error)
	ResolveRelationshipsFunc   func(ctx context.Context, connectionID, resourceKey, id, namespace string) ([]resource.ResolvedRelationship, error)
	GetHealthFunc              func(ctx context.Context, connectionID, resourceKey string, data json.RawMessage) (*resource.ResourceHealth, error)
	GetResourceEventsFunc      func(ctx context.Context, connectionID, resourceKey, id, namespace string, limit int32) ([]resource.ResourceEvent, error)
}

// compile-time check
var _ ResourceProvider = (*mockProvider)(nil)

func (m *mockProvider) Get(ctx context.Context, key string, input resource.GetInput) (*resource.GetResult, error) {
	if m.GetFunc != nil {
		return m.GetFunc(ctx, key, input)
	}
	return &resource.GetResult{}, nil
}

func (m *mockProvider) List(ctx context.Context, key string, input resource.ListInput) (*resource.ListResult, error) {
	if m.ListFunc != nil {
		return m.ListFunc(ctx, key, input)
	}
	return &resource.ListResult{}, nil
}

func (m *mockProvider) Find(ctx context.Context, key string, input resource.FindInput) (*resource.FindResult, error) {
	if m.FindFunc != nil {
		return m.FindFunc(ctx, key, input)
	}
	return &resource.FindResult{}, nil
}

func (m *mockProvider) Create(ctx context.Context, key string, input resource.CreateInput) (*resource.CreateResult, error) {
	if m.CreateFunc != nil {
		return m.CreateFunc(ctx, key, input)
	}
	return &resource.CreateResult{}, nil
}

func (m *mockProvider) Update(ctx context.Context, key string, input resource.UpdateInput) (*resource.UpdateResult, error) {
	if m.UpdateFunc != nil {
		return m.UpdateFunc(ctx, key, input)
	}
	return &resource.UpdateResult{}, nil
}

func (m *mockProvider) Delete(ctx context.Context, key string, input resource.DeleteInput) (*resource.DeleteResult, error) {
	if m.DeleteFunc != nil {
		return m.DeleteFunc(ctx, key, input)
	}
	return &resource.DeleteResult{}, nil
}

func (m *mockProvider) StartConnection(ctx context.Context, connectionID string) (types.ConnectionStatus, error) {
	if m.StartConnectionFunc != nil {
		return m.StartConnectionFunc(ctx, connectionID)
	}
	return types.ConnectionStatus{}, nil
}

func (m *mockProvider) StopConnection(ctx context.Context, connectionID string) (types.Connection, error) {
	if m.StopConnectionFunc != nil {
		return m.StopConnectionFunc(ctx, connectionID)
	}
	return types.Connection{}, nil
}

func (m *mockProvider) LoadConnections(ctx context.Context) ([]types.Connection, error) {
	if m.LoadConnectionsFunc != nil {
		return m.LoadConnectionsFunc(ctx)
	}
	return nil, nil
}

func (m *mockProvider) ListConnections(ctx context.Context) ([]types.Connection, error) {
	if m.ListConnectionsFunc != nil {
		return m.ListConnectionsFunc(ctx)
	}
	return nil, nil
}

func (m *mockProvider) GetConnection(ctx context.Context, id string) (types.Connection, error) {
	if m.GetConnectionFunc != nil {
		return m.GetConnectionFunc(ctx, id)
	}
	return types.Connection{}, nil
}

func (m *mockProvider) GetConnectionNamespaces(ctx context.Context, id string) ([]string, error) {
	if m.GetConnectionNamespacesFunc != nil {
		return m.GetConnectionNamespacesFunc(ctx, id)
	}
	return nil, nil
}

func (m *mockProvider) UpdateConnection(ctx context.Context, connection types.Connection) (types.Connection, error) {
	if m.UpdateConnectionFunc != nil {
		return m.UpdateConnectionFunc(ctx, connection)
	}
	return types.Connection{}, nil
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

func (m *mockProvider) StartConnectionWatch(ctx context.Context, connectionID string) error {
	if m.StartConnectionWatchFunc != nil {
		return m.StartConnectionWatchFunc(ctx, connectionID)
	}
	return nil
}

func (m *mockProvider) StopConnectionWatch(ctx context.Context, connectionID string) error {
	if m.StopConnectionWatchFunc != nil {
		return m.StopConnectionWatchFunc(ctx, connectionID)
	}
	return nil
}

func (m *mockProvider) HasWatch(ctx context.Context, connectionID string) bool {
	if m.HasWatchFunc != nil {
		return m.HasWatchFunc(ctx, connectionID)
	}
	return false
}

func (m *mockProvider) GetWatchState(ctx context.Context, connectionID string) (*resource.WatchConnectionSummary, error) {
	if m.GetWatchStateFunc != nil {
		return m.GetWatchStateFunc(ctx, connectionID)
	}
	return nil, nil
}

func (m *mockProvider) ListenForEvents(ctx context.Context, sink resource.WatchEventSink) error {
	if m.ListenForEventsFunc != nil {
		return m.ListenForEventsFunc(ctx, sink)
	}
	<-ctx.Done()
	return nil
}

func (m *mockProvider) EnsureResourceWatch(ctx context.Context, connectionID, resourceKey string) error {
	if m.EnsureResourceWatchFunc != nil {
		return m.EnsureResourceWatchFunc(ctx, connectionID, resourceKey)
	}
	return nil
}

func (m *mockProvider) StopResourceWatch(ctx context.Context, connectionID, resourceKey string) error {
	if m.StopResourceWatchFunc != nil {
		return m.StopResourceWatchFunc(ctx, connectionID, resourceKey)
	}
	return nil
}

func (m *mockProvider) RestartResourceWatch(ctx context.Context, connectionID, resourceKey string) error {
	if m.RestartResourceWatchFunc != nil {
		return m.RestartResourceWatchFunc(ctx, connectionID, resourceKey)
	}
	return nil
}

func (m *mockProvider) IsResourceWatchRunning(ctx context.Context, connectionID, resourceKey string) (bool, error) {
	if m.IsResourceWatchRunningFunc != nil {
		return m.IsResourceWatchRunningFunc(ctx, connectionID, resourceKey)
	}
	return false, nil
}

func (m *mockProvider) GetResourceGroups(ctx context.Context, connectionID string) map[string]resource.ResourceGroup {
	if m.GetResourceGroupsFunc != nil {
		return m.GetResourceGroupsFunc(ctx, connectionID)
	}
	return nil
}

func (m *mockProvider) GetResourceGroup(ctx context.Context, id string) (resource.ResourceGroup, error) {
	if m.GetResourceGroupFunc != nil {
		return m.GetResourceGroupFunc(ctx, id)
	}
	return resource.ResourceGroup{}, nil
}

func (m *mockProvider) GetResourceTypes(ctx context.Context, connectionID string) map[string]resource.ResourceMeta {
	if m.GetResourceTypesFunc != nil {
		return m.GetResourceTypesFunc(ctx, connectionID)
	}
	return nil
}

func (m *mockProvider) GetResourceType(ctx context.Context, id string) (*resource.ResourceMeta, error) {
	if m.GetResourceTypeFunc != nil {
		return m.GetResourceTypeFunc(ctx, id)
	}
	return nil, nil
}

func (m *mockProvider) HasResourceType(ctx context.Context, id string) bool {
	if m.HasResourceTypeFunc != nil {
		return m.HasResourceTypeFunc(ctx, id)
	}
	return false
}

func (m *mockProvider) GetResourceDefinition(ctx context.Context, id string) (resource.ResourceDefinition, error) {
	if m.GetResourceDefinitionFunc != nil {
		return m.GetResourceDefinitionFunc(ctx, id)
	}
	return resource.ResourceDefinition{}, nil
}

func (m *mockProvider) GetResourceCapabilities(ctx context.Context, resourceKey string) (*resource.ResourceCapabilities, error) {
	if m.GetResourceCapabilitiesFunc != nil {
		return m.GetResourceCapabilitiesFunc(ctx, resourceKey)
	}
	return nil, nil
}

func (m *mockProvider) GetResourceSchema(ctx context.Context, connectionID, resourceKey string) (json.RawMessage, error) {
	if m.GetResourceSchemaFunc != nil {
		return m.GetResourceSchemaFunc(ctx, connectionID, resourceKey)
	}
	return nil, nil
}

func (m *mockProvider) GetFilterFields(ctx context.Context, connectionID, resourceKey string) ([]resource.FilterField, error) {
	if m.GetFilterFieldsFunc != nil {
		return m.GetFilterFieldsFunc(ctx, connectionID, resourceKey)
	}
	return nil, nil
}

func (m *mockProvider) GetActions(ctx context.Context, key string) ([]resource.ActionDescriptor, error) {
	if m.GetActionsFunc != nil {
		return m.GetActionsFunc(ctx, key)
	}
	return nil, nil
}

func (m *mockProvider) ExecuteAction(ctx context.Context, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error) {
	if m.ExecuteActionFunc != nil {
		return m.ExecuteActionFunc(ctx, key, actionID, input)
	}
	return nil, nil
}

func (m *mockProvider) StreamAction(ctx context.Context, key, actionID string, input resource.ActionInput, stream chan<- resource.ActionEvent) error {
	if m.StreamActionFunc != nil {
		return m.StreamActionFunc(ctx, key, actionID, input, stream)
	}
	return nil
}

func (m *mockProvider) GetEditorSchemas(ctx context.Context, connectionID string) ([]resource.EditorSchema, error) {
	if m.GetEditorSchemasFunc != nil {
		return m.GetEditorSchemasFunc(ctx, connectionID)
	}
	return nil, nil
}

func (m *mockProvider) GetRelationships(ctx context.Context, resourceKey string) ([]resource.RelationshipDescriptor, error) {
	if m.GetRelationshipsFunc != nil {
		return m.GetRelationshipsFunc(ctx, resourceKey)
	}
	return nil, nil
}

func (m *mockProvider) ResolveRelationships(ctx context.Context, connectionID, resourceKey, id, namespace string) ([]resource.ResolvedRelationship, error) {
	if m.ResolveRelationshipsFunc != nil {
		return m.ResolveRelationshipsFunc(ctx, connectionID, resourceKey, id, namespace)
	}
	return nil, nil
}

func (m *mockProvider) GetHealth(ctx context.Context, connectionID, resourceKey string, data json.RawMessage) (*resource.ResourceHealth, error) {
	if m.GetHealthFunc != nil {
		return m.GetHealthFunc(ctx, connectionID, resourceKey, data)
	}
	return nil, nil
}

func (m *mockProvider) GetResourceEvents(ctx context.Context, connectionID, resourceKey, id, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	if m.GetResourceEventsFunc != nil {
		return m.GetResourceEventsFunc(ctx, connectionID, resourceKey, id, namespace, limit)
	}
	return nil, nil
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
	assert.Equal(t, "data-1", events[0].Data)
	assert.Equal(t, "key-2", events[1].Key)
	assert.Equal(t, "data-2", events[1].Data)
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
	assert.Equal(t, "a", adds[0].Data)
	assert.Equal(t, "c", adds[1].Data)

	p1 := e.EventsWithKey("p1")
	assert.Len(t, p1, 2)
}

func TestRecordingEmitter_WaitForEvent_Immediate(t *testing.T) {
	e := newRecordingEmitter()
	e.Emit("target/event", "payload")

	ev := e.WaitForEvent(t, "target", 100*time.Millisecond)
	assert.Equal(t, "target/event", ev.Key)
	assert.Equal(t, "payload", ev.Data)
}

func TestRecordingEmitter_WaitForEvent_Async(t *testing.T) {
	e := newRecordingEmitter()

	go func() {
		time.Sleep(20 * time.Millisecond)
		e.Emit("async/event", "arrived")
	}()

	ev := e.WaitForEvent(t, "async", 2*time.Second)
	assert.Equal(t, "async/event", ev.Key)
	assert.Equal(t, "arrived", ev.Data)
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
	ctrl := &controller{
		logger:      zap.NewNop().Sugar(),
		plugins:     make(map[string]*pluginState),
		connections: make(map[string][]types.Connection),
		subs:        newSubscriptionManager(),
		emitter:     emitter,
	}
	return ctrl, emitter
}

// registerMockPlugin registers a mockProvider under a pluginID with a default
// watch cancel context.
func registerMockPlugin(ctrl *controller, pluginID string, provider ResourceProvider) {
	_, cancel := context.WithCancel(context.Background())
	ctrl.pluginsMu.Lock()
	if existing, ok := ctrl.plugins[pluginID]; ok {
		existing.watchCancel()
	}
	ctrl.plugins[pluginID] = &pluginState{
		provider:    provider,
		version:     1,
		watchCancel: cancel,
	}
	ctrl.pluginsMu.Unlock()
	ctrl.connsMu.Lock()
	if ctrl.connections[pluginID] == nil {
		ctrl.connections[pluginID] = []types.Connection{}
	}
	ctrl.connsMu.Unlock()
}
