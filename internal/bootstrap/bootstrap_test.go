package bootstrap

import (
	"testing"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"

	coresettings "github.com/omniviewdev/omniview/internal/settings"
)

func newDeveloperProvider(t *testing.T) pkgsettings.Provider {
	t.Helper()
	provider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{})
	for _, s := range coresettings.Developer.Settings {
		provider.RegisterSetting(coresettings.Developer.ID, s)
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
