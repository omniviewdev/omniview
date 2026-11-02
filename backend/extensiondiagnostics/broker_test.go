package extensiondiagnostics

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func brokerFixture(t *testing.T) (*Broker, chan Request) {
	t.Helper()
	b := NewBroker()
	events := make(chan Request, MaxPending+1)
	b.Start(func(request Request) error { events <- request; return nil })
	if _, err := b.RegisterRuntime("main", nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(b.Close)
	return b, events
}

func snapshotPayload(window string) string {
	return `{"schemaVersion":1,"capturedAt":"2026-11-01T12:00:00Z","windowName":"` + window + `","points":[],"pending":[],"plugins":[],"problems":[],"coverage":[],"limits":{"quarantineCrashThreshold":3,"maxCrashRecordsPerContribution":5},"truncated":false}`
}

func receiveRequest(t *testing.T, events <-chan Request) Request {
	t.Helper()
	select {
	case request := <-events:
		return request
	case <-time.After(time.Second):
		t.Fatal("missing diagnostics request")
		return Request{}
	}
}

func receiveResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(time.Second):
		t.Fatal("diagnostics query did not finish")
		return nil
	}
}

func queryAsync(b *Broker, ctx context.Context, window string) <-chan error {
	done := make(chan error, 1)
	go func() { _, err := b.Query(ctx, window, "snapshot", Options{}); done <- err }()
	return done
}

func TestBrokerWindowCorrelationDuplicateAndFreshQuery(t *testing.T) {
	b, events := brokerFixture(t)
	first := queryAsync(b, context.Background(), "main")
	request := receiveRequest(t, events)
	if err := b.Respond(request.RequestID, "other", snapshotPayload("other"), ""); !errors.Is(err, ErrWindow) {
		t.Fatalf("wrong window: %v", err)
	}
	if err := b.Respond(request.RequestID, "main", snapshotPayload("other"), ""); !errors.Is(err, ErrResponse) {
		t.Fatalf("payload window mismatch: %v", err)
	}
	if err := b.Respond(request.RequestID, "main", snapshotPayload("main"), ""); err != nil {
		t.Fatal(err)
	}
	if err := receiveResult(t, first); err != nil {
		t.Fatal(err)
	}
	if err := b.Respond(request.RequestID, "main", snapshotPayload("main"), ""); !errors.Is(err, ErrResponse) {
		t.Fatalf("duplicate accepted: %v", err)
	}
	second := queryAsync(b, context.Background(), "main")
	next := receiveRequest(t, events)
	if next.RequestID == request.RequestID {
		t.Fatal("query reused stale correlation")
	}
	b.Close()
	if err := receiveResult(t, second); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("shutdown: %v", err)
	}
}

func TestBrokerCancellationExpiryAndCapacity(t *testing.T) {
	b, events := brokerFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := queryAsync(b, ctx, "main")
	request := receiveRequest(t, events)
	cancel()
	if err := receiveResult(t, done); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	if err := b.Respond(request.RequestID, "main", snapshotPayload("main"), ""); !errors.Is(err, ErrResponse) {
		t.Fatalf("expired response: %v", err)
	}
	var waiting []<-chan error
	for range MaxPending {
		waiting = append(waiting, queryAsync(b, context.Background(), "main"))
		receiveRequest(t, events)
	}
	if _, err := b.Query(context.Background(), "main", "snapshot", Options{}); !errors.Is(err, ErrCapacity) {
		t.Fatalf("capacity: %v", err)
	}
	b.Close()
	for _, done := range waiting {
		if err := receiveResult(t, done); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("shutdown pending query: %v", err)
		}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.pending) != 0 {
		t.Fatal("pending requests leaked")
	}
}

