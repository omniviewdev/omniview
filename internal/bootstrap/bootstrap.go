package bootstrap

import (
	"context"
	"errors"
	"net/url"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	"github.com/omniviewdev/omniview/internal/telemetry"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

const settingsChangedEvent = "settings/changed"

func init() {
	// Invalidation only: setting values can contain credentials.
	application.RegisterEvent[settingsservice.Scope](settingsChangedEvent)
}

// Service wraps the startup/shutdown logic that was previously in the
// Wails v2 OnStartup/OnShutdown closures. It implements ServiceStartup and
// ServiceShutdown so the Wails v3 runtime calls it automatically.
type Service struct {
	Log                  logging.Logger
	Settings             *settingsservice.Service
	TelemetrySvc         *telemetry.Service
	PluginManager        plugin.Manager
	PluginRegistryClient *registry.Client
}

func (b *Service) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// Startup consumers already have hydrated values. The settings service owns
	// committed notifications; bootstrap supplies only service-specific effects.
	b.attachSettingsEffects(ctx)

	// Apply user-configured marketplace URL to the registry client.
	marketplaceURL, urlErr := b.Settings.Provider().GetString("developer.marketplace_url")
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

func (b *Service) attachSettingsEffects(ctx context.Context) {
	b.Settings.SetApplyHandler(func(category string, values map[string]any) error {
		if category != coresettings.Telemetry.ID {
			return nil
		}
		cfg := b.TelemetrySvc.Config().WithSettings(values)
		if err := b.TelemetrySvc.ApplyConfig(ctx, cfg); err != nil {
			b.Log.Errorw(ctx, "failed to apply telemetry config change", "error", err)
			return errors.New("telemetry could not apply the saved settings")
		}
		b.Log.Infow(ctx, "telemetry config updated from settings")
		return nil
	})
	b.Settings.SetChangeHandler(func(scope settingsservice.Scope) {
		if app := application.Get(); app != nil {
			app.Event.Emit(settingsChangedEvent, scope)
		}
	})
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
