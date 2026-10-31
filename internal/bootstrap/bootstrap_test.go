package bootstrap

import (
	"path/filepath"
	"testing"

	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
)

// TestPreparedCoreSettingsPreserveMigrations proves real host definitions and
// migrations are ready for service consumers before Wails startup callbacks.
func TestPreparedCoreSettingsPreserveMigrations(t *testing.T) {
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for category, values := range map[string]map[string]any{
		"appearance": {"theme": "solarized"},
		"terminal":   {"theme": "default", "fontSize": 14},
		"developer":  {"pprof_port": 6069, "removed_setting": "old build"},
	} {
		if saveErr := store.SaveCategory(category, values); saveErr != nil {
			t.Fatal(saveErr)
		}
	}
	core, err := settingsservice.Initialize(settingsservice.Options{
		Store:      store,
		Categories: coresettings.Definitions(false),
		Migrations: map[string]settingsservice.Migration{
			"appearance": coresettings.MigrateAppearanceValues,
			"terminal":   coresettings.MigrateTerminalValues,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	provider := core.Provider()
	for id, want := range map[string]string{"appearance.theme": "solarized-dark", "terminal.theme": "application"} {
		if got, readErr := provider.GetString(id); readErr != nil || got != want {
			t.Fatalf("%s = %q, %v; want %q", id, got, readErr, want)
		}
	}
	if got, readErr := provider.GetInt("terminal.fontSize"); readErr != nil || got != 14 {
		t.Fatalf("terminal font size = %d, %v", got, readErr)
	}
	if got, readErr := provider.GetInt("developer.pprof_port"); readErr != nil || got != 6069 {
		t.Fatalf("prepared profiling port = %d, %v", got, readErr)
	}
	snapshot, snapshotErr := core.GetSnapshot(settingsservice.Scope{Kind: "host", PluginID: ""})
	if snapshotErr != nil {
		t.Fatal(snapshotErr)
	}
	setting := snapshot.Categories["developer"].Settings["pprof_port"]
	if setting.PendingRestart || !setting.RequiresRestart {
		t.Fatalf("hydrated value must be startup baseline: %+v", setting)
	}
	appearance, err := store.LoadCategory("appearance")
	if err != nil || appearance["theme"] != "solarized-dark" {
		t.Fatalf("appearance migration not persisted: %v, %v", appearance, err)
	}
	terminal, err := store.LoadCategory("terminal")
	if err != nil || terminal["theme"] != "application" || terminal["fontSize"] != float64(14) {
		t.Fatalf("terminal migration not persisted with sibling: %v, %v", terminal, err)
	}
}
