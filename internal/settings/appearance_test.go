package categories

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAppearanceThemeDefaultsToVoid(t *testing.T) {
	setting := Appearance.Settings[settingTheme]
	require.Equal(t, "void", setting.Default)
	require.Empty(t, setting.Options)
	require.NoError(t, setting.Validate("plugin:acme/slate"))
	require.Error(t, setting.Validate("bad theme id"))
}

func TestMigrateAppearanceValues(t *testing.T) {
	tests := map[string]string{
		"default":           "void",
		"solarized":         "solarized-dark",
		"void":              "void",
		"plugin:acme/slate": "plugin:acme/slate",
	}
	for input, want := range tests {
		t.Run(input, func(t *testing.T) {
			original := map[string]any{settingTheme: input, "future": "preserved"}
			values, changed := MigrateAppearanceValues(original)
			require.Equal(t, want, values[settingTheme])
			require.Equal(t, "preserved", values["future"])
			require.Equal(t, input != want, changed)
			require.Equal(t, input, original[settingTheme], "migration must not mutate its input")
		})
	}
}

func TestMigrateTerminalValues(t *testing.T) {
	tests := map[string]string{
		"default":         "application",
		"application":     "application",
		"dracula":         "dracula",
		"future-terminal": "future-terminal",
	}
	for input, want := range tests {
		t.Run(input, func(t *testing.T) {
			original := map[string]any{settingTheme: input, "future": "preserved"}
			values, changed := MigrateTerminalValues(original)
			require.Equal(t, want, values[settingTheme])
			require.Equal(t, "preserved", values["future"])
			require.Equal(t, input != want, changed)
			require.Equal(t, input, original[settingTheme], "migration must not mutate its input")
		})
	}
}

func TestEditorThemeDefaultsToApplicationWithExplicitOptions(t *testing.T) {
	setting := Editor.Settings[settingTheme]
	require.Equal(t, "application", setting.Default)
	require.Len(t, setting.Options, 3)
	require.Equal(t, "application", setting.Options[0].Value)
	require.Equal(t, "brilliance-black", setting.Options[1].Value)
	require.Equal(t, "github-dark", setting.Options[2].Value)
}

func TestTerminalThemeDefaultsToApplicationWithExplicitOptions(t *testing.T) {
	setting := Terminal.Settings[settingTheme]
	require.Equal(t, "application", setting.Default)
	require.Equal(t, "application", setting.Options[0].Value)
	require.Greater(t, len(setting.Options), 1)
}
