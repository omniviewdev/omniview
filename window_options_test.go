package main

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Decision A14: every control is a Tab stop. WKWebView skips plain buttons
// unless the macOS "Keyboard navigation" setting is on or tabFocusesLinks is
// set, so the window template must set it (docs/ui-next/status/N22.md).
func TestMacWebviewPreferencesTabToEveryControl(t *testing.T) {
	prefs := macWebviewPreferences()

	require.True(t, prefs.TabFocusesLinks.IsSet(), "TabFocusesLinks must be set explicitly, not left to the macOS default")
	require.True(t, prefs.TabFocusesLinks.Get())
}

func TestMacTitleBarCentresTrafficLightsOnTheTopRow(t *testing.T) {
	titleBar := macTitleBar()

	require.True(t, titleBar.AppearsTransparent)
	require.True(t, titleBar.HideTitle)
	require.True(t, titleBar.FullSizeContent)
	require.False(t, titleBar.Hide, "the title bar stays: it carries the traffic lights")
	require.True(t, titleBar.UseToolbar, "the empty toolbar is what moves the lights down")
	require.True(t, titleBar.HideToolbarSeparator)
	require.Equal(t, application.MacToolbarStyleUnifiedCompact, titleBar.ToolbarStyle)
}

// Decision A17 and the VS Code and JetBrains rule: on macOS the red light, Close Window (Cmd+Shift+W) and Cmd+W on the empty window close the
// window and the app STAYS in the Dock; only Quit (Cmd+Q) exits. The main window hides on close (backend/window/wails.go, attachMainWindow), and
// AppKit asks the delegate after every window that closes or hides whether the app should end: the answer must be no (docs/ui-next/status/S2b.md,
// observed natively: with the option on, the process exited on the red light in every build from the Wails v3 migration on).
func TestMacApplicationStaysRunningWhenTheLastWindowCloses(t *testing.T) {
	options := macApplicationOptions()

	require.False(t, options.ApplicationShouldTerminateAfterLastWindowClosed, "the main window hides on close: the app must not quit with it")
}
