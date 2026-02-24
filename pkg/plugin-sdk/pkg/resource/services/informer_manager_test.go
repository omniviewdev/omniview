package services

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// mockInformerHandle is a test double for types.InformerHandle.
type mockInformerHandle struct {
	mu                 sync.Mutex
	registered         []string
	startCalled        bool
	startResourceCalls []string
	stopCalled         bool
	stopCh             chan struct{}
}

func (m *mockInformerHandle) RegisterResource(
	_ *pkgtypes.PluginContext,
	resource types.ResourceMeta,
	_ types.InformerSyncPolicy,
	_ chan types.InformerAddPayload,
	_ chan types.InformerUpdatePayload,
	_ chan types.InformerDeletePayload,
) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.registered = append(m.registered, resource.String())
	return nil
}

func (m *mockInformerHandle) Start(
	ctx context.Context,
	stopCh chan struct{},
	stateChan chan<- types.InformerStateEvent,
) error {
	m.mu.Lock()
	m.startCalled = true
	m.stopCh = stopCh
	m.mu.Unlock()
	// Block until stopped
	select {
	case <-stopCh:
	case <-ctx.Done():
	}
	return nil
}

func (m *mockInformerHandle) StartResource(
	_ context.Context,
	resource types.ResourceMeta,
	stateChan chan<- types.InformerStateEvent,
) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.startResourceCalls = append(m.startResourceCalls, resource.String())
	// Simulate immediate sync
	stateChan <- types.InformerStateEvent{
		ResourceKey:   resource.String(),
		State:         types.InformerStateSynced,
		ResourceCount: 5,
		TotalCount:    5,
	}
	return nil
}

func (m *mockInformerHandle) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopCalled = true
	if m.stopCh != nil {
		select {
		case <-m.stopCh:
		default:
			close(m.stopCh)
		}
	}
}

// newTestManager creates an InformerManager[string] wired to a mock handle.
func newTestManager(handle *mockInformerHandle) (
	*InformerManager[string],
	chan types.InformerAddPayload,
	chan types.InformerUpdatePayload,
	chan types.InformerDeletePayload,
	chan types.InformerStateEvent,
) {
	addChan := make(chan types.InformerAddPayload)
	updateChan := make(chan types.InformerUpdatePayload)
	deleteChan := make(chan types.InformerDeletePayload)
	stateChan := make(chan types.InformerStateEvent)

	createFunc := func(_ *pkgtypes.PluginContext, _ *string) (types.InformerHandle, error) {
		return handle, nil
	}

	mgr := NewInformerManager(createFunc, nil, addChan, updateChan, deleteChan, stateChan)
	return mgr, addChan, updateChan, deleteChan, stateChan
}

func testPluginContext() *pkgtypes.PluginContext {
	return pkgtypes.NewPluginContext(context.Background(), "test", nil, nil, nil)
}

func TestCreateConnectionInformer(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"

	err := mgr.CreateConnectionInformer(testPluginContext(), conn, &client)
	require.NoError(t, err)

	assert.True(t, mgr.HasInformer(testPluginContext(), "conn-1"))
}

func TestCreateConnectionInformer_Duplicate(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"

	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	err := mgr.CreateConnectionInformer(testPluginContext(), conn, &client)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already exists")
}

func TestRegisterResource(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	resource := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
	err := mgr.RegisterResource(testPluginContext(), conn, resource, types.SyncOnConnect)
	require.NoError(t, err)

	handle.mu.Lock()
	assert.Contains(t, handle.registered, "core::v1::Pod")
	handle.mu.Unlock()

	// Verify state is Pending after registration
	summary, err := mgr.GetConnectionState("conn-1")
	require.NoError(t, err)
	assert.Equal(t, types.InformerStatePending, summary.Resources["core::v1::Pod"])
}

func TestRegisterResource_NoConnection(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "nonexistent"}
	resource := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
	err := mgr.RegisterResource(testPluginContext(), conn, resource, types.SyncOnConnect)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "informer not found")
}

func TestHasInformer(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	assert.False(t, mgr.HasInformer(testPluginContext(), "nope"))

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	assert.True(t, mgr.HasInformer(testPluginContext(), "conn-1"))
}

func TestGetConnectionState(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	// Register multiple resources
	pods := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
	svc := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Service"}
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, pods, types.SyncOnConnect))
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, svc, types.SyncOnConnect))

	summary, err := mgr.GetConnectionState("conn-1")
	require.NoError(t, err)
	assert.Equal(t, "conn-1", summary.Connection)
	assert.Equal(t, 2, summary.TotalResources)
	assert.Equal(t, 0, summary.SyncedCount)
	assert.Equal(t, 0, summary.ErrorCount)
}

