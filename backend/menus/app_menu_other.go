//go:build !darwin || server

package menus

import "github.com/wailsapp/wails/v3/pkg/application"

// addAppMenu keeps the Wails AppMenu role where no native About panel exists.
func addAppMenu(menu *application.Menu, _ string) {
	menu.AddRole(application.AppMenu)
}
