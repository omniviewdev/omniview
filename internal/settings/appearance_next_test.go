//go:build ui_next

package categories

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMaterialSchema(t *testing.T) {
	for key, choices := range map[string][]string{
		"windowMaterial": {"opaque", "translucent", "glass"}, "glassStyle": {"regular", "clear"},
	} {
		setting := Appearance.Settings[key]
		require.Equal(t, choices[0], setting.Default)
		for _, choice := range choices {
			require.NoError(t, setting.Validate(choice))
		}
		require.Error(t, setting.Validate("unsupported"))
	}
	for key, value := range map[string]int{"chromeOpacity": 62, "contentOpacity": 94, "menuOpacity": 90, "sheetOpacity": 96} {
		setting := Appearance.Settings[key]
		require.Equal(t, value, setting.Default)
		for _, valid := range []any{0, 100, float64(72)} {
			require.NoError(t, setting.Validate(valid))
		}
		for _, invalid := range []any{-1, 101, 2.5, math.NaN(), math.Inf(1), nil, "70", true} {
			require.Error(t, setting.Validate(invalid))
		}
	}
}