func TestGetConnectionState_NotFound(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	_, err := mgr.GetConnectionState("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "informer not found")
}

func TestGetConnectionState_AggregatesSyncedAndErrors(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	pods := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
	svc := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Service"}
	ns := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Namespace"}
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, pods, types.SyncOnConnect))
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, svc, types.SyncOnConnect))
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, ns, types.SyncOnConnect))

	// Manually manipulate internal state to simulate synced/error
	mgr.mu.Lock()
	entry := mgr.informers["conn-1"]
	entry.states["core::v1::Pod"] = types.InformerStateSynced
	entry.counts["core::v1::Pod"] = 10
	entry.states["core::v1::Service"] = types.InformerStateSynced
	entry.counts["core::v1::Service"] = 3
	entry.states["core::v1::Namespace"] = types.InformerStateError
	mgr.mu.Unlock()

	summary, err := mgr.GetConnectionState("conn-1")
	require.NoError(t, err)
	assert.Equal(t, 3, summary.TotalResources)
	assert.Equal(t, 2, summary.SyncedCount)
	assert.Equal(t, 1, summary.ErrorCount)
	assert.Equal(t, 10, summary.ResourceCounts["core::v1::Pod"])
	assert.Equal(t, 3, summary.ResourceCounts["core::v1::Service"])
}

func TestEnsureResource_OnFirstQuery(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, stateChan := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	resource := types.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"}
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, resource, types.SyncOnFirstQuery))

	// Drain the state event from StartResource in a goroutine
	done := make(chan struct{})
	go func() {
		<-stateChan
		close(done)
	}()

	err := mgr.EnsureResource("conn-1", "apps::v1::Deployment")
	require.NoError(t, err)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for state event")
	}

	handle.mu.Lock()
	assert.Contains(t, handle.startResourceCalls, "apps::v1::Deployment")
	handle.mu.Unlock()
}

func TestEnsureResource_SkipsSyncOnConnect(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	resource := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, resource, types.SyncOnConnect))

	err := mgr.EnsureResource("conn-1", "core::v1::Pod")
	require.NoError(t, err)

	handle.mu.Lock()
	assert.Empty(t, handle.startResourceCalls, "should not start resource for SyncOnConnect policy")
	handle.mu.Unlock()
}

func TestEnsureResource_SkipsAlreadySynced(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	resource := types.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"}
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, resource, types.SyncOnFirstQuery))

	// Simulate already-synced state
	mgr.mu.Lock()
	mgr.informers["conn-1"].states["apps::v1::Deployment"] = types.InformerStateSynced
	mgr.mu.Unlock()

	err := mgr.EnsureResource("conn-1", "apps::v1::Deployment")
	require.NoError(t, err)

	handle.mu.Lock()
	assert.Empty(t, handle.startResourceCalls, "should not start resource that's already synced")
	handle.mu.Unlock()
}

func TestEnsureResource_NoConnection(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	err := mgr.EnsureResource("nonexistent", "core::v1::Pod")
	assert.NoError(t, err, "should return nil for missing connection")
}

func TestStartConnection(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	// Must have Run() active to receive the start signal
	stopCh := make(chan struct{})
	controllerAdd := make(chan types.InformerAddPayload)
	controllerUpdate := make(chan types.InformerUpdatePayload)
	controllerDelete := make(chan types.InformerDeletePayload)
	controllerState := make(chan types.InformerStateEvent, 10)

	go mgr.Run(stopCh, controllerAdd, controllerUpdate, controllerDelete, controllerState)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	err := mgr.StartConnection(testPluginContext(), "conn-1")
	require.NoError(t, err)

	// Wait for Start to be called on the handle
	assert.Eventually(t, func() bool {
		handle.mu.Lock()
		defer handle.mu.Unlock()
		return handle.startCalled
	}, time.Second, 10*time.Millisecond)

	close(stopCh)
}

