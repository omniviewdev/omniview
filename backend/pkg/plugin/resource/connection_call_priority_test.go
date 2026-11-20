package resource

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// holdOnCalls makes provider park every start and stop in scope, and log it in
// order as "start <id>" or "stop <id>". It also logs the profile overlays, see
// logOverlays.
func holdOnCalls(provider *mockProvider, scope *callScope, order *callLog) {
	provider.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		order.add("start " + id)
		scope.hold("start " + id).wait(ctx)
		return lockScopeConnected(id), nil
	}
	provider.StopConnectionFunc = func(ctx context.Context, id string) (types.Connection, error) {
		order.add("stop " + id)
		scope.hold("stop " + id).wait(ctx)
		return types.Connection{ID: id, Name: id}, nil
	}
	logOverlays(provider, order)
}

// logOverlays makes provider log every profile overlay it is given as "apply"
// and the ids of the profiles in it, comma separated.
func logOverlays(provider *mockProvider, order *callLog) {
	provider.ApplyConnectionOverlayFunc = func(ctx context.Context, overlay resourcev2.ConnectionOverlay) error {
		ids := make([]string, 0, len(overlay.Upserts))
		for _, connection := range overlay.Upserts {
			ids = append(ids, connection.ID)
		}
		order.add("apply " + strings.Join(ids, ","))
		return provider.applyConnectionOverlay(ctx, overlay)
	}
}

func loadCall(ctrl *controller, plugin string) func() error {
	return func() error {
		_, err := ctrl.LoadConnections(testInvocationContext(), plugin)
		return err
	}
}

// A profile change that waits for an in-flight start runs as soon as that start
// ends. The start and the stop that arrive while it waits queue behind it
// instead of overlapping the call it waits for, and run after it. Before the
// change waits, another connection of the plugin starts beside the in-flight
// call as usual.
func TestProfileChangeRunsBeforeStartsAndStopsThatArriveWhileItWaits(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope, order := newCallScope(t), &callLog{}
	holdOnCalls(p1, scope, order)
	first := scope.goCall(startCall(ctrl, "p1", "a"))
	awaitSignal(t, scope.entered("start a"), "the first start to reach the provider")
	scope.release("start control")
	finished, err := scope.callWithin("StartConnection(p1, control) while a start is in flight and nothing waits",
		startCall(ctrl, "p1", "control"))
	require.True(t, finished)
	require.NoError(t, err)

	change := scope.goCall(saveCall(ctrl, "p1", profileTestConnection("route", "B")))
	awaitTransactionsWaiting(t, ctrl, "p1", 1)
	lateStart := scope.goCall(startCall(ctrl, "p1", "b"))
	lateStop := scope.goCall(stopCall(ctrl, "p1", "c"))
	requireStillWaiting(t, lateStart, "a start that arrives while a profile change waits")
	requireStillWaiting(t, lateStop, "a stop that arrives while a profile change waits")
	assert.NotContains(t, order.snapshot(), "start b", "a start that arrived while a profile change waits ran")
	assert.NotContains(t, order.snapshot(), "stop c", "a stop that arrived while a profile change waits ran")

	scope.release("start a")
	require.NoError(t, awaitDone(t, first, "the first start"))
	require.NoError(t, awaitDone(t, change, "the profile change, once the calls in flight when it began to wait ended"))
	awaitSignal(t, scope.entered("start b"), "the late start to run after the profile change")
	awaitSignal(t, scope.entered("stop c"), "the late stop to run after the profile change")
	scope.release("start b")
	scope.release("stop c")
	require.NoError(t, awaitDone(t, lateStart, "the late start"))
	require.NoError(t, awaitDone(t, lateStop, "the late stop"))

	entries := order.snapshot()
	apply := slices.Index(entries, "apply route")
	require.GreaterOrEqual(t, apply, 0, "the profile change never reached the provider: %v", entries)
	require.Less(t, apply, slices.Index(entries, "start b"), "the late start ran before the profile change: %v", entries)
	require.Less(t, apply, slices.Index(entries, "stop c"), "the late stop ran before the profile change: %v", entries)
	requireRegistryIdle(t, ctrl)
}

