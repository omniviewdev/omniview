package invocation

import (
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// pageWindow is a server-mode window as Wails builds it: the page it serves is named by the runtime's client id,
// and its close event never fires (BrowserWindow.OnWindowEvent is a no-op that returns a no-op).
type pageWindow struct {
	realmWindow
	client string
}

func (w *pageWindow) ClientID() string { return w.client }
func (w *pageWindow) OnWindowEvent(events.WindowEventType, func(*application.WindowEvent)) func() {
	return func() {}
}

// pageSockets stands for Wails' registry of connected pages: a client id is in it while its events socket is open.
type pageSockets struct {
	mu   sync.Mutex
	open map[string]bool
}

func newPageSockets() *pageSockets { return &pageSockets{mu: sync.Mutex{}, open: map[string]bool{}} }
func (p *pageSockets) connect(client string) {
	p.mu.Lock()
	p.open[client] = true
	p.mu.Unlock()
}
func (p *pageSockets) drop(client string) {
	p.mu.Lock()
	delete(p.open, client)
	p.mu.Unlock()
}
func (p *pageSockets) connected(client string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.open[client]
}

// retirements records the owners the realm retired, as the source coordinator's RetireSourceOwner receives them.
type retirements struct {
	mu     sync.Mutex
	owners []string
}

func (r *retirements) retire(owner string) {
	r.mu.Lock()
	r.owners = append(r.owners, owner)
	r.mu.Unlock()
}
func (r *retirements) all() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.owners...)
}

// pageRealm is a realm whose pages are the fake registry's. A test that steps the sweep itself gives it an interval too long to fire (an hour), so that the realm's own timer never adds a sweep of its own.
func pageRealm(t *testing.T, every time.Duration) (*WindowRealm, *pageSockets, *retirements) {
	t.Helper()
	sockets, retired := newPageSockets(), &retirements{mu: sync.Mutex{}, owners: nil}
	realm := NewWindowRealm(retired.retire)
	realm.connected = sockets.connected
	realm.every = every
	return realm, sockets, retired
}

const stepped = time.Hour

func openPage(t *testing.T, realm *WindowRealm, sockets *pageSockets, id uint) (*pageWindow, *Scope) {
	t.Helper()
	window := &pageWindow{realmWindow: realmWindow{Window: nil, id: id, onClose: nil}, client: "page-" + strconv.FormatUint(uint64(id), 10)}
	sockets.connect(window.client)
	scope := realm.ScopeForWindow(window)
	require.NotNil(t, scope, "page %d was refused a scope", id)
	return window, scope
}

func scopeCount(realm *WindowRealm) int {
	realm.mu.Lock()
	defer realm.mu.Unlock()
	return len(realm.scopes)
}

func TestWindowRealmRefusesChangedBrowserClientWithoutEvictingLivePage(t *testing.T) {
	realm, sockets, retired := pageRealm(t, stepped)
	window, original := openPage(t, realm, sockets, 7)
	foreign := &pageWindow{realmWindow: realmWindow{id: window.ID()}, client: "different-client"}
	sockets.connect(foreign.client)
	refused, err := realm.AdmitWindow(foreign)
	require.ErrorIs(t, err, ErrWindowUnavailable)
	require.Nil(t, refused)
	require.Same(t, original, realm.ScopeForWindow(window))
	require.Equal(t, 1, scopeCount(realm))
	require.Empty(t, retired.all())
	sockets.drop(window.client)
	realm.sweep()
	realm.sweep()
	require.Equal(t, []string{original.Principal().Owner()}, retired.all())
}

// The stall of INV2: a host that served 64 pages refused the 65th and every one after it, because a page that closes in server mode
// never announced it (stock Wails' BrowserWindow.OnWindowEvent does nothing) and its scope was never released.
func TestWindowRealmServesEveryPageOpenedAndClosedOneAfterAnother(t *testing.T) {
	realm, sockets, retired := pageRealm(t, stepped)
	owners := map[string]bool{}
	for id := uint(1); id <= 300; id++ {
		// openPage fails the test when the realm refuses the page: the host that stopped answering at the 65th.
		window, scope := openPage(t, realm, sockets, id)
		owners[scope.Principal().Owner()] = true
		sockets.drop(window.client)
		// Two sweeps find the page gone twice, which is what retires it (a socket that drops and comes back is not a page that closed).
		realm.sweep()
		realm.sweep()
	}
	require.Len(t, owners, 300)
	require.Zero(t, scopeCount(realm), "the realm still holds the scopes of pages that closed")
	require.ElementsMatch(t, keys(owners), retired.all(), "every closed page's owner is retired exactly once")
}

func keys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	return out
}