func TestStartConnection_NotFound(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	err := mgr.StartConnection(testPluginContext(), "nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
}

func TestStopConnection(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	stopCh := make(chan struct{})
	controllerAdd := make(chan types.InformerAddPayload)
	controllerUpdate := make(chan types.InformerUpdatePayload)
	controllerDelete := make(chan types.InformerDeletePayload)
	controllerState := make(chan types.InformerStateEvent, 10)

	go mgr.Run(stopCh, controllerAdd, controllerUpdate, controllerDelete, controllerState)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	// Register a resource so we get a cancelled event
	resource := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, resource, types.SyncOnConnect))

	// Start the connection first
	require.NoError(t, mgr.StartConnection(testPluginContext(), "conn-1"))

	// Wait for start to be received
	assert.Eventually(t, func() bool {
		handle.mu.Lock()
		defer handle.mu.Unlock()
		return handle.startCalled
	}, time.Second, 10*time.Millisecond)

	// Now stop it
	err := mgr.StopConnection(testPluginContext(), "conn-1")
	require.NoError(t, err)

	// Should receive a cancelled state event
	select {
	case event := <-controllerState:
		assert.Equal(t, "core::v1::Pod", event.ResourceKey)
		assert.Equal(t, types.InformerStateCancelled, event.State)
		assert.Equal(t, "conn-1", event.Connection)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for cancelled state event")
	}

	// Entry should be removed
	assert.Eventually(t, func() bool {
		return !mgr.HasInformer(testPluginContext(), "conn-1")
	}, time.Second, 10*time.Millisecond)

	// Handle.Stop should have been called
	handle.mu.Lock()
	assert.True(t, handle.stopCalled)
	handle.mu.Unlock()

	close(stopCh)
}

func TestStopConnection_NotFound(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	err := mgr.StopConnection(testPluginContext(), "nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "informer not found")
}

func TestRun_FansInAddEvents(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, addChan, _, _, _ := newTestManager(handle)

	stopCh := make(chan struct{})
	controllerAdd := make(chan types.InformerAddPayload, 1)
	controllerUpdate := make(chan types.InformerUpdatePayload)
	controllerDelete := make(chan types.InformerDeletePayload)
	controllerState := make(chan types.InformerStateEvent)

	go mgr.Run(stopCh, controllerAdd, controllerUpdate, controllerDelete, controllerState)

	event := types.InformerAddPayload{Key: "core::v1::Pod", Connection: "conn-1", ID: "my-pod"}
	addChan <- event

	select {
	case received := <-controllerAdd:
		assert.Equal(t, "core::v1::Pod", received.Key)
		assert.Equal(t, "my-pod", received.ID)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for add event")
	}

	close(stopCh)
}

func TestRun_FansInUpdateEvents(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, updateChan, _, _ := newTestManager(handle)

	stopCh := make(chan struct{})
	controllerAdd := make(chan types.InformerAddPayload)
	controllerUpdate := make(chan types.InformerUpdatePayload, 1)
	controllerDelete := make(chan types.InformerDeletePayload)
	controllerState := make(chan types.InformerStateEvent)

	go mgr.Run(stopCh, controllerAdd, controllerUpdate, controllerDelete, controllerState)

	event := types.InformerUpdatePayload{Key: "core::v1::Pod", Connection: "conn-1", ID: "my-pod"}
	updateChan <- event

	select {
	case received := <-controllerUpdate:
		assert.Equal(t, "core::v1::Pod", received.Key)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for update event")
	}

	close(stopCh)
}

func TestRun_FansInDeleteEvents(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, deleteChan, _ := newTestManager(handle)

	stopCh := make(chan struct{})
	controllerAdd := make(chan types.InformerAddPayload)
	controllerUpdate := make(chan types.InformerUpdatePayload)
	controllerDelete := make(chan types.InformerDeletePayload, 1)
	controllerState := make(chan types.InformerStateEvent)

	go mgr.Run(stopCh, controllerAdd, controllerUpdate, controllerDelete, controllerState)

	event := types.InformerDeletePayload{Key: "core::v1::Pod", Connection: "conn-1", ID: "my-pod"}
	deleteChan <- event

	select {
	case received := <-controllerDelete:
		assert.Equal(t, "core::v1::Pod", received.Key)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for delete event")
	}

	close(stopCh)
}

func TestRun_StateEventsUpdateLocalTracking(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, stateChan := newTestManager(handle)

	stopCh := make(chan struct{})
	controllerAdd := make(chan types.InformerAddPayload)
	controllerUpdate := make(chan types.InformerUpdatePayload)
	controllerDelete := make(chan types.InformerDeletePayload)
	controllerState := make(chan types.InformerStateEvent, 1)

	// Create a connection so there's an entry to update
	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))

	resource := types.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
	require.NoError(t, mgr.RegisterResource(testPluginContext(), conn, resource, types.SyncOnConnect))

	go mgr.Run(stopCh, controllerAdd, controllerUpdate, controllerDelete, controllerState)

	// Send a state event through the internal channel
	stateChan <- types.InformerStateEvent{
		Connection:    "conn-1",
		ResourceKey:   "core::v1::Pod",
		State:         types.InformerStateSynced,
		ResourceCount: 42,
	}

	// Should be forwarded to controller
	select {
	case event := <-controllerState:
		assert.Equal(t, types.InformerStateSynced, event.State)
		assert.Equal(t, 42, event.ResourceCount)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for state event")
	}

	// Internal tracking should be updated
	summary, err := mgr.GetConnectionState("conn-1")
	require.NoError(t, err)
	assert.Equal(t, types.InformerStateSynced, summary.Resources["core::v1::Pod"])
	assert.Equal(t, 42, summary.ResourceCounts["core::v1::Pod"])
	assert.Equal(t, 1, summary.SyncedCount)

	close(stopCh)
}

