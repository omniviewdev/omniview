package telemetry

import (
	"testing"

	"github.com/grafana/pyroscope-go"
	"github.com/stretchr/testify/assert"
)

func TestProfilingConfig(t *testing.T) {
	cfg := profilingConfig("1.0.0", "localhost:4040")
	assert.Equal(t, "omniview", cfg.ApplicationName)
	assert.Equal(t, "http://localhost:4040", cfg.ServerAddress)
	assert.Equal(t, "1.0.0", cfg.Tags["version"])
	assert.ElementsMatch(t, []pyroscope.ProfileType{
		pyroscope.ProfileCPU,
		pyroscope.ProfileAllocSpace,
		pyroscope.ProfileGoroutines,
	}, cfg.ProfileTypes)
}
