//go:build !ui_next

package window

import "testing"

func TestSettingsPreferredSize(t *testing.T) {
	assertSettingsPreferredSize(t, 1060, 640)
}
