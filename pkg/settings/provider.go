package settings

import (
	"context"
	"encoding/gob"
	"errors"
	"fmt"
	"reflect"
	"strings"

	"go.uber.org/zap"
)

var (
	ErrSettingNotFound         = errors.New("setting not found")
	ErrSettingTypeMismatch     = errors.New("setting type mismatch")
	ErrSettingCategoryNotFound = errors.New("setting category not found")
	ErrInvalidSettingID        = errors.New("invalid setting ID")
)

//nolin:gochecknoglobals // don't want to have to specify this in every function
var nilSetting = Setting{}

// The settings store is a map of maps. The first map is the category of the settings, and the second
// map is the settings themselves. The key of the first map is the category name, and the key of the
// second map is the setting ID.
type Store map[string]Category

// Category is a group of settings. This is used to group settings together in the UI.
type Category struct {
	Settings    map[string]Setting `json:"settings"`
	ID          string             `json:"id"`
	Label       string             `json:"label"`
	Description string             `json:"description"`
	Icon        string             `json:"icon"`
}

// Provider manages the settings for the application. This is used to load and save settings
// to and from local storage.
type Provider interface {
	// Initialize initializes the settings provider with a set of base settings. Add the wails
	// context so we can eventually dispatch events when settings change.
	Initialize(ctx context.Context, categories ...Category) error

	// LoadSettings loads the settings from local storage
	LoadSettings() error

	// SaveSettings saves the settings to local storage
	SaveSettings() error

	// ListSettings returns the settings store
	ListSettings() Store

	// GetSetting returns the setting by ID. This ID should be in the form of a dot separated string
	// that represents the path to the setting. For example, "appearance.theme"
	GetSetting(id string) (Setting, error)

	// GetSettingValue returns the value of the setting by ID
	GetSettingValue(id string) (any, error)

	// SetSetting sets the value of the setting by ID
	SetSetting(id string, value any) error

	// SetSettings sets multiple settings at once
	SetSettings(settings map[string]any) error

	// ResetSetting resets the value of the setting by ID to the default value
	ResetSetting(id string) error

	// RegisterSetting registers a setting with the provider
	RegisterSetting(categoryID string, setting Setting) error

	// RegisterSettings registers a list of settings with the provider to a category
	RegisterSettings(categoryID string, settings ...Setting) error

	// GetCategories returns a list of all categories, with the settings removed. This
	// is intended for use in the UI to display the categories menu.
	GetCategories() []Category

	// GetCategorySettings returns the settings by category
	GetCategory(id string) (Category, error)

	// GetCategoryValues returns a map of the values of the settings by category
	GetCategoryValues(id string) (map[string]interface{}, error)
}

// ProviderOpts are the options for creating a new settings provider.
type ProviderOpts struct {
	// Logger is the logger for the provider
	Logger *zap.SugaredLogger
	// PluginID is the ID of the plugin
	PluginID string
	// PluginSettings
	PluginSettings []Category
}

func NewProvider(opts ProviderOpts) Provider {
	provider := &provider{
		logger:   opts.Logger,
		pluginID: opts.PluginID,
	}

	if len(opts.PluginSettings) > 0 {
		if err := provider.Initialize(context.Background(), opts.PluginSettings...); err != nil {
			// if we can't initialize settings, don't start up
			panic(err)
		}
	}

	return provider
}

type provider struct {
	ctx      context.Context
	pluginID string
	logger   *zap.SugaredLogger
	store    Store
}

