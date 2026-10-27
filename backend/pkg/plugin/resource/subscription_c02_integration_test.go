package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

const subscriptionFileID = "watched/opaque:%2F"

type subscriptionFileClient struct{ path string }
type subscriptionFileConnections struct{ path string }

func (p subscriptionFileConnections) LoadConnections(context.Context) ([]types.Connection, error) {
	return []types.Connection{{ID: "local", Name: "Private watched file", Data: map[string]interface{}{"path": p.path}}}, nil
}
func (subscriptionFileConnections) CreateClient(ctx context.Context) (*subscriptionFileClient, error) {
	session := sdkresource.SessionFromContext(ctx)
	if session == nil || session.Connection == nil {
		return nil, fmt.Errorf("native file connection is absent")
	}
	path, ok := session.Connection.Data["path"].(string)
	if !ok {
		return nil, fmt.Errorf("native file path is absent")
	}
	if _, statErr := os.Stat(path); statErr != nil {
		return nil, statErr
	}
	return &subscriptionFileClient{path: path}, nil
}
func (subscriptionFileConnections) DestroyClient(context.Context, *subscriptionFileClient) error {
	return nil
}
func (subscriptionFileConnections) CheckConnection(_ context.Context, connection *types.Connection, client *subscriptionFileClient) (types.ConnectionStatus, error) {
	if _, statErr := os.Stat(client.path); statErr != nil {
		return types.ConnectionStatus{}, statErr
	}
	return types.ConnectionStatus{Connection: connection, Status: types.ConnectionStatusConnected}, nil
}
func (subscriptionFileConnections) GetNamespaces(context.Context, *subscriptionFileClient) ([]string, error) {
	return nil, nil
}

type subscriptionFileSource struct{ stopped chan struct{} }

