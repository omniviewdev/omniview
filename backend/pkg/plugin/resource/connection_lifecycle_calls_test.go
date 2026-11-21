package resource

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	// callTimeout bounds every operation that has to finish and every wait for a
	// signal, so that a broken implementation fails the test instead of hanging it.
	callTimeout = 5 * time.Second
	// settleWindow is how long an operation that has to wait may stay unfinished
	// before the test counts it as waiting. It can only fail an implementation
	// that lets the operation through: a correct one is blocked until the test
	// releases it, whatever the machine speed.
	settleWindow = 50 * time.Millisecond
)

// callScope runs the operations of one test and parks the fake provider's calls
// in named holds until the test releases them. When the test ends, even by
// failing, it releases every hold and waits for every operation, so that no
// operation outlives the controller the test built. A leaked operation panics
// in the torn-down state service ("assignment to entry in nil map") and takes
// the whole test binary down instead of failing its own test. Create it
// right after the fixture, so that it is cleaned up before the fixture.
type callScope struct {
	t       *testing.T
	mu      sync.Mutex
	holds   map[string]*providerHold
	running []<-chan struct{}
}

func newCallScope(t *testing.T) *callScope {
	t.Helper()
	scope := &callScope{t: t, holds: make(map[string]*providerHold)}
	t.Cleanup(scope.finish)
	return scope
}

// track registers an operation; the returned func marks it finished.
func (s *callScope) track() func() {
	done := make(chan struct{})
	s.mu.Lock()
	s.running = append(s.running, done)
	s.mu.Unlock()
	return func() { close(done) }
}

// goCall runs call on its own goroutine and returns its result channel.
func (s *callScope) goCall(call func() error) <-chan error {
	finished := s.track()
	done := make(chan error, 1)
	go func() {
		defer finished()
		done <- call()
	}()
	return done
}

// hold returns the named hold, creating it on first use.
func (s *callScope) hold(name string) *providerHold {
	s.mu.Lock()
	defer s.mu.Unlock()
	hold, ok := s.holds[name]
	if !ok {
		hold = newProviderHold()
		s.holds[name] = hold
	}
	return hold
}

// entered closes once the named call is inside the provider.
func (s *callScope) entered(name string) <-chan struct{} { return s.hold(name).entered }

func (s *callScope) release(name string) { s.hold(name).releaseRPC() }

func (s *callScope) finish() {
	// A probe that waits for a call that never ends stops at its own deadline,
	// which is twice callTimeout at most. Only a failing test waits that long.
	deadline := time.NewTimer(3 * callTimeout)
	defer deadline.Stop()
	// An operation can start more operations and holds while it winds down, so
	// the lists are read again after each one.
	for i := 0; ; i++ {
		s.mu.Lock()
		for _, hold := range s.holds {
			hold.releaseRPC()
		}
		if i >= len(s.running) {
			s.mu.Unlock()
			return
		}
		finished := s.running[i]
		s.mu.Unlock()
		select {
		case <-finished:
		case <-deadline.C:
			return
		}
	}
}

// The scope ends every operation of its test before the fixture is torn down,
// including the operation that an operation starts while it winds down, once it
// has released the holds. An operation that outlives its test panics the whole
// test binary.
func TestCallScopeEndsEveryOperationBeforeItsTestEnds(t *testing.T) {
	var first, nested atomic.Bool
	t.Run("test with parked operations", func(t *testing.T) {
		scope := newCallScope(t)
		hold := scope.hold("parked")
		scope.goCall(func() error {
			hold.wait(context.Background())
			scope.goCall(func() error {
				time.Sleep(3 * settleWindow)
				nested.Store(true)
				return nil
			})
			time.Sleep(settleWindow)
			first.Store(true)
			return nil
		})
		awaitSignal(t, hold.entered, "the operation to park")
	})
	require.True(t, first.Load(), "the scope did not release the holds and wait for the operation")
	require.True(t, nested.Load(), "the scope did not wait for the operation that the first one started")
}

// awaitDone waits for an operation that must finish by itself.
func awaitDone(t *testing.T, done <-chan error, what string) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(callTimeout):
		t.Fatalf("%s did not finish within %s", what, callTimeout)
		return nil
	}
}

// requireStillWaiting fails when an operation that must wait finishes anyway.
func requireStillWaiting(t *testing.T, done <-chan error, what string) {
	t.Helper()
	select {
	case err := <-done:
		t.Fatalf("%s finished (error: %v) while it had to wait", what, err)
	case <-time.After(settleWindow):
	}
}

func awaitSignal(t *testing.T, signal <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(callTimeout):
		t.Fatalf("%s did not happen within %s", what, callTimeout)
	}
}

