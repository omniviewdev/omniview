package settings

import pkgsettings "github.com/omniviewdev/plugin-sdk/settings"

// RedactSettingValues projects provider values for control/inspect output. A
// value is public only when its schema explicitly identifies it as nonsecret.
// Unknown or unavailable plugin schemas therefore fail closed. Provider-owned
// maps and values are not modified; the projection is for read-only encoding.
func RedactSettingValues(values map[string]any, schema map[string]pkgsettings.Setting) map[string]any {
	result := make(map[string]any, len(values))
	for id, value := range values {
		setting, known := schema[id]
		if !known || setting.Sensitive || setting.Type == pkgsettings.Password {
			result[id] = "[REDACTED]"
		} else {
			result[id] = value
		}
	}
	return result
}

// RedactSettingsSchema keeps schema metadata while excluding every value-bearing
// field of sensitive settings. Do not serialize an unredacted schema alongside
// RedactSettingValues: defaults and select options can also contain credentials.
func RedactSettingsSchema(schema map[string]pkgsettings.Setting) map[string]pkgsettings.Setting {
	result := make(map[string]pkgsettings.Setting, len(schema))
	for id, setting := range schema {
		setting.Value = pkgsettings.CloneValue(setting.Value)
		setting.Default = pkgsettings.CloneValue(setting.Default)
		if setting.Options != nil {
			options := make([]pkgsettings.SettingOption, len(setting.Options))
			for index, option := range setting.Options {
				options[index] = option
				options[index].Value = pkgsettings.CloneValue(option.Value)
			}
			setting.Options = options
		}
		if setting.FileSelection != nil {
			selection := *setting.FileSelection
			selection.Extensions = append([]string(nil), selection.Extensions...)
			setting.FileSelection = &selection
		}
		if setting.Sensitive || setting.Type == pkgsettings.Password {
			setting.Sensitive = true
			setting.Value = "[REDACTED]"
			setting.Default = "[REDACTED]"
			setting.Options = nil
			setting.FileSelection = nil
		}
		result[id] = setting
	}
	return result
}

// RedactedPluginSettings is the control boundary's safe plugin inspection API.
// Only hydrated schema metadata can classify values, never inferred fallback
// metadata. The SDK v1 decoder treats absent legacy classification as sensitive;
// Password is always secret. Unavailable or foreign schema origins fail closed.
func RedactedPluginSettings(ctrl Controller, plugin string) map[string]pkgsettings.Setting {
	settings := ctrl.ListSettings(plugin)
	result := make(map[string]pkgsettings.Setting, len(settings))
	host, ok := ctrl.(*controller)
	if ok {
		host.mu.RLock()
		defer host.mu.RUnlock()
	}
	for id, setting := range settings {
		var authoritative pkgsettings.Setting
		known := false
		if ok {
			authoritative, known = host.schemaCache[plugin][id]
		}
		if !known || authoritative.Sensitive || authoritative.Type == pkgsettings.Password ||
			setting.Sensitive || setting.Type == pkgsettings.Password {
			setting.Sensitive = true
			setting.Value = "[REDACTED]"
			setting.Default = "[REDACTED]"
			setting.Options = nil
			setting.FileSelection = nil
		}
		result[id] = setting
	}
	return result
}
