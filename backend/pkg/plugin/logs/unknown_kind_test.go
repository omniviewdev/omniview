package logs

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	logspb "github.com/omniviewdev/plugin-sdk/proto/v1/logs"
)

// SDK v0.22.0 decodes an event kind it does not know to StreamEventUnknown (-1); v0.21.0
// decoded it to StreamEventSourceAdded (0) and kept the event's source, so a window that adds
// a source on kind 0 listed a source that was never there. The upgrade note says a switch
// over event types must ignore -1. The host's log lane is the one place every window's
// events pass, so it is the place that ignores them: the legacy viewer keeps only the last
// hundred events and stops reading a stream of them once the window is full, the runtime's
// stream keeps a bounded backlog while its session is created, and neither has any use for a
// kind the host cannot name.

// aNewerPluginsLogStream is a logs plugin built on an SDK that is newer than this host's: its
// stream sends the event kinds it is given, among them one that this host's SDK has no name for.
type aNewerPluginsLogStream struct {
	logspb.UnimplementedLogPluginServer
	sessionID string
	events    []*logspb.LogStreamEvent
	// finished is closed when the plugin has sent everything it has, so a test never waits on a clock.
	finished chan struct{}
}

func (p *aNewerPluginsLogStream) GetSupportedResources(context.Context, *emptypb.Empty) (*logspb.GetSupportedLogResourcesResponse, error) {
	return &logspb.GetSupportedLogResourcesResponse{}, nil
}

func (p *aNewerPluginsLogStream) Stream(stream logspb.LogPlugin_StreamServer) error {
	for _, event := range p.events {
		if err := stream.Send(&logspb.LogStreamOutput{SessionId: p.sessionID, Payload: &logspb.LogStreamOutput_Event{Event: event}}); err != nil {
			return err
		}
	}
	close(p.finished)
	<-stream.Context().Done()
	return nil
}

func aKindOnTheWire(kind logspb.LogStreamEventType, source string) *logspb.LogStreamEvent {
	return &logspb.LogStreamEvent{Type: kind, SourceId: source, Message: "from a newer plugin", Timestamp: timestamppb.Now()}
}

// aLaneController is the controller of the log lane as this package's tests hold it: the interface
// NewController returns is the controller.
func aLaneController(t *testing.T, connections hostresource.ConnectionReader) *controller {
	t.Helper()
	ctrl, ok := NewController(logging.NewNop(), nil, connections).(*controller)
	require.True(t, ok, "NewController returns the controller")
	return ctrl
}

// aHostOnANewerPlugin is the lane of a host that runs a plugin built on a newer SDK: the
// controller, the recorder that is the window's event channel, and the session the window opened.
type aHostOnANewerPlugin struct {
	ctrl      *controller
	window    *eventRecorder
	sessionID string
}

// aControllerOnANewerPlugin starts the controller of a host for the plugin, over a real gRPC
// pair to the SDK's client, with a session the window has opened.
func aControllerOnANewerPlugin(t *testing.T, events ...*logspb.LogStreamEvent) aHostOnANewerPlugin {
	t.Helper()
	const pluginID = "newer-plugin"
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	t.Cleanup(cancel)
	sessionID := "7d0c4f0e-6a3f-4f5e-9f55-5b7f2c1f2a11"
	plugin := &aNewerPluginsLogStream{sessionID: sessionID, events: events, finished: make(chan struct{})}
	server := grpc.NewServer()
	logspb.RegisterLogPluginServer(server, plugin)
	listener := bufconn.Listen(1024 * 1024)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { server.Stop(); _ = listener.Close() })
	//nolint:staticcheck // Match the existing host bufconn integration convention.
	transport, err := grpc.DialContext(ctx, "passthrough:///newer-plugin",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = transport.Close() })
	client, err := (&sdklogs.Plugin{}).GRPCClient(ctx, nil, transport)
	require.NoError(t, err)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"log": client}})

	window := newEventRecorder()
	ctrl := aLaneController(t, nil)
	ctrl.ctx = ctx
	ctrl.emitter = window
	t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(pluginID, config.PluginMeta{ID: pluginID}) })
	require.NoError(t, ctrl.OnPluginStart(pluginID, config.PluginMeta{ID: pluginID}, backend))
	ctrl.mu.Lock()
	ctrl.sessionIndex[sessionID] = sessionIndex{pluginID: pluginID, connectionID: "connection"}
	ctrl.mu.Unlock()
	select {
	case <-plugin.finished:
	case <-ctx.Done():
		t.Fatal("the plugin's stream did not open: ", ctx.Err())
	}
	return aHostOnANewerPlugin{ctrl: ctrl, window: window, sessionID: sessionID}
}

// nextOutput is what the controller's reader of the plugin's stream handed to its mux.
func nextOutput(t *testing.T, ctrl *controller) sdklogs.StreamOutput {
	t.Helper()
	select {
	case output := <-ctrl.outputMux:
		return output
	case <-time.After(10 * time.Second):
		t.Fatal("the plugin's stream delivered no more output")
		return sdklogs.StreamOutput{}
	}
}

