package logs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"slices"
	"strconv"
	"strings"
	"sync"
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
	logrecord "github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
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
// flag on each replay line and a SOURCE_CAUGHT_UP event. The lane is the one reader that asks
// on the window's behalf: it owns the SDK's reserved parameter names ("omniview."), strips what
// a window sends of them, and sets the ask itself on a session the window creates. These tests
// hold that where the lane meets the plugin and the window: what the lane hands its provider,
// the requests and frames on the wire of a real SDK manager behind real gRPC, and what the
// window is told. The reply's fact, the line's flag and the caught-up event are the SDK's, and
// reach the window as the plugin sent them.

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
	updates  []*logspb.UpdateLogSessionOptionsRequest
}

func (f *framesOnTheWire) unary(ctx context.Context, request any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	switch typed := request.(type) {
	case *logspb.CreateLogSessionRequest:
		f.mu.Lock()
		f.requests = append(f.requests, proto.CloneOf(typed))
		f.mu.Unlock()
	case *logspb.UpdateLogSessionOptionsRequest:
		f.mu.Lock()
		f.updates = append(f.updates, proto.CloneOf(typed))
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

// aSource is one source of a test handler: the lines it holds, how many of them are replay
// (what a ReplayCount reports), and how it ends. A source that is finite ends at its last line; one
// that is not holds its stream open after its lines until the session closes it, and its first
// breaks opens fail with a read error after their lines, as a stream that drops does.
type aSource struct {
	lines  []string
	replay int64
	finite bool
	breaks int

	mu    sync.Mutex
	opens int
}

func (s *aSource) open() io.ReadCloser {
	s.mu.Lock()
	s.opens++
	fails := s.opens <= s.breaks
	s.mu.Unlock()
	body := strings.NewReader(strings.Join(s.lines, "\n") + "\n")
	switch {
	case s.finite:
		return io.NopCloser(body)
	case fails:
		return &aReaderThatEnds{lines: body, err: errors.New("the stream dropped")}
	}
	return &aReaderThatEnds{lines: body, done: make(chan struct{})}
}

// aReaderThatEnds reads its lines and then fails with err, or, when it has none, holds until it is closed.
type aReaderThatEnds struct {
	lines *strings.Reader
	err   error
	done  chan struct{}
	once  sync.Once
}

func (r *aReaderThatEnds) Read(p []byte) (int, error) {
	if n, _ := r.lines.Read(p); n > 0 {
		return n, nil
	}
	if r.err != nil {
		return 0, r.err
	}
	<-r.done
	return 0, io.EOF
}

func (r *aReaderThatEnds) Close() error {
	if r.done != nil {
		r.once.Do(func() { close(r.done) })
	}
	return nil
}

// aHandlerOver is the handler of a resource over sources; it declares ReplayCount when counted.
func aHandlerOver(resource string, counted bool, sources map[string]*aSource, order ...string) sdklogs.Handler {
	handler := sdklogs.Handler{
		Plugin: "test", Resource: resource,
		Handler: func(_ *sdktypes.PluginContext, request sdklogs.LogStreamRequest) (io.ReadCloser, error) {
			return sources[request.SourceID].open(), nil
		},
		SourceBuilder: logtest.MultiSourceBuilder(order...),
	}
	if counted {
		handler.ReplayCount = func(_ *sdktypes.PluginContext, request sdklogs.LogStreamRequest) (int64, error) {
			return sources[request.SourceID].replay, nil
		}
	}
	return handler
}

// aProviderTheLaneRuns is the SDK's client of the plugin, with a record of what the lane hands it:
// the options of each create and update before the SDK encodes them (the SDK itself removes one
// of the reserved names from what it sends, so the wire alone cannot show what the lane did), and
// the outputs the plugin's stream delivered to the lane, as the lane received them.
type aProviderTheLaneRuns struct {
	*sdklogs.PluginClient
	mu       sync.Mutex
	created  []sdklogs.CreateSessionOptions
	updated  []sdklogs.LogSessionOptions
	received []sdklogs.StreamOutput
}

func (p *aProviderTheLaneRuns) CreateSession(ctx *sdktypes.PluginContext, opts sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	p.noteCreate(opts)
	return p.PluginClient.CreateSession(ctx, opts)
}

func (p *aProviderTheLaneRuns) CreateResourceSession(ctx *sdktypes.PluginContext, opts sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	p.noteCreate(opts)
	return p.PluginClient.CreateResourceSession(ctx, opts)
}

func (p *aProviderTheLaneRuns) noteCreate(opts sdklogs.CreateSessionOptions) {
	opts.Options.Params = maps.Clone(opts.Options.Params)
	p.mu.Lock()
	p.created = append(p.created, opts)
	p.mu.Unlock()
}

func (p *aProviderTheLaneRuns) UpdateSessionOptions(ctx *sdktypes.PluginContext, sessionID string, opts sdklogs.LogSessionOptions) (*sdklogs.LogSession, error) {
	noted := opts
	noted.Params = maps.Clone(opts.Params)
	p.mu.Lock()
	p.updated = append(p.updated, noted)
	p.mu.Unlock()
	return p.PluginClient.UpdateSessionOptions(ctx, sessionID, opts)
}

func (p *aProviderTheLaneRuns) Stream(ctx context.Context, input chan sdklogs.StreamInput) (chan sdklogs.StreamOutput, error) {
	upstream, err := p.PluginClient.Stream(ctx, input)
	if err != nil {
		return nil, err
	}
	forwarded := make(chan sdklogs.StreamOutput)
	go func() {
		defer close(forwarded)
		for output := range upstream {
			p.mu.Lock()
			p.received = append(p.received, output)
			p.mu.Unlock()
			select {
			case forwarded <- output:
			case <-ctx.Done():
				return
			}
		}
	}()
	return forwarded, nil
}

// handedForSession is the options of the one create the lane handed its provider for a session.
func (p *aProviderTheLaneRuns) handedForSession(t *testing.T, sessionID string) sdklogs.CreateSessionOptions {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, opts := range p.created {
		if opts.SessionID == sessionID {
			return opts
		}
	}
	t.Fatalf("the lane handed its provider no create for session %s", sessionID)
	return sdklogs.CreateSessionOptions{}
}

// caughtUpEvents are the caught-up events of one session the plugin's stream delivered to the lane.
func (p *aProviderTheLaneRuns) caughtUpEvents(sessionID string) []sdklogs.LogStreamEvent {
	p.mu.Lock()
	defer p.mu.Unlock()
	var events []sdklogs.LogStreamEvent
	for _, output := range p.received {
		if output.SessionID == sessionID && output.Event != nil && output.Event.Type == sdklogs.StreamEventSourceCaughtUp {
			events = append(events, *output.Event)
		}
	}
	return events
}

// onTheWireFor is the create request the plugin's server received for a session.
func (f *framesOnTheWire) onTheWireFor(t *testing.T, sessionID string) *logspb.CreateLogSessionRequest {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, request := range f.requests {
		if request.GetSessionId() == sessionID {
			return request
		}
	}
	t.Fatalf("the plugin's server received no create for session %s", sessionID)
	return nil
}

// reservedOn lists the reserved parameter names of a parameter map, sorted.
func reservedOn(params map[string]string) []string {
	var names []string
	for key := range params {
		if strings.HasPrefix(key, "omniview.") {
			names = append(names, key)
		}
	}
	slices.Sort(names)
	return names
}

// aReplayHost is the lane over a real SDK manager behind real gRPC: the controller, the recorder that
// is the window's event channel, what the lane hands its provider, and what the wire carries.
type aReplayHost struct {
	ctx      context.Context
	ctrl     *controller
	window   *eventRecorder
	wire     *framesOnTheWire
	provider *aProviderTheLaneRuns
	logged   *logrecord.RecordingSink
}

const replayHostPlugin = "replay-host"

func aReplayHostOver(t *testing.T, handlers ...sdklogs.Handler) *aReplayHost {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)
	byID := make(map[string]sdklogs.Handler, len(handlers))
	for _, handler := range handlers {
		byID[handler.ID()] = handler
	}
	manager := sdklogs.NewManager(sdklogs.ManagerConfig{
		Logger: logging.NewNop(), Clock: timeutil.NewInstantFakeClock(), Handlers: byID,
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
	transport, err := grpc.DialContext(ctx, "passthrough:///"+replayHostPlugin,
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainUnaryInterceptor(sdk.ClientPluginContextInterceptor(logging.NewNop())),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = transport.Close() })
	client, err := logPlugin.GRPCClient(ctx, nil, transport)
	require.NoError(t, err)
	pluginClient, ok := client.(*sdklogs.PluginClient)
	require.True(t, ok, "the SDK's client of the plugin")
	provider := &aProviderTheLaneRuns{PluginClient: pluginClient}
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"log": provider}})

	logged := &logrecord.RecordingSink{}
	ctrl, ok := NewController(logging.New(logging.Config{Backend: logging.NewSinkBackend(logged)}), nil, immediateUIConnection{}).(*controller)
	require.True(t, ok, "NewController returns the controller")
	window := newEventRecorder()
	ctrl.ctx = ctx
	ctrl.emitter = window
	t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(replayHostPlugin, config.PluginMeta{ID: replayHostPlugin}) })
	require.NoError(t, ctrl.OnPluginStart(replayHostPlugin, config.PluginMeta{ID: replayHostPlugin}, backend))
	go ctrl.runMux()
	return &aReplayHost{ctx: ctx, ctrl: ctrl, window: window, wire: wire, provider: provider, logged: logged}
}

