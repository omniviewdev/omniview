package invocation

import (
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// B-108 (#698 item 1): 6 pages whose shells ignore SIGHUP were gone at 4.8, 6.4, 8.0, 9.1, 10.7 and 12.3 s, because the realm retired one window
// after another and each retirement waits for its shells' close ladder. These tests count without a clock: a retirement's "grace" is a gate that
// the test opens only after it has seen every window begin to retire (the CLOSE events), so a realm that retires the windows in line never gets
// there. The bounded wait below fails only when an event that must come does not; it is never the thing being measured.
const retireEventWait = 5 * time.Second

// graceGate stands for the close ladder of a window whose shells ignore SIGHUP: hold announces that a window began to retire (its CLOSE event),
// then waits for the grace to pass, which the test decides.
type graceGate struct {
	entered chan string
	grace   chan struct{}
	once    sync.Once
}

func newGraceGate() *graceGate {
	return &graceGate{entered: make(chan string, 64), grace: make(chan struct{}), once: sync.Once{}}
}

func (g *graceGate) hold(name string) {
	g.entered <- name
	<-g.grace
}

func (g *graceGate) pass() { g.once.Do(func() { close(g.grace) }) }

// awaitEntered collects the names of the n windows that began to retire, or fails with what it saw.
func (g *graceGate) awaitEntered(t *testing.T, n int, what string) map[string]bool {
	t.Helper()
	seen := map[string]bool{}
	for len(seen) < n {
		select {
		case name := <-g.entered:
			seen[name] = true
		case <-time.After(retireEventWait):
			t.Fatalf("%s: %d of %d began to retire while the first still held its grace; the rest wait for it", what, len(seen), n)
		}
	}
	return seen
}

func awaitClosed(t *testing.T, done <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(retireEventWait):
		t.Fatalf("%s never returned", what)
	}
}

// sweepAway drops every page's socket and steps the sweep until the pages are retired, in the background.
func sweepAway(realm *WindowRealm, sockets *pageSockets, pages []*pageWindow) <-chan struct{} {
	for _, page := range pages {
		sockets.drop(page.client)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range pageSweepAbsences {
			realm.sweep()
		}
	}()
	return done
}

func openPages(t *testing.T, realm *WindowRealm, sockets *pageSockets, n int) []*pageWindow {
	t.Helper()
	pages := make([]*pageWindow, 0, n)
	for id := 1; id <= n; id++ {
		page, _ := openPage(t, realm, sockets, uint(id))
		pages = append(pages, page)
	}
	return pages
}

func TestSixPagesAreRetiredInTheTimeOfOneLadder(t *testing.T) {
	const pages = 6
	for _, stage := range []string{"source owner", "subscriber"} {
		t.Run(stage, func(t *testing.T) {
			gate := newGraceGate()
			sockets := newPageSockets()
			var realm *WindowRealm
			if stage == "source owner" {
				realm = NewWindowRealm(gate.hold)
			} else {
				realm = NewWindowRealm(nil)
				realm.OnRetire(func(key WindowIdentity) { gate.hold(string(rune('a' + key.id))) })
			}
			realm.connected, realm.every = sockets.connected, stepped
			opened := openPages(t, realm, sockets, pages)
			done := sweepAway(realm, sockets, opened)
			t.Cleanup(func() { gate.pass(); <-done })

			seen := gate.awaitEntered(t, pages, "all "+stage+" retirements must begin before any grace passes")
			require.Len(t, seen, pages, "every page retired exactly once")
			gate.pass()
			awaitClosed(t, done, "the sweep")
		})
	}
}

func TestEverySubscriberHearsOfAClosingWindowWhileTheOthersStillWork(t *testing.T) {
	const subscribers = 6
	gate := newGraceGate()
	realm := NewWindowRealm(nil)
	for index := range subscribers {
		realm.OnRetire(func(WindowIdentity) { gate.hold(string(rune('a' + index))) })
	}
	window := &realmWindow{Window: nil, id: 1, onClose: nil}
	require.NotNil(t, realm.ScopeForWindow(window))
	done := make(chan struct{})
	go func() { defer close(done); window.onClose(nil) }()
	t.Cleanup(func() { gate.pass(); <-done })

	seen := gate.awaitEntered(t, subscribers, "all subscribers of one announce must begin before any grace passes")
	require.Len(t, seen, subscribers)
	gate.pass()
	awaitClosed(t, done, "the close event")
}

