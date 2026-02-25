package resource

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ======================== isConnectionError tests ======================== //

func TestIsConnectionError_NilError(t *testing.T) {
	// status.FromError(nil) returns (nil, true) and nil.Code() == codes.OK,
	// so isConnectionError should return false.
	assert.False(t, isConnectionError(nil))
}

func TestIsConnectionError_PlainErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "connection refused",
			err:  errors.New("dial tcp 127.0.0.1:5000: connection refused"),
			want: true,
		},
		{
			name: "EOF",
			err:  errors.New("unexpected EOF"),
			want: true,
		},
		{
			name: "unrelated error",
			err:  errors.New("not found"),
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isConnectionError(tt.err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestIsConnectionError_GRPCStatusErrors(t *testing.T) {
	tests := []struct {
		name string
		code codes.Code
		want bool
	}{
		{name: "Unavailable", code: codes.Unavailable, want: true},
		{name: "Internal", code: codes.Internal, want: true},
		{name: "NotFound", code: codes.NotFound, want: false},
		{name: "OK", code: codes.OK, want: false},
		{name: "InvalidArgument", code: codes.InvalidArgument, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := status.Error(tt.code, "test error")
			got := isConnectionError(err)
			assert.Equal(t, tt.want, got)
		})
	}
}

// ======================== triggerCrashRecovery tests ======================== //

// newCrashTestController builds a minimal controller suitable for
// triggerCrashRecovery tests. The Wails context (ctx) is left nil so
// runtime.EventsEmit is skipped (the production code guards on c.ctx != nil).
func newCrashTestController() *controller {
	return &controller{
		logger:     zap.NewNop().Sugar(),
		crashOnces: make(map[string]*sync.Once),
	}
}

func TestTriggerCrashRecovery_CallbackInvoked(t *testing.T) {
	ctrl := newCrashTestController()
	ctrl.crashOnces["plugin-a"] = &sync.Once{}

	var called atomic.Int32
	ctrl.onCrashCallback = func(pluginID string) {
		called.Add(1)
		assert.Equal(t, "plugin-a", pluginID)
	}

	ctrl.triggerCrashRecovery("plugin-a", errors.New("connection lost"), "informer")

	// The callback is invoked in a goroutine (go c.onCrashCallback(pluginID)),
	// so give it a moment to execute.
	assert.Eventually(t, func() bool {
		return called.Load() == 1
	}, 2*1e9, 10*1e6, "callback should have been invoked once")
}

func TestTriggerCrashRecovery_OnceSemantics(t *testing.T) {
	ctrl := newCrashTestController()
	ctrl.crashOnces["plugin-a"] = &sync.Once{}

	var callCount atomic.Int32
	ctrl.onCrashCallback = func(pluginID string) {
		callCount.Add(1)
	}

	// Trigger crash recovery three times for the same plugin.
	for i := 0; i < 3; i++ {
		ctrl.triggerCrashRecovery("plugin-a", errors.New("crash"), "informer")
	}

	// Wait until the single allowed callback has a chance to run.
	assert.Eventually(t, func() bool {
		return callCount.Load() >= 1
	}, 2*1e9, 10*1e6, "callback should have been invoked at least once")

	// Verify it was invoked exactly once despite three triggers.
	assert.Equal(t, int32(1), callCount.Load(),
		"callback must be invoked exactly once per sync.Once")
}

func TestTriggerCrashRecovery_NilCallback_NoPanic(t *testing.T) {
	ctrl := newCrashTestController()
	ctrl.crashOnces["plugin-a"] = &sync.Once{}
	ctrl.onCrashCallback = nil

	// Must not panic.
	assert.NotPanics(t, func() {
		ctrl.triggerCrashRecovery("plugin-a", errors.New("crash"), "informer")
	})
}

func TestTriggerCrashRecovery_MissingOnceEntry_NoPanic(t *testing.T) {
	ctrl := newCrashTestController()
	// crashOnces has no entry for "unknown-plugin".
	ctrl.onCrashCallback = func(pluginID string) {
		t.Fatal("callback should not be invoked when there is no Once entry")
	}

	assert.NotPanics(t, func() {
		ctrl.triggerCrashRecovery("unknown-plugin", errors.New("crash"), "informer")
	})
}

func TestTriggerCrashRecovery_IndependentPlugins(t *testing.T) {
	ctrl := newCrashTestController()
	ctrl.crashOnces["plugin-a"] = &sync.Once{}
	ctrl.crashOnces["plugin-b"] = &sync.Once{}

	var countA, countB atomic.Int32
	ctrl.onCrashCallback = func(pluginID string) {
		switch pluginID {
		case "plugin-a":
			countA.Add(1)
		case "plugin-b":
			countB.Add(1)
		}
	}

	// Crash plugin A.
	ctrl.triggerCrashRecovery("plugin-a", errors.New("crash"), "informer")

	assert.Eventually(t, func() bool {
		return countA.Load() == 1
	}, 2*1e9, 10*1e6, "plugin-a callback should fire")

	// Crash plugin B -- it should still fire even though A already crashed.
	ctrl.triggerCrashRecovery("plugin-b", errors.New("crash"), "connection")

	assert.Eventually(t, func() bool {
		return countB.Load() == 1
	}, 2*1e9, 10*1e6, "plugin-b callback should fire independently")

	// Trigger A again -- should NOT fire a second time.
	ctrl.triggerCrashRecovery("plugin-a", errors.New("crash again"), "informer")

	// Small sleep-equivalent: use Eventually to confirm no extra call.
	assert.Never(t, func() bool {
		return countA.Load() > 1
	}, 200*1e6, 50*1e6, "plugin-a callback must not fire a second time")

	assert.Equal(t, int32(1), countA.Load())
	assert.Equal(t, int32(1), countB.Load())
}

// ======================== SetCrashCallback test ======================== //

func TestSetCrashCallback(t *testing.T) {
	ctrl := newCrashTestController()

	assert.Nil(t, ctrl.onCrashCallback, "callback should initially be nil")

	var invoked bool
	ctrl.SetCrashCallback(func(pluginID string) {
		invoked = true
	})

	assert.NotNil(t, ctrl.onCrashCallback, "callback should be set after SetCrashCallback")

	// Invoke to verify it's wired correctly.
	ctrl.onCrashCallback("test")
	assert.True(t, invoked)
}