// open creates a session the way the window does, through the lane's own entry.
func (h *aReplayHost) open(t *testing.T, resource string, options sdklogs.LogSessionOptions) *sdklogs.LogSession {
	t.Helper()
	session, err := h.ctrl.CreateSession(h.ctx, replayHostPlugin, "route", sdklogs.CreateSessionOptions{
		ResourceKey: resource, ResourceID: "pod", Options: options,
	})
	require.NoError(t, err)
	return session
}

// eventPayloads are the lifecycle events the window was told of one session, as emitted.
func eventPayloads(window *eventRecorder, sessionID string) []string {
	var payloads []string
	for _, emitted := range window.recorded() {
		if emitted.key != "core/logs/event/"+sessionID {
			continue
		}
		if payload, ok := emitted.data[0].(string); ok {
			payloads = append(payloads, payload)
		}
	}
	return payloads
}

// linePayloads are the lines the window was told of one session, each as the JSON object it was sent
// as (so that a key that is absent shows as absent), in the order they were sent.
func linePayloads(t *testing.T, window *eventRecorder, sessionID string) []map[string]json.RawMessage {
	t.Helper()
	var lines []map[string]json.RawMessage
	for _, emitted := range window.recorded() {
		if emitted.key != "core/logs/lines/"+sessionID {
			continue
		}
		payload, ok := emitted.data[0].(string)
		require.True(t, ok)
		var batch []map[string]json.RawMessage
		require.NoError(t, json.Unmarshal([]byte(payload), &batch))
		lines = append(lines, batch...)
	}
	return lines
}

