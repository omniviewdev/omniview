package resource

import (
	"context"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

type retryErrorOpener struct {
	errors chan error
}

func (o *retryErrorOpener) OpenSourceStream(context.Context, resourcev2.SourceOpenRequest) (resourcev2.SourceStream, error) {
	return nil, <-o.errors
}

func retryTestSession(ctrl *controller, viewID string) *sourceSession {
	ctrl.sources.mu.Lock()
	defer ctrl.sources.mu.Unlock()
	return ctrl.sources.views[viewID].session
}

type retryTimer struct {
	delay time.Duration
	tick  chan time.Time
}

func retryTestClock(ctrl *controller) chan retryTimer {
	timers := make(chan retryTimer, 8)
	ctrl.sources.now = func() time.Time { return time.Unix(100, 0) }
	ctrl.sources.after = func(delay time.Duration) <-chan time.Time {
		tick := make(chan time.Time, 1)
		timers <- retryTimer{delay: delay, tick: tick}
		return tick
	}
	return timers
}
func retryTestTick(t *testing.T, timers <-chan retryTimer, expected time.Duration) {
	t.Helper()
	select {
	case timer := <-timers:
		require.Equal(t, expected, timer.delay)
		timer.tick <- time.Unix(100, 0)
	case <-time.After(5 * time.Second):
		t.Fatal("missing reopen timer")
	}
}

func TestSourceAutomaticReopenTransientFailures(t *testing.T) {
	for _, code := range []string{"UNAVAILABLE", "CONNECTION_ERROR", "TIMEOUT"} {
		t.Run(code, func(t *testing.T) {
			ctrl, _, provider, target := sourceTestFixture(t)
			timers := retryTestClock(ctrl)
			view := sourceTestOpen(t, ctrl, target)
			first := sourceNextOpen(t, provider)
			sourceSend(first.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetContinuityLost}})
			retryTestTick(t, timers, time.Second)
			second := sourceNextOpen(t, provider)
			sourceSend(second.stream, resourcev2.SourceFrame{Failed: &resourcev2.SourceFailure{Code: code, Message: "temporary"}})
			retryTestTick(t, timers, 5*time.Second)
			third := sourceNextOpen(t, provider)
			sourceSend(third.stream, sourceBoundary(resourcev2.EnumerationExhausted))
			require.Eventually(t, func() bool {
				states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", target.Target.Route)
				return err == nil && states.Types[target.Target.Type].State == "following"
			}, 5*time.Second, time.Millisecond)
			require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
		})
	}
}

func TestSourceAutomaticReopenOpenErrorsExhaustBudget(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	timers := retryTestClock(ctrl)
	view := sourceTestOpen(t, ctrl, target)
	first := sourceNextOpen(t, provider)
	s := retryTestSession(ctrl, view.ViewID)
	opener := &retryErrorOpener{errors: make(chan error, 3)}
	for range 3 {
		opener.errors <- resourcev2.NewError("CONNECTION_ERROR", "temporary")
	}
	s.mu.Lock()
	s.opener = opener
	s.mu.Unlock()
	sourceSend(first.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetContinuityLost}})
	for _, delay := range []time.Duration{time.Second, 5 * time.Second, 15 * time.Second} {
		retryTestTick(t, timers, delay)
	}
	require.Eventually(t, func() bool {
		states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", target.Target.Route)
		status := states.Types[target.Target.Type]
		return err == nil && status.State == "failed" && status.Error != nil && status.Error.Code == "RESET_REQUIRED"
	}, 5*time.Second, time.Millisecond)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceTransientFailureOutsideReopenAndPermanentFailure(t *testing.T) {
	for _, tc := range []struct {
		name, code string
		reopen     bool
	}{
		{"initial transient", "UNAVAILABLE", false},
		{"reopen permanent", "PROVIDER_ERROR", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctrl, _, provider, target := sourceTestFixture(t)
			timers := retryTestClock(ctrl)
			view := sourceTestOpen(t, ctrl, target)
			current := sourceNextOpen(t, provider)
			if tc.reopen {
				sourceSend(current.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetContinuityLost}})
				retryTestTick(t, timers, time.Second)
				current = sourceNextOpen(t, provider)
			}
			sourceSend(current.stream, resourcev2.SourceFrame{Failed: &resourcev2.SourceFailure{Code: tc.code, Message: "failure"}})
			require.Eventually(t, func() bool {
				states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", target.Target.Route)
				status := states.Types[target.Target.Type]
				return err == nil && status.State == "failed" && status.Error != nil && status.Error.Code == tc.code
			}, 5*time.Second, time.Millisecond)
			require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
		})
	}
}

func TestSourceReopenRetiredEpochDoesNotOpen(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	timers := retryTestClock(ctrl)
	view := sourceTestOpen(t, ctrl, target)
	first := sourceNextOpen(t, provider)
	s := retryTestSession(ctrl, view.ViewID)
	sourceSend(first.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetContinuityLost}})
	var timer retryTimer
	select {
	case timer = <-timers:
	case <-time.After(5 * time.Second):
		t.Fatal("missing reopen timer")
	}
	func() {
		ctrl.pluginsMu.Lock()
		defer ctrl.pluginsMu.Unlock()
		generation := ctrl.plugins["p1"]
		if generation.sourceEpoch == nil {
			generation.sourceEpoch = make(map[string]uint64)
		}
		generation.sourceEpoch[target.Target.Route.Connection]++
	}()
	require.Equal(t, time.Second, timer.delay)
	timer.tick <- time.Unix(100, 0)
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.generation != first.request.Generation
	}, 5*time.Second, time.Millisecond)
	s.mu.Lock()
	done := s.done
	s.mu.Unlock()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("retired reopen did not stop")
	}
	select {
	case <-provider.opens:
		t.Fatal("retired epoch opened a source")
	default:
	}
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}
