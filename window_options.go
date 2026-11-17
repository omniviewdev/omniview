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
