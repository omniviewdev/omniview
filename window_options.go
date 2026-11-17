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