// callWithin runs call and reports through the test, from any goroutine, when it
// does not return in time. The first result tells whether it returned.
func (s *callScope) callWithin(what string, call func() error) (bool, error) {
	s.t.Helper()
	done := s.goCall(call)
	select {
	case err := <-done:
		return true, err
	case <-time.After(callTimeout):
		s.t.Errorf("%s did not return within %s", what, callTimeout)
		return false, nil
	}
}

// callLog records the order in which fake provider calls happen.
type callLog struct {
	mu      sync.Mutex
	entries []string
}

func (l *callLog) add(entry string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, entry)
}

func (l *callLog) snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.entries...)
}

// hookPairs is a connection change hook that counts overlapping begin/release
// pairs per connection.
type hookPairs struct {
	mu     sync.Mutex
	active map[string]int
	peak   map[string]int
}

func newHookPairs() *hookPairs {
	return &hookPairs{active: make(map[string]int), peak: make(map[string]int)}
}

func (h *hookPairs) begin(_, connection string) func() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.active[connection]++
	h.peak[connection] = max(h.peak[connection], h.active[connection])
	return func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.active[connection]--
	}
}

func (h *hookPairs) peakFor(connection string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.peak[connection]
}

// lifecycleCallFixture registers plugin "p1" with a provider that supports
// connection lifecycle, and loads its connections.
func lifecycleCallFixture(t *testing.T) (*controller, *recordingEmitter, *mockProvider) {
	t.Helper()
	ctrl, emitter := newTestControllerWithEmitter(t)
	provider := lockScopeProvider("p1-native")
	registerMockPlugin(ctrl, "p1", provider)
	_, err := ctrl.LoadConnections(testInvocationContext(), "p1")
	require.NoError(t, err)
	return ctrl, emitter, provider
}

func startCall(ctrl *controller, plugin, connection string) func() error {
	return func() error {
		_, err := ctrl.StartConnection(testInvocationContext(), plugin, connection)
		return err
	}
}

func stopCall(ctrl *controller, plugin, connection string) func() error {
	return func() error {
		_, err := ctrl.StopConnection(testInvocationContext(), plugin, connection)
		return err
	}
}

func saveCall(ctrl *controller, plugin string, connection types.Connection) func() error {
	return func() error {
		_, err := ctrl.SaveConnectionProfile(testInvocationContext(), plugin, connection, nil)
		return err
	}
}

func cachedConnection(t *testing.T, ctrl *controller, plugin, id string) types.Connection {
	t.Helper()
	listed, err := ctrl.ListConnections(testInvocationContext(), plugin)
	require.NoError(t, err)
	for _, connection := range listed {
		if connection.ID == id {
			return connection
		}
	}
	t.Fatalf("connection %q is not cached for plugin %q", id, plugin)
	return types.Connection{}
}

func connectionStarted(ctrl *controller, plugin, id string) bool {
	for _, connection := range ctrl.BorrowableConnections(plugin) {
		if connection.ID == id {
			return connection.Started
		}
	}
	return false
}

func requireProfilesMuFree(t *testing.T, ctrl *controller) {
	t.Helper()
	require.True(t, ctrl.profilesMu.TryLock(), "profilesMu is held although no operation is running")
	ctrl.profilesMu.Unlock()
}

// A start that waits inside the provider must not hold up the start or stop of
// any other connection, of this plugin or of another one.
func TestStartOfOtherConnectionProceedsWhileOneStartIsInFlight(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	registerMockPlugin(ctrl, "p2", lockScopeProvider("p2-native"))
	hold := scope.hold("hold")
	p1.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		if id == "slow" {
			hold.wait(ctx)
		}
		return lockScopeConnected(id), nil
	}
	slow := scope.goCall(startCall(ctrl, "p1", "slow"))
	awaitSignal(t, hold.entered, "the slow start to reach the provider")

	probes := []struct {
		name string
		call func() error
	}{
		{"StartConnection(p1, other)", startCall(ctrl, "p1", "other")},
		{"StopConnection(p1, other)", stopCall(ctrl, "p1", "other")},
		{"StartConnection(p2, slow)", startCall(ctrl, "p2", "slow")},
		{"StopConnection(p2, other)", stopCall(ctrl, "p2", "other")},
	}
	for _, probe := range probes {
		finished, err := scope.callWithin(probe.name+" while StartConnection(p1, slow) is in flight", probe.call)
		if !finished {
			t.FailNow()
		}
		require.NoError(t, err, probe.name)
	}
	select {
	case err := <-slow:
		t.Fatalf("the slow start finished (error: %v) before it was released, so the probes did not run beside it", err)
	default:
	}
	hold.releaseRPC()
	require.NoError(t, awaitDone(t, slow, "the slow start"))
}