func (h *aReplayHost) awaitEvents(t *testing.T, sessionID string, what string, done func([]sdklogs.LogStreamEvent) bool) {
	t.Helper()
	require.Eventually(t, func() bool { return done(eventsOf(t, h.window, sessionID)) }, 10*time.Second, 5*time.Millisecond, what)
}

func countKind(events []sdklogs.LogStreamEvent, kind sdklogs.LogStreamEventType, source string) int {
	n := 0
	for _, event := range events {
		if event.Type == kind && event.SourceID == source {
			n++
		}
	}
	return n
}

// replayFlagsOf is the flag of each line of a source the window was told of, in order: true when
// the line carried "replay":true, false when the key was absent. A key with any other value fails.
func replayFlagsOf(t *testing.T, lines []map[string]json.RawMessage, source string) []bool {
	t.Helper()
	var flags []bool
	for _, line := range lines {
		if string(line["source_id"]) != strconv.Quote(source) {
			continue
		}
		raw, present := line["replay"]
		if present {
			require.Equal(t, "true", string(raw), "the flag is true or absent")
		}
		flags = append(flags, present)
	}
	return flags
}

func TestTheLaneAsksForReplayMarkersAndTheWindowIsToldWhatThePluginSent(t *testing.T) {
	counted := map[string]*aSource{"pod": {lines: replayFixtureLines(), replay: 2}}
	host := aReplayHostOver(t, aHandlerOver("replay", true, counted, "pod"))

	// The window sets no session parameter of its own: the lane asks.
	session := host.open(t, "replay", sdklogs.LogSessionOptions{Follow: true, IncludeTimestamps: true, IncludeSourceEvents: true})
	require.True(t, session.ReplayMarkers, "the plugin accepted what the lane asked, and the window is told so")

	handed := host.provider.handedForSession(t, session.ID)
	require.Equal(t, map[string]string{sdklogs.ParamReplayMarkers: sdklogs.ReplayMarkersOn}, handed.Options.Params,
		"the lane hands its provider the ask and nothing else")
	wireParams := host.wire.onTheWireFor(t, session.ID).GetOptions().GetParams()
	require.Equal(t, "1", wireParams["omniview.log.replay-markers"], "the create request that reached the plugin carries the ask")
	require.Equal(t, []string{"omniview.log.replay-markers"}, reservedOn(wireParams))

	// The window is told the first two lines as replay and the third as live, and one caught-up event.
	host.window.linesOf(t, session.ID, len(replayFixtureLines()))
	host.awaitEvents(t, session.ID, "the caught-up event did not reach the window", func(events []sdklogs.LogStreamEvent) bool {
		return countKind(events, sdklogs.StreamEventSourceCaughtUp, "pod") > 0
	})
	lines := linePayloads(t, host.window, session.ID)
	require.Len(t, lines, 3)
	require.Equal(t, []bool{true, true, false}, replayFlagsOf(t, lines, "pod"))
	require.Equal(t, `"first line"`, string(lines[0]["content"]))
	require.Equal(t, "true", string(lines[0]["replay"]))
	require.NotContains(t, lines[2], "replay", "a live line carries no flag")

	var caughtUp []string
	for _, payload := range eventPayloads(host.window, session.ID) {
		var event map[string]any
		require.NoError(t, json.Unmarshal([]byte(payload), &event))
		if event["type"] == float64(sdklogs.StreamEventSourceCaughtUp) {
			caughtUp = append(caughtUp, payload)
		}
	}
	require.Len(t, caughtUp, 1, "one caught-up event for the one source")
	require.Equal(t, 7, int(sdklogs.StreamEventSourceCaughtUp))
	require.Contains(t, caughtUp[0], `"type":7`)
	require.Contains(t, caughtUp[0], `"source_id":"pod"`)
	// What the window got is what the SDK sent the lane, byte for byte.
	sent := host.provider.caughtUpEvents(session.ID)
	require.Len(t, sent, 1)
	encoded, err := json.Marshal(sent[0])
	require.NoError(t, err)
	require.Equal(t, string(encoded), caughtUp[0])
}

