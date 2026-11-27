//go:build !ui_next

package categories

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCurrentFlavourOmitsMaterialSettings(t *testing.T) {
	for _, key := range []string{"windowMaterial", "glassStyle", "chromeOpacity", "contentOpacity", "menuOpacity", "sheetOpacity"} {
		require.NotContains(t, Appearance.Settings, key)
	}
}
