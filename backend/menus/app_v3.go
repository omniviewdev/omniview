package menus

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// EventCommand is the event of an item that runs a command of the new shell. Its data is the id of a host command
// (ui-next/plugins/host/palette.ts): every window hears it, and the one that has the focus runs the command.
const EventCommand = "menu/command"

// The events of the old shell (ui/). The new shell hears none of them, so Zoom does nothing there. The items that run
// a command send theirs after it, so the old shell keeps them.
const (
	EventTerminalCreate       = "menu/view/terminal/create"
	EventBottomDrawerMinimize = "menu/view/bottomdrawer/minimize"
	EventZoomIn               = "menu/view/zoom/in"
	EventZoomOut              = "menu/view/zoom/out"
	EventZoomReset            = "menu/view/zoom/reset"
)

func init() {
	application.RegisterEvent[string](EventCommand)
	application.RegisterEvent[application.Void](EventTerminalCreate)
	application.RegisterEvent[application.Void](EventBottomDrawerMinimize)
	application.RegisterEvent[application.Void](EventZoomIn)
	application.RegisterEvent[application.Void](EventZoomOut)
	application.RegisterEvent[application.Void](EventZoomReset)
}

// AppMenuOptions selects the build-dependent parts of the application menu.
type AppMenuOptions struct {
	// Reload adds View > Reload (CmdOrCtrl+R). It reloads the whole window and
	// so every open tab, which is why it is kept for development instances and
	// dropped from packaged builds (decision A18). Force Reload stays in both.
	Reload bool
}

// darwin is the GOOS of macOS, whose menu differs from the other platforms'.
const darwin = "darwin"

// windowCloser is the part of a window the Close Window item needs.
type windowCloser interface {
	Close()
}

// emitter is the part of the application's event manager the command items need.
type emitter interface {
	Emit(name string, data ...any) bool
}

// commandRow is an item that runs a command of the new shell. An empty accelerator binds nothing and leaves the key to
// the page: the chord depends on what has the focus (Cmd+K clears a terminal that has it) or a terminal keeps it
// (Ctrl+Tab).
type commandRow struct {
	label  string
	mac    string // accelerator on macOS
	other  string // accelerator on Windows and Linux
	shown  string // chord the page binds; Windows draws it as text where other is empty (its menu shows what follows a tab without binding it, which macOS and GTK cannot)
	id     string // host command the item runs
	legacy string // event the old shell listens to for the same action
}

func fileCommands() []commandRow {
	return []commandRow{
		{label: "Close Tab", mac: "", other: "", shown: "Ctrl+W", id: "host.tab.close", legacy: ""},
		{label: "Reopen Closed Tab", mac: "Cmd+Shift+T", other: "", shown: "Ctrl+Alt+Shift+T", id: "host.tab.reopen", legacy: ""},
	}
}

// viewCommands: Cmd+Shift+T is Reopen Closed Tab, so New Terminal takes Ctrl+Shift+` on macOS. Wails cannot match the
// backtick key on Windows and Linux (keys_windows.go names it OEM_3): there New Terminal stays Ctrl+Shift+T, and the
// page reopens with Ctrl+Alt+Shift+T.
func viewCommands() []commandRow {
	return []commandRow{
		{label: "Search…", mac: "", other: "", shown: "Ctrl+K", id: "host.search", legacy: ""},
		{label: "Toggle Panel", mac: "Cmd+J", other: "", shown: "Ctrl+J", id: "host.panel.toggle", legacy: EventBottomDrawerMinimize},
		{label: "Toggle Maximized Panel", mac: "Cmd+Shift+J", other: "Ctrl+Alt+Shift+J", shown: "", id: "host.panel.maximize", legacy: ""},
		{label: "New Terminal", mac: "Ctrl+Shift+`", other: "Ctrl+Shift+T", shown: "", id: "host.terminal.new", legacy: EventTerminalCreate},
		{label: "Next Tab", mac: "Cmd+Shift+]", other: "", shown: "Ctrl+Tab", id: "host.tab.next", legacy: ""},
		{label: "Previous Tab", mac: "Cmd+Shift+[", other: "", shown: "Ctrl+Shift+Tab", id: "host.tab.previous", legacy: ""},
	}
}

// commandClick is the click of a row: every window hears the command, and the one that has the focus runs it.
func commandClick(row commandRow, events emitter) func(*application.Context) {
	return func(_ *application.Context) {
		events.Emit(EventCommand, row.id)
		if row.legacy != "" {
			events.Emit(row.legacy)
		}
	}
}

// addCommands adds an item for each row, with the accelerator goos gives it.
func addCommands(menu *application.Menu, rows []commandRow, events emitter, goos string) {
	for _, row := range rows {
		label, accelerator := row.label, row.other
		switch {
		case goos == darwin:
			accelerator = row.mac
		case goos == "windows" && accelerator == "":
			label += "\t" + row.shown
		}

		item := menu.Add(label).OnClick(commandClick(row, events))
		if accelerator != "" {
			item.SetAccelerator(accelerator)
		}
	}
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
	if runtime.GOOS == darwin {
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
		addFileMenu(menu, app.Event, func() windowCloser { return focusedWindow() })
		menu.AddRole(application.EditMenu)
		menu.AddRole(application.WindowMenu)
	}
	if runtime.GOOS != darwin {
		fileMenu := menu.AddSubmenu("File")
		fileMenu.Add("Settings…").SetAccelerator("CmdOrCtrl+,").OnClick(func(_ *application.Context) {
			go openSettings()
		})
		addCommands(fileMenu, fileCommands(), app.Event, runtime.GOOS)
	}

	addViewMenu(menu, app, focusedWindow, options.Reload)

	app.Menu.Set(menu)
}

// addFileMenu adds the macOS File submenu: the tab commands, then Close Window.
// macOS has no other menu item for the window: the Window role lacks one, and the
// page owns Cmd+W (it closes a tab), so the window chord is Cmd+Shift+W.
func addFileMenu(menu *application.Menu, events emitter, focused func() windowCloser) {
	fileMenu := menu.AddSubmenu("File")
	addCommands(fileMenu, fileCommands(), events, darwin)
	fileMenu.AddSeparator()
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

// addViewMenu adds the View submenu: the commands of the new shell, Reload and
// Force Reload, and the old shell's zoom. Reload is added only when reload is true.
func addViewMenu(
	menu *application.Menu,
	app *application.App,
	focusedWindow func() application.Window,
	reload bool,
) {
	viewMenu := menu.AddSubmenu("View")

	addCommands(viewMenu, viewCommands(), app.Event, runtime.GOOS)
	viewMenu.AddSeparator()

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

	// The new shell reads no text size yet, so these three do nothing in it.
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
}
