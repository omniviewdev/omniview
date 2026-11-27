package categories

import (
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/settings"
)

// The host is the producer of the terminal's settings (issue #697 step 1): each declares its type, its default and
// the bounds the page may rely on, so that a value outside them is refused at the commit and never reaches an emulator.

func terminalSetting(t *testing.T, id string) settings.Setting {
	t.Helper()
	setting, ok := Terminal.Settings[id]
	require.True(t, ok, "the terminal category declares %q", id)
	return setting
}

func TestTheTerminalDeclaresTheSettingsOfIssue697(t *testing.T) {
	want := map[string]struct {
		kind settings.SettingType
		def  any
	}{
		"fontFamily":            {settings.Text, ""},
		"fontSize":              {settings.Integer, 12},
		"lineHeight":            {settings.Float, 1.5},
		"scrollback":            {settings.Integer, 5000},
		"cursorStyle":           {settings.Text, "block"},
		"cursorBlink":           {settings.Toggle, true}, // the legacy UI's default: the new tool reads "cursorBlinkNext"
		"macOptionIsMeta":       {settings.Text, "auto"},
		"bell":                  {settings.Text, "visual"},
		"gpuAcceleration":       {settings.Text, "auto"},
		"copyOnSelect":          {settings.Toggle, false},
		"multiLinePasteWarning": {settings.Text, "auto"},
	}
	for id, expected := range want {
		got := terminalSetting(t, id)
		assert.Equal(t, expected.kind, got.Type, id)
		assert.Equal(t, expected.def, got.Default, id)
		assert.NotEmpty(t, got.Label, id)
		assert.NotEmpty(t, got.Description, id)
	}
}

func TestTheTerminalRefusesAValueOutsideTheProducersBounds(t *testing.T) {
	cases := []struct {
		id      string
		valid   []any
		invalid []any
	}{
		{"fontSize", []any{6, 12, 72, 14.0}, []any{5, 73, 0, -1, 12.5, math.NaN(), math.Inf(1)}},
		{"lineHeight", []any{1.0, 1.5, 2.0, 1}, []any{0.0, 0.99, 2.01, 100.0, -1.0, math.NaN(), math.Inf(1)}},
		{"scrollback", []any{0, 1, 5000, 100000, 1000.0}, []any{-1, 100001, 1_000_000_000, 10.5, math.NaN(), math.Inf(1)}},
		{"cursorStyle", []any{"block", "underline", "bar"}, []any{"", "BLOCK", "beam"}},
		{"macOptionIsMeta", []any{"auto", "on", "off"}, []any{"", "true", "ON"}},
		{"bell", []any{"off", "visual"}, []any{"", "audible", "on"}},
		{"gpuAcceleration", []any{"auto", "on", "off"}, []any{"", "webgl", "true"}},
		{"multiLinePasteWarning", []any{"auto", "always", "never"}, []any{"", "ask", "sometimes"}},
		{"fontFamily", []any{"", "Menlo", "JetBrains Mono", `"Fira Code", monospace`, "SF Mono, Menlo, monospace", "Noto Sans Mono CJK-JP"}, []any{
			"a; color: red", "Menlo;monospace", "Menlo; monospace", "url(https://evil.example/f.woff2)", "Menlo, url(x)", "a{b}", `"unterminated`, "a\nb", "a\\b", "x<y>", strings.Repeat("a", 257), "a,,b", ", a", "a, ",
		}},
	}
	for _, tc := range cases {
		setting := terminalSetting(t, tc.id)
		for _, value := range tc.valid {
			assert.True(t, setting.Validation(value).Valid, "%s accepts %v", tc.id, value)
		}
		for _, value := range tc.invalid {
			result := setting.Validation(value)
			assert.False(t, result.Valid, "%s refuses %v", tc.id, value)
			assert.NotEmpty(t, result.Message, tc.id)
		}
	}
}

func TestTheTerminalRefusesAValueOfAnotherTypeAtTheCommit(t *testing.T) {
	provider := settings.NewProvider(settings.ProviderOpts{PluginSettings: []settings.Category{Terminal}})
	require.Error(t, provider.SetSetting("terminal.scrollback", 1_000_000_000))
	require.Error(t, provider.SetSetting("terminal.lineHeight", 100.0))
	require.Error(t, provider.SetSetting("terminal.bell", "audible"))
	require.NoError(t, provider.SetSetting("terminal.lineHeight", 1.25))
	got, err := provider.GetFloat("terminal.lineHeight")
	require.NoError(t, err)
	assert.InDelta(t, 1.25, got, 0)
	got2, err := provider.GetInt("terminal.scrollback")
	require.NoError(t, err)
	assert.Equal(t, 5000, got2, "a refused commit leaves the value")
}

func TestTheLegacyCursorBlinkDefaultIsUnchangedAndTheNewToolHasItsOwnKey(t *testing.T) {
	assert.Equal(t, true, terminalSetting(t, "cursorBlink").Default, "the legacy UI's declared default stays true")
	next := terminalSetting(t, "cursorBlinkNext")
	assert.Equal(t, settings.Toggle, next.Type)
	assert.Equal(t, false, next.Default, "idle is zero timers in the new tool")
}