// define custom merge behavior to make sure we don't overwrite any existing settings,
// but update the values of any settings that already exist
//
// TODO - right now, if the new setting has a different type than the existing setting,
// the new setting will overwrite the existing setting. We should probably throw an error
// if this happens.
func (p *provider) mergeSettings(categories ...Category) {
	if p.store == nil {
		p.store = make(Store)
	}
	for _, category := range categories {
		currentCategory, ok := p.store[category.ID]
		if !ok {
			// we don't have this category, go ahead and full assign it and set the settings
			// to their defaults
			newSettings := make(map[string]Setting, len(category.Settings))
			for _, setting := range category.Settings {
				setting.Value = setting.Default
				newSettings[setting.ID] = setting
			}
			category.Settings = newSettings
			p.store[category.ID] = category
			continue
		}

		// if we've gotten here, the category exists
		// lets update the category info first
		currentCategory.Label = category.Label
		currentCategory.Description = category.Description
		currentCategory.Icon = category.Icon

		for id, setting := range category.Settings {
			current, ok := currentCategory.Settings[id]
			if !ok {
				// we don't have this setting, go ahead and full assign it with a default
				// and move on
				setting.Value = setting.Default
				currentCategory.Settings[id] = setting
				continue
			}

			// now for the merge behavior. We'll want to make sure that the setting type is the same
			// as the existing setting, so we'll need to use reflection here.
			// if there's a type mismatch, don't fail, but log an error
			// TODO - we should probably do some behavior here to try to convert the value to the
			// correct type, but for now, we'll just log an error
			if reflect.TypeOf(setting.Type) != reflect.TypeOf(current.Type) {
				// log an error and continue
				p.logger.Errorf(
					"setting type mismatch: %s. currently has %s, tried to assign %s",
					id,
					reflect.TypeOf(current.Type),
					reflect.TypeOf(setting.Type),
				)
				continue
			}

			var toCheck interface{}
			if setting.Value != nil {
				toCheck = setting.Value
			} else {
				toCheck = setting.Default
			}

			if reflect.TypeOf(current.Value) != reflect.TypeOf(toCheck) {
				// log an error and continue
				p.logger.Errorf(
					"setting value mismatch: %s. currently has %s, tried to assign %s",
					id,
					reflect.TypeOf(current.Value),
					reflect.TypeOf(toCheck),
				)
				continue
			}

			current.Label = setting.Label
			current.Description = setting.Description
			current.Default = setting.Default
			current.Validator = setting.Validator
			current.Options = setting.Options

			currentCategory.Settings[id] = current
		}

		p.store[category.ID] = currentCategory
	}
}

func (p *provider) Initialize(ctx context.Context, categories ...Category) error {
	if p.store != nil {
		return errors.New("settings provider already initialized")
	}

	p.ctx = ctx

	// load in, merge, and resave the settings to make sure we have the latest
	// ready to go
	if err := p.LoadSettings(); err != nil {
		return err
	}

	if len(categories) == 0 {
		// nothing to do
		return nil
	}

	p.mergeSettings(categories...)
	if err := p.SaveSettings(); err != nil {
		return err
	}
	return nil
}

func (p *provider) SaveSettings() error {
	gob.Register(Store{})
	gob.Register(Setting{})
	gob.Register(SettingOption{})
	gob.Register(Category{})
	gob.Register([]interface{}{})

	store, err := GetStore(p.pluginID)
	if err != nil {
		return err
	}
	defer store.Close()

	encoder := gob.NewEncoder(store)
	return encoder.Encode(p.store)
}

func (p *provider) LoadSettings() error {
	gob.Register(Store{})
	gob.Register(Setting{})
	gob.Register(SettingOption{})
	gob.Register(Category{})
	gob.Register([]interface{}{})

	store, err := GetStore(p.pluginID)
	if err != nil {
		return err
	}
	defer store.Close()

	// if the file is empty, we'll initialize the state with an empty map
	fileInfo, err := store.Stat()
	if err != nil {
		return err
	}

	// nothing to decode if the file is empty
	if fileInfo.Size() == 0 {
		p.logger.Debugw("settings store is empty, initializing")
		encoder := gob.NewEncoder(store)
		return encoder.Encode(p.store)
	}

	// proceed with decoding since the file is not empty
	decoder := gob.NewDecoder(store)
	err = decoder.Decode(&p.store)
	if err != nil {
		return err
	}

	return nil
}

func (p *provider) ListSettings() Store {
	return p.store
}

func (p *provider) GetSetting(id string) (Setting, error) {
	category, id, err := p.parseSettingID(id)
	if err != nil {
		return nilSetting, err
	}
	setting, ok := p.store[category].Settings[id]
	if !ok {
		return nilSetting, ErrSettingNotFound
	}
	return setting, nil
}

