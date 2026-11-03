package types

import (
	"fmt"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

// NativeProviders is one activation's SDK provider graph. Construct fresh providers
// for each activation; never share providers between backend generations.
// Resource and exec controllers own Close, logs owns Close when available,
// networking owns StopAll, and metrics owns cancellation of its streams.
// Settings and tools expose no disposal contract. Shutdown owns only shared
// clients and other aggregate resources after all controllers have retired.
type NativeProviders struct {
	Resource    resourcev2.Provider
	Exec        exec.Provider
	Logs        logs.Provider
	Metric      metric.Provider
	Networker   networker.Provider
	Settings    settings.Provider
	Tools       tools.Provider
	HealthCheck func() bool
	Shutdown    func() error
}

// ComposeNativeBackend binds SDK utilities to the resource provider's actual
// connection registry without constructing transport plugins or gRPC clients.
// It does not connect, start streams, or bypass host controller admission.
func ComposeNativeBackend(native NativeProviders) (*InProcessBackend, error) {
	providers := make(map[string]interface{})
	if native.Resource != nil {
		providers["resource"] = native.Resource
	}
	utilities := []struct {
		name     string
		provider interface{}
		present  bool
	}{
		{"exec", native.Exec, native.Exec != nil},
		{"log", native.Logs, native.Logs != nil},
		{"metric", native.Metric, native.Metric != nil},
		{"networker", native.Networker, native.Networker != nil},
	}
	connectionProvider, hasConnections := native.Resource.(resourcev2.ConnectionContextProvider)
	// Validate the whole graph before mutating any provider binding.
	for _, utility := range utilities {
		if !utility.present || native.Resource == nil {
			continue
		}
		if !hasConnections {
			return nil, fmt.Errorf("native %s requires resource connection context provider", utility.name)
		}
		if _, ok := utility.provider.(resourcev2.ConnectionContextConsumer); !ok {
			return nil, fmt.Errorf("native %s must consume resource connection context", utility.name)
		}
	}
	for _, utility := range utilities {
		if !utility.present {
			continue
		}
		if hasConnections {
			utility.provider.(resourcev2.ConnectionContextConsumer).BindConnectionContextProvider(connectionProvider)
		}
		providers[utility.name] = utility.provider
	}
	if native.Settings != nil {
		providers["settings"] = native.Settings
	}
	if native.Tools != nil {
		providers["tools"] = native.Tools
	}
	return newOwnedInProcessBackend(InProcessBackendConfig{
		Providers:   providers,
		HealthCheck: native.HealthCheck,
		Shutdown:    native.Shutdown,
	}), nil
}
