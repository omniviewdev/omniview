package resource

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// reentryProbe is one host path that a provider's callback may reach.
type reentryProbe struct {
	name string
	// waits marks a path that waits for the registered start and stop calls of
	// its own plugin, and so for the call it is called from inside.
	waits bool
	call  func(ctx context.Context) error
}

// reentryProbes lists the paths of plugin "p1" and "p2" that matter to a
// callback made from inside the start or stop of connection "lease" of "p1".
func reentryProbes(ctrl *controller, p1 *mockProvider) []reentryProbe {
	ctrl.pluginsMu.RLock()
	generation := ctrl.plugins["p1"]
	ctrl.pluginsMu.RUnlock()
	route := profileTestConnection("route", "endpoint")
	return []reentryProbe{
		// Paths that wait for the calls of their plugin.
		{"LoadConnections(p1)", true, func(ctx context.Context) error {
			_, err := ctrl.LoadConnections(ctx, "p1")
			return err
		}},
		{"SaveConnectionProfile(p1)", true, func(ctx context.Context) error {
			_, err := ctrl.SaveConnectionProfile(ctx, "p1", route, nil)
			return err
		}},
		{"ImportConnectionProfile(p1)", true, func(ctx context.Context) error {
			_, err := ctrl.ImportConnectionProfile(ctx, "p1", "route")
			return err
		}},
		{"ResetConnectionProfile(p1)", true, func(ctx context.Context) error {
			_, err := ctrl.ResetConnectionProfile(ctx, "p1", "route")
			return err
		}},
		{"RemoveConnection(p1)", true, func(ctx context.Context) error {
			return ctrl.RemoveConnection(ctx, "p1", "route")
		}},
		{"connection watch refresh(p1)", true, func(ctx context.Context) error {
			_, err := ctrl.refreshWatchedConnections(ctx, "p1", p1, generation)
			return err
		}},
		{"replayConnectionProfiles(p1)", true, func(ctx context.Context) error {
			_, err := ctrl.replayConnectionProfiles(ctx, "p1", nil)
			return err
		}},
		// The same connection waits for its own call.
		{"StartConnection(p1, lease)", true, func(ctx context.Context) error {
			_, err := ctrl.StartConnection(ctx, "p1", "lease")
			return err
		}},
		{"StopConnection(p1, lease)", true, func(ctx context.Context) error {
			_, err := ctrl.StopConnection(ctx, "p1", "lease")
			return err
		}},
		// Paths that never wait for a registered call.
		{"ListConnectionProfiles(p1)", false, func(ctx context.Context) error {
			_, err := ctrl.ListConnectionProfiles(ctx, "p1")
			return err
		}},
		{"GetConnection(p1)", false, func(ctx context.Context) error {
			_, err := ctrl.GetConnection(ctx, "p1", "p1-native")
			return err
		}},
		{"ListConnections(p1)", false, func(ctx context.Context) error {
			_, err := ctrl.ListConnections(ctx, "p1")
			return err
		}},
		{"ListAllConnections()", false, func(ctx context.Context) error {
			_, err := ctrl.ListAllConnections(ctx)
			return err
		}},
		{"GetAllConnectionStates()", false, func(ctx context.Context) error {
			_, err := ctrl.GetAllConnectionStates(ctx)
			return err
		}},
		{"BorrowableConnections(p1)", false, func(context.Context) error {
			_ = ctrl.BorrowableConnections("p1")
			return nil
		}},
		{"ListPlugins()", false, func(ctx context.Context) error {
			_, err := ctrl.ListPlugins(ctx)
			return err
		}},
		{"HasPlugin(p1)", false, func(ctx context.Context) error {
			_, err := ctrl.HasPlugin(ctx, "p1")
			return err
		}},
		{"Catalog(p1, other)", false, func(ctx context.Context) error {
			_, err := ctrl.Catalog(ctx, "p1", resourcev2.CatalogRequest{Route: resourcev2.AccessRoute{Connection: "other"}})
			return err
		}},
		// Another connection of the same plugin and another plugin do not wait.
		{"StartConnection(p1, other)", false, func(ctx context.Context) error {
			_, err := ctrl.StartConnection(ctx, "p1", "other")
			return err
		}},
		{"StopConnection(p1, other)", false, func(ctx context.Context) error {
			_, err := ctrl.StopConnection(ctx, "p1", "other")
			return err
		}},
		{"LoadConnections(p2)", false, func(ctx context.Context) error {
			_, err := ctrl.LoadConnections(ctx, "p2")
			return err
		}},
		{"SaveConnectionProfile(p2)", false, func(ctx context.Context) error {
			_, err := ctrl.SaveConnectionProfile(ctx, "p2", profileTestConnection("p2-save", "endpoint"), nil)
			return err
		}},
	}
}

