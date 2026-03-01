package settings

import (
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/settings"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// AdapterV1 wraps SDK v1 settings.Provider as the engine canonical SettingsProvider.
// For v1, all methods are direct delegation (types identical).
// When v2 ships and canonical types diverge, AdapterV1 translates v1 → canonical.
type AdapterV1 struct {
	inner sdksettings.Provider
}

var _ SettingsProvider = (*AdapterV1)(nil)

// NewAdapterV1 creates a new v1 adapter wrapping the given SDK settings provider.
func NewAdapterV1(inner sdksettings.Provider) *AdapterV1 {
	return &AdapterV1{inner: inner}
}

func (a *AdapterV1) ListSettings() map[string]pkgsettings.Setting {
	return a.inner.ListSettings()
}

func (a *AdapterV1) GetSetting(id string) (pkgsettings.Setting, error) {
	return a.inner.GetSetting(id)
}

func (a *AdapterV1) GetSettingValue(id string) (any, error) {
	return a.inner.GetSettingValue(id)
}

func (a *AdapterV1) SetSetting(id string, value any) error {
	return a.inner.SetSetting(id, value)
}

func (a *AdapterV1) SetSettings(settings map[string]any) error {
	return a.inner.SetSettings(settings)
}
