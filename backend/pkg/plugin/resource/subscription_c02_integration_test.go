package resource

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const subscriptionFileID = "watched/opaque:%2F"
const subscriptionFileType = "proof::v1::File"

type subscriptionFileClient struct{ path string }

type subscriptionRegistrationGate struct {
	*sdkresource.Controller[subscriptionFileClient]
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
	return p.Controller.ListenForEvents(ctx, sink, onReady)
}

func subscriptionFileRecord(client *subscriptionFileClient, target sdkresource.ReadTarget) (sdkresource.Record, string, error) {
	content, err := os.ReadFile(client.path)
	if err != nil {
		return sdkresource.Record{}, "", err
	}
	value := string(content)
	record := canonicalTestRecord(target.Provider, target.Authority, target.Type, subscriptionFileID)
	record.Body = sdkresource.Value{Kind: "map", Map: map[string]sdkresource.Value{
		"id":    {Kind: "string", String: subscriptionFileID},
		"value": {Kind: "string", String: value},
	}}
	return record, value, nil
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
	stopped := make(chan struct{})
	registered, buildErr := sdkresource.NewController(sdkresource.Config[subscriptionFileClient]{
		Catalog: func(context.Context, sdkresource.CatalogRequest) (sdkresource.Catalog, error) {
			catalog := canonicalTestCatalog("proof", subscriptionFileType)
			descriptor := &catalog.Types[0]
			// Require explicit representation selection so connection startup
			// cannot emit the initial add before frontend subscription admission.
			descriptor.Capabilities = []sdkresource.Capability{
				{Operation: sdkresource.OperationGet, Scope: sdkresource.QueryScope{}},
				{Operation: sdkresource.OperationEnumerate, Scope: sdkresource.QueryScope{}},
				{Operation: sdkresource.OperationUpdate, Scope: sdkresource.QueryScope{}, Guarantee: sdkresource.BestEffortGuarantee},
			}
			return catalog, nil
		},
		Lifecycle: &sdkresource.Lifecycle[subscriptionFileClient]{
			LoadConnections: func(context.Context) ([]types.Connection, error) {
				return []types.Connection{{ID: "local", Name: "Private watched file", Data: map[string]interface{}{"path": path}}}, nil
			},
			CreateClient: func(_ context.Context, connection types.Connection) (*subscriptionFileClient, error) {
				client := &subscriptionFileClient{path: connection.Data["path"].(string)}
				if _, err := os.Stat(client.path); err != nil {
					return nil, err
				}
				return client, nil
			},
			DestroyClient: func(context.Context, *subscriptionFileClient) error { return nil },
			CheckConnection: func(_ context.Context, connection types.Connection, client *subscriptionFileClient) (types.ConnectionStatus, error) {
				if _, err := os.Stat(client.path); err != nil {
					return types.ConnectionStatus{}, err
				}
				return types.ConnectionStatus{Connection: &connection, Status: types.ConnectionStatusConnected}, nil
			},
		},
		Registrations: []sdkresource.Registration[subscriptionFileClient]{{
			Type:  subscriptionFileType,
			Scope: sdkresource.QueryScope{},
			Get: func(_ context.Context, client *subscriptionFileClient, request sdkresource.GetRequest) (sdkresource.Record, error) {
				if request.Reference.Address.ID != subscriptionFileID {
					return sdkresource.Record{}, sdkresource.NewError("NOT_FOUND", "File does not exist.")
				}
				record, _, err := subscriptionFileRecord(client, sdkresource.ReadTarget{Provider: request.Reference.Address.Provider, Authority: request.Reference.Address.Authority, Type: request.Reference.Address.Type})
				return record, err
			},
			Enumerate: func(_ context.Context, client *subscriptionFileClient, request sdkresource.EnumerateRequest) (sdkresource.SourcePage, error) {
				record, _, err := subscriptionFileRecord(client, request.Target)
				if err != nil {
					return sdkresource.SourcePage{}, err
				}
				one := "1"
				return sdkresource.SourcePage{Records: []sdkresource.Record{record}, Count: sdkresource.Count{Kind: "exact", Value: &one}, Coverage: sdkresource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
			},
			Watch: func(ctx context.Context, client *subscriptionFileClient, target sdkresource.ReadTarget, _ sdkresource.Representation, sink sdkresource.WatchEventSink) error {
				defer close(stopped)
				ticker := time.NewTicker(10 * time.Millisecond)
				defer ticker.Stop()
				previous, initialized := "", false
				for {
					record, value, err := subscriptionFileRecord(client, target)
					if err != nil {
						return err
					}
					metadata := sdkresource.ResourceMetadata{Labels: map[string]string{"value": value}}
					if !initialized {
						sink.OnAdd(sdkresource.WatchAddPayload{Route: target.Route, Record: record, Metadata: metadata, Guarantee: sdkresource.BestEffortGuarantee})
					} else if value != previous {
						sink.OnUpdate(sdkresource.WatchUpdatePayload{Route: target.Route, Record: record, Metadata: metadata, Guarantee: sdkresource.BestEffortGuarantee})
					}
					previous, initialized = value, true
					one := "1"
					sink.OnStateChange(sdkresource.WatchStateEvent{Route: target.Route, Type: target.Type, State: sdkresource.WatchStateSynced, Message: value, Count: sdkresource.Count{Kind: "exact", Value: &one}, Guarantee: sdkresource.BestEffortGuarantee})
					select {
					case <-ctx.Done():
						return nil
					case <-ticker.C:
					}
				}
			},
		}},
	})
	require.NoError(t, buildErr)
	t.Cleanup(func() { require.NoError(t, registered.Close()) })
	gated := &subscriptionRegistrationGate{Controller: registered, entered: make(chan struct{}), release: make(chan struct{})}
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
	_, pendingErr := ctrl.StartConnection(ctx, "proof", "local")
	require.Error(t, pendingErr)
	close(gated.release)
	select {
	case startErr := <-started:
		require.NoError(t, startErr)
	case <-time.After(time.Second):
		t.Fatal("registered event RPC did not complete plugin startup")
	}
	connections, loadErr := ctrl.LoadConnections(ctx, "proof")
	require.NoError(t, loadErr)
	require.Len(t, connections, 1)
	require.Equal(t, "local", connections[0].ID)
	connection, connectionErr := ctrl.GetConnection(ctx, "proof", "local")
	require.NoError(t, connectionErr)
	require.Equal(t, path, connection.Data["path"])
	// The SDK catalog leases a real native client; acquisition requires startup.
	_, startErr := ctrl.StartConnection(ctx, "proof", "local")
	require.NoError(t, startErr)
	target := admittedReadTarget(t, ctrl, "proof", "local", subscriptionFileType).Target
	subscription := HostSubscription{TargetID: "native-file-subscription", Target: target}
	require.NoError(t, ctrl.SubscribeResource(ctx, "proof", subscription))
	require.NoError(t, ctrl.SubscribeResource(ctx, "proof", subscription))
	require.NoError(t, ctrl.StartConnectionWatch(ctx, "proof", []sdkresource.ReadTarget{target}))
	initial := emitter.WaitForEvent(t, "/ADD", 2*time.Second)
	payload, ok := initial.Data[0].(HostWatchRecordEvent)
	require.True(t, ok)
	require.Equal(t, "proof/local/"+subscriptionFileType+"/ADD", initial.Key)
	require.Equal(t, subscription.TargetID, payload.Record.TargetID)
	require.Equal(t, subscriptionFileID, payload.Record.Record.Reference.Address.ID)
	require.Equal(t, "first", payload.Record.Record.Body.Map["value"].String)
	require.Equal(t, sdkresource.BestEffortGuarantee, payload.Guarantee)

	waitForValue := func(value string) {
		t.Helper()
		require.Eventually(t, func() bool {
			entry, exists := ctrl.registryStore.Get("proof", payload.Record.Record.Reference, target.Route)
			return exists && entry.Labels["value"] == value
		}, 2*time.Second, time.Millisecond)
	}
	require.NoError(t, ctrl.UnsubscribeResource(ctx, "proof", subscription))
	require.True(t, ctrl.isSubscribed("proof", "local", subscriptionFileType))
	writeNative("second")
	waitForValue("second")
	require.Eventually(t, func() bool { return len(emitter.EventsWithKey("/UPDATE")) > 0 }, time.Second, time.Millisecond)
	updates := len(emitter.EventsWithKey("/UPDATE"))
	require.NoError(t, ctrl.UnsubscribeResource(ctx, "proof", subscription))
	require.False(t, ctrl.isSubscribed("proof", "local", subscriptionFileType))
	writeNative("third")
	waitForValue("third")
	// Registry updates remain live after frontend reference counts reach zero.
	require.Len(t, emitter.EventsWithKey("/UPDATE"), updates)
	require.NoError(t, ctrl.SubscribeResource(ctx, "proof", subscription))
	writeNative("fourth")
	waitForValue("fourth")
	require.Eventually(t, func() bool {
		for _, event := range emitter.EventsWithKey("/UPDATE") {
			update, typed := event.Data[0].(HostWatchRecordEvent)
			if typed && update.Record.TargetID == subscription.TargetID && update.Record.Record.Body.Map["value"].String == "fourth" {
				return true
			}
		}
		return false
	}, time.Second, time.Millisecond)
	_, stopErr := ctrl.StopConnection(ctx, "proof", "local")
	require.NoError(t, stopErr)
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("registered native file watcher did not stop")
	}
}
