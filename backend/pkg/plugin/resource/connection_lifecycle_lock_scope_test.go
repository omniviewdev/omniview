package resource

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// lockScopeWindow is how long an operation that must not wait for an in-flight
// provider RPC may stay pending before the test reports it as blocked. The
// operations are in-memory fakes plus one small profile-store write, so a
// healthy implementation returns within milliseconds.
const lockScopeWindow = 750 * time.Millisecond

// lockProbe is one host operation issued on its own goroutine, the way an
// independent Wails or plugin-callback handler would issue it while another
// operation is in flight.
type lockProbe struct {
	name string
	// proceed marks an operation that must not wait for the in-flight RPC.
	// Other probes are only observed and logged.
	proceed bool
	run     func() error
}

type lockProbeRun struct {
	probes []lockProbe
	done   []chan struct{}
}

// startLockProbes runs every probe on its own goroutine. The scope waits for
// them when the test ends, even by failing.
func startLockProbes(scope *callScope, probes []lockProbe) *lockProbeRun {
	run := &lockProbeRun{probes: probes, done: make([]chan struct{}, len(probes))}
	for i := range probes {
		run.done[i] = make(chan struct{})
		finished := scope.track()
		go func(i int) {
			defer finished()
			defer close(run.done[i])
			_ = run.probes[i].run()
		}(i)
	}
	return run
}

// settle waits until every probe that must proceed has returned, or until the
// window elapses.
func (r *lockProbeRun) settle(window time.Duration) {
	deadline := time.NewTimer(window)
	defer deadline.Stop()
	for i, probe := range r.probes {
		if !probe.proceed {
			continue
		}
		select {
		case <-r.done[i]:
		case <-deadline.C:
			return
		}
	}
}

// pending snapshots which probes have not returned.
func (r *lockProbeRun) pending() []bool {
	pending := make([]bool, len(r.probes))
	for i := range r.done {
		select {
		case <-r.done[i]:
		default:
			pending[i] = true
		}
	}
	return pending
}

// drain waits for every probe to return once the blocking RPC was released. A
// probe that is still pending then is a hang, not lock serialization.
func (r *lockProbeRun) drain(t *testing.T, limit time.Duration) {
	t.Helper()
	deadline := time.NewTimer(limit)
	defer deadline.Stop()
	for i := range r.done {
		select {
		case <-r.done[i]:
		case <-deadline.C:
			t.Fatalf("%s did not return even after the blocking provider RPC was released", r.probes[i].name)
		}
	}
}

// providerHold parks a fake provider call until the test releases it.
type providerHold struct {
	entered chan struct{}
	release chan struct{}
	enter   sync.Once
	free    sync.Once
}

func newProviderHold() *providerHold {
	return &providerHold{entered: make(chan struct{}), release: make(chan struct{})}
}

func (h *providerHold) wait(ctx context.Context) {
	h.enter.Do(func() { close(h.entered) })
	select {
	case <-h.release:
	case <-ctx.Done():
	}
}

func (h *providerHold) releaseRPC() { h.free.Do(func() { close(h.release) }) }

func lockScopeConnected(id string) types.ConnectionStatus {
	return types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: id, Name: id}}
}

// lockScopeProvider supports connection lifecycle, discovery and the profile
// overlay, which are the provider calls the probes below reach.
func lockScopeProvider(native string) *mockProvider {
	provider := connectionOverlayTestProvider(profileTestConnection(native, "endpoint"))
	provider.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		return lockScopeConnected(id), nil
	}
	provider.StopConnectionFunc = func(_ context.Context, id string) (types.Connection, error) {
		return types.Connection{ID: id, Name: id}, nil
	}
	return provider
}

// lockScopeFixture is two registered plugins. The start and the stop of the
// connection "slow" of p1 wait inside the provider until the test releases them.
type lockScopeFixture struct {
	ctrl           *controller
	scope          *callScope
	hold           *providerHold
	p1, p2         *mockProvider
	startedPlugins atomic.Int32
}

