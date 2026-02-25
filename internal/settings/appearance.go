package categories

import "github.com/omniviewdev/plugin-sdk/settings"

//nolint:gochecknoglobals // we're providing this as a package level variable
var Appearance = settings.Category{
	ID:          "appearance",
	Label:       "Appearance",
	Description: "Customize the look and feel of the application",
	Icon:        "LuPaintbrush",
	Settings:    map[string]settings.Setting{},
}