func TestWindowRealmKeepsALivePageAndForgivesASocketThatDropsAndReturns(t *testing.T) {
	realm, sockets, retired := pageRealm(t, stepped)
	window, scope := openPage(t, realm, sockets, 1)
	for range 10 {
		realm.sweep()
	}
	require.Same(t, scope, realm.ScopeForWindow(window), "a connected page keeps its scope")

	// One sweep misses the page (its socket was down when the sweep looked), the next finds it back: it is still the same page, and the
	// absence is forgiven, not kept: a second blip after the page came back is one absence again, not the second.
	for range 3 {
		sockets.drop(window.client)
		realm.sweep()
		sockets.connect(window.client)
		realm.sweep()
	}
	require.Same(t, scope, realm.ScopeForWindow(window), "a socket that returned before the second sweep did not retire the page")
	require.Empty(t, retired.all())

	// Gone for as many sweeps in a row as the realm waits: retired, once, and its identity is never granted again.
	sockets.drop(window.client)
	for range 5 {
		realm.sweep()
	}
	require.Equal(t, []string{scope.Principal().Owner()}, retired.all())
	require.Nil(t, realm.ScopeForWindow(window))
}

// A page whose socket reconnects is the same page under a new window: its old window's scope stays until the page itself is gone.
func TestWindowRealmRetiresEveryWindowOfAPageWhenThePageIsGone(t *testing.T) {
	realm, sockets, retired := pageRealm(t, stepped)
	first, firstScope := openPage(t, realm, sockets, 1)
	second := &pageWindow{realmWindow: realmWindow{Window: nil, id: 2, onClose: nil}, client: first.client}
	secondScope := realm.ScopeForWindow(second)
	require.NotNil(t, secondScope)
	require.NotSame(t, firstScope, secondScope)
	for range 10 {
		realm.sweep()
	}
	require.Empty(t, retired.all(), "the page is still connected under its new window")

	sockets.drop(first.client)
	realm.sweep()
	realm.sweep()
	require.ElementsMatch(t, []string{firstScope.Principal().Owner(), secondScope.Principal().Owner()}, retired.all())
	require.Zero(t, scopeCount(realm))
}

func TestWindowRealmSweepsOnItsOwnAndStopsWhenNoPageIsLeft(t *testing.T) {
	realm, sockets, retired := pageRealm(t, 5*time.Millisecond)
	window, scope := openPage(t, realm, sockets, 1)
	sockets.drop(window.client)
	require.Eventually(t, func() bool { return len(retired.all()) == 1 }, 5*time.Second, 5*time.Millisecond, "nothing swept a page that closed")
	require.Equal(t, scope.Principal().Owner(), retired.all()[0])
	require.Eventually(t, func() bool {
		realm.mu.Lock()
		defer realm.mu.Unlock()
		return realm.sweeper == nil
	}, 5*time.Second, 5*time.Millisecond, "the sweep keeps running with no page to look at")

	// A page that comes after the sweep stopped starts it again.
	next, _ := openPage(t, realm, sockets, 2)
	sockets.drop(next.client)
	require.Eventually(t, func() bool { return len(retired.all()) == 2 }, 5*time.Second, 5*time.Millisecond, "the sweep did not start again for a new page")
}

// A native window announces its close itself: the sweep never looks at it, whatever the registry of pages says.
func TestWindowRealmSweepLeavesNativeWindowsToTheirCloseEvent(t *testing.T) {
	realm, _, retired := pageRealm(t, stepped)
	native := &realmWindow{Window: nil, id: 1, onClose: nil}
	scope := realm.ScopeForWindow(native)
	require.NotNil(t, scope)
	for range 10 {
		realm.sweep()
	}
	require.Same(t, scope, realm.ScopeForWindow(native))
	require.Empty(t, retired.all())
	native.onClose(nil)
	require.Equal(t, []string{scope.Principal().Owner()}, retired.all())
	require.Nil(t, realm.ScopeForWindow(native))
}

func TestWindowRealmSweepRacesWithNewPages(t *testing.T) {
	realm, sockets, _ := pageRealm(t, 5*time.Millisecond)
	var group sync.WaitGroup
	for worker := uint(0); worker < 8; worker++ {
		group.Add(1)
		go func(worker uint) {
			defer group.Done()
			for index := uint(0); index < 100; index++ {
				id := worker*1000 + index + 1
				window := &pageWindow{realmWindow: realmWindow{Window: nil, id: id, onClose: nil}, client: "race-" + strconv.FormatUint(uint64(id), 10)}
				sockets.connect(window.client)
				realm.ScopeForWindow(window)
				sockets.drop(window.client)
				realm.sweep()
			}
		}(worker)
	}
	group.Wait()
	require.Eventually(t, func() bool { return scopeCount(realm) == 0 }, 10*time.Second, 5*time.Millisecond, "pages that closed were left in the realm")
}
