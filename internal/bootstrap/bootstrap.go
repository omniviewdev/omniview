package bootstrap

import (
	"context"
	"errors"
	"net/url"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	"github.com/omniviewdev/omniview/internal/telemetry"
	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const settingsChangedEvent = "settings/changed"

func init() {
	// Invalidation only: setting values can contain credentials.
	application.RegisterEvent[string](settingsChangedEvent)
}

// Service wraps the startup/shutdown logic that was previously in the
// Wails v2 OnStartup/OnShutdown closures. It implements ServiceStartup and
// ServiceShutdown so the Wails v3 runtime calls it automatically.
type Service struct {
	Log                  logging.Logger
	SettingsProvider     pkgsettings.Provider
	SettingsCategories   []pkgsettings.Category
	ReportApplyError     func(error)
	TelemetrySvc         *telemetry.Service
	PluginManager        plugin.Manager
	PluginRegistryClient *registry.Client
}

func (b *Service) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// Settings are already hydrated before services are constructed. One handler
	// per category applies live effects and invalidates UI after durable writes.
	b.applyOnChange(ctx)

	// Apply user-configured marketplace URL to the registry client.
	marketplaceURL, urlErr := b.SettingsProvider.GetString("developer.marketplace_url")
	if urlErr == nil && marketplaceURL != "" {
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

// applyOnChange registers post-commit effects without owning persistence.
func (b *Service) applyOnChange(ctx context.Context) {
	for _, category := range b.SettingsCategories {
		catID := category.ID
		b.SettingsProvider.RegisterChangeHandler(catID, func(vals map[string]any) {
			if catID == coresettings.Telemetry.ID {
				cfg := b.TelemetrySvc.Config().WithSettings(vals)
				if err := b.TelemetrySvc.ApplyConfig(ctx, cfg); err != nil {
					b.Log.Errorw(ctx, "failed to apply telemetry config change", "error", err)
					if b.ReportApplyError != nil {
						b.ReportApplyError(errors.New("telemetry could not apply the saved settings"))
					}
				} else {
					b.Log.Infow(ctx, "telemetry config updated from settings")
				}
			}
			if app := application.Get(); app != nil {
				app.Event.Emit(settingsChangedEvent, catID)
			}
		})
	}
}

func (b *Service) ServiceShutdown() error {
	// DevServerManager and controllers have their own ServiceShutdown
	// called by Wails v3 automatically.
	b.PluginManager.Shutdown()
	if err := b.TelemetrySvc.Shutdown(context.Background()); err != nil {
		b.Log.Errorw(context.Background(), "failed to shut down telemetry", "error", err)
	}
	return nil
}