func TestAWindowCannotForgeOrInjectTheSDKsReservedParameters(t *testing.T) {
	for _, name := range []string{"counted", "plain"} {
		t.Run(name, func(t *testing.T) {
			counting := name == "counted"
			source := &aSource{lines: replayFixtureLines(), replay: 2, finite: !counting}
			host := aReplayHostOver(t, aHandlerOver("pod", counting, map[string]*aSource{"pod": source}, "pod"))

			forged := map[string]string{
				"omniview.log.replay-markers":          "0",
				"omniview.log.replay-markers.accepted": "1",
				"omniview.other":                       "x",
				"ordinary":                             "y",
			}
			before := maps.Clone(forged)
			options := sdklogs.LogSessionOptions{Follow: counting, IncludeTimestamps: true, IncludeSourceEvents: true, Params: forged}
			session := host.open(t, "pod", options)

			require.Equal(t, before, forged, "the caller's own map is unchanged")
			require.Equal(t, counting, session.ReplayMarkers, "the fact is the plugin's, as the SDK stated it")

			// What the lane handed its provider: the host's own ask, the ordinary key, nothing else of the namespace.
			want := map[string]string{sdklogs.ParamReplayMarkers: sdklogs.ReplayMarkersOn, "ordinary": "y"}
			require.Equal(t, want, host.provider.handedForSession(t, session.ID).Options.Params)
			// The same on the wire: the ask is "1", the accepted key and the injected key are not there.
			require.Equal(t, want, host.wire.onTheWireFor(t, session.ID).GetOptions().GetParams())

			host.window.linesOf(t, session.ID, len(replayFixtureLines()))
			if counting {
				return
			}
			host.awaitEvents(t, session.ID, "the session did not end", func(events []sdklogs.LogStreamEvent) bool {
				return countKind(events, sdklogs.StreamEventStreamEnded, "") > 0
			})
			require.Empty(t, host.provider.caughtUpEvents(session.ID), "a plugin that does not count replay sends no caught-up event")
			for _, line := range linePayloads(t, host.window, session.ID) {
				require.NotContains(t, line, "replay", "no line of a plugin that does not count replay is flagged")
			}
			for _, payload := range eventPayloads(host.window, session.ID) {
				require.NotContains(t, payload, `"type":7`)
			}

			// The same handler, a session made with no parameters at all through the SDK's client, bypassing
			// the lane: the frames of its lines and events are the same bytes.
			pctx, err := host.ctrl.getConnectedCtx(host.ctx, replayHostPlugin, "route")
			require.NoError(t, err)
			direct, err := host.provider.PluginClient.CreateSession(pctx, sdklogs.CreateSessionOptions{
				ResourceKey: "pod", ResourceID: "pod",
				Options: sdklogs.LogSessionOptions{IncludeTimestamps: true, IncludeSourceEvents: true},
			})
			require.NoError(t, err)
			require.False(t, direct.ReplayMarkers)
			require.Eventually(t, func() bool {
				for _, frame := range host.wire.forSession(t, direct.ID).raw {
					if frame.GetEvent().GetType() == logspb.LogStreamEventType_LOG_STREAM_EVENT_STREAM_ENDED {
						return true
					}
				}
				return false
			}, 10*time.Second, 5*time.Millisecond, "the direct session did not end")
			viaLane, bypassed := host.wire.forSession(t, session.ID), host.wire.forSession(t, direct.ID)
			require.Len(t, bypassed.lines, len(replayFixtureLines()))
			require.Equal(t, bypassed.lines, viaLane.lines, "the lines on the wire differ from the ones of a session made with no parameters")
			require.Equal(t, bypassed.events, viaLane.events, "the events on the wire differ from the ones of a session made with no parameters")
			require.Len(t, viaLane.raw, len(bypassed.raw))
		})
	}
}

