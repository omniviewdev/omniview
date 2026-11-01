//go:build devcontrol

package host

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	pluginsettings "github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

func TestUnknownPersistedPluginSchemaNeverBecomesPublic(t *testing.T) {
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.SavePluginSettings("fixture", map[string]any{"unknown.key": "fixture-private-value"}); err != nil {
		t.Fatal(err)
	}
	controller := pluginsettings.NewController(logging.NewNop(), store)
	service, initErr := settingsservice.Initialize(settingsservice.Options{
		Store: store, Categories: nil, Migrations: nil, Logger: nil,
	})
	if initErr != nil {
		t.Fatal(initErr)
	}
	service.AttachPlugins(controller)
	adapter := devcontrol.NewSettingsAdapter(service)
	schema, err := adapter.Schema(devcontrol.SettingsParams{Scope: "plugin", PluginID: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	setting, ok := schema["unknown.key"]
	if !ok || !setting.Sensitive || setting.Value != "[REDACTED]" {
		t.Fatal("unknown schema was not hidden")
	}
	data, err := json.Marshal(schema)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "fixture-private-value") {
		t.Fatal("unknown persisted value leaked through host bridge")
	}
	values, err := adapter.Get(devcontrol.SettingsParams{Scope: "plugin", PluginID: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	data, _ = json.Marshal(values)
	if strings.Contains(string(data), "fixture-private-value") {
		t.Fatal("unknown persisted value leaked through get")
	}
}
