package logs

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkutils "github.com/omniviewdev/plugin-sdk/pkg/utils"
	"github.com/omniviewdev/plugin-sdk/pkg/utils/timeutil"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs/logtest"
	logspb "github.com/omniviewdev/plugin-sdk/proto/v1/logs"
)

// SDK v0.22.0 adds opt-in replay markers to the log lane: a reader that asks (the session
// parameter omniview.log.replay-markers = 1) is told where each source's replay ends, by a
// flag on each replay line and a SOURCE_CAUGHT_UP event. This host does not ask yet, and
// this change does not consume the markers: the step that does deletes the timestamp
// inference the Logs strip makes today. What this host owes in the meantime is that a plugin
// that already declares Handler.ReplayCount changes nothing for it: the SDK promises that a
// session that does not ask gets the stream it always got, byte for byte. The test holds the
// promise where the host meets it: the frames on the wire, and the events the window is told
// of, for the same source streamed by a handler that declares ReplayCount and by one that
// does not.

// replayFixtureLines are what the fixture source holds. Each carries its own time, so what
// the SDK decodes of it does not depend on a clock.
func replayFixtureLines() []string {
	return []string{
		"2026-11-22T10:00:00Z first line",
		"2026-11-22T10:00:01Z second line",
		"2026-11-22T10:00:02Z third line",
	}
}

// framesOnTheWire records what the plugin's server sent on its log stream, and the options of
// every session the host asked it to create.
type framesOnTheWire struct {
	mu       sync.Mutex
	frames   []*logspb.LogStreamOutput
	requests []*logspb.CreateLogSessionRequest
}

func (f *framesOnTheWire) unary(ctx context.Context, request any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	if create, ok := request.(*logspb.CreateLogSessionRequest); ok {
		f.mu.Lock()
		f.requests = append(f.requests, proto.CloneOf(create))
		f.mu.Unlock()
	}
	return handler(ctx, request)
}

func (f *framesOnTheWire) stream(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
	if strings.HasSuffix(info.FullMethod, "/Stream") {
		ss = &recordingStream{ServerStream: ss, record: f}
	}
	return handler(srv, ss)
}

type recordingStream struct {
	grpc.ServerStream
	record *framesOnTheWire
}

func (s *recordingStream) SendMsg(message any) error {
	if frame, ok := message.(*logspb.LogStreamOutput); ok {
		s.record.mu.Lock()
		s.record.frames = append(s.record.frames, proto.CloneOf(frame))
		s.record.mu.Unlock()
	}
	return s.ServerStream.SendMsg(message)
}

// sessionFrames is what the plugin sent on the wire for one session: its lines and events as
// bytes the session's own ID and the time of its events do not show in, and the frames as sent.
type sessionFrames struct {
	lines  [][]byte
	events [][]byte
	raw    []*logspb.LogStreamOutput
}

// forSession returns the frames of one session: the lines in the order they were sent, and the
// events in a fixed order (the plugin sends them from more than one goroutine).
func (f *framesOnTheWire) forSession(t *testing.T, sessionID string) sessionFrames {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	var frames sessionFrames
	marshal := proto.MarshalOptions{Deterministic: true}
	for _, frame := range f.frames {
		if frame.GetSessionId() != sessionID {
			continue
		}
		frames.raw = append(frames.raw, frame)
		normal := proto.CloneOf(frame)
		normal.SessionId = ""
		if line := normal.GetLine(); line != nil {
			line.SessionId = ""
			encoded, err := marshal.Marshal(normal)
			require.NoError(t, err)
			frames.lines = append(frames.lines, encoded)
			continue
		}
		if event := normal.GetEvent(); event != nil {
			event.Timestamp = timestamppb.New(time.Time{})
			encoded, err := marshal.Marshal(normal)
			require.NoError(t, err)
			frames.events = append(frames.events, encoded)
		}
	}
	slices.SortFunc(frames.events, bytes.Compare)
	return frames
}