// eventsOf is the lifecycle events the window was told of one session, as it decodes them.
func eventsOf(t *testing.T, window *eventRecorder, sessionID string) []sdklogs.LogStreamEvent {
	t.Helper()
	var told []sdklogs.LogStreamEvent
	for _, event := range window.recorded() {
		if event.key != "core/logs/event/"+sessionID {
			continue
		}
		require.Len(t, event.data, 1)
		payload, ok := event.data[0].(string)
		require.True(t, ok, "the event is sent as a string")
		var decoded sdklogs.LogStreamEvent
		require.NoError(t, json.Unmarshal([]byte(payload), &decoded))
		told = append(told, decoded)
	}
	return told
}

func TestAnEventKindTheSDKDoesNotKnowIsNotHandedToTheWindow(t *testing.T) {
	const future = logspb.LogStreamEventType(99)
	host := aControllerOnANewerPlugin(t,
		aKindOnTheWire(future, "phantom"),
		aKindOnTheWire(logspb.LogStreamEventType_LOG_STREAM_EVENT_SOURCE_ADDED, "real"),
	)

	// What the SDK's client makes of the wire: the premise of the rule. A client that
	// decoded the unknown kind to 0 (v0.21.0) would hand the lane a source that does not exist.
	unknown := nextOutput(t, host.ctrl)
	require.NotNil(t, unknown.Event)
	require.Equal(t, sdklogs.StreamEventUnknown, unknown.Event.Type, "an event kind the SDK does not know decodes to StreamEventUnknown")
	require.Equal(t, "phantom", unknown.Event.SourceID)
	known := nextOutput(t, host.ctrl)
	require.NotNil(t, known.Event)
	require.Equal(t, sdklogs.StreamEventSourceAdded, known.Event.Type)

	// What the lane does with each, in the order the plugin sent them.
	host.ctrl.handleOutput(unknown)
	host.ctrl.handleOutput(known)
	told := eventsOf(t, host.window, host.sessionID)
	require.Len(t, told, 1, "the window is told of the source that was added and of nothing else")
	require.Equal(t, sdklogs.StreamEventSourceAdded, told[0].Type)
	require.Equal(t, "real", told[0].SourceID)
}

// The lane ignores only what it cannot name. The kinds of this SDK, the one this change does
// not consume (a source's replay is over: SDK v0.22.0 sends it only to a reader that asked, and
// the host does not) included, go to the window as they came.
func TestTheLaneHandsEveryKindTheSDKNamesToTheWindowAsItCame(t *testing.T) {
	kinds := []sdklogs.LogStreamEventType{
		sdklogs.StreamEventSourceAdded, sdklogs.StreamEventSourceRemoved, sdklogs.StreamEventStreamError,
		sdklogs.StreamEventReconnecting, sdklogs.StreamEventReconnected, sdklogs.StreamEventStreamEnded,
		sdklogs.StreamEventSessionReady, sdklogs.StreamEventSourceCaughtUp,
	}
	events := newEventRecorder()
	ctrl := &controller{
		logger: logging.NewNop(), clients: make(map[string]Provider), sessionIndex: make(map[string]sessionIndex),
		batches: make(map[string]*logBatch), emitter: events,
	}
	const sessionID = "session"
	ctrl.sessionIndex[sessionID] = sessionIndex{pluginID: "plugin", connectionID: "connection"}
	for _, kind := range kinds {
		ctrl.handleOutput(sdklogs.StreamOutput{SessionID: sessionID, Event: &sdklogs.LogStreamEvent{Type: kind, SourceID: "a"}})
	}
	told := eventsOf(t, events, sessionID)
	require.Len(t, told, len(kinds))
	for i, kind := range kinds {
		require.Equal(t, kind, told[i].Type)
		require.Equal(t, "a", told[i].SourceID)
	}
}

// A Logs tool's finite read of a resource's log gets what its lines say: a kind it cannot
// name neither fails it nor ends it early.
func TestAHeadlessReadIgnoresAnEventKindTheSDKDoesNotKnow(t *testing.T) {
	read := &headlessRead{done: make(chan struct{}), limit: 10}
	read.accept(sdklogs.StreamOutput{Event: &sdklogs.LogStreamEvent{Type: sdklogs.StreamEventUnknown, SourceID: "phantom"}})
	read.accept(sdklogs.StreamOutput{Line: &sdklogs.LogLine{Content: "after the unknown kind"}})
	read.accept(sdklogs.StreamOutput{Event: &sdklogs.LogStreamEvent{Type: sdklogs.StreamEventSourceCaughtUp, SourceID: "a"}})
	require.False(t, read.ended, "an event kind the read cannot name does not end it")
	require.NoError(t, read.err)
	read.accept(sdklogs.StreamOutput{Event: &sdklogs.LogStreamEvent{Type: sdklogs.StreamEventStreamEnded}})
	require.True(t, read.ended)
	require.NoError(t, read.err)
	require.Len(t, read.result.Lines, 1)
	require.Equal(t, "after the unknown kind", read.result.Lines[0].Content)
}
