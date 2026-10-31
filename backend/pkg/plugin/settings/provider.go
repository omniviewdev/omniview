package settings

import (
	"context"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// Provider is the narrow settings transport consumed by the controller.
type Provider interface {
	ListSettings() map[string]pkgsettings.Setting
	GetSetting(id string) (pkgsettings.Setting, error)
	GetSettingValue(id string) (any, error)
	ValidateSetting(id string, value any) (pkgsettings.ValidationResult, error)
	CommitSettings(
		ctx context.Context,
		values map[string]any,
		persist pkgsettings.PersistFunc,
	) (pkgsettings.CommitResult, error)
}