func newLockScopeFixture(t *testing.T) *lockScopeFixture {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	scope := newCallScope(t)
	f := &lockScopeFixture{
		ctrl: ctrl, scope: scope, hold: scope.hold("slow"),
		p1: lockScopeProvider("p1-native"), p2: lockScopeProvider("p2-native"),
	}
	f.p1.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		if id == "slow" {
			f.hold.wait(ctx)
		}
		return lockScopeConnected(id), nil
	}
	f.p1.StopConnectionFunc = func(ctx context.Context, id string) (types.Connection, error) {
		if id == "slow" {
			f.hold.wait(ctx)
		}
		return types.Connection{ID: id, Name: id}, nil
	}
	registerMockPlugin(ctrl, "p1", f.p1)
	registerMockPlugin(ctrl, "p2", f.p2)
	for _, pluginID := range []string{"p1", "p2"} {
		_, err := ctrl.LoadConnections(testInvocationContext(), pluginID)
		require.NoError(t, err)
	}
	return f
}

func (f *lockScopeFixture) generation(pluginID string) *pluginState {
	f.ctrl.pluginsMu.RLock()
	defer f.ctrl.pluginsMu.RUnlock()
	return f.ctrl.plugins[pluginID]
}

// probes lists the host operations issued while the start or stop of "slow" is
// in flight.
func (f *lockScopeFixture) probes(t *testing.T) []lockProbe {
	t.Helper()
	ctrl, p1, p2 := f.ctrl, f.p1, f.p2
	return []lockProbe{
		// A different connection of the same plugin.
		{name: "StartConnection(p1, other connection)", proceed: true, run: func() error {
			_, err := ctrl.StartConnection(testInvocationContext(), "p1", "p1-start")
			return err
		}},
		{name: "StopConnection(p1, other connection)", proceed: true, run: func() error {
			_, err := ctrl.StopConnection(testInvocationContext(), "p1", "p1-stop")
			return err
		}},
		// Another plugin entirely.
		{name: "StartConnection(p2)", proceed: true, run: func() error {
			_, err := ctrl.StartConnection(testInvocationContext(), "p2", "p2-start")
			return err
		}},
		{name: "StopConnection(p2)", proceed: true, run: func() error {
			_, err := ctrl.StopConnection(testInvocationContext(), "p2", "p2-stop")
			return err
		}},
		{name: "LoadConnections(p2)", proceed: true, run: func() error {
			_, err := ctrl.LoadConnections(testInvocationContext(), "p2")
			return err
		}},
		{name: "ListConnectionProfiles(p2)", proceed: true, run: func() error {
			_, err := ctrl.ListConnectionProfiles(testInvocationContext(), "p2")
			return err
		}},
		{name: "SaveConnectionProfile(p2)", proceed: true, run: func() error {
			_, err := ctrl.SaveConnectionProfile(
				testInvocationContext(), "p2", profileTestConnection("p2-save", "endpoint"), nil)
			return err
		}},
		{name: "connection watch refresh(p2)", proceed: true, run: func() error {
			_, err := ctrl.refreshWatchedConnections(testInvocationContext(), "p2", p2, f.generation("p2"))
			return err
		}},
		// Plugin load runs LoadConnections, so it waits like any discovery.
		{name: "OnPluginStart(other plugin) [plugin load runs LoadConnections]", proceed: true, run: func() error {
			id := fmt.Sprintf("p3-%d", f.startedPlugins.Add(1))
			backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
				Providers: map[string]interface{}{"resource": lockScopeProvider(id + "-native")},
			})
			if err := ctrl.OnPluginStart(id, defaultMeta(), backend); err != nil {
				return err
			}
			t.Cleanup(func() { _ = ctrl.OnPluginStop(id, defaultMeta()) })
			return nil
		}},
		// Controls: read paths that never take profilesMu.
		{name: "ListConnections(p1) [control]", proceed: true, run: func() error {
			_, err := ctrl.ListConnections(testInvocationContext(), "p1")
			return err
		}},
		{name: "GetConnection(p1) [control]", proceed: true, run: func() error {
			_, err := ctrl.GetConnection(testInvocationContext(), "p1", "p1-native")
			return err
		}},
		{name: "ListAllConnections() [control]", proceed: true, run: func() error {
			_, err := ctrl.ListAllConnections(testInvocationContext())
			return err
		}},
		// Same plugin. ListConnectionProfiles takes the profile lock only to read
		// and waits for no connection call, so it must proceed. Each of the
		// others is a profile transaction that waits for the in-flight call of
		// its plugin by design: observed only.
		{name: "ListConnectionProfiles(p1)", proceed: true, run: func() error {
			_, err := ctrl.ListConnectionProfiles(testInvocationContext(), "p1")
			return err
		}},
		{name: "SaveConnectionProfile(p1) [observed]", run: func() error {
			_, err := ctrl.SaveConnectionProfile(
				testInvocationContext(), "p1", profileTestConnection("p1-save", "endpoint"), nil)
			return err
		}},
		{name: "LoadConnections(p1) [observed]", run: func() error {
			_, err := ctrl.LoadConnections(testInvocationContext(), "p1")
			return err
		}},
		{name: "connection watch refresh(p1) [observed]", run: func() error {
			_, err := ctrl.refreshWatchedConnections(testInvocationContext(), "p1", p1, f.generation("p1"))
			return err
		}},
	}
}

