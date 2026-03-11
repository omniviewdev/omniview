package telemetry

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDefaultDevConfig(t *testing.T) {
	cfg := DefaultConfig(true)
	assert.True(t, cfg.Enabled)
	assert.True(t, cfg.Traces)
	assert.True(t, cfg.Metrics)
	assert.True(t, cfg.LogsShip)
	assert.Equal(t, "debug", cfg.LogsShipLevel)
	assert.True(t, cfg.Profiling)
	assert.Equal(t, "localhost:4318", cfg.OTLPEndpoint)
	assert.Equal(t, "localhost:4040", cfg.PyroscopeEndpoint)
}

func TestDefaultProdConfig(t *testing.T) {
	cfg := DefaultConfig(false)
	assert.False(t, cfg.Enabled)
	assert.True(t, cfg.Traces)
	assert.True(t, cfg.Metrics)
	assert.True(t, cfg.LogsShip)
	assert.Equal(t, "warn", cfg.LogsShipLevel)
	assert.False(t, cfg.Profiling)
	assert.Empty(t, cfg.OTLPEndpoint)
	assert.Empty(t, cfg.PyroscopeEndpoint)
}
