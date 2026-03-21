package menus

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

// SetupKeyBindings registers standalone keyboard shortcuts that are decoupled
// from menu items. In v3, keybindings can exist independently of the menu bar.
func SetupKeyBindings(app *application.App) {
	// Terminal creation shortcut — also in the View menu, but registered as a
	// standalone keybinding so it fires even if the menu is not visible
	// (e.g. on Windows/Linux when the window has no menu bar).
	app.KeyBinding.Add("CmdOrCtrl+Shift+T", func(window application.Window) {
		window.EmitEvent("menu/view/terminal/create")
	})
}
