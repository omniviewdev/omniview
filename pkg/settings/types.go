package settings

type SettingType string

const (
	// Text is the type for a text field entry.
	Text SettingType = "text"
	// Integer is the type for an integer field entry.
	Integer SettingType = "integer"
	// Float is the type for a float field entry.
	Float SettingType = "float"
	// Toggle is the type for a toggle field entry.
	Toggle SettingType = "toggle"
	// Color is the type for a color field entry.
	Color SettingType = "color"
	// DateTime is the type for a date time field entry.
	DateTime SettingType = "datetime"
	// SettingTypePassword is the type for a password field entry.
	Password SettingType = "password"
)

// AllSettingTypes is a list of all setting types. Necessary for Wails
// to bind the enums.
//
//nolint:gochecknoglobals // this is a necessary for enum binding
var AllSettingTypes = []struct {
	Value  SettingType
	TSName string
}{
	{Text, "TEXT"},
	{Integer, "INTEGER"},
	{Float, "FLOAT"},
	{Toggle, "TOGGLE"},
	{Color, "COLOR"},
	{DateTime, "DATETIME"},
	{Password, "PASSWORD"},
}

type SettingOption struct {
	// Label is the human readable label of the option
	Label string `json:"label"`
	// Description is an optional human readable description of the option
	Description string `json:"description"`
	// Value is the value of the option
	Value interface{} `json:"value"`
}

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
}

func (s *Setting) Validate(value interface{}) error {
	if s.Validator != nil {
		return s.Validator(value)
	}
	return nil
}

func (s *Setting) SetValue(value interface{}) error {
	if err := s.Validate(value); err != nil {
		return err
	}
	s.Value = value
	return nil
}

func (s *Setting) ResetValue() {
	s.Value = s.Default
}
