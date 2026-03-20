package menus

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

// SetupContextMenus registers all application context menus.
// Context menus are attached to HTML elements via the CSS property
// --custom-contextmenu, e.g.:
//
//	<div style="--custom-contextmenu: drawer-tab; --custom-contextmenu-data: tab-id">
func SetupContextMenus(app *application.App) {
	setupDrawerTabContextMenu(app)
}

// setupDrawerTabContextMenu creates the right-click menu for drawer tabs
// (bottom panel tabs such as terminal sessions).
func setupDrawerTabContextMenu(app *application.App) {
	ctxMenu := app.ContextMenu.New()

	ctxMenu.Add("Close Tab").OnClick(func(ctx *application.Context) {
		tabID := ctx.ContextMenuData()
		app.Event.Emit(EventContextTabClose, tabID)
	})

	ctxMenu.Add("Close Other Tabs").OnClick(func(ctx *application.Context) {
		tabID := ctx.ContextMenuData()
		app.Event.Emit(EventContextTabCloseOthers, tabID)
	})

	app.ContextMenu.Add("drawer-tab", ctxMenu)
}
