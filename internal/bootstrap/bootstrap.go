package bootstrap

import (
	"context"
	"fmt"
	"net/url"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
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
	b.registerCoreSettings(coreCategories)

	// One handler per category owns persistence, side effects and UI invalidation.
	b.persistOnChange(ctx, coreCategories)

	// Apply the persisted telemetry settings immediately so telemetry
	// activates on startup (the change handler only fires on changes).
	if b.SettingsStore != nil {
		if vals, err := b.SettingsStore.LoadCategory("telemetry"); err == nil && len(vals) > 0 {
			cfg := b.TelemetrySvc.Config().WithSettings(vals)
			if applyErr := b.TelemetrySvc.ApplyConfig(ctx, cfg); applyErr != nil {
				b.Log.Errorw(ctx, "failed to apply initial telemetry config", "error", applyErr)
			} else {
				b.Log.Infow(ctx, "telemetry initialized from persisted settings", "enabled", cfg.Enabled)
			}
		}
	}

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

// registerCoreSettings registers the core settings categories with the settings
// provider and hydrates them from the persisted store.
func (b *Service) registerCoreSettings(coreCategories []pkgsettings.Category) {
	for _, category := range coreCategories {
		for _, s := range category.Settings {
			// Registration only fails on a type mismatch with an already-registered setting.
			_ = b.SettingsProvider.RegisterSetting(category.ID, s)
		}
		if b.SettingsStore != nil {
			if vals, loadErr := b.SettingsStore.LoadCategory(category.ID); loadErr == nil && len(vals) > 0 {
				var changed bool
				switch category.ID {
				case coresettings.Appearance.ID:
					vals, changed = coresettings.MigrateAppearanceValues(vals)
				case coresettings.Terminal.ID:
					vals, changed = coresettings.MigrateTerminalValues(vals)
				}
				if changed {
					if saveErr := b.SettingsStore.SaveCategory(category.ID, vals); saveErr != nil {
						fmt.Fprintf(os.Stderr, "failed to persist migrated settings category %s: %v\n", category.ID, saveErr)
					}
				}
				hydrateCategory(b.SettingsProvider, category, vals)
			}
		}
	}
}

// persistOnChange registers the single category callback supported by the SDK.
func (b *Service) persistOnChange(ctx context.Context, coreCategories []pkgsettings.Category) {
	for _, category := range coreCategories {
		catID := category.ID
		b.SettingsProvider.RegisterChangeHandler(catID, func(vals map[string]any) {
			if b.SettingsStore != nil {
				if saveErr := b.SettingsStore.SaveCategory(catID, vals); saveErr != nil {
					fmt.Fprintf(os.Stderr, "failed to persist settings category %s: %v\n", catID, saveErr)
				}
			}
			if catID == coresettings.Telemetry.ID {
				cfg := b.TelemetrySvc.Config().WithSettings(vals)
				if err := b.TelemetrySvc.ApplyConfig(ctx, cfg); err != nil {
					b.Log.Errorw(ctx, "failed to apply telemetry config change", "error", err)
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

// hydrateCategory applies persisted values to the registered settings of a
// category. SetSettings is all-or-nothing, so a single stored key the current
// build does not declare (written by a newer build, or since removed) or a
// value that no longer validates would otherwise discard the whole category.
// Unknown keys are skipped, and on a validation failure each value is applied
// on its own so the rest still load.
func hydrateCategory(provider pkgsettings.Provider, category pkgsettings.Category, vals map[string]any) {
	prefixed := make(map[string]any, len(vals))
	for k, v := range vals {
		if _, ok := category.Settings[k]; !ok {
			fmt.Fprintf(os.Stderr, "ignoring unknown persisted setting %s.%s\n", category.ID, k)
			continue
		}
		prefixed[category.ID+"."+k] = v
	}
	if len(prefixed) == 0 {
		return
	}
	if err := provider.SetSettings(prefixed); err == nil {
		return
	}
	for id, v := range prefixed {
		if err := provider.SetSetting(id, v); err != nil {
			fmt.Fprintf(os.Stderr, "failed to hydrate setting %s: %v\n", id, err)
		}
	}
}