// Many starts of different connections run inside the provider together. The
// provider only answers once all of them are in, so a serialized host fails.
func TestStartsOfDifferentConnectionsRunConcurrentlyAndEachPublishItsState(t *testing.T) {
	const connections = 4
	ctrl, _, provider := lifecycleCallFixture(t)
	scope := newCallScope(t)
	var arrived atomic.Int32
	var serialized atomic.Bool
	allIn := make(chan struct{})
	provider.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		if serialized.Load() {
			return types.ConnectionStatus{}, errors.New("starts ran one at a time")
		}
		if arrived.Add(1) == connections {
			close(allIn)
		}
		select {
		case <-allIn:
			return lockScopeConnected(id), nil
		case <-time.After(callTimeout):
			serialized.Store(true)
			return types.ConnectionStatus{}, errors.New("starts ran one at a time")
		}
	}
	calls := make([]<-chan error, 0, connections)
	for i := range connections {
		calls = append(calls, scope.goCall(startCall(ctrl, "p1", fmt.Sprintf("conn-%d", i))))
	}
	for i, call := range calls {
		require.NoError(t, awaitDone(t, call, fmt.Sprintf("start %d", i)))
	}
	for i := range connections {
		id := fmt.Sprintf("conn-%d", i)
		require.False(t, cachedConnection(t, ctrl, "p1", id).LastRefresh.IsZero(), "%s keeps its connected stamp", id)
		require.True(t, connectionStarted(ctrl, "p1", id), "%s is recorded as started", id)
	}
}

// A provider calls back into the host while its start runs: it reads the stored
// profile of its connection, and it may start or stop other connections or reach
// another plugin. Each of these host paths takes profilesMu. They are called
// here synchronously from inside provider.StartConnection of the connection
// "lease" of p1, with a fresh host context like a callback served from the
// plugin process would have, and must return.
//
// It covers exactly ListConnectionProfiles(p1), StartConnection(p1, other),
// StopConnection(p1, other), SaveConnectionProfile(p2) and LoadConnections(p2).
// It does not cover the paths that wait for the calls of p1 itself, which would
// wait for this very start: connection_call_reentry_test.go covers those, and
// the lock scope test observes them.
func TestHostPathsThatNeedProfilesMuReturnFromInsideProviderStart(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	registerMockPlugin(ctrl, "p2", lockScopeProvider("p2-native"))
	token := "stored-credential"
	_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "p1",
		profileTestConnection("lease", "endpoint"), &ConnectionProfileCredentials{Token: &token})
	require.NoError(t, err)

	var listed []ConnectionProfile
	callbacks := []struct {
		name string
		call func() error
	}{
		{"ListConnectionProfiles(p1)", func() error {
			var listErr error
			listed, listErr = ctrl.ListConnectionProfiles(testInvocationContext(), "p1")
			return listErr
		}},
		{"StartConnection(p1, other)", startCall(ctrl, "p1", "other")},
		{"StopConnection(p1, other)", stopCall(ctrl, "p1", "other")},
		{"SaveConnectionProfile(p2)", saveCall(ctrl, "p2", profileTestConnection("p2-save", "endpoint"))},
		{"LoadConnections(p2)", func() error {
			_, loadErr := ctrl.LoadConnections(testInvocationContext(), "p2")
			return loadErr
		}},
	}
	var failures []error
	p1.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		if id != "lease" {
			return lockScopeConnected(id), nil
		}
		for _, callback := range callbacks {
			finished, callbackErr := scope.callWithin(callback.name+" from inside provider.StartConnection", callback.call)
			if !finished {
				return types.ConnectionStatus{}, errors.New("a host callback did not return")
			}
			if callbackErr != nil {
				failures = append(failures, fmt.Errorf("%s: %w", callback.name, callbackErr))
			}
		}
		return lockScopeConnected(id), nil
	}
	require.NoError(t, awaitDone(t, scope.goCall(startCall(ctrl, "p1", "lease")), "StartConnection(p1, lease)"))
	require.Empty(t, failures)
	var profile *ConnectionProfile
	for i := range listed {
		if listed[i].ID == "lease" {
			profile = &listed[i]
		}
	}
	require.NotNil(t, profile, "the stored profile is returned to the callback")
	require.Nil(t, profile.Connection.GetSensitiveData(), "credentials never leave the host store")
}

