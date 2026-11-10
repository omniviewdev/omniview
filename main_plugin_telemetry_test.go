package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/telemetry"
)

func TestPluginTelemetryStartupRespectsMasterSwitch(t *testing.T) {
	svc := telemetry.New(telemetry.Config{
		Enabled: false, Profiling: true, PyroscopeEndpoint: "http://profiles.example",
	}, "", "", "", false, t.TempDir())
	disabled, err := pluginTelemetryConfig(svc, "kubernetes")
	require.NoError(t, err)
	require.False(t, disabled.Enabled)
	require.Empty(t, disabled.OTLPEndpoint)
	require.Nil(t, disabled.Cleanup)

	// The running SDK has already seen the disabled value. A new launch is required.
	require.NoError(t, svc.ApplyConfig(context.Background(), telemetry.Config{
		Enabled: true, Traces: true, OTLPEndpoint: "http://127.0.0.1:4318",
	}))
	restarted, err := pluginTelemetryConfig(svc, "kubernetes")
	require.NoError(t, err)
	require.True(t, restarted.Enabled)
	require.NotEmpty(t, restarted.OTLPEndpoint)
	require.NotEmpty(t, restarted.AuthToken)
	defer restarted.Cleanup()

	tracingDisabled := telemetry.New(telemetry.Config{Enabled: true}, "", "", "", false, t.TempDir())
	noTrace, err := pluginTelemetryConfig(tracingDisabled, "kubernetes")
	require.NoError(t, err)
	require.False(t, noTrace.Enabled)
	require.Nil(t, noTrace.Cleanup)

	profiling := telemetry.New(telemetry.Config{
		Enabled: true, Profiling: true, PyroscopeEndpoint: "http://profiles.example",
	}, "", "", "", false, t.TempDir())
	configured, err := pluginTelemetryConfig(profiling, "kubernetes")
	require.NoError(t, err)
	require.True(t, configured.Profiling)
	require.Equal(t, "http://profiles.example", configured.PyroscopeEndpoint)
	defer configured.Cleanup()
}