// startInFlight starts the connection "slow" of p1 (or stops it) and returns once
// the call is inside the provider. Its result arrives on the returned channel.
func (f *lockScopeFixture) startInFlight(t *testing.T, held string) <-chan error {
	t.Helper()
	inFlight := f.scope.goCall(func() error {
		var err error
		if held == "StartConnection" {
			_, err = f.ctrl.StartConnection(testInvocationContext(), "p1", "slow")
		} else {
			_, err = f.ctrl.StopConnection(testInvocationContext(), "p1", "slow")
		}
		return err
	})
	select {
	case <-f.hold.entered:
	case <-time.After(5 * time.Second):
		t.Fatalf("%s(p1, slow) never reached the provider RPC", held)
	}
	return inFlight
}

func reportLockProbes(t *testing.T, probes []lockProbe, pending []bool, held string) {
	t.Helper()
	for i, probe := range probes {
		switch {
		case probe.proceed && pending[i]:
			t.Errorf("%s was blocked while %s(p1, slow) was in flight inside the provider: "+
				"profilesMu is held across the plugin RPC", probe.name, held)
		case probe.proceed:
			t.Logf("returned promptly: %s while %s(p1, slow) was in flight", probe.name, held)
		default:
			t.Logf("observed: %s blocked=%v while %s(p1, slow) was in flight", probe.name, pending[i], held)
		}
	}
}

// Lock scope: StartConnection and StopConnection used to take the
// controller-wide profilesMu and keep it across the plugin RPC
// (provider.StartConnection / provider.StopConnection). The mutex is one per
// controller, not per plugin or per connection, so a single slow or hung
// connection start stalled start, stop, profile list/save, discovery and
// watch-driven refresh for every other connection of every plugin.
//
// While one connection's provider start (or stop) is in flight, the start/stop
// of other connections and the profile and discovery operations of other
// plugins proceed. Same-plugin profile operations are only observed here,
// because they coordinate with an in-flight start of the same plugin by design.
// The control probes must keep proceeding.
func TestInFlightConnectionLifecycleRPCDoesNotBlockUnrelatedHostOperations(t *testing.T) {
	for _, held := range []string{"StartConnection", "StopConnection"} {
		t.Run("in-flight "+held, func(t *testing.T) {
			f := newLockScopeFixture(t)
			probes := f.probes(t)

			// Baseline without contention: every probe must succeed, so a probe
			// that returns quickly below is known to have done real work.
			for _, probe := range probes {
				require.NoError(t, probe.run(), "baseline %s", probe.name)
			}

			inFlight := f.startInFlight(t, held)
			run := startLockProbes(f.scope, probes)
			run.settle(lockScopeWindow)
			pending := run.pending()

			f.hold.releaseRPC()
			select {
			case err := <-inFlight:
				require.NoError(t, err)
			case <-time.After(5 * time.Second):
				t.Fatalf("%s(p1, slow) did not finish after its provider RPC was released", held)
			}
			run.drain(t, 5*time.Second)
			reportLockProbes(t, probes, pending, held)
		})
	}
}