// runReentryProbes runs every probe synchronously with ctx, from inside a
// provider call, and returns what each one returned. Each probe has a context
// deadline of twice callTimeout: a probe that waits for the call it is inside
// is reported as a hang after callTimeout, well before its deadline, and the
// rest are skipped.
func runReentryProbes(ctx context.Context, scope *callScope, probes []reentryProbe) []error {
	scope.t.Helper()
	results := make([]error, 0, len(probes))
	for _, probe := range probes {
		probeCtx, cancel := context.WithTimeout(ctx, 2*callTimeout)
		finished, err := scope.callWithin(probe.name+" from inside a provider call", func() error {
			return probe.call(probeCtx)
		})
		cancel()
		if !finished {
			break
		}
		results = append(results, err)
	}
	return results
}

// requireReentryError asserts that err is what a path returns instead of
// waiting for the start or stop it was called from.
func requireReentryError(t *testing.T, name string, err error) {
	t.Helper()
	var classified *resourcev2.ResourceOperationError
	require.ErrorAs(t, err, &classified, name)
	require.Equal(t, "INVALID_REQUEST", classified.Code, name)
	require.Contains(t, classified.Message, "waits for the start or stop of a connection that it was called from", name)
}

func requireProbeResults(t *testing.T, probes []reentryProbe, results []error) {
	t.Helper()
	require.Len(t, results, len(probes))
	for i, probe := range probes {
		if probe.waits {
			requireReentryError(t, probe.name, results[i])
		} else {
			require.NoError(t, results[i], probe.name)
		}
	}
}

// A path that waits for the registered calls of its plugin, reached from inside
// a start or stop of that plugin with the context the provider was given, would
// wait for the very call it is inside. It returns an error at once instead,
// while the paths that do not wait, including every path of another connection
// and of another plugin, keep working.
func TestPathsThatWaitForTheirOwnCallFailFastInsideAProviderCall(t *testing.T) {
	for _, where := range []string{"start", "stop", "catalog admission after a start"} {
		t.Run(where, func(t *testing.T) {
			ctrl, _, p1 := lifecycleCallFixture(t)
			scope := newCallScope(t)
			registerMockPlugin(ctrl, "p2", lockScopeProvider("p2-native"))
			probes := reentryProbes(ctrl, p1)
			var results []error
			var trigger func() error
			var once sync.Once
			switch where {
			case "start":
				p1.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
					if id == "lease" {
						once.Do(func() { results = runReentryProbes(ctx, scope, probes) })
					}
					return lockScopeConnected(id), nil
				}
				trigger = startCall(ctrl, "p1", "lease")
			case "stop":
				p1.StopConnectionFunc = func(ctx context.Context, id string) (types.Connection, error) {
					if id == "lease" {
						once.Do(func() { results = runReentryProbes(ctx, scope, probes) })
					}
					return types.Connection{ID: id, Name: id}, nil
				}
				trigger = stopCall(ctrl, "p1", "lease")
			default:
				catalog := p1.CatalogFunc
				p1.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
					if request.Route.Connection == "lease" {
						once.Do(func() { results = runReentryProbes(ctx, scope, probes) })
					}
					return catalog(ctx, request)
				}
				trigger = startCall(ctrl, "p1", "lease")
			}
			require.NoError(t, awaitDone(t, scope.goCall(trigger), "the "+where))
			requireProbeResults(t, probes, results)
			requireProfilesMuFree(t, ctrl)
			require.False(t, ctrl.calls.registered(connectionCallKey{plugin: "p1", connection: "lease"}))
		})
	}
}

