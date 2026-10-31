//go:build devcontrol

package devcontrol

import (
	"encoding/json"

	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	"github.com/omniviewdev/omniview/internal/devcontract"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const settingNotFoundExit = 3
const hostSettingsScope = "host"

type settingsAdapter struct{ service *settingsservice.Service }

func NewSettingsAdapter(service *settingsservice.Service) Settings {
	return &settingsAdapter{service: service}
}

func settingsScope(p SettingsParams) settingsservice.Scope {
	return settingsservice.Scope{Kind: p.Scope, PluginID: p.PluginID}
}

func (a *settingsAdapter) Schema(p SettingsParams) (map[string]pkgsettings.Setting, error) {
	if a.service == nil {
		return nil, invalidParams()
	}
	snapshot, err := a.service.GetSnapshot(settingsScope(p))
	if err != nil {
		return nil, err
	}
	result := make(map[string]pkgsettings.Setting)
	for categoryID, category := range snapshot.Categories {
		for id, setting := range category.Settings {
			if p.Scope == hostSettingsScope {
				id = categoryID + "." + id
			}
			result[id] = setting
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
			return nil, devcontract.Fail(settingNotFoundExit, "setting_not_found", "setting is not registered")
		}
		return setting.Value, nil
	}
	result := make(map[string]any, len(schema))
	for id, setting := range schema {
		result[id] = setting.Value
	}
	return result, nil
}

func (a *settingsAdapter) Set(p SettingsParams) (settingsservice.CommitResult, error) {
	if p.ID == "" || len(p.Value) == 0 || p.Values != nil {
		return settingsservice.CommitResult{}, invalidParams()
	}
	return a.write(p, map[string]json.RawMessage{p.ID: p.Value})
}

func (a *settingsAdapter) Bulk(p SettingsParams) (settingsservice.CommitResult, error) {
	if p.ID != "" || len(p.Value) != 0 || len(p.Values) == 0 {
		return settingsservice.CommitResult{}, invalidParams()
	}
	return a.write(p, p.Values)
}

func (a *settingsAdapter) write(
	p SettingsParams, raw map[string]json.RawMessage,
) (settingsservice.CommitResult, error) {
	schema, err := a.Schema(p)
	if err != nil {
		return settingsservice.CommitResult{}, err
	}
	values := make(map[string]any, len(raw))
	for id, data := range raw {
		if _, ok := schema[id]; !ok {
			return settingsservice.CommitResult{},
				devcontract.Fail(settingNotFoundExit, "setting_not_found", "setting is not registered")
		}
		var value any
		if decodeErr := json.Unmarshal(data, &value); decodeErr != nil {
			return settingsservice.CommitResult{}, invalidParams()
		}
		values[id] = value
	}
	return a.service.Commit(settingsScope(p), values)
}