// The catalog admission after a start is a plugin call as well.
func TestInFlightCatalogAdmissionDoesNotBlockUnrelatedHostOperations(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	registerMockPlugin(ctrl, "p2", lockScopeProvider("p2-native"))
	hold := scope.hold("hold")
	catalog := p1.CatalogFunc
	p1.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		if request.Route.Connection == "slow" {
			hold.wait(ctx)
		}
		return catalog(ctx, request)
	}
	slow := scope.goCall(startCall(ctrl, "p1", "slow"))
	awaitSignal(t, hold.entered, "the catalog admission of the slow start")

	probes := []struct {
		name string
		call func() error
	}{
		{"StartConnection(p1, other)", startCall(ctrl, "p1", "other")},
		{"StopConnection(p1, other)", stopCall(ctrl, "p1", "other")},
		{"StartConnection(p2)", startCall(ctrl, "p2", "other")},
		{"SaveConnectionProfile(p2)", saveCall(ctrl, "p2", profileTestConnection("p2-save", "endpoint"))},
		{"ListConnectionProfiles(p1)", func() error {
			_, err := ctrl.ListConnectionProfiles(testInvocationContext(), "p1")
			return err
		}},
	}
	for _, probe := range probes {
		finished, err := scope.callWithin(probe.name+" while the catalog admission of a start is in flight", probe.call)
		if !finished {
			t.FailNow()
		}
		require.NoError(t, err, probe.name)
	}
	hold.releaseRPC()
	require.NoError(t, awaitDone(t, slow, "the slow start"))
}

// Two starts of one connection were serialized by profilesMu. They still are,
// and both leave one correct cache entry behind.
func TestSameConnectionStartsStaySerialized(t *testing.T) {
	ctrl, emitter, provider := lifecycleCallFixture(t)
	scope := newCallScope(t)
	hooks := newHookPairs()
	ctrl.SetConnectionChangeHook(hooks.begin)
	hold := scope.hold("hold")
	var mu sync.Mutex
	var running, peak, providerCalls int
	provider.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		mu.Lock()
		running++
		peak = max(peak, running)
		providerCalls++
		first := providerCalls == 1
		mu.Unlock()
		defer func() {
			mu.Lock()
			running--
			mu.Unlock()
		}()
		if first {
			hold.wait(ctx)
		}
		return lockScopeConnected(id), nil
	}
	first := scope.goCall(startCall(ctrl, "p1", "same"))
	awaitSignal(t, hold.entered, "the first start to reach the provider")
	second := scope.goCall(startCall(ctrl, "p1", "same"))
	requireStillWaiting(t, second, "the second start of the same connection")
	mu.Lock()
	reached := providerCalls
	mu.Unlock()
	require.Equal(t, 1, reached, "the second start must not reach the provider while the first is in flight")

	hold.releaseRPC()
	require.NoError(t, awaitDone(t, first, "the first start"))
	require.NoError(t, awaitDone(t, second, "the second start"))
	mu.Lock()
	defer mu.Unlock()
	require.Equal(t, 2, providerCalls)
	require.Equal(t, 1, peak, "provider calls for one connection never overlap")
	require.Equal(t, 1, hooks.peakFor("same"), "connection change hook pairs for one connection never overlap")
	listed, err := ctrl.ListConnections(testInvocationContext(), "p1")
	require.NoError(t, err)
	entries := 0
	for _, connection := range listed {
		if connection.ID == "same" {
			entries++
			require.False(t, connection.LastRefresh.IsZero())
		}
	}
	require.Equal(t, 1, entries, "the connection has one cache entry")
	require.True(t, connectionStarted(ctrl, "p1", "same"))
	require.Len(t, emitter.EventsWithKey(EventConnectionStatus), 2)
}

