package plugin

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func newProfilingManager(t *testing.T, provider pkgsettings.Provider) *pluginManager {
	t.Helper()
	return NewManager(testLogger(t), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, provider, nil, nil).(*pluginManager)
}

func TestPluginProfilingDefaultsAndFrozenStartupSetting(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		provider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{PluginSettings: []pkgsettings.Category{{
			ID: "developer", Settings: map[string]pkgsettings.Setting{
				"plugin_pprof_enabled": {ID: "plugin_pprof_enabled", Type: pkgsettings.Toggle, Default: false},
			},
		}}})
		require.False(t, newProfilingManager(t, provider).pluginPprofEnabled)
		require.NoError(t, provider.SetSetting("developer.plugin_pprof_enabled", enabled))
		pm := newProfilingManager(t, provider)
		require.Equal(t, enabled, pm.pluginPprofEnabled)
		require.NoError(t, provider.SetSetting("developer.plugin_pprof_enabled", !enabled))
		require.Equal(t, enabled, pm.pluginPprofEnabled, "saved changes must not change existing manager")
		require.Equal(t, !enabled, newProfilingManager(t, provider).pluginPprofEnabled)
	}
	require.False(t, newProfilingManager(t, nil).pluginPprofEnabled)
	require.False(t, newProfilingManager(t, pkgsettings.NewProvider(pkgsettings.ProviderOpts{})).pluginPprofEnabled)
	invalidType := pkgsettings.NewProvider(pkgsettings.ProviderOpts{PluginSettings: []pkgsettings.Category{{
		ID: "developer", Settings: map[string]pkgsettings.Setting{
			"plugin_pprof_enabled": {ID: "plugin_pprof_enabled", Type: pkgsettings.Text, Default: "true"},
		},
	}}})
	require.False(t, newProfilingManager(t, invalidType).pluginPprofEnabled)
}

func TestPluginProfilingEnvironmentOverridesAllInheritedValues(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		pm := &pluginManager{pluginPprofEnabled: enabled}
		environment := pm.pluginProfilingEnvironment([]string{
			"PATH=/bin", "OMNIVIEW_PLUGIN_PPROF_ENABLED=true", "OMNIVIEW_PPROF_PORT=6060",
			"OMNIVIEW_PLUGIN_PPROF_ENABLED=false", "OMNIVIEW_PPROF_PORT=7070",
			"OMNIVIEW_TELEMETRY_PROFILING=true",
		})
		expected := "OMNIVIEW_PLUGIN_PPROF_ENABLED=false"
		if enabled {
			expected = "OMNIVIEW_PLUGIN_PPROF_ENABLED=true"
		}
		require.Equal(t, []string{"PATH=/bin", "OMNIVIEW_TELEMETRY_PROFILING=true", expected}, environment)
	}
}

type profilingRPCClient struct {
	lifecyclepb.PluginLifecycleClient
	query func(context.Context) (*lifecyclepb.ProfilingStatusResponse, error)
}

func (c *profilingRPCClient) GetProfilingStatus(ctx context.Context, _ *emptypb.Empty, _ ...grpc.CallOption) (*lifecyclepb.ProfilingStatusResponse, error) {
	return c.query(ctx)
}

func profilingTestBackend(query func(context.Context) (*lifecyclepb.ProfilingStatusResponse, error)) *plugintypes.InProcessBackend {
	return plugintypes.NewInProcessBackend(map[string]interface{}{
		"lifecycle": lc.NewClient(&profilingRPCClient{query: query}),
	})
}