// theWindowWasTold is what the window received of one session, as the lane sent it.
type theWindowWasTold struct {
	lines  [][]byte // each line as the window decodes it, session ID and all, as JSON
	events [][]byte
	raw    []string // every payload as it was emitted
}

func windowTold(t *testing.T, window *eventRecorder, sessionID string) theWindowWasTold {
	t.Helper()
	var told theWindowWasTold
	for _, emitted := range window.recorded() {
		payload, ok := emitted.data[0].(string)
		require.True(t, ok)
		switch emitted.key {
		case "core/logs/lines/" + sessionID:
			told.raw = append(told.raw, payload)
			var batch []sdklogs.LogLine
			require.NoError(t, json.Unmarshal([]byte(payload), &batch))
			for _, line := range batch {
				line.SessionID = ""
				encoded, err := json.Marshal(line)
				require.NoError(t, err)
				told.lines = append(told.lines, encoded)
			}
		case "core/logs/event/" + sessionID:
			told.raw = append(told.raw, payload)
			var event sdklogs.LogStreamEvent
			require.NoError(t, json.Unmarshal([]byte(payload), &event))
			event.Timestamp = time.Time{}
			encoded, err := json.Marshal(event)
			require.NoError(t, err)
			told.events = append(told.events, encoded)
		}
	}
	slices.SortFunc(told.events, bytes.Compare)
	return told
}

