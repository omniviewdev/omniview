package telemetry

import (
	"context"
	"strings"

	"github.com/grafana/pyroscope-go"
)

// profilingConfig builds a Pyroscope configuration for the given version and endpoint.
func profilingConfig(version, endpoint, clientID string) pyroscope.Config {
	addr := endpoint
	if !strings.HasPrefix(addr, "http://") && !strings.HasPrefix(addr, "https://") {
		addr = "http://" + addr
	}
	tags := map[string]string{"version": version}
	if clientID != "" {
		tags["omniview_client_id"] = clientID
	}
	return pyroscope.Config{
		ApplicationName: "omniview",
		ServerAddress:   addr,
		Tags:            tags,
		ProfileTypes: []pyroscope.ProfileType{
			pyroscope.ProfileCPU,
			pyroscope.ProfileAllocSpace,
			pyroscope.ProfileGoroutines,
		},
	}
}

// startProfiling starts the Pyroscope profiler with the given version and endpoint.
func startProfiling(version, endpoint, clientID string) (*pyroscope.Profiler, error) {
	cfg := profilingConfig(version, endpoint, clientID)
	return pyroscope.Start(cfg)
}

// WithPluginProfile wraps fn with Pyroscope labels identifying the plugin.
func WithPluginProfile(ctx context.Context, pluginID string, fn func(context.Context)) {
	pyroscope.TagWrapper(ctx, pyroscope.Labels("plugin", pluginID), fn)
}

// WithControllerProfile wraps fn with Pyroscope labels identifying the controller and operation.
func WithControllerProfile(ctx context.Context, controller, op string, fn func(context.Context)) {
	pyroscope.TagWrapper(ctx, pyroscope.Labels("controller", controller, "operation", op), fn)
}