func TestPluginProfilingStatusesUseLifecycleStatusAndStableOrdering(t *testing.T) {
	pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{}}
	responses := map[string]*lifecyclepb.ProfilingStatusResponse{
		"running":  {Running: true, Url: "http://127.0.0.1:43210", Pid: 1234},
		"disabled": {Pid: 2345},
		"failed":   {Error: "listen failed", Pid: 3456},
	}
	for id, response := range responses {
		pm.records[id] = &plugintypes.PluginRecord{
			ID: id, Phase: lifecycle.PhaseRunning,
			Backend: profilingTestBackend(func(ctx context.Context) (*lifecyclepb.ProfilingStatusResponse, error) {
				deadline, ok := ctx.Deadline()
				require.True(t, ok)
				require.LessOrEqual(t, time.Until(deadline), pluginProfilingTimeout)
				return response, nil
			}),
		}
	}
	wrapper := &ServiceWrapper{Mgr: pm}
	require.Equal(t, []PluginProfilingStatus{
		{PluginID: "disabled", Supported: true, PID: 2345},
		{PluginID: "failed", Supported: true, Error: "listen failed", PID: 3456},
		{PluginID: "running", Supported: true, Running: true, URL: "http://127.0.0.1:43210", PID: 1234},
	}, wrapper.GetPluginProfilingStatuses())
	require.Empty(t, (&pluginManager{}).GetPluginProfilingStatuses())
}

func TestPluginProfilingStatusesDistinguishUnsupportedAndRPCFailure(t *testing.T) {
	for _, test := range []struct {
		name      string
		err       error
		supported bool
	}{
		{name: "old SDK", err: status.Error(codes.Unimplemented, "unknown method"), supported: false},
		{name: "RPC failure", err: status.Error(codes.Unavailable, "disconnected"), supported: true},
		{name: "timeout", err: context.DeadlineExceeded, supported: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			backend := profilingTestBackend(func(context.Context) (*lifecyclepb.ProfilingStatusResponse, error) {
				return nil, test.err
			})
			pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{
				"fixture": {ID: "fixture", Phase: lifecycle.PhaseRunning, Backend: backend},
			}}
			result := pm.GetPluginProfilingStatuses()
			require.Len(t, result, 1)
			require.Equal(t, test.supported, result[0].Supported)
			require.NotEmpty(t, result[0].Error)
			require.False(t, result[0].Running)
			require.Empty(t, result[0].URL)
			require.Zero(t, result[0].PID)
		})
	}
}

func TestPluginProfilingLegacyLifecycleRPCReportsUnsupported(t *testing.T) {
	client, server := serveLifecycleFixture(t, &lifecycleRPCFixture{})
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"lifecycle": client})
	pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{
		"legacy": {ID: "legacy", Phase: lifecycle.PhaseRunning, Backend: backend},
	}}
	result := pm.GetPluginProfilingStatuses()
	require.False(t, result[0].Supported)
	require.Equal(t, "Plugin SDK does not support profiling status", result[0].Error)
	require.Empty(t, result[0].URL)

	server.Stop()
	result = pm.GetPluginProfilingStatuses()
	require.True(t, result[0].Supported)
	require.NotEmpty(t, result[0].Error)
	require.False(t, result[0].Running)
	require.Empty(t, result[0].URL)
}

func TestPluginProfilingStatusesDropDisplacedOrExitedBackend(t *testing.T) {
	for _, transition := range []string{"reload", "unload", "exit", "stop"} {
		t.Run(transition, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			backend := profilingTestBackend(func(ctx context.Context) (*lifecyclepb.ProfilingStatusResponse, error) {
				close(entered)
				select {
				case <-release:
					return &lifecyclepb.ProfilingStatusResponse{Running: true, Url: "http://127.0.0.1:43210", Pid: 1234}, nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			})
			pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{
				"fixture": {ID: "fixture", Phase: lifecycle.PhaseRunning, Backend: backend},
			}}
			done := make(chan []PluginProfilingStatus, 1)
			go func() { done <- pm.GetPluginProfilingStatuses() }()
			<-entered
			// Taking this lock while the RPC waits also proves no inventory lock
			// is retained across the remote call.
			pm.recordsMu.Lock()
			switch transition {
			case "reload":
				pm.records["fixture"] = &plugintypes.PluginRecord{ID: "fixture", Phase: lifecycle.PhaseRunning, Backend: plugintypes.NewInProcessBackend(nil)}
			case "unload":
				delete(pm.records, "fixture")
			case "exit":
				backend.Kill()
			case "stop":
				pm.records["fixture"].Phase = lifecycle.PhaseStopped
			}
			pm.recordsMu.Unlock()
			close(release)
			result := <-done
			require.Len(t, result, 1)
			require.True(t, result[0].Supported)
			require.False(t, result[0].Running)
			require.Empty(t, result[0].URL)
			require.Zero(t, result[0].PID)
			require.NotEmpty(t, result[0].Error)
		})
	}
}

