package menus

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Menu event constants.
const (
	EventTerminalCreate         = "menu/view/terminal/create"
	EventBottomDrawerMinimize   = "menu/view/bottomdrawer/minimize"
	EventBottomDrawerFullscreen = "menu/view/bottomdrawer/fullscreen"
	EventSidebarMinimize        = "menu/view/sidebar/minimize"
	EventContextTabClose        = "menu/context/drawer-tab/close"
	EventContextTabCloseOthers  = "menu/context/drawer-tab/close-others"
)

func init() {
	application.RegisterEvent[application.Void](EventTerminalCreate)
	application.RegisterEvent[application.Void](EventBottomDrawerMinimize)
	application.RegisterEvent[application.Void](EventBottomDrawerFullscreen)
	application.RegisterEvent[application.Void](EventSidebarMinimize)
	application.RegisterEvent[string](EventContextTabClose)
	application.RegisterEvent[string](EventContextTabCloseOthers)
}

// SetupAppMenu creates and sets the application menu for Wails v3.
// It mirrors the v2 menu structure from GetMenus/CreateViewMenu but uses
// the v3 menu builder API. The menu is shared by every window; reload items
// act on the focused window and fall back to mainWindow.
func SetupAppMenu(app *application.App, mainWindow *application.WebviewWindow, openSettings func()) {
	menu := app.NewMenu()
	focusedWindow := func() application.Window {
		if current := app.Window.Current(); current != nil {
			return current
		}
		return mainWindow
	}

	// macOS-specific role menus
	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
		// The About role opens the standard panel, which shows the numeric
		// CFBundleShortVersionString stamped by CI (a nightly reads "0.0.0").
		// ShowAbout shows Options.Description, which has the full build version.
		appMenu := menu.FindByRole(application.AppMenu).GetSubmenu()
		appMenu.RemoveMenuItem(appMenu.FindByRole(application.About))
		aboutMenu := app.NewMenu()
		aboutMenu.Add("About " + app.Config().Name).OnClick(func(_ *application.Context) {
			app.Menu.ShowAbout()
		})
		aboutMenu.AddSeparator()
		aboutMenu.Add("Settings…").SetAccelerator("CmdOrCtrl+,").OnClick(func(_ *application.Context) {
			go openSettings()
		})
		appMenu.Prepend(aboutMenu)
		menu.AddRole(application.EditMenu)
		menu.AddRole(application.WindowMenu)
	}
	if runtime.GOOS != "darwin" {
		fileMenu := menu.AddSubmenu("File")
		fileMenu.Add("Settings…").SetAccelerator("CmdOrCtrl+,").OnClick(func(_ *application.Context) {
			go openSettings()
		})
	}

	// View submenu — custom items matching the v2 View menu
	viewMenu := menu.AddSubmenu("View")

	viewMenu.Add("Reload").
		SetAccelerator("CmdOrCtrl+R").
		OnClick(func(_ *application.Context) {
			focusedWindow().Reload()
		})

	viewMenu.Add("Force Reload").
		SetAccelerator("CmdOrCtrl+Shift+F").
		OnClick(func(_ *application.Context) {
			focusedWindow().ForceReload()
		})

	viewMenu.AddSeparator()

	viewMenu.Add("New Terminal Session").
		SetAccelerator("CmdOrCtrl+Shift+T").
		OnClick(func(_ *application.Context) {
			app.Event.Emit(EventTerminalCreate)
		})

	viewMenu.Add("Minimize Bottom Menu").
		SetAccelerator("CmdOrCtrl+Shift+B").
		OnClick(func(_ *application.Context) {
			app.Event.Emit(EventBottomDrawerMinimize)
		})

	viewMenu.Add("Maximize Bottom Menu").
		SetAccelerator("CmdOrCtrl+Alt+B").
		OnClick(func(_ *application.Context) {
			app.Event.Emit(EventBottomDrawerFullscreen)
		})

	viewMenu.AddSeparator()

	viewMenu.Add("Close Sidebar").
		SetAccelerator("CmdOrCtrl+Shift+S").
		OnClick(func(_ *application.Context) {
			app.Event.Emit(EventSidebarMinimize)
		})

	app.Menu.Set(menu)
}
