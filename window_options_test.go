package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Decision A14: every control is a Tab stop. WKWebView skips plain buttons
// unless the macOS "Keyboard navigation" setting is on or tabFocusesLinks is
// set, so the window template must set it (docs/ui-next/status/N22.md).
func TestMacWebviewPreferencesTabToEveryControl(t *testing.T) {
	prefs := macWebviewPreferences()

	require.True(t, prefs.TabFocusesLinks.IsSet(), "TabFocusesLinks must be set explicitly, not left to the macOS default")
	require.True(t, prefs.TabFocusesLinks.Get())
}