func TestAPluginThatDeclaresReplayCountSendsAHostThatDoesNotAskTheStreamItAlwaysSent(t *testing.T) {
	const pluginID = "replay-aware"
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)

	var counted atomic.Int32
	open := func(*sdktypes.PluginContext, sdklogs.LogStreamRequest) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(strings.Join(replayFixtureLines(), "\n") + "\n")), nil
	}
	handler := func(resource string, replayCount sdklogs.ReplayCountFunc) sdklogs.Handler {
		return sdklogs.Handler{
			Plugin: "test", Resource: resource, Handler: open, ReplayCount: replayCount,
			SourceBuilder: logtest.SingleSourceBuilder("pod", map[string]string{"source": "pod"}),
		}
	}
	manager := sdklogs.NewManager(sdklogs.ManagerConfig{
		Logger: logging.NewNop(),
		Clock:  timeutil.NewInstantFakeClock(),
		Handlers: map[string]sdklogs.Handler{
			"test/plain": handler("plain", nil),
			// What the SDK promises a plugin that takes part: two of the three lines are replay, and
			// only a reader that asks is told so.
			"test/replay": handler("replay", func(*sdktypes.PluginContext, sdklogs.LogStreamRequest) (int64, error) {
				counted.Add(1)
				return 2, nil
			}),
		},
	})
	manager.BindConnectionContextProvider(aLeaseThatRunsTheCallback{})
	t.Cleanup(manager.Close)

	wire := &framesOnTheWire{}
	server := grpc.NewServer(sdkutils.RegisterServerOpts([]grpc.ServerOption{
		grpc.ChainUnaryInterceptor(wire.unary), grpc.ChainStreamInterceptor(wire.stream),
	}, logging.NewNop())...)
	logPlugin := &sdklogs.Plugin{Impl: manager}
	require.NoError(t, logPlugin.GRPCServer(nil, server))
	listener := bufconn.Listen(1024 * 1024)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { server.Stop(); _ = listener.Close() })
	//nolint:staticcheck // Match the existing host bufconn integration convention.
	transport, err := grpc.DialContext(ctx, "passthrough:///replay-aware",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainUnaryInterceptor(sdk.ClientPluginContextInterceptor(logging.NewNop())),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = transport.Close() })
	client, err := logPlugin.GRPCClient(ctx, nil, transport)
	require.NoError(t, err)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"log": client}})

	window := newEventRecorder()
	ctrl := aLaneController(t, immediateUIConnection{})
	ctrl.ctx = ctx
	ctrl.emitter = window
	t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(pluginID, config.PluginMeta{ID: pluginID}) })
	require.NoError(t, ctrl.OnPluginStart(pluginID, config.PluginMeta{ID: pluginID}, backend))
	go ctrl.runMux()

	// The same viewer opens the same source twice, once through each handler, as the legacy
	// viewer does: it sets no session parameter of its own.
	open2 := func(resource string) string {
		session, createErr := ctrl.CreateSession(ctx, pluginID, "route", sdklogs.CreateSessionOptions{
			ResourceKey: resource, ResourceID: "pod",
			Options: sdklogs.LogSessionOptions{IncludeTimestamps: true, IncludeSourceEvents: true},
		})
		require.NoError(t, createErr)
		require.False(t, session.ReplayMarkers, "a session the host did not ask for markers is not one that has them")
		require.Empty(t, session.Options.Params[sdklogs.ParamReplayMarkersAccepted], "the plugin did not accept what the host did not offer")
		return session.ID
	}
	plainID, replayID := open2("plain"), open2("replay")

	// Wait for everything each session has: its lines reached the window and its stream ended.
	for _, id := range []string{plainID, replayID} {
		window.linesOf(t, id, len(replayFixtureLines()))
		require.Eventually(t, func() bool {
			for _, event := range eventsOf(t, window, id) {
				if event.Type == sdklogs.StreamEventStreamEnded {
					return true
				}
			}
			return false
		}, 10*time.Second, 5*time.Millisecond, "session %s did not end", id)
	}

	// The host asked for nothing: no session parameter of the SDK's reaches the plugin, and the
	// plugin's ReplayCount was never called.
	wire.mu.Lock()
	require.Len(t, wire.requests, 2)
	for _, request := range wire.requests {
		for key := range request.GetOptions().GetParams() {
			require.False(t, strings.HasPrefix(key, "omniview."), "the host's create request carries the SDK's parameter %q", key)
		}
	}
	wire.mu.Unlock()
	require.Zero(t, counted.Load(), "ReplayCount is called only for a session that asked")

	// The frames on the wire are the same, byte for byte, with and without ReplayCount: none is
	// flagged, none is a caught-up event, and none carries a field this host does not know.
	plainFrames, replayFrames := wire.forSession(t, plainID), wire.forSession(t, replayID)
	require.Len(t, plainFrames.lines, len(replayFixtureLines()))
	require.Equal(t, plainFrames.lines, replayFrames.lines, "the lines of a handler that declares ReplayCount differ on the wire")
	require.Equal(t, plainFrames.events, replayFrames.events, "the events of a handler that declares ReplayCount differ on the wire")
	for _, frame := range replayFrames.raw {
		require.Empty(t, frame.ProtoReflect().GetUnknown())
		if line := frame.GetLine(); line != nil {
			require.False(t, line.GetReplay(), "a line is flagged as replay though the reader did not ask: %q", line.GetContent())
			require.Empty(t, line.ProtoReflect().GetUnknown())
		}
		if event := frame.GetEvent(); event != nil {
			require.NotEqual(t, logspb.LogStreamEventType_LOG_STREAM_EVENT_SOURCE_CAUGHT_UP, event.GetType())
			require.Empty(t, event.ProtoReflect().GetUnknown())
		}
	}
	require.Len(t, plainFrames.raw, len(replayFrames.raw))

	// What the window was told is the same too, byte for byte once the session's own ID is set
	// aside, and no payload of it holds the flag.
	plainTold, replayTold := windowTold(t, window, plainID), windowTold(t, window, replayID)
	require.Equal(t, plainTold.lines, replayTold.lines, "the lines the window received differ")
	require.Equal(t, plainTold.events, replayTold.events, "the events the window was told of differ")
	for _, payload := range replayTold.raw {
		require.NotContains(t, payload, `"replay"`, "the window's payload carries the replay flag")
	}
	for i, line := range replayFixtureLines() {
		var decoded sdklogs.LogLine
		require.NoError(t, json.Unmarshal(replayTold.lines[i], &decoded))
		require.Equal(t, strings.SplitN(line, " ", 2)[1], decoded.Content)
	}
}