func TestAnUpdateThroughTheLaneNeverCarriesTheReservedParameters(t *testing.T) {
	sources := map[string]*aSource{"a": {lines: []string{"a1"}, replay: 1}, "b": {lines: []string{"b1"}, replay: 1}}
	host := aReplayHostOver(t, aHandlerOver("replay", true, sources, "a", "b"))
	session := host.open(t, "replay", sdklogs.LogSessionOptions{Follow: true, IncludeSourceEvents: true})
	require.True(t, session.ReplayMarkers)

	forged := map[string]string{
		"omniview.log.replay-markers":          "1",
		"omniview.log.replay-markers.accepted": "1",
		"omniview.other":                       "x",
		"enabled_sources":                      "a,b",
	}
	before := maps.Clone(forged)
	updated, err := host.ctrl.UpdateSessionOptions(session.ID, sdklogs.LogSessionOptions{Follow: true, IncludeSourceEvents: true, Params: forged})
	require.NoError(t, err)
	require.Equal(t, before, forged, "the caller's own map is unchanged")
	require.True(t, updated.ReplayMarkers, "acceptance is fixed at creation; the update neither grants nor revokes it")

	want := map[string]string{"enabled_sources": "a,b"}
	host.provider.mu.Lock()
	require.Len(t, host.provider.updated, 1)
	require.Equal(t, want, host.provider.updated[0].Params, "what the lane handed its provider")
	host.provider.mu.Unlock()
	host.wire.mu.Lock()
	require.Len(t, host.wire.updates, 1)
	require.Equal(t, want, host.wire.updates[0].GetOptions().GetParams(), "what reached the plugin")
	host.wire.mu.Unlock()
}

