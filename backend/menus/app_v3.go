package menus

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// SetupAppMenu creates and sets the application menu for Wails v3.
// It mirrors the v2 menu structure from GetMenus/CreateViewMenu but uses
// the v3 menu builder API.
func SetupAppMenu(app *application.App, window *application.WebviewWindow) {
	menu := app.NewMenu()

	// macOS-specific role menus
	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
		menu.AddRole(application.EditMenu)
		menu.AddRole(application.WindowMenu)
	}

	// View submenu — custom items matching the v2 View menu
	viewMenu := menu.AddSubmenu("View")

	viewMenu.Add("Reload").
		SetAccelerator("CmdOrCtrl+R").
		OnClick(func(ctx *application.Context) {
			window.Reload()
		})

	viewMenu.Add("Force Reload").
		SetAccelerator("CmdOrCtrl+Shift+F").
		OnClick(func(ctx *application.Context) {
			window.ForceReload()
		})

	viewMenu.AddSeparator()

	viewMenu.Add("New Terminal Session").
		SetAccelerator("CmdOrCtrl+Shift+T").
		OnClick(func(ctx *application.Context) {
			app.Event.Emit("menu/view/terminal/create")
		})

	viewMenu.Add("Minimize Bottom Menu").
		SetAccelerator("CmdOrCtrl+Shift+B").
		OnClick(func(ctx *application.Context) {
			app.Event.Emit("menu/view/bottomdrawer/minimize")
		})

	viewMenu.Add("Maximize Bottom Menu").
		SetAccelerator("CmdOrCtrl+Alt+B").
		OnClick(func(ctx *application.Context) {
			app.Event.Emit("menu/view/bottomdrawer/fullscreen")
		})

	viewMenu.AddSeparator()

	viewMenu.Add("Close Sidebar").
		SetAccelerator("CmdOrCtrl+Shift+S").
		OnClick(func(ctx *application.Context) {
			app.Event.Emit("menu/view/sidebar/minimize")
		})

	app.Menu.Set(menu)
}
