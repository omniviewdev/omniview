package bootstrap

import (
	"path/filepath"
	"testing"

	coresettings "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func newDeveloperProvider(t *testing.T) pkgsettings.Provider {
	t.Helper()
	provider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{})
	for _, s := range coresettings.Developer.Settings {
		if err := provider.RegisterSetting(coresettings.Developer.ID, s); err != nil {
			t.Fatalf("register %s: %v", s.ID, err)
		}
	}
	return provider
}

func TestHydrateCategorySkipsUnknownKeys(t *testing.T) {
	provider := newDeveloperProvider(t)

	hydrateCategory(provider, coresettings.Developer, map[string]any{
		"pnpmpath":        "/opt/homebrew/bin/pnpm",
		"removed_setting": "left over from another build",
	})

	got, err := provider.GetSettingValue("developer.pnpmpath")
	if err != nil {
		t.Fatalf("GetSettingValue: %v", err)
	}
	if got != "/opt/homebrew/bin/pnpm" {
		t.Fatalf("pnpmpath = %v, want /opt/homebrew/bin/pnpm", got)
	}
}

func TestRegisterCoreSettingsMigratesAndPersistsAppearanceTheme(t *testing.T) {
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("open settings store: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Errorf("close settings store: %v", closeErr)
		}
	})
	if err := store.SaveCategory(coresettings.Appearance.ID, map[string]any{"theme": "solarized"}); err != nil {
		t.Fatalf("seed appearance settings: %v", err)
	}

	provider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{})
	service := Service{SettingsProvider: provider, SettingsStore: store}
	service.registerCoreSettings([]pkgsettings.Category{coresettings.Appearance})

	got, err := provider.GetSettingValue("appearance.theme")
	if err != nil {
		t.Fatalf("get hydrated appearance theme: %v", err)
	}
	if got != "solarized-dark" {
		t.Fatalf("hydrated appearance theme = %v, want solarized-dark", got)
	}
	persisted, err := store.LoadCategory(coresettings.Appearance.ID)
	if err != nil {
		t.Fatalf("reload appearance settings: %v", err)
	}
	if persisted["theme"] != "solarized-dark" {
		t.Fatalf("persisted appearance theme = %v, want solarized-dark", persisted["theme"])
	}
}

func TestRegisterCoreSettingsMigratesAndPersistsTerminalTheme(t *testing.T) {
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("open settings store: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Errorf("close settings store: %v", closeErr)
		}
	})
	if err := store.SaveCategory(coresettings.Terminal.ID, map[string]any{
		"theme":    "default",
		"fontSize": 14,
	}); err != nil {
		t.Fatalf("seed terminal settings: %v", err)
	}

	provider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{})
	service := Service{SettingsProvider: provider, SettingsStore: store}
	service.registerCoreSettings([]pkgsettings.Category{coresettings.Terminal})

	got, err := provider.GetSettingValue("terminal.theme")
	if err != nil {
		t.Fatalf("get hydrated terminal theme: %v", err)
	}
	if got != "application" {
		t.Fatalf("hydrated terminal theme = %v, want application", got)
	}
	persisted, err := store.LoadCategory(coresettings.Terminal.ID)
	if err != nil {
		t.Fatalf("reload terminal settings: %v", err)
	}
	if persisted["theme"] != "application" {
		t.Fatalf("persisted terminal theme = %v, want application", persisted["theme"])
	}
	if persisted["fontSize"] != float64(14) {
		t.Fatalf("persisted terminal fontSize = %v, want 14", persisted["fontSize"])
	}
}
