package metric

import (
	"context"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
)

// retiredSessions stands for the controller: it records the lifetimes the wrapper told it to retire.
type retiredSessions struct {
	Controller
	mu      sync.Mutex
	retired []context.Context
}

func (r *retiredSessions) RetireMetricsSession(ctx context.Context) {
	r.mu.Lock()
	r.retired = append(r.retired, ctx)
	r.mu.Unlock()
}
func (r *retiredSessions) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.retired)
}

// browserMetricWindow is a server-mode window as Wails builds it: it names its page, and its close event never fires.
type browserMetricWindow struct {
	application.Window
	id     uint
	client string
}

func (w *browserMetricWindow) ID() uint         { return w.id }
func (w *browserMetricWindow) ClientID() string { return w.client }
func (w *browserMetricWindow) OnWindowEvent(events.WindowEventType, func(*application.WindowEvent)) func() {
	return func() {}
}

// nativeMetricWindow is a native window: its close event fires, and runs every callback registered for it.
type nativeMetricWindow struct {
	application.Window
	id       uint
	onClosed []func(*application.WindowEvent)
}

func (w *nativeMetricWindow) ID() uint { return w.id }
func (w *nativeMetricWindow) OnWindowEvent(_ events.WindowEventType, callback func(*application.WindowEvent)) func() {
	w.onClosed = append(w.onClosed, callback)
	return func() {}
}
func (w *nativeMetricWindow) close() {
	for _, callback := range w.onClosed {
		callback(nil)
	}
}

type browserPages struct {
	mu   sync.Mutex
	open map[string]bool
}

func (p *browserPages) set(client string, connected bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.open[client] = connected
}
func (p *browserPages) connected(client string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.open[client]
}

func metricPageFixture() (*ServiceWrapper, *retiredSessions, *browserPages) {
	pages := &browserPages{open: map[string]bool{}}
	ctrl := &retiredSessions{}
	realm := invocation.NewWindowRealm(nil, invocation.WithPageSweep(pages.connected, 5*time.Millisecond))
	return &ServiceWrapper{Ctrl: ctrl, Realm: realm}, ctrl, pages
}

func openMetricPage(t *testing.T, wrapper *ServiceWrapper, pages *browserPages, id uint) *browserMetricWindow {
	t.Helper()
	window := &browserMetricWindow{id: id, client: "page-" + strconv.FormatUint(uint64(id), 10)}
	pages.set(window.client, true)
	_, _, err := wrapper.metricSession(context.WithValue(context.Background(), application.WindowKey, window))
	require.NoError(t, err, "page %d was refused a metric session", id)
	return window
}

func sessionCount(wrapper *ServiceWrapper) int {
	wrapper.sessionsMu.Lock()
	defer wrapper.sessionsMu.Unlock()
	return len(wrapper.sessions)
}

// B-86: the metric registry holds 64 sessions and released one only on the window's close event, which a server-mode page never fires.
// The 64th page of a host's life was the last one that could open a metric view; every later one was refused until the host restarted.
func TestMetricSessionsAreReleasedWhenAServerModePageCloses(t *testing.T) {
	wrapper, ctrl, pages := metricPageFixture()
	for id := uint(1); id <= 65; id++ {
		window := openMetricPage(t, wrapper, pages, id)
		pages.set(window.client, false)
		require.Eventually(t, func() bool { return sessionCount(wrapper) == 0 }, 10*time.Second, time.Millisecond,
			"the metric session of page %d outlived its page", id)
	}
	require.Equal(t, 65, ctrl.count(), "each closed page's observations are retired with it")
	for _, lifetime := range ctrl.retired {
		require.Error(t, lifetime.Err(), "a retired session's lifetime is cancelled")
	}
}

// The cap is for live pages: the 65th that is open at the same time is refused, with a code that is not a permission denial.
func TestMetricSessionLimitIsForLivePagesAndAnswersWithALimitCode(t *testing.T) {
	wrapper, _, pages := metricPageFixture()
	for id := uint(1); id <= 64; id++ {
		openMetricPage(t, wrapper, pages, id)
	}
	window := &browserMetricWindow{id: 65, client: "page-65"}
	pages.set(window.client, true)
	_, _, err := wrapper.metricSession(context.WithValue(context.Background(), application.WindowKey, window))
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	require.Equal(t, "RESOURCE_LIMIT", app.Code)
	require.ErrorIs(t, err, invocation.ErrWindowLimit)

	// A page that closes gives its slot to the next.
	pages.set("page-1", false)
	require.Eventually(t, func() bool {
		_, _, retry := wrapper.metricSession(context.WithValue(context.Background(), application.WindowKey, window))
		return retry == nil
	}, 10*time.Second, 5*time.Millisecond, "a freed slot was not given to the waiting page")
}

// A native window's close was already propagated by the metric registry's own hook; it is the realm's signal now, and it behaves the same.
func TestMetricSessionsAreReleasedWhenANativeWindowCloses(t *testing.T) {
	ctrl := &retiredSessions{}
	wrapper := &ServiceWrapper{Ctrl: ctrl, Realm: invocation.NewWindowRealm(nil)}
	for id := uint(1); id <= 65; id++ {
		window := &nativeMetricWindow{id: id}
		_, session, err := wrapper.metricSession(context.WithValue(context.Background(), application.WindowKey, window))
		require.NoError(t, err, "native window %d was refused a metric session", id)
		window.close()
		require.Equal(t, 0, sessionCount(wrapper))
		require.Error(t, session.ctx.Err())
	}
	require.Equal(t, 65, ctrl.count())
}

func TestMetricSessionOfARetiredWindowIsNotRecreated(t *testing.T) {
	wrapper, _, pages := metricPageFixture()
	window := openMetricPage(t, wrapper, pages, 1)
	pages.set(window.client, false)
	require.Eventually(t, func() bool { return sessionCount(wrapper) == 0 }, 10*time.Second, time.Millisecond)
	_, _, err := wrapper.metricSession(context.WithValue(context.Background(), application.WindowKey, window))
	require.Error(t, err, "a call that arrives after the page's retirement must not open a session nobody will release")
	require.NotErrorIs(t, err, invocation.ErrWindowLimit)
	require.Equal(t, 0, sessionCount(wrapper))
}
