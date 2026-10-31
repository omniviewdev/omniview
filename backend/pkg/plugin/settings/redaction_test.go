package settings

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func TestRedactSettingValues_HidesSensitiveAndUnknownSchema(t *testing.T) {
	values := map[string]any{"theme": "dark", "token": "secret-token", "unknown": "unknown-secret"}
	schema := map[string]pkgsettings.Setting{
		"theme": {ID: "theme"},
		"token": {ID: "token", Sensitive: true},
	}
	redacted := RedactSettingValues(values, schema)
	assert.Equal(t, "dark", redacted["theme"])
	assert.Equal(t, "[REDACTED]", redacted["token"])
	assert.Equal(t, "[REDACTED]", redacted["unknown"])
	assert.Equal(t, "secret-token", values["token"], "redaction must not change provider-owned data")
	withoutSchema := RedactSettingValues(values, nil)
	for _, value := range withoutSchema {
		assert.Equal(t, "[REDACTED]", value)
	}
}

func TestRedactSettingsSchema_HidesSensitiveDefaultsAndOptions(t *testing.T) {
	schema := map[string]pkgsettings.Setting{
		"theme": {ID: "theme", Value: "dark", Default: "light"},
		"token": {
			ID: "token", Sensitive: true, Value: "current-secret", Default: "default-secret",
			Options:       []pkgsettings.SettingOption{{Label: "credential", Value: "option-secret"}},
			FileSelection: &pkgsettings.SettingFileSelection{DefaultPath: "path-secret"},
		},
	}
	redacted := RedactSettingsSchema(schema)
	encoded, err := json.Marshal(redacted)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "current-secret")
	assert.NotContains(t, string(encoded), "default-secret")
	assert.NotContains(t, string(encoded), "option-secret")
	assert.NotContains(t, string(encoded), "path-secret")
	assert.Equal(t, "dark", redacted["theme"].Value)
	assert.True(t, redacted["token"].Sensitive)
	assert.Equal(t, "current-secret", schema["token"].Value)
	assert.Equal(t, "default-secret", schema["token"].Default)
	assert.Equal(t, "option-secret", schema["token"].Options[0].Value)
}

func TestSnapshot_DoesNotTrustUnknownPersistedSchema(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{
		"theme": "dark", "token": "stored-secret", "unknown": "unclassified-secret",
	}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	ctrl.schemaCache["fixture"] = map[string]pkgsettings.Setting{
		"theme": {ID: "theme"},
		"token": {ID: "token", Sensitive: true},
	}
	snapshot, err := ctrl.Snapshot("fixture")
	require.NoError(t, err)
	safe := snapshot.Settings
	assert.Equal(t, "dark", safe["theme"].Value)
	assert.Equal(t, "[REDACTED]", safe["token"].Value)
	assert.Equal(t, "[REDACTED]", safe["unknown"].Value)
	assert.True(t, safe["unknown"].Sensitive)
	ctrl.schemaCache = nil
	snapshot, err = ctrl.Snapshot("fixture")
	require.NoError(t, err)
	safe = snapshot.Settings
	assert.Equal(t, "[REDACTED]", safe["theme"].Value)
	values, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Equal(t, "unclassified-secret", values["unknown"])
}

func TestRedaction_PasswordTypeOverridesFalseSensitiveFlag(t *testing.T) {
	schema := map[string]pkgsettings.Setting{
		"password": {
			ID: "password", Type: pkgsettings.Password, Sensitive: false,
			Value: "password-current", Default: "password-default",
			Options:       []pkgsettings.SettingOption{{Value: "password-option"}},
			FileSelection: &pkgsettings.SettingFileSelection{DefaultPath: "password-path"},
		},
	}
	values := RedactSettingValues(map[string]any{"password": "password-current"}, schema)
	assert.Equal(t, "[REDACTED]", values["password"])
	safeSchema := RedactSettingsSchema(schema)
	encoded, err := json.Marshal(safeSchema)
	require.NoError(t, err)
	for _, secret := range []string{"password-current", "password-default", "password-option", "password-path"} {
		assert.NotContains(t, string(encoded), secret)
	}
	assert.True(t, safeSchema["password"].Sensitive)

	store := openTestStore(t)
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"password": "password-current"}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	ctrl.schemaCache["fixture"] = schema
	snapshot, err := ctrl.Snapshot("fixture")
	require.NoError(t, err)
	safe := snapshot.Settings
	assert.Equal(t, "[REDACTED]", safe["password"].Value)
}