func (subscriptionFileSource) Definition() sdkresource.ResourceDefinition {
	return sdkresource.ResourceDefinition{IDAccessor: "id"}
}
func subscriptionFileData(client *subscriptionFileClient) (json.RawMessage, string, error) {
	content, readErr := os.ReadFile(client.path)
	if readErr != nil {
		return nil, "", readErr
	}
	value := string(content)
	data, marshalErr := json.Marshal(map[string]interface{}{"id": subscriptionFileID, "value": value, "metadata": map[string]interface{}{"labels": map[string]string{"value": value}}})
	return data, value, marshalErr
}
func (subscriptionFileSource) Get(_ context.Context, client *subscriptionFileClient, _ sdkresource.ResourceMeta, input sdkresource.GetInput) (*sdkresource.GetResult, error) {
	if input.ID != subscriptionFileID {
		return nil, &sdkresource.ResourceOperationError{Code: "NOT_FOUND"}
	}
	data, _, readErr := subscriptionFileData(client)
	return &sdkresource.GetResult{Result: data, Success: readErr == nil}, readErr
}
func (subscriptionFileSource) List(_ context.Context, client *subscriptionFileClient, _ sdkresource.ResourceMeta, _ sdkresource.ListInput) (*sdkresource.ListResult, error) {
	data, _, readErr := subscriptionFileData(client)
	return &sdkresource.ListResult{Result: []json.RawMessage{data}, Success: readErr == nil, TotalCount: 1}, readErr
}
func (subscriptionFileSource) Find(context.Context, *subscriptionFileClient, sdkresource.ResourceMeta, sdkresource.FindInput) (*sdkresource.FindResult, error) {
	return nil, &sdkresource.ResourceOperationError{Code: "UNSUPPORTED"}
}
func (subscriptionFileSource) Create(context.Context, *subscriptionFileClient, sdkresource.ResourceMeta, sdkresource.CreateInput) (*sdkresource.CreateResult, error) {
	return nil, &sdkresource.ResourceOperationError{Code: "UNSUPPORTED"}
}
func (subscriptionFileSource) Update(context.Context, *subscriptionFileClient, sdkresource.ResourceMeta, sdkresource.UpdateInput) (*sdkresource.UpdateResult, error) {
	return nil, &sdkresource.ResourceOperationError{Code: "UNSUPPORTED"}
}
func (subscriptionFileSource) Delete(context.Context, *subscriptionFileClient, sdkresource.ResourceMeta, sdkresource.DeleteInput) (*sdkresource.DeleteResult, error) {
	return nil, &sdkresource.ResourceOperationError{Code: "UNSUPPORTED"}
}
func (source subscriptionFileSource) Watch(ctx context.Context, client *subscriptionFileClient, meta sdkresource.ResourceMeta, sink sdkresource.WatchEventSink) error {
	defer close(source.stopped)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	previous, initialized := "", false
	for {
		data, value, readErr := subscriptionFileData(client)
		if readErr != nil {
			return readErr
		}
		if !initialized {
			sink.OnAdd(sdkresource.WatchAddPayload{Key: meta.Key(), ID: subscriptionFileID, Data: data, Metadata: sdkresource.ResourceMetadata{Labels: map[string]string{"value": value}}})
		} else if value != previous {
			sink.OnUpdate(sdkresource.WatchUpdatePayload{Key: meta.Key(), ID: subscriptionFileID, Data: data, Metadata: sdkresource.ResourceMetadata{Labels: map[string]string{"value": value}}})
		}
		previous, initialized = value, true
		sink.OnStateChange(sdkresource.WatchStateEvent{ResourceKey: meta.Key(), State: sdkresource.WatchStateSynced, Message: value, ResourceCount: 1})
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

type subscriptionRegistrationGate struct {
	sdkresource.Provider
	entered chan struct{}
	release chan struct{}
}

func (p *subscriptionRegistrationGate) ListenForEvents(ctx context.Context, sink sdkresource.WatchEventSink, onReady func() error) error {
	close(p.entered)
	select {
	case <-p.release:
	case <-ctx.Done():
		return ctx.Err()
	}
	return p.Provider.ListenForEvents(ctx, sink, onReady)
}

func TestC02RegisteredFileWatchSubscriptionLifecycle(t *testing.T) {
	ctx := testInvocationContext()
	path := filepath.Join(t.TempDir(), "native.txt")
	writeNative := func(value string) {
		t.Helper()
		stage := path + ".next"
		require.NoError(t, os.WriteFile(stage, []byte(value), 0600))
		require.NoError(t, os.Rename(stage, path))
	}
	writeNative("first")
	meta := sdkresource.ResourceMeta{Group: "proof", Version: "v1", Kind: "File"}
	source := subscriptionFileSource{stopped: make(chan struct{})}
	registered, buildErr := sdkresource.BuildResourceController(context.Background(), sdkresource.ResourcePluginConfig[subscriptionFileClient]{
		Connections: subscriptionFileConnections{path: path},
		Resources:   []sdkresource.ResourceRegistration[subscriptionFileClient]{{Meta: meta, Resourcer: source}},
	})
	require.NoError(t, buildErr)
	t.Cleanup(registered.Close)
	gated := &subscriptionRegistrationGate{Provider: registered, entered: make(chan struct{}), release: make(chan struct{})}
	transport := setupGRPCProvider(t, gated)
	ctrl, emitter := newTestControllerWithEmitter(t)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": transport})
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginShutdown("proof", defaultMeta())) })
	started := make(chan error, 1)
	go func() { started <- ctrl.OnPluginStart("proof", defaultMeta(), backend) }()
	select {
	case <-gated.entered:
	case <-time.After(time.Second):
		t.Fatal("actual event RPC did not reach delayed native registration")
	}
	// A concurrent request must not start the one-shot source while the real
	// SDK listener is still absent. This is an admission outcome, not a sleep.
	_, pendingErr := ctrl.StartConnection(ctx, "proof", "local")
	require.Error(t, pendingErr)
	close(gated.release)
	select {
	case startErr := <-started:
		require.NoError(t, startErr)
	case <-time.After(time.Second):
		t.Fatal("registered event RPC did not complete plugin startup")
	}
	connection, connectionErr := ctrl.GetConnection(ctx, "proof", "local")
	require.NoError(t, connectionErr)
	require.Equal(t, path, connection.Data["path"])
	require.NoError(t, ctrl.SubscribeResource(ctx, "proof", "local", meta.Key()))
	require.NoError(t, ctrl.SubscribeResource(ctx, "proof", "local", meta.Key()))
	_, startErr := ctrl.StartConnection(ctx, "proof", "local")
	require.NoError(t, startErr)
	initial := emitter.WaitForEvent(t, "/ADD", 2*time.Second)
	payload, ok := initial.Data[0].(sdkresource.WatchAddPayload)
	require.True(t, ok)
	require.Equal(t, "proof/local/"+meta.Key()+"/ADD", initial.Key)
	require.Equal(t, subscriptionFileID, payload.ID)
	var native struct {
		Value string `json:"value"`
	}
	require.NoError(t, json.Unmarshal(payload.Data, &native))
	require.Equal(t, "first", native.Value)

	waitForValue := func(value string) {
		t.Helper()
		require.Eventually(t, func() bool {
			entry, exists := ctrl.registryStore.Get("proof", "local", meta.Key(), "", subscriptionFileID)
			return exists && entry.Labels["value"] == value
		}, 2*time.Second, time.Millisecond)
	}
	require.NoError(t, ctrl.UnsubscribeResource(ctx, "proof", "local", meta.Key()))
	require.True(t, ctrl.isSubscribed("proof", "local", meta.Key()))
	writeNative("second")
	waitForValue("second")
	require.Eventually(t, func() bool { return len(emitter.EventsWithKey("/UPDATE")) > 0 }, time.Second, time.Millisecond)
	updates := len(emitter.EventsWithKey("/UPDATE"))
	require.NoError(t, ctrl.UnsubscribeResource(ctx, "proof", "local", meta.Key()))
	require.False(t, ctrl.isSubscribed("proof", "local", meta.Key()))
	writeNative("third")
	waitForValue("third")
	// The actual native update reached the host registry, but the released
	// frontend subscription must not forward it onto the Wails event bridge.
	require.Len(t, emitter.EventsWithKey("/UPDATE"), updates)
	require.NoError(t, ctrl.SubscribeResource(ctx, "proof", "local", meta.Key()))
	writeNative("fourth")
	waitForValue("fourth")
	require.Eventually(t, func() bool {
		for _, event := range emitter.EventsWithKey("/UPDATE") {
			update, typed := event.Data[0].(sdkresource.WatchUpdatePayload)
			if !typed {
				continue
			}
			var value struct {
				Value string `json:"value"`
			}
			if decodeErr := json.Unmarshal(update.Data, &value); decodeErr == nil && value.Value == "fourth" {
				return true
			}
		}
		return false
	}, time.Second, time.Millisecond)
	_, stopErr := ctrl.StopConnection(ctx, "proof", "local")
	require.NoError(t, stopErr)
	select {
	case <-source.stopped:
	case <-time.After(time.Second):
		t.Fatal("registered native file watcher did not stop")
	}
}