// Every kind of profile transaction waits for its plugin the same way: it takes
// its place in line, holds back the start that arrives after it began to wait,
// and runs before that start.
func TestEveryKindOfProfileTransactionHoldsBackStartsThatArriveWhileItWaits(t *testing.T) {
	kinds := []struct {
		name string
		call func(ctrl *controller, p1 *mockProvider) func() error
	}{
		{"load", func(ctrl *controller, _ *mockProvider) func() error { return loadCall(ctrl, "p1") }},
		{"watch refresh", func(ctrl *controller, p1 *mockProvider) func() error {
			return func() error {
				ctrl.pluginsMu.RLock()
				generation := ctrl.plugins["p1"]
				ctrl.pluginsMu.RUnlock()
				_, err := ctrl.refreshWatchedConnections(testInvocationContext(), "p1", p1, generation)
				return err
			}
		}},
		{"replay", func(ctrl *controller, _ *mockProvider) func() error {
			return func() error {
				_, err := ctrl.replayConnectionProfiles(testInvocationContext(), "p1", nil)
				return err
			}
		}},
		{"profile change", func(ctrl *controller, _ *mockProvider) func() error {
			return saveCall(ctrl, "p1", profileTestConnection("route", "B"))
		}},
	}
	for _, kind := range kinds {
		t.Run(kind.name, func(t *testing.T) {
			ctrl, _, p1 := lifecycleCallFixture(t)
			scope, order := newCallScope(t), &callLog{}
			holdOnCalls(p1, scope, order)
			first := scope.goCall(startCall(ctrl, "p1", "a"))
			awaitSignal(t, scope.entered("start a"), "the first start to reach the provider")
			transaction := scope.goCall(kind.call(ctrl, p1))
			awaitTransactionsWaiting(t, ctrl, "p1", 1)
			late := scope.goCall(startCall(ctrl, "p1", "b"))
			requireStillWaiting(t, late, "a start that arrives while the transaction waits")
			require.NotContains(t, order.snapshot(), "start b", "the late start ran while the transaction waited")

			scope.release("start a")
			require.NoError(t, awaitDone(t, first, "the first start"))
			require.NoError(t, awaitDone(t, transaction, "the transaction, once the call in flight ended"))
			awaitSignal(t, scope.entered("start b"), "the late start to run after the transaction")
			scope.release("start b")
			require.NoError(t, awaitDone(t, late, "the late start"))

			entries := order.snapshot()
			require.Equal(t, "start a", entries[0])
			require.Equal(t, "start b", entries[len(entries)-1], "the late start ran before the transaction: %v", entries)
			requireRegistryIdle(t, ctrl)
		})
	}
}

// Profile transactions that wait for one plugin run one at a time in the order
// in which they began to wait, and before a start that arrives after all of them.
func TestProfileChangesThatWaitForAPluginRunInTheOrderTheyBeganToWait(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope, order := newCallScope(t), &callLog{}
	holdOnCalls(p1, scope, order)
	first := scope.goCall(startCall(ctrl, "p1", "a"))
	awaitSignal(t, scope.entered("start a"), "the first start to reach the provider")
	changes := make([]<-chan error, 0, 3)
	for i, id := range []string{"t1", "t2", "t3"} {
		changes = append(changes, scope.goCall(saveCall(ctrl, "p1", profileTestConnection(id, "endpoint"))))
		awaitTransactionsWaiting(t, ctrl, "p1", i+1)
	}
	late := scope.goCall(startCall(ctrl, "p1", "b"))
	requireStillWaiting(t, late, "a start that arrives behind three waiting profile changes")

	scope.release("start a")
	require.NoError(t, awaitDone(t, first, "the first start"))
	for i, change := range changes {
		require.NoError(t, awaitDone(t, change, fmt.Sprintf("profile change %d", i+1)))
	}
	awaitSignal(t, scope.entered("start b"), "the late start to run after the profile changes")
	scope.release("start b")
	require.NoError(t, awaitDone(t, late, "the late start"))
	// Each change applies the profiles saved so far, so the ids name the change.
	require.Equal(t, []string{"start a", "apply t1", "apply t1,t2", "apply t1,t2,t3", "start b"}, order.snapshot())
	requireRegistryIdle(t, ctrl)
}