// Starts and stops of one connection never overlap, whichever came first, and
// the later one wins. A start during a stop does not fail on the stop's fence,
// and two stops do not end each other's fence or hook pair.
func TestSameConnectionStartAndStopStayOrdered(t *testing.T) {
	t.Run("start during an in-flight stop", func(t *testing.T) {
		ctrl, _, provider := lifecycleCallFixture(t)
		scope := newCallScope(t)
		log := &callLog{}
		hold := scope.hold("hold")
		provider.StopConnectionFunc = func(ctx context.Context, id string) (types.Connection, error) {
			log.add("stop:enter")
			hold.wait(ctx)
			log.add("stop:exit")
			return types.Connection{ID: id, Name: id}, nil
		}
		provider.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
			log.add("start")
			return lockScopeConnected(id), nil
		}
		stop := scope.goCall(stopCall(ctrl, "p1", "route"))
		awaitSignal(t, hold.entered, "the stop to reach the provider")
		start := scope.goCall(startCall(ctrl, "p1", "route"))
		requireStillWaiting(t, start, "a start during an in-flight stop of the same connection")
		hold.releaseRPC()
		require.NoError(t, awaitDone(t, stop, "the stop"))
		require.NoError(t, awaitDone(t, start, "the start"))
		require.Equal(t, []string{"stop:enter", "stop:exit", "start"}, log.snapshot())
		require.True(t, connectionStarted(ctrl, "p1", "route"))
	})
	t.Run("stop during an in-flight start", func(t *testing.T) {
		ctrl, _, provider := lifecycleCallFixture(t)
		scope := newCallScope(t)
		log := &callLog{}
		hold := scope.hold("hold")
		provider.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
			log.add("start:enter")
			hold.wait(ctx)
			log.add("start:exit")
			return lockScopeConnected(id), nil
		}
		provider.StopConnectionFunc = func(_ context.Context, id string) (types.Connection, error) {
			log.add("stop")
			return types.Connection{ID: id, Name: id}, nil
		}
		start := scope.goCall(startCall(ctrl, "p1", "route"))
		awaitSignal(t, hold.entered, "the start to reach the provider")
		stop := scope.goCall(stopCall(ctrl, "p1", "route"))
		requireStillWaiting(t, stop, "a stop during an in-flight start of the same connection")
		hold.releaseRPC()
		require.NoError(t, awaitDone(t, start, "the start"))
		require.NoError(t, awaitDone(t, stop, "the stop"))
		require.Equal(t, []string{"start:enter", "start:exit", "stop"}, log.snapshot())
		require.False(t, connectionStarted(ctrl, "p1", "route"))
		require.True(t, cachedConnection(t, ctrl, "p1", "route").LastRefresh.IsZero(), "the stop's state is the last write")
	})
	t.Run("stop during an in-flight stop", func(t *testing.T) {
		ctrl, _, provider := lifecycleCallFixture(t)
		scope := newCallScope(t)
		hooks := newHookPairs()
		ctrl.SetConnectionChangeHook(hooks.begin)
		log := &callLog{}
		hold := scope.hold("hold")
		var stops atomic.Int32
		provider.StopConnectionFunc = func(ctx context.Context, id string) (types.Connection, error) {
			if stops.Add(1) == 1 {
				log.add("stop 1:enter")
				hold.wait(ctx)
				log.add("stop 1:exit")
			} else {
				log.add("stop 2")
			}
			return types.Connection{ID: id, Name: id}, nil
		}
		first := scope.goCall(stopCall(ctrl, "p1", "route"))
		awaitSignal(t, hold.entered, "the first stop to reach the provider")
		second := scope.goCall(stopCall(ctrl, "p1", "route"))
		requireStillWaiting(t, second, "a stop during an in-flight stop of the same connection")
		hold.releaseRPC()
		require.NoError(t, awaitDone(t, first, "the first stop"))
		require.NoError(t, awaitDone(t, second, "the second stop"))
		require.Equal(t, []string{"stop 1:enter", "stop 1:exit", "stop 2"}, log.snapshot())
		require.Equal(t, 1, hooks.peakFor("route"), "connection change hook pairs for one connection never overlap")
		ctrl.pluginsMu.RLock()
		fenced := ctrl.plugins["p1"].sourceChanging["route"]
		ctrl.pluginsMu.RUnlock()
		require.False(t, fenced, "no fence is left behind")
	})
}

// A display-only profile edit publishes without bumping any epoch. A start that
// began before it holds the old configuration and must not write it over the
// edit, so the edit has to wait for the start.
func TestProfileChangeWaitsForInFlightStartAndIsNotOverwrittenByIt(t *testing.T) {
	ctrl, _, provider := lifecycleCallFixture(t)
	scope := newCallScope(t)
	named := func(name string) types.Connection {
		connection := profileTestConnection("route", "endpoint")
		connection.Name = name
		return connection
	}
	require.NoError(t, saveCall(ctrl, "p1", named("old"))())
	hold := scope.hold("hold")
	var startInFlight, overlapped atomic.Bool
	provider.StartConnectionFunc = func(ctx context.Context, _ string) (types.ConnectionStatus, error) {
		snapshot := named("old") // what the provider held when the start began
		startInFlight.Store(true)
		defer startInFlight.Store(false)
		hold.wait(ctx)
		return types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &snapshot}, nil
	}
	provider.ApplyConnectionOverlayFunc = func(ctx context.Context, overlay resourcev2.ConnectionOverlay) error {
		if startInFlight.Load() {
			overlapped.Store(true)
		}
		return provider.applyConnectionOverlay(ctx, overlay)
	}
	start := scope.goCall(startCall(ctrl, "p1", "route"))
	awaitSignal(t, hold.entered, "the start to reach the provider")
	save := scope.goCall(saveCall(ctrl, "p1", named("new")))
	requireStillWaiting(t, save, "a profile edit during an in-flight start of the same plugin")

	hold.releaseRPC()
	require.NoError(t, awaitDone(t, start, "the start"))
	require.NoError(t, awaitDone(t, save, "the profile edit"))
	require.False(t, overlapped.Load(), "the overlay was applied while the start was in flight")
	require.Equal(t, "new", cachedConnection(t, ctrl, "p1", "route").Name, "the start overwrote the newer profile")
}

