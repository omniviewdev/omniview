package types

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

func TestNewPluginRecord_Defaults(t *testing.T) {
	meta := config.PluginMeta{ID: "test", Name: "Test Plugin", Version: "1.0"}
	record := NewPluginRecord("test", meta, lifecycle.PhaseInstalled)

	assert.Equal(t, "test", record.ID)
	assert.Equal(t, lifecycle.PhaseInstalled, record.Phase)
	assert.Equal(t, meta, record.Metadata)
	assert.True(t, record.Enabled)
	assert.NotNil(t, record.StateMachine)
	assert.False(t, record.InstalledAt.IsZero())
}

func TestPluginRecord_ToInfo_BasicFields(t *testing.T) {
	record := &PluginRecord{
		ID:       "my-plugin",
		Phase:    lifecycle.PhaseRunning,
		Metadata: config.PluginMeta{ID: "my-plugin", Name: "My Plugin"},
		Enabled:  true,
		DevMode:  true,
		DevPath:  "/dev/path",
		Capabilities: []sdktypes.Capability{
			sdktypes.CapabilityResource,
			sdktypes.CapabilityExec,
		},
		LastError: "some error",
	}

	info := record.ToInfo()

	assert.Equal(t, "my-plugin", info.ID)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	assert.Equal(t, "My Plugin", info.Metadata.Name)
	assert.True(t, info.Enabled)
	assert.True(t, info.DevMode)
	assert.Equal(t, "/dev/path", info.DevPath)
	assert.Len(t, info.Capabilities, 2)
	assert.Equal(t, "some error", info.LastError)
}

func TestPluginRecord_ToInfo_UsesStateMachinePhase(t *testing.T) {
	sm := lifecycle.NewPluginStateMachine("test", lifecycle.PhaseRunning)

	record := &PluginRecord{
		ID:           "test",
		Phase:        lifecycle.PhaseInstalled, // stale phase on struct
		StateMachine: sm,
	}

	info := record.ToInfo()
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
}

func TestPluginRecord_ToInfo_WithoutStateMachine(t *testing.T) {
	record := &PluginRecord{
		ID:    "test",
		Phase: lifecycle.PhaseFailed,
	}

	info := record.ToInfo()
	assert.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
}

func TestPluginRecord_ToStateRecord_RoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	record := &PluginRecord{
		ID:          "round-trip",
		Phase:       lifecycle.PhaseRunning,
		Metadata:    config.PluginMeta{ID: "round-trip", Version: "2.0"},
		Enabled:     true,
		DevMode:     true,
		DevPath:     "/my/path",
		LastError:   "oops",
		ErrorCount:  3,
		InstalledAt: now,
		Backend:     NewInProcessBackend(nil), // runtime field
	}

	sr := record.ToStateRecord()

	assert.Equal(t, "round-trip", sr.ID)
	assert.Equal(t, lifecycle.PhaseRunning, sr.Phase)
	assert.Equal(t, "round-trip", sr.Metadata.ID)
	assert.True(t, sr.Enabled)
	assert.True(t, sr.DevMode)
	assert.Equal(t, "/my/path", sr.DevPath)
	assert.Equal(t, "oops", sr.LastError)
	assert.Equal(t, 3, sr.ErrorCount)
	assert.Equal(t, now, sr.InstalledAt)
}

func TestPluginRecord_Capabilities(t *testing.T) {
	record := &PluginRecord{
		ID: "caps-test",
		Capabilities: []sdktypes.Capability{
			sdktypes.CapabilityResource,
			sdktypes.CapabilityLog,
		},
	}

	info := record.ToInfo()
	require.Len(t, info.Capabilities, 2)
	assert.Equal(t, sdktypes.CapabilityResource, info.Capabilities[0])
	assert.Equal(t, sdktypes.CapabilityLog, info.Capabilities[1])
}
