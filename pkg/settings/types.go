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

type SettingFileSelection struct {
	// Whether file selection should be allowed.
	Enabled bool `json:"enabled"`
	// Allow the selection of folders.
	AllowFolders bool `json:"allowFolders"`
	// The allowed extensions that should be selectable.
	Extensions []string `json:"extensions"`
	// Multiple files can be selected.
	Multiple bool `json:"multiple"`
	// Whether the file selection should be saved as a relative path.
	Relative bool `json:"relative"`
	// DefaultPath is the default path for the file selection.
	DefaultPath string `json:"defaultPath"`
}

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