// A stop fences its route with a plain boolean and removes it when it ends. A
// profile transaction on the same route must not start under that fence, or the
// stop would end the transaction's fence while it is still applying.
func TestProfileChangeWaitsForInFlightStopAndKeepsItsOwnFence(t *testing.T) {
	ctrl, _, provider := lifecycleCallFixture(t)
	scope := newCallScope(t)
	require.NoError(t, saveCall(ctrl, "p1", profileTestConnection("route", "A"))())
	hooks := newHookPairs()
	ctrl.SetConnectionChangeHook(hooks.begin)
	hold := scope.hold("hold")
	provider.StopConnectionFunc = func(ctx context.Context, id string) (types.Connection, error) {
		hold.wait(ctx)
		return profileTestConnection(id, "A"), nil
	}
	var applyOnce, resumeOnce sync.Once
	applyEntered, applyResume := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() { resumeOnce.Do(func() { close(applyResume) }) })
	var fencedInApply atomic.Bool
	provider.ApplyConnectionOverlayFunc = func(ctx context.Context, overlay resourcev2.ConnectionOverlay) error {
		ctrl.pluginsMu.RLock()
		fencedInApply.Store(ctrl.plugins["p1"].sourceChanging["route"])
		ctrl.pluginsMu.RUnlock()
		applyOnce.Do(func() { close(applyEntered) })
		<-applyResume
		return provider.applyConnectionOverlay(ctx, overlay)
	}
	stop := scope.goCall(stopCall(ctrl, "p1", "route"))
	awaitSignal(t, hold.entered, "the stop to reach the provider")
	save := scope.goCall(saveCall(ctrl, "p1", profileTestConnection("route", "B")))
	requireStillWaiting(t, save, "a profile change during an in-flight stop of the same plugin")
	select {
	case <-applyEntered:
		t.Fatal("the overlay was applied while the stop was in flight")
	default:
	}

	hold.releaseRPC()
	require.NoError(t, awaitDone(t, stop, "the stop"))
	awaitSignal(t, applyEntered, "the profile change to apply its overlay")
	require.True(t, fencedInApply.Load(), "the route is fenced by the transaction while it applies")
	resumeOnce.Do(func() { close(applyResume) })
	require.NoError(t, awaitDone(t, save, "the profile change"))
	require.Equal(t, 1, hooks.peakFor("route"), "the stop's and the change's hook pairs never overlap")
	ctrl.pluginsMu.RLock()
	fenced := ctrl.plugins["p1"].sourceChanging["route"]
	ctrl.pluginsMu.RUnlock()
	require.False(t, fenced, "no fence is left behind")
}

// Discovery and the watch refresh publish the connection cache for the whole
// plugin, so they wait for an in-flight start of that plugin and no other.
func TestLoadAndWatchRefreshWaitForAnInFlightStartOfTheSamePlugin(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	registerMockPlugin(ctrl, "p2", lockScopeProvider("p2-native"))
	hold := scope.hold("hold")
	var discoveries atomic.Int32
	native := p1.NativeConnectionsFunc
	p1.NativeConnectionsFunc = func(ctx context.Context) ([]types.Connection, error) {
		discoveries.Add(1)
		return native(ctx)
	}
	p1.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		hold.wait(ctx)
		return lockScopeConnected(id), nil
	}
	ctrl.pluginsMu.RLock()
	generation := ctrl.plugins["p1"]
	ctrl.pluginsMu.RUnlock()
	start := scope.goCall(startCall(ctrl, "p1", "slow"))
	awaitSignal(t, hold.entered, "the start to reach the provider")
	before := discoveries.Load()

	load := scope.goCall(func() error {
		_, err := ctrl.LoadConnections(testInvocationContext(), "p1")
		return err
	})
	refresh := scope.goCall(func() error {
		_, err := ctrl.refreshWatchedConnections(testInvocationContext(), "p1", p1, generation)
		return err
	})
	requireStillWaiting(t, load, "LoadConnections during an in-flight start of the same plugin")
	requireStillWaiting(t, refresh, "a watch refresh during an in-flight start of the same plugin")
	require.Equal(t, before, discoveries.Load(), "discovery reached the provider during the start")
	finished, err := scope.callWithin("LoadConnections(p2) while a start of p1 is in flight", func() error {
		_, loadErr := ctrl.LoadConnections(testInvocationContext(), "p2")
		return loadErr
	})
	require.True(t, finished)
	require.NoError(t, err)

	hold.releaseRPC()
	require.NoError(t, awaitDone(t, start, "the start"))
	require.NoError(t, awaitDone(t, load, "LoadConnections"))
	require.NoError(t, awaitDone(t, refresh, "the watch refresh"))
}

