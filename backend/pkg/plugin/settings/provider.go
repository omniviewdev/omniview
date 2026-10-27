package settings

import (
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// Provider is the engine's version-independent interface for settings plugins.
// For v1, method signatures match SDK settings.Provider exactly (doc 20 §13.7).
// When v2 redesigns settings (adds context.Context), this diverges.
type Provider interface {
	ListSettings() map[string]pkgsettings.Setting
	GetSetting(id string) (pkgsettings.Setting, error)
	GetSettingValue(id string) (any, error)
	ValidateSetting(id string, value any) (pkgsettings.ValidationResult, error)
	SetSetting(id string, value any) error
	SetSettings(settings map[string]any) error
}