// A profile transaction whose context ends while it waits leaves the line at
// once: the starts queued behind it go on, and the next transaction is first.
func TestProfileChangeWhoseContextEndsWhileItWaitsLeavesTheLine(t *testing.T) {
	t.Run("the calls queued behind it go on", func(t *testing.T) {
		ctrl, _, p1 := lifecycleCallFixture(t)
		scope, order := newCallScope(t), &callLog{}
		holdOnCalls(p1, scope, order)
		first := scope.goCall(startCall(ctrl, "p1", "a"))
		awaitSignal(t, scope.entered("start a"), "the first start to reach the provider")
		changeCtx, cancel := context.WithCancel(testInvocationContext())
		defer cancel()
		change := scope.goCall(func() error {
			_, err := ctrl.SaveConnectionProfile(changeCtx, "p1", profileTestConnection("route", "B"), nil)
			return err
		})
		awaitTransactionsWaiting(t, ctrl, "p1", 1)
		late := scope.goCall(startCall(ctrl, "p1", "b"))
		requireStillWaiting(t, late, "a start queued behind a profile change")
		require.NotContains(t, order.snapshot(), "start b", "the start ran while a profile change waited")

		cancel()
		require.Equal(t, "CANCELLED", requireAppError(t, awaitDone(t, change, "the canceled profile change")).Code)
		// Nothing waits any more, so the start goes on although the first start
		// is still in flight.
		awaitSignal(t, scope.entered("start b"), "the queued start to run once the profile change gave up")
		scope.release("start a")
		scope.release("start b")
		require.NoError(t, awaitDone(t, first, "the first start"))
		require.NoError(t, awaitDone(t, late, "the queued start"))
		require.Equal(t, []string{"start a", "start b"}, order.snapshot(), "the canceled change reached the provider")
		requireRegistryIdle(t, ctrl)
	})

	t.Run("the next transaction is first in line", func(t *testing.T) {
		ctrl, _, p1 := lifecycleCallFixture(t)
		scope, order := newCallScope(t), &callLog{}
		holdOnCalls(p1, scope, order)
		first := scope.goCall(startCall(ctrl, "p1", "a"))
		awaitSignal(t, scope.entered("start a"), "the first start to reach the provider")
		headCtx, cancelHead := context.WithCancel(testInvocationContext())
		defer cancelHead()
		head := scope.goCall(func() error {
			_, err := ctrl.SaveConnectionProfile(headCtx, "p1", profileTestConnection("t1", "endpoint"), nil)
			return err
		})
		awaitTransactionsWaiting(t, ctrl, "p1", 1)
		next := scope.goCall(saveCall(ctrl, "p1", profileTestConnection("t2", "endpoint")))
		awaitTransactionsWaiting(t, ctrl, "p1", 2)
		late := scope.goCall(startCall(ctrl, "p1", "b"))
		requireStillWaiting(t, late, "a start queued behind two profile changes")

		cancelHead()
		require.Equal(t, "CANCELLED", requireAppError(t, awaitDone(t, head, "the canceled profile change")).Code)
		requireStillWaiting(t, late, "a start queued behind the profile change that is now first in line")
		require.NotContains(t, order.snapshot(), "start b", "the start ran while a profile change waited")

		scope.release("start a")
		require.NoError(t, awaitDone(t, first, "the first start"))
		require.NoError(t, awaitDone(t, next, "the second profile change"))
		awaitSignal(t, scope.entered("start b"), "the queued start to run after the profile change")
		scope.release("start b")
		require.NoError(t, awaitDone(t, late, "the queued start"))
		require.Equal(t, []string{"start a", "apply t2", "start b"}, order.snapshot())
		requireRegistryIdle(t, ctrl)
	})
}

// A start made from inside an in-flight start of its plugin is part of that call
// and is not held back by a waiting profile change, which would otherwise wait
// for the call that waits for the start. A path that waits for the call it is
// inside still fails at once and takes no place in line. A start made without
// the mark of the call cannot be told from a new one and queues behind the
// change until its own context ends.
func TestStartMadeFromInsideAnInFlightCallIsNotHeldBackByAWaitingProfileChange(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	scope, order := newCallScope(t), &callLog{}
	inLease, changeWaits := make(chan struct{}), make(chan struct{})
	var (
		nestedStart, sameConnection, nestedChange, unmarkedStart error
		waitingAfterFailFast                                     int
	)
	logOverlays(p1, order)
	p1.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		order.add("start " + id)
		if id != "lease" {
			return lockScopeConnected(id), nil
		}
		close(inLease)
		select {
		case <-changeWaits:
		case <-time.After(callTimeout):
			return types.ConnectionStatus{}, errors.New("the profile change never began to wait")
		}
		// ctx is marked with this call, as the context of a provider callback is.
		// A call that is held back ends at this bound, long before the test gives
		// up on the start, so that a failing run leaves nothing behind.
		bounded, cancel := context.WithTimeout(ctx, callTimeout/2)
		defer cancel()
		_, nestedStart = ctrl.StartConnection(bounded, "p1", "other")
		_, sameConnection = ctrl.StartConnection(bounded, "p1", "lease")
		_, nestedChange = ctrl.SaveConnectionProfile(bounded, "p1", profileTestConnection("inner", "endpoint"), nil)
		waitingAfterFailFast = transactionsWaiting(ctrl, "p1")
		unmarked, cancelUnmarked := context.WithTimeout(testInvocationContext(), settleWindow)
		defer cancelUnmarked()
		_, unmarkedStart = ctrl.StartConnection(unmarked, "p1", "unmarked")
		return lockScopeConnected(id), nil
	}
	lease := scope.goCall(startCall(ctrl, "p1", "lease"))
	awaitSignal(t, inLease, "the start to reach the provider")
	change := scope.goCall(saveCall(ctrl, "p1", profileTestConnection("route", "B")))
	awaitTransactionsWaiting(t, ctrl, "p1", 1)
	close(changeWaits)

	require.NoError(t, awaitDone(t, lease, "the in-flight start, which starts another connection"))
	require.NoError(t, awaitDone(t, change, "the profile change"))
	require.NoError(t, nestedStart, "StartConnection(p1, other) from inside the start of lease")
	requireReentryError(t, "StartConnection(p1, lease) from inside the start of lease", sameConnection)
	requireReentryError(t, "SaveConnectionProfile(p1) from inside the start of lease", nestedChange)
	require.Equal(t, 1, waitingAfterFailFast, "only the profile change that waits from outside has a place in line")
	require.Equal(t, "TIMEOUT", requireAppError(t, unmarkedStart).Code,
		"a start without the mark of the call is held back")
	require.Equal(t, []string{"start lease", "start other", "apply route"}, order.snapshot())
	requireRegistryIdle(t, ctrl)
}