// A caller queued behind a call on its connection, or a transaction queued
// behind a call of its plugin, leaves when its context ends and holds nothing.
func TestWaitingForAConnectionCallEndsWithItsContext(t *testing.T) {
	ctrl, _, provider := lifecycleCallFixture(t)
	scope := newCallScope(t)
	hold := scope.hold("hold")
	provider.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		hold.wait(ctx)
		return lockScopeConnected(id), nil
	}
	first := scope.goCall(startCall(ctrl, "p1", "slow"))
	awaitSignal(t, hold.entered, "the first start to reach the provider")
	startCtx, cancelStart := context.WithCancel(testInvocationContext())
	defer cancelStart()
	saveCtx, cancelSave := context.WithCancel(testInvocationContext())
	defer cancelSave()
	queuedStart := scope.goCall(func() error {
		_, err := ctrl.StartConnection(startCtx, "p1", "slow")
		return err
	})
	queuedSave := scope.goCall(func() error {
		_, err := ctrl.SaveConnectionProfile(saveCtx, "p1", profileTestConnection("route", "A"), nil)
		return err
	})
	requireStillWaiting(t, queuedStart, "a start queued behind a start of its connection")
	requireStillWaiting(t, queuedSave, "a profile change queued behind a start of its plugin")

	cancelStart()
	cancelSave()
	require.Equal(t, "CANCELLED", requireAppError(t, awaitDone(t, queuedStart, "the queued start")).Code)
	require.Equal(t, "CANCELLED", requireAppError(t, awaitDone(t, queuedSave, "the queued profile change")).Code)
	requireProfilesMuFree(t, ctrl)

	hold.releaseRPC()
	require.NoError(t, awaitDone(t, first, "the first start"))
	require.NoError(t, awaitDone(t, scope.goCall(startCall(ctrl, "p1", "slow")), "a later start of the same connection"))
}

// Every way a call can end releases its connection and profilesMu.
func TestFailedConnectionCallsReleaseTheirConnection(t *testing.T) {
	ctrl, _, provider := lifecycleCallFixture(t)
	scope := newCallScope(t)
	var starts, stops atomic.Int32
	provider.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		if starts.Add(1) == 1 {
			return types.ConnectionStatus{}, errors.New("start failed")
		}
		return lockScopeConnected(id), nil
	}
	provider.StopConnectionFunc = func(_ context.Context, id string) (types.Connection, error) {
		if stops.Add(1) == 1 {
			return types.Connection{}, errors.New("stop failed")
		}
		return types.Connection{ID: id, Name: id}, nil
	}
	run := func(name string, call func() error) error {
		finished, err := scope.callWithin(name, call)
		require.True(t, finished, name)
		requireProfilesMuFree(t, ctrl)
		return err
	}
	require.Error(t, run("first start", startCall(ctrl, "p1", "route")))
	require.NoError(t, run("second start", startCall(ctrl, "p1", "route")))
	require.Error(t, run("first stop", stopCall(ctrl, "p1", "route")))
	require.NoError(t, run("second stop", stopCall(ctrl, "p1", "route")))
	// The provider is never reached when the plugin is unknown.
	require.Error(t, run("start of an unknown plugin", startCall(ctrl, "late", "route")))
	registerMockPlugin(ctrl, "late", lockScopeProvider("late-native"))
	require.NoError(t, run("start once the plugin exists", startCall(ctrl, "late", "route")))
}

// A start whose plugin is replaced while it is in flight is rejected, and the
// next start of that connection runs once its call has returned.
func TestRetiredGenerationCallReleasesItsConnectionWhenItsRPCReturns(t *testing.T) {
	ctrl, _, old := lifecycleCallFixture(t)
	scope := newCallScope(t)
	hold := scope.hold("hold")
	old.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		hold.wait(ctx)
		return lockScopeConnected(id), nil
	}
	retired := scope.goCall(startCall(ctrl, "p1", "route"))
	awaitSignal(t, hold.entered, "the start to reach the provider")
	require.NoError(t, ctrl.OnPluginStop("p1", defaultMeta()))
	registerMockPlugin(ctrl, "p1", lockScopeProvider("p1-native"))
	successor := scope.goCall(startCall(ctrl, "p1", "route"))

	hold.releaseRPC()
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, awaitDone(t, retired, "the retired start")).Code)
	require.NoError(t, awaitDone(t, successor, "the start on the replacement"))
	require.True(t, connectionStarted(ctrl, "p1", "route"))
}

// The connection change hook field is guarded by profilesMu. A start or stop
// reads it before it releases the lock, and a transaction reads it inside the
// lock, so every begin of the hook runs while its caller holds profilesMu. A
// begin that runs without the lock reads the field unguarded.
func TestConnectionChangeHookBeginsUnderProfilesMu(t *testing.T) {
	ctrl, _, _ := lifecycleCallFixture(t)
	var begins, outside atomic.Int32
	ctrl.SetConnectionChangeHook(func(_, _ string) func() {
		begins.Add(1)
		if ctrl.profilesMu.TryLock() {
			ctrl.profilesMu.Unlock()
			outside.Add(1)
		}
		return func() {}
	})
	for _, operation := range []struct {
		name string
		call func() error
	}{
		{"StartConnection", startCall(ctrl, "p1", "route")},
		{"StopConnection", stopCall(ctrl, "p1", "route")},
		{"SaveConnectionProfile", saveCall(ctrl, "p1", profileTestConnection("route", "A"))},
	} {
		before := begins.Load()
		require.NoError(t, operation.call(), operation.name)
		require.Positive(t, begins.Load()-before, "%s never began the hook", operation.name)
		require.Zero(t, outside.Load(),
			"%s began the hook without profilesMu: the hook field is read outside its lock", operation.name)
	}
}