// The order the realm documents survives the concurrency: for each window the source owner is retired first, and the subscribers hear of the
// window only then, with the window already refused. The owner of every window waits for every other window's owner to begin: while they all
// wait, no subscriber may have started.
func TestTheSourceOwnerOfEveryWindowIsRetiredBeforeItsSubscribersHear(t *testing.T) {
	const pages = 6
	gate := newGraceGate()
	sockets := newPageSockets()
	var mu sync.Mutex
	var owners, heard []string
	realm := NewWindowRealm(func(owner string) {
		mu.Lock()
		owners = append(owners, owner)
		mu.Unlock()
		gate.hold(owner)
	})
	realm.connected, realm.every = sockets.connected, stepped
	opened := openPages(t, realm, sockets, pages)
	refused := make(chan bool, pages)
	realm.OnRetire(func(key WindowIdentity) {
		mu.Lock()
		heard = append(heard, string(rune('a'+key.id)))
		mu.Unlock()
		for _, page := range opened {
			if IdentityOf(page) == key {
				refused <- realm.ScopeForWindow(page) == nil
			}
		}
	})
	done := sweepAway(realm, sockets, opened)
	t.Cleanup(func() { gate.pass(); <-done })

	gate.awaitEntered(t, pages, "every source owner must begin to retire")
	mu.Lock()
	early := len(heard)
	mu.Unlock()
	require.Zero(t, early, "a subscriber heard of a window before the source owners were retired")
	gate.pass()
	awaitClosed(t, done, "the sweep")
	require.Len(t, owners, pages)
	require.Len(t, heard, pages, "every window reached the subscriber")
	for range pages {
		require.True(t, <-refused, "the window is already refused when the subscribers hear of it")
	}
}

// A subscriber that fails does not hide the others: every window's retirement runs to its end, and the failure reaches the caller of the
// sweep after that. (A subscriber has no error to return: a panic is its only failure, and it was never swallowed.)
func TestAFailingRetirementDoesNotHideTheResultOfAnother(t *testing.T) {
	const pages = 6
	gate := newGraceGate()
	sockets := newPageSockets()
	realm := NewWindowRealm(nil)
	realm.connected, realm.every = sockets.connected, stepped
	opened := openPages(t, realm, sockets, pages)
	var mu sync.Mutex
	finished := map[uint]bool{}
	realm.OnRetire(func(key WindowIdentity) {
		gate.hold(string(rune('a' + key.id)))
		if key.id == 3 {
			panic("window 3 failed to retire")
		}
		mu.Lock()
		finished[key.id] = true
		mu.Unlock()
	})
	for _, page := range opened {
		sockets.drop(page.client)
	}
	recovered := make(chan any, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer func() { recovered <- recover() }()
		for range pageSweepAbsences {
			realm.sweep()
		}
	}()
	t.Cleanup(func() { gate.pass(); <-done })

	gate.awaitEntered(t, pages, "every window must begin to retire")
	gate.pass()
	awaitClosed(t, done, "the sweep")
	require.Equal(t, "window 3 failed to retire", <-recovered, "the failure reaches the sweep's caller")
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, finished, pages-1, "the other windows finished their retirement")
}

// The sweep and the close event return when the retirements are over, and leave no goroutine behind.
func TestRetiringWindowsLeavesNoGoroutineBehind(t *testing.T) {
	const pages = 6
	sockets := newPageSockets()
	var mu sync.Mutex
	finished := 0
	realm := NewWindowRealm(func(string) {})
	realm.OnRetire(func(WindowIdentity) {
		mu.Lock()
		finished++
		mu.Unlock()
	})
	realm.connected, realm.every = sockets.connected, stepped
	opened := openPages(t, realm, sockets, pages)
	before := runtime.NumGoroutine()
	awaitClosed(t, sweepAway(realm, sockets, opened), "the sweep")
	mu.Lock()
	require.Equal(t, pages, finished, "the sweep returned before the retirements were over")
	mu.Unlock()
	// Polled here, not by require.Eventually: its condition runs in a goroutine of its own, which this count would include.
	deadline := time.Now().Add(retireEventWait)
	for runtime.NumGoroutine() > before {
		if time.Now().After(deadline) {
			t.Fatalf("goroutines left behind by the retirements: %d, were %d", runtime.NumGoroutine(), before)
		}
		time.Sleep(time.Millisecond)
	}
}
