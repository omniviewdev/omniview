package menus

import (
	"context"
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

// GetMenus get's the upper menus for the application
func GetMenus(ctx context.Context) *menu.Menu {
	AppMenu := menu.NewMenu()
	if runtime.GOOS == "darwin" {
		AppMenu.Append(menu.AppMenu())

		// Edit
		AppMenu.Append(menu.EditMenu())

		// WindowMenu
		AppMenu.Append(menu.WindowMenu())
	}

	// View
	CreateViewMenu(ctx, AppMenu)

	return AppMenu
}
