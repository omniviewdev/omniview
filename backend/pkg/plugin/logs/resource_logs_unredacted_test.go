package logs

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devdiag"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// The host redacts credential-shaped text from what it logs about itself: omniview.log,
// ui.log, plugin process logs and what is shipped to a collector. A resource's log (a
// pod's, a file's) is not one of those logs. It is the user's own data, shown to the
// person who opened that resource's logs and handed, byte for byte, to the Logs tool
// that asked for it: a line with password=x or a URL with a query string is the very
// thing they came to read, and an altered line is altered evidence. These tests hold
// the boundary at the logs capability, the path from a provider's lines to the
// frontend's event and to the Logs tool. A change that wraps every log in the host with
// the redactor, in this path or around it, fails them.

// podLogLines returns the lines of a resource's log: what the host's log sinks would
// change, and a line that they would not.
func podLogLines() []string {
	return []string{
		"login failed for user=admin password=x",
		"GET https://api.example.com/v1/pods?labelSelector=app%3Dweb&limit=500&watch=true 200",
		"upstream said: Authorization: Bearer abc123def456ghi789 key AKIAIOSFODNN7EXAMPLE",
		`{"level":"info","token":"s3cr3t","apiKey":"k","msg":"loaded"}`,
		"a line with nothing to hide",
	}
}

// The test would prove nothing if the redactor left its lines alone anyway.
func requireTheFixtureIsWhatTheHostRedacts(t *testing.T) {
	t.Helper()
	lines := podLogLines()
	for _, line := range lines[:len(lines)-1] {
		require.NotEqual(t, line, devdiag.Redact(line), "the host's log sinks would not change %q", line)
	}
	require.Equal(t, lines[len(lines)-1], devdiag.Redact(lines[len(lines)-1]))
}

// podLogUIProvider streams a resource's log into a UI session the way a provider does:
// each line goes to the controller's output handler.
type podLogUIProvider struct {
	stubLogsProvider
	controller *controller
	lines      []string
}

func (p *podLogUIProvider) CreateSession(_ *sdktypes.PluginContext, opts sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	for _, line := range p.lines {
		p.controller.handleOutput(sdklogs.StreamOutput{
			SessionID: opts.SessionID,
			Line:      &sdklogs.LogLine{SessionID: opts.SessionID, Content: line},
		})
	}
	return &sdklogs.LogSession{ID: opts.SessionID}, nil
}

// eventRecorder is the controller's emitter in a test: what it is given is what the
// frontend would receive, as the Wails application would send it.
type eventRecorder struct {
	mu     sync.Mutex
	events []recordedEvent
	arrive chan struct{}
}

type recordedEvent struct {
	key  string
	data []any
}

func newEventRecorder() *eventRecorder {
	return &eventRecorder{mu: sync.Mutex{}, events: nil, arrive: make(chan struct{}, 64)}
}

func (r *eventRecorder) Emit(key string, data ...any) {
	r.mu.Lock()
	r.events = append(r.events, recordedEvent{key: key, data: data})
	r.mu.Unlock()
	select {
	case r.arrive <- struct{}{}:
	default:
	}
}

func (r *eventRecorder) recorded() []recordedEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]recordedEvent(nil), r.events...)
}

// linesOf returns the lines the recorded events of one session carry, in order, once
// there are n of them. The controller flushes a batch when a timer says so, in a
// goroutine of its own; the test waits for the event and not for a time.
func (r *eventRecorder) linesOf(t *testing.T, sessionID string, n int) []sdklogs.LogLine {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		var lines []sdklogs.LogLine
		for _, event := range r.recorded() {
			if event.key != "core/logs/lines/"+sessionID {
				continue
			}
			require.Len(t, event.data, 1)
			payload, ok := event.data[0].(string)
			require.True(t, ok, "the event carries the batch as a string")
			var batch []sdklogs.LogLine
			require.NoError(t, json.Unmarshal([]byte(payload), &batch))
			lines = append(lines, batch...)
		}
		if len(lines) >= n {
			return lines
		}
		select {
		case <-r.arrive:
		case <-deadline:
			t.Fatalf("%d of %d lines reached the frontend", len(lines), n)
		}
	}
}