// The error reaches a caller of the host as the canonical invalid request: a
// fix for the caller, not a retry.
func TestPathThatWaitsForItsOwnCallReturnsAnInvalidRequestAtTheHostBoundary(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	var saved error
	p1.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		// A path that waited for this very call would end at this deadline, which
		// is twice what the test allows the start to take.
		ctx, cancel := context.WithTimeout(ctx, 2*callTimeout)
		defer cancel()
		_, saved = ctrl.SaveConnectionProfile(ctx, "p1", profileTestConnection("route", "endpoint"), nil)
		return lockScopeConnected(id), nil
	}
	require.NoError(t, awaitDone(t, scope.goCall(startCall(ctrl, "p1", "lease")), "the start"))
	appErr := requireAppError(t, saved)
	require.Equal(t, "INVALID_REQUEST", appErr.Code)
	require.Equal(t, 400, appErr.Status)
	require.Equal(t, "correctRequest", appErr.Recovery)
	require.Contains(t, appErr.Detail, "waits for the start or stop of a connection that it was called from")
}

// A callback served from the plugin process runs on a goroutine with a context
// of its own, which carries no mark of the call it belongs to. The server marks
// it with WithinConnectionCall. These are the cases the mark detects and the
// cases it does not: an unmarked path waits until its own context ends.
func TestCallbackServerMarksItsContextWithWithinConnectionCall(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	registerMockPlugin(ctrl, "p2", lockScopeProvider("p2-native"))
	probes := reentryProbes(ctrl, p1)
	var results []error
	type undetected struct {
		name string
		ctx  func() context.Context
	}
	// Every one of these waits for the call it is inside, and none is detected.
	// The short deadline ends the wait that the mark would have cut short.
	undetectedCases := []undetected{
		{"no mark", testInvocationContext},
		{"mark of a connection that is not in flight", func() context.Context {
			return WithinConnectionCall(testInvocationContext(), "p1", "other")
		}},
		{"mark of another plugin", func() context.Context {
			return WithinConnectionCall(testInvocationContext(), "p2", "lease")
		}},
		{"only the innermost of two marks counts", func() context.Context {
			return WithinConnectionCall(WithinConnectionCall(testInvocationContext(), "p1", "lease"), "p1", "other")
		}},
	}
	var timedOut []error
	var entered atomic.Bool // a probe that is not stopped starts "lease" again from inside it
	p1.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		if id != "lease" || entered.Swap(true) {
			return lockScopeConnected(id), nil
		}
		// The callback server's context is a fresh one, marked with the plugin it
		// serves and the connection the callback was made for.
		results = runReentryProbes(WithinConnectionCall(testInvocationContext(), "p1", "lease"), scope, probes)
		for _, c := range undetectedCases {
			ctx, cancel := context.WithTimeout(c.ctx(), settleWindow)
			_, err := ctrl.SaveConnectionProfile(ctx, "p1", profileTestConnection("route", "endpoint"), nil)
			cancel()
			timedOut = append(timedOut, err)
		}
		return lockScopeConnected(id), nil
	}
	require.NoError(t, awaitDone(t, scope.goCall(startCall(ctrl, "p1", "lease")), "the start"))
	requireProbeResults(t, probes, results)
	require.Len(t, timedOut, len(undetectedCases))
	for i, c := range undetectedCases {
		appErr := requireAppError(t, timedOut[i])
		require.Equal(t, "TIMEOUT", appErr.Code, c.name)
	}
}