func TestBrokerUnavailableTimeoutBounds(t *testing.T) {
	b := NewBroker()
	if _, err := b.Query(context.Background(), "main", "snapshot", Options{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing frontend transport: %v", err)
	}
	b.Start(func(Request) error { return ErrUnavailable })
	if _, err := b.Query(context.Background(), "missing", "snapshot", Options{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing window: %v", err)
	}
	b, events := brokerFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	done := queryAsync(b, ctx, "main")
	request := receiveRequest(t, events)
	if err := b.Respond(request.RequestID, "main", strings.Repeat("x", MaxPayloadBytes+1), ""); !errors.Is(err, ErrResponse) {
		t.Fatalf("oversized payload: %v", err)
	}
	if err := receiveResult(t, done); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("absent frontend must timeout: %v", err)
	}
	if err := b.Respond(request.RequestID, "main", snapshotPayload("main"), ""); !errors.Is(err, ErrResponse) {
		t.Fatalf("late response accepted: %v", err)
	}
}

func TestBrokerLookupCorrelationAndSafeFailure(t *testing.T) {
	b, events := brokerFixture(t)
	done := make(chan error, 1)
	go func() {
		_, err := b.Query(context.Background(), "main", "lookup", Options{PointID: "point", PluginID: "plugin", ResourceKey: "resource"})
		done <- err
	}()
	request := receiveRequest(t, events)
	payload, _ := json.Marshal(map[string]any{"schemaVersion": 1, "capturedAt": time.Now().UTC().Format(time.RFC3339Nano), "windowName": "main", "pointId": "wrong", "pluginId": "plugin", "resourceKey": "resource"})
	if err := b.Respond(request.RequestID, "main", string(payload), ""); !errors.Is(err, ErrResponse) {
		t.Fatalf("lookup context mismatch: %v", err)
	}
	if err := b.Respond(request.RequestID, "main", "", "PRIVATE_PLUGIN_EXCEPTION"); err != nil {
		t.Fatal(err)
	}
	if err := receiveResult(t, done); !errors.Is(err, ErrRuntime) || strings.Contains(err.Error(), "PRIVATE") {
		t.Fatalf("unsafe runtime failure: %v", err)
	}
	for _, operation := range []string{"eval", "reload", "unquarantine"} {
		if _, err := b.Query(context.Background(), "main", operation, Options{}); !errors.Is(err, ErrParams) {
			t.Fatalf("non-read operation %q accepted: %v", operation, err)
		}
	}
}

func TestBrokerUnsupportedContextUsesOnlyAllowlistedLookupCode(t *testing.T) {
	for _, operation := range []string{"snapshot", "lookup"} {
		t.Run(operation, func(t *testing.T) {
			b, events := brokerFixture(t)
			done := make(chan error, 1)
			options := Options{}
			if operation == "lookup" {
				options = Options{PointID: "unsupported", PluginID: "plugin", ResourceKey: "resource"}
			}
			go func() {
				_, err := b.Query(context.Background(), "main", operation, options)
				done <- err
			}()
			request := receiveRequest(t, events)
			if err := b.Respond(request.RequestID, "main", "", "unsupported-context"); err != nil {
				t.Fatal(err)
			}
			expected := ErrRuntime
			if operation == "lookup" {
				expected = ErrUnsupported
			}
			if err := receiveResult(t, done); !errors.Is(err, expected) {
				t.Fatalf("error code: got %v, want %v", err, expected)
			}
		})
	}
}

func TestBrokerRegisteredBrowserQueryAndStaleUnregister(t *testing.T) {
	b := NewBroker()
	events := make(chan Request, MaxPending+1)
	b.Start(func(request Request) error { events <- request; return nil })
	t.Cleanup(b.Close)
	var alive atomic.Bool
	alive.Store(true)
	first, err := b.RegisterRuntime("browser-3", alive.Load)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.Query(context.Background(), "main", "snapshot", Options{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("browser runtime incorrectly fulfilled default native target: %v", err)
	}
	done := queryAsync(b, context.Background(), "browser-3")
	request := receiveRequest(t, events)
	if request.WindowName != "browser-3" {
		t.Fatalf("wrong native browser target: %+v", request)
	}
	if err := b.Respond(request.RequestID, "browser-3", snapshotPayload("browser-3"), ""); err != nil {
		t.Fatal(err)
	}
	if err := receiveResult(t, done); err != nil {
		t.Fatal(err)
	}
	current, err := b.RegisterRuntime("browser-3", alive.Load)
	if err != nil || current.Token == first.Token {
		t.Fatalf("registration was not rotated: %+v %v", current, err)
	}
	b.UnregisterRuntime("browser-3", first.Token)
	windows, err := b.Windows(context.Background())
	if err != nil || len(windows) != 1 || windows[0].WindowName != "browser-3" || windows[0].LastSeen.IsZero() {
		t.Fatalf("stale unregister removed current runtime: %+v %v", windows, err)
	}
	serialized, _ := json.Marshal(windows)
	if strings.Contains(string(serialized), current.Token) {
		t.Fatal("discovery leaked registration token")
	}
	done = queryAsync(b, context.Background(), "browser-3")
	request = receiveRequest(t, events)
	b.UnregisterRuntime("browser-3", current.Token)
	if err := receiveResult(t, done); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("unregister did not release pending query: %v", err)
	}
	if err := b.Respond(request.RequestID, "browser-3", snapshotPayload("browser-3"), ""); !errors.Is(err, ErrResponse) {
		t.Fatalf("unregistered response accepted: %v", err)
	}
	if _, err := b.RegisterRuntime("browser-3", alive.Load); err != nil {
		t.Fatal(err)
	}
	alive.Store(false)
	if _, err := b.Query(context.Background(), "browser-3", "snapshot", Options{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("closed browser stayed queryable: %v", err)
	}
	windows, err = b.Windows(context.Background())
	if err != nil || len(windows) != 0 {
		t.Fatalf("closed registration was not removed: %+v %v", windows, err)
	}
	b.Close()
	if _, err := b.Windows(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("shutdown discovery: %v", err)
	}
}

func TestRuntimeRegistrationCapacityPrunesClosedWindows(t *testing.T) {
	b, _ := brokerFixture(t)
	var alive atomic.Bool
	alive.Store(true)
	for i := range MaxRuntimes - 1 {
		if _, err := b.RegisterRuntime("runtime-"+strconv.Itoa(i), alive.Load); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := b.RegisterRuntime("overflow", nil); !errors.Is(err, ErrCapacity) {
		t.Fatalf("unbounded runtime registrations: %v", err)
	}
	alive.Store(false)
	if _, err := b.RegisterRuntime("replacement", nil); err != nil {
		t.Fatalf("closed windows exhausted registration capacity: %v", err)
	}
	windows, err := b.Windows(context.Background())
	if err != nil || len(windows) != 2 {
		t.Fatalf("closed windows remained in discovery: %+v %v", windows, err)
	}
}