// Re-entrancy: StartConnection used to hold profilesMu across
// provider.StartConnection. A provider may call back into the host while its
// start RPC is running, for example to read a connection's stored profile. The
// only host paths that expose a connection's stored profile and its private
// credentials are ListConnectionProfiles and the profile transactions, and they
// take profilesMu. A callback built on them waited on the lock that the very
// start waiting for it held, which deadlocked until a timeout. Connection lookup
// and registered-state paths do not take the lock and are the controls.
//
// A host path that returns the connection's profile and its stored credentials
// can be called from inside provider.StartConnection and returns. The controls
// keep returning.
func TestProviderStartCanCallBackIntoHostForConnectionProfileAndState(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	scope := newCallScope(t)
	provider := lockScopeProvider("p1-native")
	registerMockPlugin(ctrl, "p1", provider)
	ctx := testInvocationContext()
	_, err := ctrl.LoadConnections(ctx, "p1")
	require.NoError(t, err)
	token := "stored-credential"
	_, err = ctrl.SaveConnectionProfile(ctx, "p1", profileTestConnection("lease", "endpoint"),
		&ConnectionProfileCredentials{Token: &token})
	require.NoError(t, err)

	probes := []lockProbe{
		{name: "GetConnection(p1, lease) [connection lookup, control]", proceed: true, run: func() error {
			_, probeErr := ctrl.GetConnection(testInvocationContext(), "p1", "lease")
			return probeErr
		}},
		{name: "ListConnections(p1) [connection lookup, control]", proceed: true, run: func() error {
			_, probeErr := ctrl.ListConnections(testInvocationContext(), "p1")
			return probeErr
		}},
		{name: "GetAllConnectionStates() [registered state, control]", proceed: true, run: func() error {
			_, probeErr := ctrl.GetAllConnectionStates(testInvocationContext())
			return probeErr
		}},
		{name: "BorrowableConnections(p1) [start state, control]", proceed: true, run: func() error {
			_ = ctrl.BorrowableConnections("p1")
			return nil
		}},
		{name: "ListConnectionProfiles(p1) [stored profile and credentials]", proceed: true, run: func() error {
			_, probeErr := ctrl.ListConnectionProfiles(testInvocationContext(), "p1")
			return probeErr
		}},
		// Mutations conflict with the in-flight start by design, so they are
		// observed only.
		{name: "LoadConnections(p1) [observed]", run: func() error {
			_, probeErr := ctrl.LoadConnections(testInvocationContext(), "p1")
			return probeErr
		}},
		{name: "SaveConnectionProfile(p1, lease) [observed]", run: func() error {
			_, probeErr := ctrl.SaveConnectionProfile(
				testInvocationContext(), "p1", profileTestConnection("lease", "endpoint"), nil)
			return probeErr
		}},
	}
	for _, probe := range probes {
		require.NoError(t, probe.run(), "baseline %s", probe.name)
	}

	var run *lockProbeRun
	var pending []bool
	provider.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		// The plugin asks the host for what it needs to build its client, on
		// separate goroutines like independent callback RPCs, and cannot finish
		// starting until the host answers.
		run = startLockProbes(scope, probes)
		run.settle(lockScopeWindow)
		pending = run.pending()
		return lockScopeConnected(id), nil
	}
	_, err = ctrl.StartConnection(testInvocationContext(), "p1", "lease")
	require.NoError(t, err)
	run.drain(t, 5*time.Second)

	for i, probe := range probes {
		switch {
		case probe.proceed && pending[i]:
			t.Errorf("%s issued from inside provider.StartConnection did not return within %s: "+
				"StartConnection holds profilesMu across the plugin RPC and this host path needs it, so a provider "+
				"calling back into it while starting would deadlock", probe.name, lockScopeWindow)
		case probe.proceed:
			t.Logf("returned promptly: %s from inside provider.StartConnection", probe.name)
		default:
			t.Logf("observed: %s blocked=%v from inside provider.StartConnection", probe.name, pending[i])
		}
	}
}
