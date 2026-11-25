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
	EventZoomIn                 = "menu/view/zoom/in"
	EventZoomOut                = "menu/view/zoom/out"
	EventZoomReset              = "menu/view/zoom/reset"
	EventContextTabClose        = "menu/context/drawer-tab/close"
	EventContextTabCloseOthers  = "menu/context/drawer-tab/close-others"
)

func init() {
	application.RegisterEvent[application.Void](EventTerminalCreate)
	application.RegisterEvent[application.Void](EventBottomDrawerMinimize)
	application.RegisterEvent[application.Void](EventBottomDrawerFullscreen)
	application.RegisterEvent[application.Void](EventSidebarMinimize)
	application.RegisterEvent[application.Void](EventZoomIn)
	application.RegisterEvent[application.Void](EventZoomOut)
	application.RegisterEvent[application.Void](EventZoomReset)
	application.RegisterEvent[string](EventContextTabClose)
	application.RegisterEvent[string](EventContextTabCloseOthers)
}

// AppMenuOptions selects the build-dependent parts of the application menu.
type AppMenuOptions struct {
	// Reload adds View > Reload (CmdOrCtrl+R). It reloads the whole window and
	// so every open tab, which is why it is kept for development instances and
	// dropped from packaged builds (decision A18). Force Reload stays in both.
	Reload bool
}

// windowCloser is the part of a window the Close Window item needs.
type windowCloser interface {
	Close()
}

// SetupAppMenu creates and sets the application menu for Wails v3.
// It mirrors the v2 menu structure from GetMenus/CreateViewMenu but uses
// the v3 menu builder API. The menu is shared by every window; reload items
// act on the focused window and fall back to mainWindow.
func SetupAppMenu(
	app *application.App,
	mainWindow *application.WebviewWindow,
	openSettings func(),
	options AppMenuOptions,
) {
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
		addCloseWindowMenu(menu, func() windowCloser { return focusedWindow() })
		menu.AddRole(application.EditMenu)
		menu.AddRole(application.WindowMenu)
	}
	if runtime.GOOS != "darwin" {
		fileMenu := menu.AddSubmenu("File")
		fileMenu.Add("Settings…").SetAccelerator("CmdOrCtrl+,").OnClick(func(_ *application.Context) {
			go openSettings()
		})
	}

	addViewMenu(menu, app, focusedWindow, options.Reload)

	app.Menu.Set(menu)
}

// addCloseWindowMenu adds the macOS File submenu, which holds only Close Window.
// macOS has no other menu item for it: the Window role lacks one, and the page
// owns Cmd+W (it closes a tab), so the window chord is Cmd+Shift+W.
func addCloseWindowMenu(menu *application.Menu, focused func() windowCloser) {
	fileMenu := menu.AddSubmenu("File")
	fileMenu.Add("Close Window").
		SetAccelerator("CmdOrCtrl+Shift+W").
		OnClick(closeFocused(focused))
}

// closeFocused returns the Close Window click handler. It calls Close on the
// focused window, so the close goes through the window's close hook: the main
// window and the Settings window hide and the app keeps running; any other
// window closes.
func closeFocused(focused func() windowCloser) func(*application.Context) {
	return func(_ *application.Context) {
		focused().Close()
	}
}

// addViewMenu adds the View submenu — custom items matching the v2 View menu.
// Reload is added only when reload is true.
func addViewMenu(
	menu *application.Menu,
	app *application.App,
	focusedWindow func() application.Window,
	reload bool,
) {
	viewMenu := menu.AddSubmenu("View")

	if reload {
		viewMenu.Add("Reload").
			SetAccelerator("CmdOrCtrl+R").
			OnClick(func(_ *application.Context) {
				focusedWindow().Reload()
			})
	}

	viewMenu.Add("Force Reload").
		SetAccelerator("CmdOrCtrl+Shift+F").
		OnClick(func(_ *application.Context) {
			focusedWindow().ForceReload()
		})

	viewMenu.AddSeparator()
	viewMenu.Add("Zoom In").
		SetAccelerator("CmdOrCtrl+Plus").
		OnClick(func(_ *application.Context) {
			focusedWindow().EmitEvent(EventZoomIn)
		})
	viewMenu.Add("Zoom Out").
		SetAccelerator("CmdOrCtrl+-").
		OnClick(func(_ *application.Context) {
			focusedWindow().EmitEvent(EventZoomOut)
		})
	viewMenu.Add("Reset Zoom").
		SetAccelerator("CmdOrCtrl+0").
		OnClick(func(_ *application.Context) {
			focusedWindow().EmitEvent(EventZoomReset)
		})

	viewMenu.AddSeparator()

	// The page reopens a closed tab with Cmd+Shift+T, so on macOS the menu takes Ctrl+Shift+` instead. Wails cannot match the backtick key on Windows
	// and Linux (keys_windows.go names it OEM_3): there the chord stays Ctrl+Shift+T and the page reopens with Ctrl+Alt+Shift+T.
	newTerminal := "CmdOrCtrl+Shift+T"
	if runtime.GOOS == "darwin" {
		newTerminal = "Ctrl+Shift+`"
	}
	viewMenu.Add("New Terminal Session").
		SetAccelerator(newTerminal).
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
}