// A call ends its hook pair before it releases its connection, so the next call
// on the connection begins its pair only after the earlier one ended. The first
// call parks in its hook release, and the second call must stay in front of the
// connection and not begin.
func TestConnectionHookReleaseEndsBeforeTheNextCallOnTheConnectionBegins(t *testing.T) {
	for _, kind := range []string{"start", "stop"} {
		t.Run(kind, func(t *testing.T) {
			ctrl, _, _ := lifecycleCallFixture(t)
			scope := newCallScope(t)
			hold := scope.hold("hook release")
			var begins atomic.Int32
			ctrl.SetConnectionChangeHook(func(_, _ string) func() {
				begins.Add(1)
				return func() { hold.wait(context.Background()) }
			})
			call := startCall(ctrl, "p1", "route")
			if kind == "stop" {
				call = stopCall(ctrl, "p1", "route")
			}
			first := scope.goCall(call)
			awaitSignal(t, hold.entered, "the first call to reach its hook release")
			second := scope.goCall(call)
			requireStillWaiting(t, second, "a call on a connection whose earlier call is still in its hook release")
			require.EqualValues(t, 1, begins.Load(),
				"the second call began its hook pair while the first call's hook release had not returned")
			hold.releaseRPC()
			require.NoError(t, awaitDone(t, first, "the first call"))
			require.NoError(t, awaitDone(t, second, "the second call"))
			require.EqualValues(t, 2, begins.Load())
		})
	}
}

// A stop closes the source interests of its connection, which can take seconds,
// after it released profilesMu: the lock is not held across the teardown. The
// test blocks the teardown on the source coordinator's lock. Once the stop has
// registered its connection it keeps it until it ends, so a free profilesMu
// then means the stop released it before the teardown, which stays blocked
// until the test unlocks it.
func TestStopReleasesProfilesMuBeforeTheSourceTeardown(t *testing.T) {
	ctrl, _, _ := lifecycleCallFixture(t)
	scope := newCallScope(t)
	ctrl.sources.mu.Lock()
	var unblock sync.Once
	unlock := func() { unblock.Do(ctrl.sources.mu.Unlock) }
	t.Cleanup(unlock) // runs before the scope waits for the stop
	stop := scope.goCall(stopCall(ctrl, "p1", "route"))
	require.Eventually(t, func() bool {
		if !ctrl.calls.registered(connectionCallKey{plugin: "p1", connection: "route"}) || !ctrl.profilesMu.TryLock() {
			return false
		}
		ctrl.profilesMu.Unlock()
		return true
	}, callTimeout, time.Millisecond,
		"the stop holds profilesMu while it closes the connection's source interests")
	requireStillWaiting(t, stop, "a stop whose source teardown is blocked")
	unlock()
	require.NoError(t, awaitDone(t, stop, "the stop"))
}

// The wait for a registered call ends with the caller's context (see
// TestWaitingForAConnectionCallEndsWithItsContext). The plain profilesMu.Lock
// that every start takes first does not: a start whose context has ended stays
// there until the holder, here ListConnectionProfiles inside its plugin call,
// unlocks. This pins what docs/plugin-development.md says.
func TestPlainProfileLockWaitDoesNotEndWithTheCallersContext(t *testing.T) {
	ctrl, _, provider := lifecycleCallFixture(t)
	scope := newCallScope(t)
	hold := scope.hold("list")
	native := provider.NativeConnectionsFunc
	provider.NativeConnectionsFunc = func(ctx context.Context) ([]types.Connection, error) {
		hold.wait(ctx)
		return native(ctx)
	}
	list := scope.goCall(func() error {
		_, err := ctrl.ListConnectionProfiles(testInvocationContext(), "p1")
		return err
	})
	awaitSignal(t, hold.entered, "ListConnectionProfiles to reach the provider")
	ctx, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	start := scope.goCall(func() error {
		_, err := ctrl.StartConnection(ctx, "p1", "route")
		return err
	})
	requireStillWaiting(t, start, "a start behind the holder of profilesMu")
	cancel()
	requireStillWaiting(t, start, "a start behind the holder of profilesMu whose context has ended")

	hold.releaseRPC()
	require.NoError(t, awaitDone(t, list, "ListConnectionProfiles"))
	require.Error(t, awaitDone(t, start, "the cancelled start"))
}
