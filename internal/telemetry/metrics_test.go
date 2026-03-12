package telemetry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

func TestNewMetrics(t *testing.T) {
	mp := sdkmetric.NewMeterProvider()
	defer mp.Shutdown(context.Background())

	m, err := NewMetrics(mp)
	require.NoError(t, err)
	require.NotNil(t, m)
	assert.NotNil(t, m.PluginLoadDuration)
	assert.NotNil(t, m.PluginActive)
	assert.NotNil(t, m.PluginCrashes)
	assert.NotNil(t, m.PluginQuarantines)
	assert.NotNil(t, m.ResourceOpDuration)
	assert.NotNil(t, m.ResourceOpErrors)
	assert.NotNil(t, m.ResourceWatchActive)
	assert.NotNil(t, m.WailsCallDuration)
	assert.NotNil(t, m.WailsCalls)
}