// The queue is per plugin: a profile change that waits for p1 holds back neither
// the calls nor the profile transactions of p2.
func TestProfileChangeWaitingForOnePluginDoesNotHoldBackAnotherPlugin(t *testing.T) {
	ctrl, _, p1 := lifecycleCallFixture(t)
	registerMockPlugin(ctrl, "p2", lockScopeProvider("p2-native"))
	scope, order := newCallScope(t), &callLog{}
	holdOnCalls(p1, scope, order)
	first := scope.goCall(startCall(ctrl, "p1", "a"))
	awaitSignal(t, scope.entered("start a"), "the first start to reach the provider")
	change := scope.goCall(saveCall(ctrl, "p1", profileTestConnection("route", "B")))
	awaitTransactionsWaiting(t, ctrl, "p1", 1)

	probes := []struct {
		name string
		call func() error
	}{
		{"StartConnection(p2)", startCall(ctrl, "p2", "x")},
		{"StopConnection(p2)", stopCall(ctrl, "p2", "y")},
		{"SaveConnectionProfile(p2)", saveCall(ctrl, "p2", profileTestConnection("route", "A"))},
		{"LoadConnections(p2)", loadCall(ctrl, "p2")},
	}
	for _, probe := range probes {
		finished, err := scope.callWithin(probe.name+" while a profile change waits for p1", probe.call)
		require.True(t, finished)
		require.NoError(t, err, probe.name)
	}
	require.Equal(t, 1, transactionsWaiting(ctrl, "p1"), "the profile change of p1 is still waiting")

	scope.release("start a")
	require.NoError(t, awaitDone(t, first, "the first start"))
	require.NoError(t, awaitDone(t, change, "the profile change"))
	requireRegistryIdle(t, ctrl)
}

// Starts, stops and profile changes of one plugin issued together all finish,
// and no profile change ever runs while a start or stop is in flight. A waiter
// that is never woken shows up as a hang, bounded here.
func TestOverlappingConnectionCallsAndProfileChangesAllFinishWithoutOverlap(t *testing.T) {
	const callers, changers, rounds = 6, 3, 12
	ctrl, _, p1 := lifecycleCallFixture(t)
	var inFlight, overlaps atomic.Int32
	enter := func() func() {
		inFlight.Add(1)
		runtime.Gosched()
		return func() { inFlight.Add(-1) }
	}
	p1.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		defer enter()()
		return lockScopeConnected(id), nil
	}
	p1.StopConnectionFunc = func(_ context.Context, id string) (types.Connection, error) {
		defer enter()()
		return types.Connection{ID: id, Name: id}, nil
	}
	p1.ApplyConnectionOverlayFunc = func(ctx context.Context, overlay resourcev2.ConnectionOverlay) error {
		if inFlight.Load() != 0 {
			overlaps.Add(1)
		}
		return p1.applyConnectionOverlay(ctx, overlay)
	}

	scope := newCallScope(t)
	results := make(chan error, callers*rounds*2+changers*rounds)
	var running sync.WaitGroup
	for i := range callers {
		running.Add(1)
		scope.goCall(func() error {
			defer running.Done()
			id := fmt.Sprintf("conn-%d", i)
			for range rounds {
				results <- startCall(ctrl, "p1", id)()
				results <- stopCall(ctrl, "p1", id)()
			}
			return nil
		})
	}
	for i := range changers {
		running.Add(1)
		scope.goCall(func() error {
			defer running.Done()
			for round := range rounds {
				id := fmt.Sprintf("profile-%d-%d", i, round)
				results <- saveCall(ctrl, "p1", profileTestConnection(id, "endpoint"))()
			}
			return nil
		})
	}
	finished := make(chan struct{})
	go func() {
		running.Wait()
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(4 * callTimeout):
		t.Fatalf("the starts, stops and profile changes did not all finish within %s", 4*callTimeout)
	}
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	require.Zero(t, overlaps.Load(), "a profile change ran while a start or stop was in flight")
	requireRegistryIdle(t, ctrl)
}
