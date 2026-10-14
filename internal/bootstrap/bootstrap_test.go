package bootstrap

import (
	"testing"

	coresettings "github.com/omniviewdev/omniview/internal/settings"
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
