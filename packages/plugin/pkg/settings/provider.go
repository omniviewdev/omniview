package settings

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sync"

	"github.com/pkg/errors"
)

// Provider is an interface for a settings provider that can be used to
// get and set settings for a plugin.
type Provider interface {
	// List the settings from the provider.
	List() ([]interface{}, error)

	// GetSingleValue returns the string value for the given key
	GetSingleValue(key string) (string, error)

	// GetMultivalue returns the array of values for the given key
	GetMultiValue(key string) ([]string, error)

	// Set the settings in the provider, this will also save the settings to the users local store
	SetSingleValue(key, value string) error

	// SetMultiValue sets the array of values for the given key
	SetMultiValue(key string, values []string) error

	// Load the settings from the users local store
	Load() error
}

type provider struct {
	sync.Mutex
	settings []interface{}
	values   map[string]interface{}
}

func (p *provider) List() ([]interface{}, error) {
	return p.settings, nil
}

func (p *provider) save() error {
	// prevent concurrent writes
	p.Lock()
	defer p.Unlock()

	file, err := os.OpenFile("./store/settings.json", os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer file.Close()

	// clear out the file before writing to it
	if err = file.Truncate(0); err != nil {
		return err
	}

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "    ")
	return encoder.Encode(p.values)
}

// set any defaults that haven't already been set from an already loaded settings file.
func (p *provider) defaulter(force bool) {
	if p.values == nil {
		p.values = make(map[string]interface{})
	}

	for _, setting := range p.settings {
		switch s := setting.(type) {
		case Select:
			if _, ok := p.values[s.ID]; !ok || force {
				p.values[s.ID] = s.Default
			}
		case Multiselect:
			if _, ok := p.values[s.ID]; !ok || force {
				p.values[s.ID] = s.Default
			}
		case Text:
			if _, ok := p.values[s.ID]; !ok || force {
				p.values[s.ID] = s.Default
			}
		case Multitext:
			if _, ok := p.values[s.ID]; !ok || force {
				p.values[s.ID] = s.Default
			}
		case KV:
			if _, ok := p.values[s.ID]; !ok || force {
				p.values[s.ID] = s.Default
			}
		default:
			panic(fmt.Sprintf("Unknown setting type: %v", reflect.TypeOf(setting)))
		}
	}
	if err := p.save(); err != nil {
		panic(err)
	}
}

func (p *provider) Load() error {
	// get the settings from the current directory in ./store/settings.json
	// if the file does not exist, create it
	if err := os.MkdirAll("./store", 0755); err != nil {
		return err
	}
	file, err := os.OpenFile("./store/settings.json", os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return err
	}
	defer file.Close()

	// load the settings from the file
	if err = json.NewDecoder(file).Decode(&p.values); err != nil {
		// if the file is empty, set the defaults and save the file
		return err
	}
	return nil
}

func (p *provider) SetSingleValue(key, value string) error {
	_, ok := p.values[key].(string)
	if !ok {
		return errors.New("value is not a string")
	}
	p.values[key] = value
	return p.save()
}

func (p *provider) GetSingleValue(key string) (string, error) {
	val, ok := p.values[key].(string)
	if !ok {
		return "", errors.New("value is not a string")
	}
	return val, nil
}

func (p *provider) SetMultiValue(key string, values []string) error {
	_, ok := p.values[key].([]string)
	if !ok {
		return errors.New("value is not an array")
	}
	p.values[key] = values
	return p.save()
}

func (p *provider) GetMultiValue(key string) ([]string, error) {
	val, ok := p.values[key].([]string)
	if !ok {
		return nil, errors.New("value is not an array")
	}
	return val, p.save()
}

// NewSettingsProvider creates a new settings provider with the given settings.
func NewSettingsProvider(settings []interface{}) Provider {
	provider := &provider{
		settings: settings,
		values:   make(map[string]interface{}),
	}

	if err := provider.Load(); err != nil {
		provider.defaulter(true)
	}

	return provider
}