func (p *provider) GetSettingValue(id string) (any, error) {
	setting, err := p.GetSetting(id)
	if err != nil {
		return nil, err
	}
	return setting.Value, nil
}

func (p *provider) SetSettings(settings map[string]any) error {
	for id, value := range settings {
		err := p.setSetting(id, value)
		if err != nil {
			return err
		}
	}
	return p.SaveSettings()
}

func tryConvertSlice(value any) ([]interface{}, bool) {
	valReflect := reflect.ValueOf(value)
	if valReflect.Kind() != reflect.Slice {
		return nil, false
	}
	result := make([]interface{}, valReflect.Len())
	for i := 0; i < valReflect.Len(); i++ {
		result[i] = valReflect.Index(i).Interface()
	}
	return result, true
}

// private method so we can save after a bulk vs individual setting change.
func (p *provider) setSetting(id string, value any) error {
	setting, err := p.GetSetting(id)
	if err != nil {
		return err
	}
	currentVal := setting.Value

	if reflect.TypeOf(currentVal).Kind() == reflect.Slice &&
		reflect.TypeOf(value).Kind() == reflect.Slice {
		// convert slice elements one by one if the destination is []interface{}
		if slice, ok := tryConvertSlice(value); ok {
			value = slice
		}
	} else if !reflect.TypeOf(value).AssignableTo(reflect.TypeOf(currentVal)) {
		// for non-slice types, fall back to the original type check
		return fmt.Errorf(
			"setting type mismatch: %s. currently has %s, tried to assign %s",
			id,
			reflect.TypeOf(currentVal).String(),
			reflect.TypeOf(value).String(),
		)
	}

	if err = setting.SetValue(value); err != nil {
		return err
	}

	category, id, err := p.parseSettingID(id)
	if err != nil {
		return err
	}

	p.store[category].Settings[id] = setting
	return nil
}

func (p *provider) SetSetting(id string, value any) error {
	if err := p.setSetting(id, value); err != nil {
		return err
	}
	return p.SaveSettings()
}

func (p *provider) ResetSetting(id string) error {
	category, id, err := p.parseSettingID(id)
	if err != nil {
		return err
	}

	setting, ok := p.store[category].Settings[id]
	if !ok {
		return ErrSettingNotFound
	}
	setting.ResetValue()
	p.store[category].Settings[id] = setting
	return nil
}

func (p *provider) HasSetting(id string) bool {
	_, err := p.GetSetting(id)
	return err == nil
}

func (p *provider) RegisterSetting(category string, setting Setting) error {
	found, ok := p.store[category]
	if !ok {
		return ErrSettingCategoryNotFound
	}
	found.Settings[setting.ID] = setting
	p.store[category] = found
	return nil
}

func (p *provider) RegisterSettings(category string, settings ...Setting) error {
	for _, setting := range settings {
		if err := p.RegisterSetting(category, setting); err != nil {
			return err
		}
	}
	return nil
}

func (p *provider) GetCategories() []Category {
	categories := make([]Category, 0, len(p.store))
	for category := range p.store {
		// copy and remove the settings so we don't expose them
		copied := p.store[category]
		copied.Settings = nil
		categories = append(categories, copied)
	}
	return categories
}

func (p *provider) GetCategory(category string) (Category, error) {
	settings, ok := p.store[category]
	if !ok {
		return Category{}, ErrSettingCategoryNotFound
	}
	return settings, nil
}

func (p *provider) GetCategoryValues(category string) (map[string]interface{}, error) {
	cat, err := p.GetCategory(category)
	if err != nil {
		return nil, err
	}

	values := make(map[string]interface{}, len(cat.Settings))
	for id, setting := range cat.Settings {
		values[id] = setting.Value
	}
	return values, nil
}

func (p *provider) parseSettingID(id string) (string, string, error) {
	// if we have a pluginID on the provider, the category will always be "plugin"
	if p.pluginID != "" {
		return "plugin", id, nil
	}

	parts := strings.Split(id, ".")
	//nolint:gomnd // self-explanatory
	if len(parts) != 2 {
		return "", "", ErrInvalidSettingID
	}
	if parts[0] == "" || parts[1] == "" {
		return "", "", ErrInvalidSettingID
	}
	return parts[0], parts[1], nil
}
