package categories

import (
	"fmt"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// ServiceWrapper exposes only frontend-safe methods of pkgsettings.Provider.
// Excluded: RegisterChangeHandler, RegisterSetting, RegisterSettings
//
//	(internal-only methods).
type ServiceWrapper struct {
	Provider     pkgsettings.Provider
	CategoryMeta map[string]pkgsettings.Category // Label, Icon, Description for each category
}

func (s *ServiceWrapper) ListSettings() pkgsettings.Store {
	store := s.Provider.ListSettings()
	// Merge registered category metadata (Label, Icon, Description) into the
	// store since RegisterSetting only populates ID + Settings.
	result := make(pkgsettings.Store, len(store))
	for id, cat := range store {
		if meta, ok := s.CategoryMeta[id]; ok {
			cat.Label = meta.Label
			cat.Description = meta.Description
			cat.Icon = meta.Icon
		}
		result[id] = cat
	}
	return result
}
func (s *ServiceWrapper) GetSetting(id string) (pkgsettings.Setting, error) {
	return s.Provider.GetSetting(id)
}
func (s *ServiceWrapper) GetSettingValue(id string) (any, error) {
	return s.Provider.GetSettingValue(id)
}
func (s *ServiceWrapper) SetSetting(id string, value any) error {
	return s.Provider.SetSetting(id, value)
}
func (s *ServiceWrapper) SetSettings(settingsMap map[string]any) error {
	return s.Provider.SetSettings(settingsMap)
}
func (s *ServiceWrapper) GetString(id string) (string, error) {
	return s.Provider.GetString(id)
}
func (s *ServiceWrapper) GetStringSlice(id string) ([]string, error) {
	return s.Provider.GetStringSlice(id)
}
func (s *ServiceWrapper) GetInt(id string) (int, error) {
	return s.Provider.GetInt(id)
}
func (s *ServiceWrapper) GetIntSlice(id string) ([]int, error) {
	return s.Provider.GetIntSlice(id)
}
func (s *ServiceWrapper) GetFloat(id string) (float64, error) {
	return s.Provider.GetFloat(id)
}
func (s *ServiceWrapper) GetFloatSlice(id string) ([]float64, error) {
	return s.Provider.GetFloatSlice(id)
}
func (s *ServiceWrapper) GetBool(id string) (bool, error) {
	return s.Provider.GetBool(id)
}

// Values returns a flat map of all setting values keyed by "category.settingID".
// This is a host-side convenience for the frontend — it was removed from the SDK
// Provider interface (plugins don't need it) but the UI settings context uses it
// to populate the full settings state.
func (s *ServiceWrapper) Values() map[string]any {
	store := s.Provider.ListSettings()
	m := make(map[string]any)
	for catID, cat := range store {
		for settingID, setting := range cat.Settings {
			m[catID+"."+settingID] = setting.Value
		}
	}
	return m
}

// GetCategory returns a single settings category by ID, including full metadata
// (Label, Icon, Description) from the registered category definitions and live
// setting values from the in-memory provider.
func (s *ServiceWrapper) GetCategory(id string) (pkgsettings.Category, error) {
	store := s.Provider.ListSettings()
	cat, ok := store[id]
	if !ok {
		return pkgsettings.Category{}, fmt.Errorf("settings category %q not found", id)
	}
	// The provider store may only have ID + Settings (RegisterSetting doesn't
	// preserve Label/Icon/Description). Merge in the registered metadata.
	if meta, hasMeta := s.CategoryMeta[id]; hasMeta {
		cat.Label = meta.Label
		cat.Description = meta.Description
		cat.Icon = meta.Icon
	}
	return cat, nil
}

// GetCategoryValues returns a flat map of setting values for a single category.
func (s *ServiceWrapper) GetCategoryValues(id string) (map[string]any, error) {
	cat, err := s.GetCategory(id)
	if err != nil {
		return nil, err
	}
	vals := make(map[string]any, len(cat.Settings))
	for settingID, setting := range cat.Settings {
		vals[settingID] = setting.Value
	}
	return vals, nil
}

// GetCategories returns all category metadata for the UI settings navigation.
func (s *ServiceWrapper) GetCategories() []pkgsettings.Category {
	store := s.Provider.ListSettings()
	cats := make([]pkgsettings.Category, 0, len(store))
	for id, cat := range store {
		// Merge in registered metadata (Label, Icon, Description).
		if meta, hasMeta := s.CategoryMeta[id]; hasMeta {
			cat.Label = meta.Label
			cat.Description = meta.Description
			cat.Icon = meta.Icon
		}
		cats = append(cats, pkgsettings.Category{
			ID:          cat.ID,
			Label:       cat.Label,
			Description: cat.Description,
			Icon:        cat.Icon,
		})
	}
	return cats
}

// LoadSettings is a no-op reload trigger for the frontend. With bbolt-backed
// persistence, settings are always in memory — this exists so the frontend's
// "reload" button still has a valid binding. It re-reads from the in-memory
// store (which is already current).
func (s *ServiceWrapper) LoadSettings() error {
	return nil
}