// aHeadlessProviderThatRecords stands for the plugin of a headless read: the SDK's manager admits a
// resource reference only through a connection provider that holds the whole resource catalogue, which
// this package's tests do not build, so what the lane hands its provider is what is recorded here.
type aHeadlessProviderThatRecords struct {
	Provider
	controller *controller
	mu         sync.Mutex
	created    []sdklogs.CreateSessionOptions
}

func (p *aHeadlessProviderThatRecords) CreateResourceSession(_ *sdktypes.PluginContext, opts sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	noted := opts
	noted.Options.Params = maps.Clone(opts.Options.Params)
	p.mu.Lock()
	p.created = append(p.created, noted)
	p.mu.Unlock()
	for _, line := range replayFixtureLines() {
		p.controller.handleOutput(sdklogs.StreamOutput{SessionID: opts.SessionID, Line: &sdklogs.LogLine{SessionID: opts.SessionID, Content: line}})
	}
	p.controller.handleOutput(sdklogs.StreamOutput{SessionID: opts.SessionID, Event: &sdklogs.LogStreamEvent{Type: sdklogs.StreamEventStreamEnded}})
	return &sdklogs.LogSession{ID: opts.SessionID}, nil
}

func (p *aHeadlessProviderThatRecords) CloseSession(*sdktypes.PluginContext, string) error {
	return nil
}

func TestAHeadlessReadStripsTheReservedParametersAndAsksForNothing(t *testing.T) {
	logged := &logrecord.RecordingSink{}
	ctrl := &controller{
		clients: make(map[string]Provider), logger: logging.New(logging.Config{Backend: logging.NewSinkBackend(logged)}),
	}
	provider := &aHeadlessProviderThatRecords{controller: ctrl}
	ctrl.clients["plugin"] = provider
	ctrl.referenceAdmitter = func(ctx context.Context, _, _ string, _ sdkresource.AccessRoute, _ sdkresource.ResourceReference) (context.Context, error) {
		return ctx, nil
	}
	forged := map[string]string{
		"omniview.log.replay-markers":          "1",
		"omniview.log.replay-markers.accepted": "1",
		"omniview.other":                       "Bearer abc123def456ghi789",
		"ordinary":                             "y",
	}
	before := maps.Clone(forged)
	result, err := ctrl.ReadResourceLogs(t.Context(), "plugin", sdklogs.CreateSessionOptions{
		ResourceKey: "pod", ResourceID: "pod", Route: &sdkresource.AccessRoute{Connection: "route"},
		Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{
			Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{},
		}},
		Options: sdklogs.LogSessionOptions{IncludeTimestamps: true, Params: forged},
	})
	require.NoError(t, err)
	require.Equal(t, before, forged, "the caller's own map is unchanged")
	require.Len(t, result.Lines, len(replayFixtureLines()))

	provider.mu.Lock()
	require.Len(t, provider.created, 1)
	require.Equal(t, map[string]string{"ordinary": "y"}, provider.created[0].Options.Params,
		"a headless read hands its provider no reserved name, and sets no ask")
	provider.mu.Unlock()
	var warned int
	for _, record := range logged.Records() {
		if record.Level == logging.LevelWarn {
			warned++
			require.NotContains(t, fmt.Sprint(record.Fields), "abc123def456ghi789", "the log names what was dropped, never what it held")
		}
	}
	require.Equal(t, 1, warned, "one warning for the read")
}

