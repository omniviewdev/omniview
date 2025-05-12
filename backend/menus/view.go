package menus

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// CreateViewMenu appends the View menu
func CreateViewMenu(ctx context.Context, appMenu *menu.Menu) {
	ViewMenu := appMenu.AddSubmenu("View")
	ViewMenu.AddText(
		"Reload",
		keys.CmdOrCtrl("r"),
		func(_ *menu.CallbackData) {
			wailsruntime.WindowReload(ctx)
		},
	)
	ViewMenu.AddText(
		"Force Reload",
		keys.Combo("f", keys.CmdOrCtrlKey, keys.ShiftKey),
		func(_ *menu.CallbackData) {
			wailsruntime.WindowReloadApp(ctx)
		},
	)

	//===========================================================
	// Bottom Menu actions
	//===========================================================
	ViewMenu.AddSeparator()
	ViewMenu.AddText(
		"New Terminal Session",
		keys.Combo("t", keys.CmdOrCtrlKey, keys.ShiftKey),
		func(_ *menu.CallbackData) {
			wailsruntime.EventsEmit(ctx, "menu/view/terminal/create")
		},
	)
	ViewMenu.AddText(
		"Minimize Bottom Menu",
		keys.Combo("b", keys.CmdOrCtrlKey, keys.ShiftKey),
		func(_ *menu.CallbackData) {
			wailsruntime.EventsEmit(ctx, "menu/view/bottomdrawer/minimize")
		},
	)
	ViewMenu.AddText(
		"Maximize Bottom Menu",
		keys.Combo("b", keys.CmdOrCtrlKey, keys.OptionOrAltKey),
		func(_ *menu.CallbackData) {
			wailsruntime.EventsEmit(ctx, "menu/view/bottomdrawer/fullscreen")
		},
	)

	//===========================================================
	// Sidebar Menu actions
	//===========================================================
	ViewMenu.AddSeparator()
	ViewMenu.AddText(
		"Close Sidebar",
		keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey),
		func(_ *menu.CallbackData) {
			wailsruntime.EventsEmit(ctx, "menu/view/sidebar/minimize")
		},
	)
}
