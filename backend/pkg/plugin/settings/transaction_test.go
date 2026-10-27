package settings

import (
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Flatten only the SDK provider's category representation to the existing
// plugin settings RPC shape. Validation, values and hooks remain real SDK code.
type transactionSDKProvider struct {
	pkgsettings.Provider
}

func (p transactionSDKProvider) ListSettings() map[string]pkgsettings.Setting {
	result := make(map[string]pkgsettings.Setting)
	for categoryID, category := range p.Provider.ListSettings() {
		for id, setting := range category.Settings {
			result[categoryID+"."+id] = setting
		}
	}
	return result
}

func (p transactionSDKProvider) ValidateSetting(id string, value any) (pkgsettings.ValidationResult, error) {
	setting, err := p.Provider.GetSetting(id)
	if err != nil {
		return pkgsettings.ValidationResult{}, err
	}
	return setting.Validation(value), nil
}

func TestSettingsTransaction_PreservesValidationHooksAndPersistence(t *testing.T) {
	store := openTestStore(t)
	provider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{
		// Empty SDK identity keeps category-qualified limits.count semantics;
		// the host controller below still scopes persistence to fixture.
		PluginID: "",
		PluginSettings: []pkgsettings.Category{{
			ID: "limits", Settings: map[string]pkgsettings.Setting{
				"count": {
					ID: "count", Type: pkgsettings.Integer, Value: 3, Default: 3,
					Validator: func(value any) pkgsettings.ValidationResult {
						count, ok := value.(int)
						if !ok || count < 1 {
							return pkgsettings.ValidationResult{Code: "positive_count", Message: "Count must be positive."}
						}
						return pkgsettings.ValidationResult{Valid: true, Code: "positive_count", Message: "Count is valid."}
					},
				},
			},
		}},
	})
	var hookValues []any
	provider.RegisterChangeHandler("limits", func(values map[string]any) {
		hookValues = append(hookValues, values["count"])
	})
	ctrl := NewController(logging.NewNop(), nil, store).(*controller)
	ctrl.clients["fixture"] = transactionSDKProvider{provider}
	ctrl.hydrated["fixture"] = true
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"limits.count": 3}))

	require.Error(t, ctrl.SetSetting("fixture", "limits.count", 0))
	values, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.EqualValues(t, 3, values["limits.count"])
	assert.Empty(t, hookValues, "invalid writes must not fire provider hooks")

	require.NoError(t, ctrl.SetSettings("fixture", map[string]any{"limits.count": 5}))
	values, err = store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.EqualValues(t, 5, values["limits.count"])
	assert.Equal(t, []any{5}, hookValues)
}