func TestRun_StopChTerminates(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	stopCh := make(chan struct{})
	controllerAdd := make(chan types.InformerAddPayload)
	controllerUpdate := make(chan types.InformerUpdatePayload)
	controllerDelete := make(chan types.InformerDeletePayload)
	controllerState := make(chan types.InformerStateEvent)

	done := make(chan error)
	go func() {
		done <- mgr.Run(stopCh, controllerAdd, controllerUpdate, controllerDelete, controllerState)
	}()

	close(stopCh)

	select {
	case err := <-done:
		assert.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("Run did not terminate after stopCh closed")
	}
}

func TestStartConnectionInformer_IdempotentViaHasInformer(t *testing.T) {
	// Verifies that calling CreateConnectionInformer twice errors (strict),
	// but the higher-level HasInformer guard makes the flow safe.
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"

	// First create succeeds
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))
	assert.True(t, mgr.HasInformer(testPluginContext(), "conn-1"))

	// HasInformer returns true, so the controller would short-circuit
	assert.True(t, mgr.HasInformer(testPluginContext(), "conn-1"))

	// Direct duplicate create still errors (strict low-level behavior preserved)
	err := mgr.CreateConnectionInformer(testPluginContext(), conn, &client)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already exists")
}

func TestStopConnection_IdempotentViaHasInformer(t *testing.T) {
	// HasInformer returns false for a non-existent connection, so the
	// controller-level guard would short-circuit before calling StopConnection.
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	// No informer created — HasInformer should return false
	assert.False(t, mgr.HasInformer(testPluginContext(), "conn-1"))

	// Low-level StopConnection still errors (strict behavior preserved)
	err := mgr.StopConnection(testPluginContext(), "conn-1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "informer not found")
}

func TestStopAndRestartConnection(t *testing.T) {
	handle := &mockInformerHandle{}
	mgr, _, _, _, _ := newTestManager(handle)

	stopCh := make(chan struct{})
	controllerAdd := make(chan types.InformerAddPayload)
	controllerUpdate := make(chan types.InformerUpdatePayload)
	controllerDelete := make(chan types.InformerDeletePayload)
	controllerState := make(chan types.InformerStateEvent, 10)

	go mgr.Run(stopCh, controllerAdd, controllerUpdate, controllerDelete, controllerState)

	conn := &pkgtypes.Connection{ID: "conn-1"}
	client := "dummy"

	// Create and start
	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))
	require.NoError(t, mgr.StartConnection(testPluginContext(), "conn-1"))

	assert.Eventually(t, func() bool {
		handle.mu.Lock()
		defer handle.mu.Unlock()
		return handle.startCalled
	}, time.Second, 10*time.Millisecond)

	// Stop — removes the informer entry
	require.NoError(t, mgr.StopConnection(testPluginContext(), "conn-1"))
	assert.Eventually(t, func() bool {
		return !mgr.HasInformer(testPluginContext(), "conn-1")
	}, time.Second, 10*time.Millisecond)

	// Re-create with a fresh handle (simulates what the controller does)
	handle2 := &mockInformerHandle{}
	mgr.createHandler = func(_ *pkgtypes.PluginContext, _ *string) (types.InformerHandle, error) {
		return handle2, nil
	}

	require.NoError(t, mgr.CreateConnectionInformer(testPluginContext(), conn, &client))
	require.NoError(t, mgr.StartConnection(testPluginContext(), "conn-1"))

	assert.Eventually(t, func() bool {
		handle2.mu.Lock()
		defer handle2.mu.Unlock()
		return handle2.startCalled
	}, time.Second, 10*time.Millisecond)

	close(stopCh)
}

func TestNewInformerManager_NilSyncPolicies(t *testing.T) {
	createFunc := func(_ *pkgtypes.PluginContext, _ *string) (types.InformerHandle, error) {
		return &mockInformerHandle{}, nil
	}

	mgr := NewInformerManager(createFunc, nil,
		make(chan types.InformerAddPayload),
		make(chan types.InformerUpdatePayload),
		make(chan types.InformerDeletePayload),
		make(chan types.InformerStateEvent),
	)

	assert.NotNil(t, mgr.syncPolicies, "nil syncPolicies should be initialized to empty map")
}
