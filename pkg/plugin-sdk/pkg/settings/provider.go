package settings

import "github.com/omniviewdev/settings"

// Provider is the interface that must be implemented by the settings provider
// plugin implementations on either side of the RPC.
type Provider interface {
	// ListSettings returns the settings store
	ListSettings() map[string]settings.Setting

	// GetSetting returns the setting by ID. This ID should be in the form of a dot separated string
	// that represents the path to the setting. For example, "appearance.theme"
	GetSetting(id string) (settings.Setting, error)

	// GetSettingValue returns the value of the setting by ID
	GetSettingValue(id string) (any, error)

	// SetSetting sets the value of the setting by ID
	SetSetting(id string, value any) error

	// SetSettings sets multiple settings at once
	SetSettings(settings map[string]any) error
}

type provider struct {
	base settings.Provider
}

// NewProviderWrapper wraps the settings provider to allow for the scoped
// semantics of using the same setting provider for the core and for the
// plugins
//
// TODO - this is a bit messy and should be refactored. It'll do for now,
// as we're just trying to get the plugin system working for the time being.
func NewProviderWrapper(base settings.Provider) Provider {
	return &provider{base: base}
}

func (p *provider) ListSettings() map[string]settings.Setting {
	store := p.base.ListSettings()
	// will always be at "plugin" key
	found, ok := store["plugin"]
	if !ok {
		return nil
	}
	return found.Settings
}

func (p *provider) GetSetting(id string) (settings.Setting, error) {
	return p.base.GetSetting(id)
}

func (p *provider) GetSettingValue(id string) (any, error) {
	return p.base.GetSettingValue(id)
}

func (p *provider) SetSetting(id string, value any) error {
	return p.base.SetSetting(id, value)
}

func (p *provider) SetSettings(settings map[string]any) error {
	return p.base.SetSettings(settings)
}
