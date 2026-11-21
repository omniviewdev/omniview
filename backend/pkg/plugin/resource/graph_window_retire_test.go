package resource

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

// graphPageWindow is a server-mode window as Wails builds it: it names its page, and its close event never fires.
type graphPageWindow struct {
	application.Window
	id     uint
	client string
}

func (w *graphPageWindow) ID() uint         { return w.id }
func (w *graphPageWindow) ClientID() string { return w.client }
func (w *graphPageWindow) OnWindowEvent(events.WindowEventType, func(*application.WindowEvent)) func() {
	return func() {}
}

type graphPages struct {
	mu   sync.Mutex
	open map[string]bool
}

func (p *graphPages) set(client string, connected bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.open[client] = connected
}
func (p *graphPages) connected(client string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.open[client]
}

func graphPageFixture() (*GraphService, *graphPages) {
	pages := &graphPages{open: map[string]bool{}}
	realm := invocation.NewWindowRealm(nil, invocation.WithPageSweep(pages.connected, 5*time.Millisecond))
	return &GraphService{realm: realm}, pages
}

func graphWindowCount(service *GraphService) int {
	service.mu.Lock()
	defer service.mu.Unlock()
	return len(service.windows)
}

func openGraphPage(service *GraphService, pages *graphPages, id uint) (*graphPageWindow, *graphWindow, error) {
	window := &graphPageWindow{id: id, client: "page-" + strconv.FormatUint(uint64(id), 10)}
	pages.set(window.client, true)
	_, session, _, err := service.graphWindow(context.WithValue(context.Background(), application.WindowKey, window))
	return window, session, err
}

// B-86: the graph registry held 64 windows and released one only on the window's close event, which a server-mode page never fires.
func TestGraphWindowsAreReleasedWhenAServerModePageCloses(t *testing.T) {
	service, pages := graphPageFixture()
	for id := uint(1); id <= 65; id++ {
		window, session, err := openGraphPage(service, pages, id)
		require.NoError(t, err, "page %d was refused a graph window", id)
		pages.set(window.client, false)
		require.Eventually(t, func() bool { return graphWindowCount(service) == 0 }, 10*time.Second, time.Millisecond,
			"the graph window of page %d outlived its page", id)
		// The slot is freed, then the lifetime is cancelled: wait for the second as well.
		require.Eventually(t, func() bool { return session.ctx.Err() != nil }, 10*time.Second, time.Millisecond, "a retired window's observations are cancelled")
	}
}

func TestGraphWindowLimitIsForLivePagesAndAnswersWithALimitCode(t *testing.T) {
	service, pages := graphPageFixture()
	for id := uint(1); id <= 64; id++ {
		_, _, err := openGraphPage(service, pages, id)
		require.NoError(t, err)
	}
	_, _, err := openGraphPage(service, pages, 65)
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	require.Equal(t, "RESOURCE_LIMIT", app.Code)
	require.ErrorIs(t, err, invocation.ErrWindowLimit)
	require.Equal(t, 64, graphWindowCount(service), "a refused window takes no registry slot")

	pages.set("page-1", false)
	require.Eventually(t, func() bool {
		_, _, retry := openGraphPage(service, pages, 65)
		return retry == nil
	}, 10*time.Second, 5*time.Millisecond, "a freed slot was not given to the waiting page")
}

func TestGraphWindowOfARetiredPageIsNotRecreated(t *testing.T) {
	service, pages := graphPageFixture()
	window, _, err := openGraphPage(service, pages, 1)
	require.NoError(t, err)
	pages.set(window.client, false)
	require.Eventually(t, func() bool { return graphWindowCount(service) == 0 }, 10*time.Second, time.Millisecond)
	_, _, _, err = service.graphWindow(context.WithValue(context.Background(), application.WindowKey, window))
	require.Error(t, err)
	require.NotErrorIs(t, err, invocation.ErrWindowLimit)
	require.Equal(t, 0, graphWindowCount(service))
}
