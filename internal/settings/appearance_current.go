//go:build !ui_next

package categories

import "github.com/omniviewdev/plugin-sdk/settings"

func withWindowMaterials(fields map[string]settings.Setting) map[string]settings.Setting {
	return fields
}
