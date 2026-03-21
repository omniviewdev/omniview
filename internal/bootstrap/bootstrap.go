package bootstrap

import (
	"context"
	"fmt"
	"net/url"
	"os"

	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/omniviewdev/omniview/internal/telemetry"
)

// Service wraps the startup/shutdown logic that was previously in the
// Wails v2 OnStartup/OnShutdown closures. It implements ServiceStartup and
// ServiceShutdown so the Wails v3 runtime calls it automatically.
type Service struct {
	Log                  logging.Logger
	SettingsProvider     pkgsettings.Provider
	SettingsStore        *settingsstore.Store
	TelemetrySvc         *telemetry.Service
	PluginManager        plugin.Manager
	PluginRegistryClient *registry.Client
}

func (b *Service) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// Register core settings categories and hydrate from bbolt.
	coreCategories := []pkgsettings.Category{
		coresettings.General, coresettings.Appearance,
		coresettings.Terminal, coresettings.Editor,
		coresettings.Developer, coresettings.Telemetry,
	}
	for _, category := range coreCategories {
		for _, s := range category.Settings {
			b.SettingsProvider.RegisterSetting(category.ID, s)
		}
		if b.SettingsStore != nil {
			if vals, loadErr := b.SettingsStore.LoadCategory(category.ID); loadErr == nil && len(vals) > 0 {
				prefixed := make(map[string]any, len(vals))
				for k, v := range vals {
					prefixed[category.ID+"."+k] = v
				}
				if setErr := b.SettingsProvider.SetSettings(prefixed); setErr != nil {
					fmt.Fprintf(os.Stderr, "failed to hydrate settings category %s: %v\n", category.ID, setErr)
				}
			}
		}
	}

	// Wire persistence: save to bbolt whenever a category changes.
	for _, category := range coreCategories {
		catID := category.ID
		b.SettingsProvider.RegisterChangeHandler(catID, func(vals map[string]any) {
			if b.SettingsStore != nil {
				if saveErr := b.SettingsStore.SaveCategory(catID, vals); saveErr != nil {
					fmt.Fprintf(os.Stderr, "failed to persist settings category %s: %v\n", catID, saveErr)
				}
			}
		})
	}

	// Wire telemetry settings hot-toggle: when any setting in the
	// "telemetry" category changes, rebuild TelemetryConfig and apply.
	telemetryFromSettings := func(vals map[string]any) telemetry.TelemetryConfig {
		cfg := b.TelemetrySvc.Config()
		if v, ok := vals["enabled"].(bool); ok {
			cfg.Enabled = v
		}
		if v, ok := vals["traces"].(bool); ok {
			cfg.Traces = v
		}
		if v, ok := vals["metrics"].(bool); ok {
			cfg.Metrics = v
		}
		if v, ok := vals["logs_ship"].(bool); ok {
			cfg.LogsShip = v
		}
		if v, ok := vals["logs_ship_level"].(string); ok {
			cfg.LogsShipLevel = v
		}
		if v, ok := vals["profiling"].(bool); ok {
			cfg.Profiling = v
		}
		if v, ok := vals["endpoint_otlp"].(string); ok {
			cfg.OTLPEndpoint = v
		}
		if v, ok := vals["endpoint_pyroscope"].(string); ok {
			cfg.PyroscopeEndpoint = v
		}
		if v, ok := vals["auth_header"].(string); ok {
			cfg.AuthHeader = v
		}
		if v, ok := vals["auth_value"].(string); ok {
			cfg.AuthValue = v
		}
		return cfg
	}

	b.SettingsProvider.RegisterChangeHandler("telemetry", func(vals map[string]any) {
		cfg := telemetryFromSettings(vals)
		if err := b.TelemetrySvc.ApplyConfig(ctx, cfg); err != nil {
			b.Log.Errorw(ctx, "failed to apply telemetry config change", "error", err)
		} else {
			b.Log.Infow(ctx, "telemetry config updated from settings")
		}
	})

	// Apply the persisted telemetry settings immediately so telemetry
	// activates on startup (the change handler only fires on changes).
	if b.SettingsStore != nil {
		if vals, err := b.SettingsStore.LoadCategory("telemetry"); err == nil && len(vals) > 0 {
			cfg := telemetryFromSettings(vals)
			if err := b.TelemetrySvc.ApplyConfig(ctx, cfg); err != nil {
				b.Log.Errorw(ctx, "failed to apply initial telemetry config", "error", err)
			} else {
				b.Log.Infow(ctx, "telemetry initialized from persisted settings", "enabled", cfg.Enabled)
			}
		}
	}

	// Apply user-configured marketplace URL to the registry client.
	if marketplaceURL, err := b.SettingsProvider.GetString("developer.marketplace_url"); err == nil && marketplaceURL != "" {
		b.PluginRegistryClient.SetBaseURL(marketplaceURL)
		safeHost := marketplaceURL
		if u, parseErr := url.Parse(marketplaceURL); parseErr == nil {
			safeHost = u.Host
		}
		b.Log.Infow(ctx, "using custom marketplace URL", "host", safeHost)
	}

	// Controllers now implement ServiceStartup/ServiceShutdown and are
	// registered as Wails v3 services, so Wails calls their lifecycle
	// methods automatically.

	// Initialize the plugin system
	if err := b.PluginManager.Initialize(ctx); err != nil {
		b.Log.Errorw(ctx, "error while initializing plugin system", "error", err)
	}
	b.PluginManager.Run(ctx)

	return nil
}

func (b *Service) ServiceShutdown() error {
	// DevServerManager and controllers have their own ServiceShutdown
	// called by Wails v3 automatically.
	b.PluginManager.Shutdown()
	_ = b.TelemetrySvc.Shutdown(context.Background())
	return nil
}