// A mark names a call. Once that call has ended, the mark changes nothing: a
// path that has to wait for another call of the plugin still waits, and a path
// with nothing to wait for runs.
func TestMarkOfAnEndedCallDoesNotFailAPathThatHasToWait(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	hold := scope.hold("hold")
	var marked context.Context
	p1.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		if id == "slow" {
			hold.wait(ctx)
		} else {
			marked = ctx
		}
		return lockScopeConnected(id), nil
	}
	require.NoError(t, startCall(ctrl, "p1", "lease")())
	require.NotNil(t, marked)
	nothingToWaitFor, cancelFirst := context.WithTimeout(marked, callTimeout)
	defer cancelFirst()
	_, err := ctrl.SaveConnectionProfile(nothingToWaitFor, "p1", profileTestConnection("route", "A"), nil)
	require.NoError(t, err, "nothing is in flight: a mark of an ended call is no reason to fail")

	slow := scope.goCall(startCall(ctrl, "p1", "slow"))
	awaitSignal(t, hold.entered, "the other start to reach the provider")
	waiting, cancel := context.WithTimeout(marked, settleWindow)
	defer cancel()
	_, err = ctrl.SaveConnectionProfile(waiting, "p1", profileTestConnection("route", "B"), nil)
	require.Equal(t, "TIMEOUT", requireAppError(t, err).Code, "another call of the plugin is in flight: wait for it")
	hold.releaseRPC()
	require.NoError(t, awaitDone(t, slow, "the other start"))
}

// A mark names the call of one plugin. A path of another plugin that has to wait
// behind a call of its own plugin is not inside the marked call, so it waits
// like any other and does not fail fast.
func TestMarkOfAnotherPluginsCallDoesNotFailAPathThatHasToWait(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	p2 := lockScopeProvider("p2-native")
	registerMockPlugin(ctrl, "p2", p2)
	for plugin, provider := range map[string]*mockProvider{"p1": p1, "p2": p2} {
		hold := scope.hold(plugin)
		provider.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
			hold.wait(ctx)
			return lockScopeConnected(id), nil
		}
	}
	first := scope.goCall(startCall(ctrl, "p1", "slow"))
	second := scope.goCall(startCall(ctrl, "p2", "lease"))
	awaitSignal(t, scope.entered("p1"), "the start of p1 to reach the provider")
	awaitSignal(t, scope.entered("p2"), "the start of p2 to reach the provider")

	// The call of p2 is registered, but p1's transaction does not wait for it.
	marked, cancel := context.WithTimeout(WithinConnectionCall(testInvocationContext(), "p2", "lease"), settleWindow)
	defer cancel()
	_, err := ctrl.SaveConnectionProfile(marked, "p1", profileTestConnection("route", "A"), nil)
	require.Equal(t, "TIMEOUT", requireAppError(t, err).Code,
		"a call of p1 is in flight and the mark names a call of p2: wait for p1's call")
	scope.release("p1")
	scope.release("p2")
	require.NoError(t, awaitDone(t, first, "the start of p1"))
	require.NoError(t, awaitDone(t, second, "the start of p2"))
}

// A start of another connection made from inside a start gets its own mark, so a
// path that waits for that inner call fails fast as well.
func TestNestedStartMarksItsOwnCall(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope := newCallScope(t)
	var inner error
	p1.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		switch id {
		case "lease":
			_, err := ctrl.StartConnection(ctx, "p1", "other")
			if err != nil {
				return types.ConnectionStatus{}, errors.New("the nested start failed")
			}
		case "other":
			bounded, cancel := context.WithTimeout(ctx, 2*callTimeout)
			defer cancel()
			_, inner = ctrl.LoadConnections(bounded, "p1")
		}
		return lockScopeConnected(id), nil
	}
	require.NoError(t, awaitDone(t, scope.goCall(startCall(ctrl, "p1", "lease")), "the outer start"))
	requireReentryError(t, "LoadConnections(p1) from inside the nested start", inner)
}
