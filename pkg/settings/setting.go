package settings

import (
	"fmt"
	"reflect"
)

type Setting struct {
	// ID is the unique identifier of the setting
	ID string `json:"id"`
	// Label is the human readable label of the setting
	Label string `json:"label"`
	// Description is the human readable description of the setting
	Description string `json:"description"`
	// Type is the type of the setting
	Type SettingType `json:"type"`
	// Value is the value of the setting
	Value interface{} `json:"value"`
	// Default is the default value of the setting
	Default interface{} `json:"default"`
	// Validator is an optional function to validate the setting, which should return an error
	// if the value is invalid
	Validator func(interface{}) error `json:"-"`
	// Options is an optional list of options for a select setting
	Options []SettingOption `json:"options"`
	// FileSelection is an optional setting for file selection
	FileSelection *SettingFileSelection `json:"fileSelection"`
	// Sensitive is a flag to indicate if the setting is sensitive and should not be
	// shown in the UI, nor allowed to be used by any other plugin.
	Sensitive bool `json:"sensitive"`
}

// Validate checks if the value of the setting is valid using an optional
// validation function. If no validation function is provided, it returns nil.
func (s *Setting) Validate(value interface{}) error {
	if s.Validator != nil {
		return s.Validator(value)
	}
	return nil
}

// SetValue sets the value of the setting and validates it using the
// validator function defined.
func (s *Setting) SetValue(value interface{}) error {
	if err := s.Validate(value); err != nil {
		return err
	}
	s.set(value)
	return nil
}

// GetValue returns the value of the setting.
func (s *Setting) GetValue() interface{} {
	if s.Sensitive {
		// Don't expose to the UI
		return nil
	}

	if s.Value == nil {
		return s.Default
	}

	return s.Value
}

// ResetValue resets the value of the setting to its default value.
func (s *Setting) ResetValue() {
	s.Value = s.Default
}

//========================================= PRIVATE METHODS ==================================

// tryConvertSlice attempts to convert a slice of any type to a slice of interface{}.
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

// set performs the main setting logic, doing any necessary conversion to try to satisfy any easily
// convertible types. This is a private method so we can save after a bulk vs individual setting change.
func (s *Setting) set(value any) error {
	currentVal := s.Value
	currType := reflect.TypeOf(currentVal)
	valType := reflect.TypeOf(value)

	if currType.Kind() == reflect.Slice && valType.Kind() == reflect.Slice {
		// convert slice elements one by one if the destination is []interface{}
		if slice, ok := tryConvertSlice(value); ok {
			value = slice
		}
	} else if currType.ConvertibleTo(valType) {
		// convert the value to the type of the current value
		value = reflect.ValueOf(value).Convert(currType).Interface()
	} else if currType.Kind() == reflect.Float64 && valType.Kind() == reflect.Int {
		// convert int to float64
		value = float64(value.(int))
	} else if currType.Kind() == reflect.Int && valType.Kind() == reflect.Float64 {
		// convert float64 to int
		value = int(value.(float64))
	} else if !reflect.TypeOf(value).AssignableTo(currType) {
		// for non-slice types, fall back to the original type check
		return fmt.Errorf(
			"setting type mismatch for setting '%s'. currently has %s, tried to assign %s",
			s.ID,
			reflect.TypeOf(currentVal).String(),
			reflect.TypeOf(value).String(),
		)
	}

	// all good, assign the value
	s.Value = value
	return nil
}
