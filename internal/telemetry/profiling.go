package telemetry

import (
	"context"
	"strings"

	"github.com/grafana/pyroscope-go"
)

// profilingConfig builds a Pyroscope configuration for the given version, endpoint,
// and optional basic-auth credentials (required for Grafana Cloud Profiles).
func profilingConfig(version, endpoint, authUser, authPassword string) pyroscope.Config {
	addr := endpoint
	if !strings.HasPrefix(addr, "http://") && !strings.HasPrefix(addr, "https://") {
		addr = "http://" + addr
	}
	return pyroscope.Config{
		ApplicationName:   "omniview",
		ServerAddress:     addr,
		BasicAuthUser:     authUser,
		BasicAuthPassword: authPassword,
		Tags:              map[string]string{"version": version},
		ProfileTypes: []pyroscope.ProfileType{
			pyroscope.ProfileCPU,
			pyroscope.ProfileAllocSpace,
			pyroscope.ProfileGoroutines,
		},
	}
}

// startProfiling starts the Pyroscope profiler with the given version, endpoint,
// and optional auth credentials.
func startProfiling(version, endpoint, authUser, authPassword string) (*pyroscope.Profiler, error) {
	cfg := profilingConfig(version, endpoint, authUser, authPassword)
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
