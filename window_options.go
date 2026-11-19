package main

import "github.com/wailsapp/wails/v3/pkg/application"

// macWebviewPreferences is the WKWebView configuration of every window.
//
// TabFocusesLinks sets WKPreferences.tabFocusesLinks, which also makes Tab
// reach buttons, icon buttons and chips. Without it WebKit follows the macOS
// "Keyboard navigation" setting, off by default, and skips them. Decision A14:
// every control is a Tab stop whatever that setting says.
func macWebviewPreferences() application.MacWebviewPreferences {
	var prefs application.MacWebviewPreferences
	prefs.TabFocusesLinks.Set(true)
	return prefs
}

// macTitleBar hides the title bar and extends the content under it, and keeps
// the traffic lights. MacTitleBarHidden alone leaves them in AppKit's 28 pt
// title bar, centred 16 px from the top: 4 px above the centre of the new
// shell's 40 px top row and 3 px above the old header's 38 px. An empty
// compact unified toolbar makes AppKit lay the lights out for a 38 pt bar
// instead, centred 20 px from the top (docs/ui-next/status/N22b.md).
func macTitleBar() application.MacTitleBar {
	titleBar := application.MacTitleBarHiddenInsetUnified
	titleBar.ToolbarStyle = application.MacToolbarStyleUnifiedCompact
	return titleBar
}

// macApplicationOptions is the application-level macOS configuration.
//
// ApplicationShouldTerminateAfterLastWindowClosed is false: the main window hides instead of closing (backend/window/wails.go, attachMainWindow),
// and with the option on AppKit ends the process as soon as that window is hidden, so the red light, Close Window and Cmd+W on an empty window
// all quit the app. A Mac editor (VS Code, JetBrains) keeps running in the Dock after its window closes; Quit (Cmd+Q) exits, and a Dock click shows
// the hidden window again (Wails reopens every hidden window when the app is activated with none visible). Decision A17.
func macApplicationOptions() application.MacOptions {
	return application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: false}
}