func TestCaughtUpEventsAndFlaggedLinesPassThroughForEverySourceAndEveryReopen(t *testing.T) {
	sources := map[string]*aSource{
		"a":   {lines: []string{"a1", "a2", "a3"}, replay: 2},
		"b":   {lines: []string{"b1", "b2"}, replay: 1},
		"pod": {lines: []string{"p1", "p2", "p3"}, replay: 2, breaks: 1},
	}
	host := aReplayHostOver(t,
		aHandlerOver("group", true, sources, "a", "b"),
		aHandlerOver("reopened", true, sources, "pod"),
	)

	t.Run("two sources of one session", func(t *testing.T) {
		session := host.open(t, "group", sdklogs.LogSessionOptions{Follow: true, IncludeSourceEvents: true})
		require.True(t, session.ReplayMarkers)
		host.window.linesOf(t, session.ID, 5)
		host.awaitEvents(t, session.ID, "a caught-up event is missing", func(events []sdklogs.LogStreamEvent) bool {
			return countKind(events, sdklogs.StreamEventSourceCaughtUp, "a") > 0 && countKind(events, sdklogs.StreamEventSourceCaughtUp, "b") > 0
		})
		events := eventsOf(t, host.window, session.ID)
		require.Equal(t, 1, countKind(events, sdklogs.StreamEventSourceCaughtUp, "a"))
		require.Equal(t, 1, countKind(events, sdklogs.StreamEventSourceCaughtUp, "b"))
		lines := linePayloads(t, host.window, session.ID)
		require.Equal(t, []bool{true, true, false}, replayFlagsOf(t, lines, "a"))
		require.Equal(t, []bool{true, false}, replayFlagsOf(t, lines, "b"))
		// Each event the window was told of is what the SDK sent the lane.
		sent := host.provider.caughtUpEvents(session.ID)
		require.Len(t, sent, 2)
		var want []string
		for _, event := range sent {
			encoded, err := json.Marshal(event)
			require.NoError(t, err)
			want = append(want, string(encoded))
		}
		var told []string
		for _, payload := range eventPayloads(host.window, session.ID) {
			if strings.Contains(payload, `"type":7`) {
				told = append(told, payload)
			}
		}
		require.ElementsMatch(t, want, told)
	})

	t.Run("a source that reopens", func(t *testing.T) {
		session := host.open(t, "reopened", sdklogs.LogSessionOptions{Follow: true, IncludeSourceEvents: true})
		require.True(t, session.ReplayMarkers)
		host.window.linesOf(t, session.ID, 6)
		host.awaitEvents(t, session.ID, "the source was not caught up again after it reopened", func(events []sdklogs.LogStreamEvent) bool {
			return countKind(events, sdklogs.StreamEventSourceCaughtUp, "pod") > 1
		})
		var kinds []sdklogs.LogStreamEventType
		for _, event := range eventsOf(t, host.window, session.ID) {
			if slices.Contains([]sdklogs.LogStreamEventType{
				sdklogs.StreamEventSourceCaughtUp, sdklogs.StreamEventReconnecting, sdklogs.StreamEventReconnected,
			}, event.Type) {
				kinds = append(kinds, event.Type)
			}
		}
		require.Equal(t, []sdklogs.LogStreamEventType{
			sdklogs.StreamEventSourceCaughtUp, sdklogs.StreamEventReconnecting, sdklogs.StreamEventReconnected, sdklogs.StreamEventSourceCaughtUp,
		}, kinds, "the window sees the events in the order the plugin sent them for the source")
		lines := linePayloads(t, host.window, session.ID)
		require.Equal(t, []bool{true, true, false, true, true, false}, replayFlagsOf(t, lines, "pod"))
	})
}

func TestTheLaneNamesWhatItDroppedAndNeverItsValues(t *testing.T) {
	source := &aSource{lines: replayFixtureLines(), replay: 2}
	host := aReplayHostOver(t, aHandlerOver("replay", true, map[string]*aSource{"pod": source}, "pod"))
	const secret = "Bearer abc123def456ghi789"
	session := host.open(t, "replay", sdklogs.LogSessionOptions{Follow: true, Params: map[string]string{
		"omniview.log.replay-markers.accepted": secret,
		"omniview.other":                       secret,
		"ordinary":                             secret,
	}})

	var warned []string
	for _, record := range host.logged.Records() {
		if record.Level != logging.LevelWarn {
			continue
		}
		warned = append(warned, fmt.Sprint(record.Message, record.Fields))
	}
	require.Len(t, warned, 1, "one warning for the create")
	require.Contains(t, warned[0], "omniview.log.replay-markers.accepted")
	require.Contains(t, warned[0], "omniview.other")
	require.Contains(t, warned[0], session.ID)
	require.NotContains(t, warned[0], secret, "the log names what was dropped, never what it held")
	require.NotContains(t, warned[0], "ordinary")
}
