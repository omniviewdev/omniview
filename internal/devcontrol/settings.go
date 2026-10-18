//go:build devcontrol

package devcontrol

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// PluginSettings.SafeSettings MUST call the host's provenance-aware
// RedactedPluginSettings helper, never synthesize schema from persisted values.
type PluginSettings interface {
	SafeSettings(string) map[string]pkgsettings.Setting
	SettingForWrite(string, string) (pkgsettings.Setting, error)
	SetSetting(string, string, any) error
	SetSettings(string, map[string]any) error
}
type settingsAdapter struct {
	host    pkgsettings.Provider
	plugins PluginSettings
}

func NewSettingsAdapter(host pkgsettings.Provider, plugins PluginSettings) Settings {
	return &settingsAdapter{host: host, plugins: plugins}
}
func (a *settingsAdapter) Schema(p SettingsParams) (map[string]pkgsettings.Setting, error) {
	if p.Scope == "plugin" {
		if p.PluginID == "" || a.plugins == nil {
			return nil, invalidParams()
		}
		return a.plugins.SafeSettings(p.PluginID), nil
	}
	if p.Scope != "host" || p.PluginID != "" || a.host == nil {
		return nil, invalidParams()
	}
	result := map[string]pkgsettings.Setting{}
	for categoryID, category := range a.host.ListSettings() {
		for id, setting := range category.Settings {
			if setting.Sensitive || setting.Type == pkgsettings.Password {
				setting.Sensitive = true
				setting.Value = "[REDACTED]"
				setting.Default = "[REDACTED]"
				setting.Options = nil
				setting.FileSelection = nil
			}
			result[categoryID+"."+id] = setting
		}
	}
	return result, nil
}
func (a *settingsAdapter) Get(p SettingsParams) (any, error) {
	schema, err := a.Schema(p)
	if err != nil {
		return nil, err
	}
	if p.ID != "" {
		setting, ok := schema[p.ID]
		if !ok {
			return nil, devcontract.Fail(3, "setting_not_found", "setting is not registered")
		}
		return setting.Value, nil
	}
	result := map[string]any{}
	for id, setting := range schema {
		result[id] = setting.Value
	}
	return result, nil
}
func (a *settingsAdapter) Set(p SettingsParams) error {
	if p.ID == "" || len(p.Value) == 0 || p.Values != nil {
		return invalidParams()
	}
	return a.write(p, map[string]json.RawMessage{p.ID: p.Value}, false)
}
func (a *settingsAdapter) Bulk(p SettingsParams) error {
	if p.ID != "" || len(p.Value) != 0 || len(p.Values) == 0 {
		return invalidParams()
	}
	return a.write(p, p.Values, true)
}
func (a *settingsAdapter) write(p SettingsParams, raw map[string]json.RawMessage, bulk bool) error {
	schema, err := a.Schema(p)
	if err != nil {
		return err
	}
	values := make(map[string]any, len(raw))
	for id, data := range raw {
		setting, ok := schema[id]
		if !ok {
			return devcontract.Fail(3, "setting_not_found", "setting is not registered")
		}
		// Redacted values cannot establish a select's native scalar/slice type.
		// Obtain that solely for decoding; never return the unredacted write schema.
		if setting.Type == pkgsettings.Select || setting.Type == pkgsettings.MultiSelect {
			if p.Scope == "plugin" {
				setting, err = a.plugins.SettingForWrite(p.PluginID, id)
			} else {
				setting, err = a.host.GetSetting(id)
			}
			if err != nil {
				return err
			}
		}
		value, err := typedSettingValue(data, setting)
		if err != nil {
			return invalidParams()
		}
		values[id] = value
	}
	if p.Scope == "plugin" {
		if bulk {
			return a.plugins.SetSettings(p.PluginID, values)
		}
		return a.plugins.SetSetting(p.PluginID, p.ID, values[p.ID])
	}
	if bulk {
		return a.host.SetSettings(values)
	}
	return a.host.SetSetting(p.ID, values[p.ID])
}
func typedSettingValue(data json.RawMessage, s pkgsettings.Setting) (any, error) {
	if strings.TrimSpace(string(data)) == "null" {
		return nil, fmt.Errorf("null setting")
	}
	switch s.Type {
	case pkgsettings.Integer:
		var v int
		err := json.Unmarshal(data, &v)
		return v, err
	case pkgsettings.Float:
		var v float64
		err := json.Unmarshal(data, &v)
		return v, err
	case pkgsettings.Toggle:
		var v bool
		err := json.Unmarshal(data, &v)
		return v, err
	case pkgsettings.Text, pkgsettings.Password, pkgsettings.Color, pkgsettings.DateTime:
		var v string
		err := json.Unmarshal(data, &v)
		return v, err
	case pkgsettings.MultiSelect, pkgsettings.Select:
		current := s.Value
		if current == nil {
			current = s.Default
		}
		if current == nil && s.Type == pkgsettings.Select && len(s.Options) > 0 {
			current = s.Options[0].Value
		}
		if current == nil {
			if s.Type == pkgsettings.MultiSelect {
				var v []any
				err := json.Unmarshal(data, &v)
				return v, err
			}
			var v any
			err := json.Unmarshal(data, &v)
			return v, err
		}
		value := reflect.New(reflect.TypeOf(current))
		if err := json.Unmarshal(data, value.Interface()); err != nil {
			return nil, err
		}
		return value.Elem().Interface(), nil
	default:
		return nil, fmt.Errorf("unsupported setting type")
	}
}