func TestPluginProfilingStatusesRecheckEarlierResults(t *testing.T) {
	first := profilingTestBackend(func(context.Context) (*lifecyclepb.ProfilingStatusResponse, error) {
		return &lifecyclepb.ProfilingStatusResponse{Running: true, Url: "http://127.0.0.1:43210", Pid: 1234}, nil
	})
	second := profilingTestBackend(func(context.Context) (*lifecyclepb.ProfilingStatusResponse, error) {
		first.Kill()
		return &lifecyclepb.ProfilingStatusResponse{}, nil
	})
	pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{
		"a": {ID: "a", Phase: lifecycle.PhaseRunning, Backend: first},
		"b": {ID: "b", Phase: lifecycle.PhaseRunning, Backend: second},
	}}
	result := pm.GetPluginProfilingStatuses()
	require.False(t, result[0].Running)
	require.Empty(t, result[0].URL)
	require.Zero(t, result[0].PID)
	require.NotEmpty(t, result[0].Error)
}

func TestPluginProfilingStatusesShareOnePollDeadline(t *testing.T) {
	firstEntered := make(chan struct{})
	first := profilingTestBackend(func(ctx context.Context) (*lifecyclepb.ProfilingStatusResponse, error) {
		close(firstEntered)
		<-ctx.Done()
		return nil, ctx.Err()
	})
	second := profilingTestBackend(func(ctx context.Context) (*lifecyclepb.ProfilingStatusResponse, error) {
		select {
		case <-firstEntered:
			return &lifecyclepb.ProfilingStatusResponse{Running: true, Url: "http://127.0.0.1:43211", Pid: 5678}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{
		"a": {ID: "a", Phase: lifecycle.PhaseRunning, Backend: first},
		"b": {ID: "b", Phase: lifecycle.PhaseRunning, Backend: second},
	}}
	started := time.Now()
	result := pm.GetPluginProfilingStatuses()
	require.Less(t, time.Since(started), 2*pluginProfilingTimeout)
	require.Len(t, result, 2)
	require.Equal(t, "a", result[0].PluginID)
	require.True(t, result[0].Supported)
	require.False(t, result[0].Running)
	require.Empty(t, result[0].URL)
	require.Zero(t, result[0].PID)
	require.Contains(t, result[0].Error, "deadline exceeded")
	require.Equal(t, "b", result[1].PluginID)
	require.True(t, result[1].Supported)
	require.True(t, result[1].Running)
	require.Equal(t, "http://127.0.0.1:43211", result[1].URL)
	require.Equal(t, 5678, result[1].PID)
	require.Empty(t, result[1].Error)
}

func TestPluginProfilingStatusesExcludeInactiveBackends(t *testing.T) {
	backend := profilingTestBackend(func(context.Context) (*lifecyclepb.ProfilingStatusResponse, error) {
		t.Error("stopped backend must not be queried")
		return nil, errors.New("unexpected RPC")
	})
	pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{
		"no-backend": {ID: "no-backend", Phase: lifecycle.PhaseRunning},
		"stopped":    {ID: "stopped", Phase: lifecycle.PhaseStopped, Backend: backend},
		"disabled":   {ID: "disabled", Phase: lifecycle.PhaseStopped, Enabled: false},
		"failed":     {ID: "failed", Phase: lifecycle.PhaseFailed, Backend: backend},
	}}
	require.Empty(t, pm.GetPluginProfilingStatuses())
}
