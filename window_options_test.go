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
