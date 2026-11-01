// Package profiling resolves host settings and exposes profiler runtime status.
package profiling

import (
	"fmt"
	"strconv"

	sdkprofiling "github.com/omniviewdev/plugin-sdk/pkg/profiling"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// ResolveConfig reads prepared settings without mutating their saved values.
// Only malformed explicit environment input is a fatal configuration error.
func ResolveConfig(provider pkgsettings.Provider, rejectedIDs []string, environment string) (sdkprofiling.Config, string, error) {
	if environment != "" {
		port, err := strconv.ParseUint(environment, 10, 16)
		if err != nil {
			return sdkprofiling.Config{}, "environment", fmt.Errorf("OMNIVIEW_PPROF_PORT must be a port number from 0 to 65535: %w", err)
		}
		return sdkprofiling.Config{Enabled: true, Port: int(port), Diagnostic: ""}, "environment", nil
	}
	invalid := func() (sdkprofiling.Config, string, error) {
		return sdkprofiling.Config{
			Enabled: false,
			Port:    0,
			Diagnostic: "Host profiling settings are invalid or unavailable. " +
				"Save valid profiling settings and restart Omniview.",
		}, "settings", nil
	}
	for _, id := range rejectedIDs {
		if id == "developer.pprof_enabled" || id == "developer.pprof_port" {
			return invalid()
		}
	}
	if provider == nil {
		return invalid()
	}
	enabled, err := provider.GetSettingValue("developer.pprof_enabled")
	if err != nil {
		return invalid()
	}
	port, err := provider.GetSettingValue("developer.pprof_port")
	if err != nil {
		return invalid()
	}
	enabledValue, ok := enabled.(bool)
	if !ok {
		return invalid()
	}
	portValue, ok := port.(int)
	if !ok || portValue < 0 || portValue > 65535 {
		return invalid()
	}
	return sdkprofiling.Config{Enabled: enabledValue, Port: portValue, Diagnostic: ""}, "settings", nil
}

// ServiceWrapper exposes runtime facts, never listener controls, to the frontend.
type ServiceWrapper struct{ Service *sdkprofiling.Service }

func (s *ServiceWrapper) GetStatus() sdkprofiling.Status { return s.Service.GetStatus() }