func TestResourceLogLinesReachTheUIEventUnredacted(t *testing.T) {
	requireTheFixtureIsWhatTheHostRedacts(t)
	events := newEventRecorder()
	ctrl := &controller{
		logger: logging.NewNop(), clients: make(map[string]Provider), sessionIndex: make(map[string]sessionIndex),
		batches: make(map[string]*logBatch), resourceClient: immediateUIConnection{}, emitter: events,
	}
	ctrl.clients["plugin"] = &podLogUIProvider{controller: ctrl, lines: podLogLines()}
	session, err := ctrl.CreateSession(context.Background(), "plugin", "route", sdklogs.CreateSessionOptions{ResourceKey: "pod", ResourceID: "pod"})
	require.NoError(t, err)

	// The lines go to the frontend as the event core/logs/lines/<session>, which the
	// controller emits when its batch is flushed: here by the timer of the real flush.
	received := events.linesOf(t, session.ID, len(podLogLines()))
	require.Len(t, received, len(podLogLines()))
	for i, line := range received {
		require.Equal(t, podLogLines()[i], line.Content)
		require.Equal(t, session.ID, line.SessionID)
	}
}

// podLogHeadlessProvider is the provider behind the Logs tool: the finite read of a
// resource's log.
type podLogHeadlessProvider struct {
	Provider
	controller *controller
	lines      []string
}

func (p *podLogHeadlessProvider) CreateResourceSession(_ *sdktypes.PluginContext, opts sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	for _, line := range p.lines {
		p.controller.handleOutput(sdklogs.StreamOutput{
			SessionID: opts.SessionID,
			Line:      &sdklogs.LogLine{SessionID: opts.SessionID, Content: line},
		})
	}
	p.controller.handleOutput(sdklogs.StreamOutput{
		SessionID: opts.SessionID,
		Event:     &sdklogs.LogStreamEvent{Type: sdklogs.StreamEventStreamEnded},
	})
	return &sdklogs.LogSession{ID: opts.SessionID}, nil
}

func (p *podLogHeadlessProvider) CloseSession(*sdktypes.PluginContext, string) error { return nil }

func TestResourceLogLinesReachTheLogsToolUnredacted(t *testing.T) {
	requireTheFixtureIsWhatTheHostRedacts(t)
	ctrl := &controller{clients: make(map[string]Provider)}
	ctrl.clients["plugin"] = &podLogHeadlessProvider{controller: ctrl, lines: podLogLines()}
	ctrl.referenceAdmitter = func(ctx context.Context, _, _ string, _ sdkresource.AccessRoute, _ sdkresource.ResourceReference) (context.Context, error) {
		return ctx, nil
	}
	result, err := ctrl.ReadResourceLogs(context.Background(), "plugin", sdklogs.CreateSessionOptions{
		ResourceKey: "pod", ResourceID: "pod", Route: &sdkresource.AccessRoute{Connection: "route"},
		Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{
			Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{},
		}},
	})
	require.NoError(t, err)

	// What the tool reads is this result, marshalled.
	payload, err := json.Marshal(result)
	require.NoError(t, err)
	var read HeadlessResult
	require.NoError(t, json.Unmarshal(payload, &read))
	require.Len(t, read.Lines, len(podLogLines()))
	for i, line := range read.Lines {
		require.Equal(t, podLogLines()[i], line.Content)
	}
}

// The same lines, read from a real file by the plugin and sent through the real logs
// stream of a plugin (the SDK's log manager and, for the first, gRPC) to the
// controller's consumer, arrive as they were written. testNativeLogConnection requires
// each line's content to equal what the file holds.
func TestResourceLogLinesAreNotRedactedByThePluginLogStream(t *testing.T) {
	requireTheFixtureIsWhatTheHostRedacts(t)
	t.Run("grpc", func(t *testing.T) { testNativeLogConnection(t, false, podLogLines()...) })
	t.Run("direct", func(t *testing.T) { testNativeLogConnection(t, true, podLogLines()...) })
}
