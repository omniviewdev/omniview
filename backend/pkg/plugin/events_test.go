package plugin

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
)

func TestEmitEvent_NilContext_NoPanic(t *testing.T) {
	assert.NotPanics(t, func() {
		emitEvent(nil, "plugin/test", map[string]interface{}{
			"key": "value",
		})
	})
}

func TestEmitStateChange_NilContext_NoPanic(t *testing.T) {
	assert.NotPanics(t, func() {
		emitStateChange(nil, "test-plugin", lifecycle.Transition{
			From:      lifecycle.PhaseStarting,
			To:        lifecycle.PhaseRunning,
			Reason:    "test",
			Timestamp: time.Now(),
		})
	})
}

func TestStateChangePayload_Fields(t *testing.T) {
	now := time.Now()
	p := StateChangePayload{
		PluginID:  "test-plugin",
		From:      lifecycle.PhaseStarting,
		To:        lifecycle.PhaseRunning,
		Reason:    "started successfully",
		Timestamp: now,
	}

	assert.Equal(t, "test-plugin", p.PluginID)
	assert.Equal(t, lifecycle.PhaseStarting, p.From)
	assert.Equal(t, lifecycle.PhaseRunning, p.To)
	assert.Equal(t, "started successfully", p.Reason)
	assert.Equal(t, now, p.Timestamp)
}
