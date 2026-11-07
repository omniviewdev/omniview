// Package grafana provides trusted, transport-neutral Prometheus-compatible metrics.
package grafana

import (
	"context"
	"os"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// CatalogEntry is metadata-only until activation. The opener grants only this
// plugin's private store and returns an independently owned handle on each call.
func CatalogEntry(openState func() (*os.Root, error)) plugin.CatalogEntry {
	meta := config.PluginMeta{ID: "grafana", Name: "Grafana", Icon: "SiGrafana", Version: "1.0.0", Description: "External Prometheus-compatible resource metrics", Capabilities: []string{"metric", "ui"}}
	return plugin.CatalogEntry{Metadata: meta, FrontendModule: "grafana", NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
		p := NewProvider(openState)
		var backend *plugintypes.InProcessBackend
		lifecycle := plugintypes.NewNativeLifecycle(meta.ID, meta.Version, meta.Capabilities, func() bool {
			return backend != nil && backend.Healthy()
		})
		var err error
		backend, err = plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Metric: p, Lifecycle: lifecycle, Shutdown: p.Close})
		if err != nil {
			_ = p.Close()
			return nil, err
		}
		return backend, nil
	}}
}

var _ metric.FiniteQueryProvider = (*Provider)(nil)
var _ metric.ProviderConfiguration = (*Provider)(nil)
