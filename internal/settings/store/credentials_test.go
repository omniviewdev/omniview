package store

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	coresettings "github.com/omniviewdev/omniview/internal/settings"
	"github.com/omniviewdev/plugin-sdk/settings"
)

func TestCredentialsDied(t *testing.T) {
	tokenIsACredential := func(id string) bool { return id == "token" || id == "pin" || id == "nested" }
	cases := []struct {
		name string
		old  string
		next string
		want bool
	}{
		{"nothing was stored", "", `{"token":"x"}`, false},
		{"a credential was removed with the document", `{"token":"x"}`, "", true},
		{"a credential was left out", `{"token":"x","theme":"dark"}`, `{"theme":"dark"}`, true},
		{"a credential was replaced", `{"token":"x"}`, `{"token":"y"}`, true},
		{"a credential was cleared", `{"token":"x"}`, `{"token":""}`, true},
		{"a credential was set to null", `{"token":"x"}`, `{"token":null}`, true},
		{"a credential was kept", `{"token":"x","theme":"dark"}`, `{"token":"x","theme":"light"}`, false},
		{"a credential was kept in another encoding", `{"token":"a/b"}`, `{"token":"a\/b"}`, false},
		{"a credential that was empty is set", `{"token":""}`, `{"token":"first"}`, false},
		{"a credential that was null is set", `{"token":null}`, `{"token":"first"}`, false},
		{"a credential that was empty is dropped", `{"token":""}`, `{}`, false},
		{"a credential is added", `{"theme":"dark"}`, `{"theme":"dark","token":"x"}`, false},
		{"an ordinary value changes", `{"theme":"dark"}`, `{"theme":"light"}`, false},
		{"an ordinary value is dropped", `{"theme":"dark"}`, `{}`, false},
		{"a numeric credential changes", `{"pin":1234}`, `{"pin":1235}`, true},
		{"a numeric credential is kept", `{"pin":1234}`, `{"pin":1234.0}`, false},
		{"integers above 2^53 that differ in the last digit", `{"pin":9007199254740992}`, `{"pin":9007199254740993}`, true},
		{"integers above 2^53 that are the same", `{"pin":9007199254740993}`, `{"pin":9007199254740993.0}`, false},
		{"big integers nested in objects and arrays",
			`{"nested":{"ids":[1,9007199254740992]}}`, `{"nested":{"ids":[1,9007199254740993]}}`, true},
		{"the same big integers nested", `{"nested":{"ids":[1,9007199254740993]}}`, `{"nested":{"ids":[1,9007199254740993.0]}}`, false},
		{"a number with an exponent counts as changed", `{"pin":1e3}`, `{"pin":1000}`, true},
		{"a number of a few hundred digits counts as changed",
			`{"pin":1` + strings.Repeat("0", 200) + `}`, `{"pin":1` + strings.Repeat("0", 200) + `.0}`, true},
		{"a nested credential changes", `{"nested":{"a":1,"b":"x"}}`, `{"nested":{"a":1,"b":"y"}}`, true},
		{"a nested credential is kept in another order", `{"nested":{"a":1,"b":"x"}}`, `{"nested":{"b":"x","a":1}}`, false},
		{"the document was not an object", `["s3cret"]`, `{"token":"x"}`, true},
		{"the document could not be read", `{"token":"s3cret"`, `{"token":"x"}`, true},
		{"the document was null", `null`, `{"token":"x"}`, false},
		{"the new document cannot be read", `{"token":"x"}`, `{"token":`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var old, next []byte
			if tc.old != "" {
				old = []byte(tc.old)
			}
			if tc.next != "" {
				next = []byte(tc.next)
			}
			assert.Equal(t, tc.want, credentialsDied(old, next, tokenIsACredential))
		})
	}
	assert.False(t, credentialsDied([]byte(`{"token":"x"}`), nil, func(string) bool { return false }),
		"nothing is a credential when the classifier says so")
}

func TestOrdinaryCredentialsCallEveryUnlistedValueACredential(t *testing.T) {
	classify := ordinaryCredentials(map[string]struct{}{"theme": {}})
	assert.False(t, classify("theme"))
	assert.True(t, classify("token"))
	assert.True(t, classify("undeclared"))
	assert.True(t, ordinaryCredentials(nil)("theme"), "with nothing remembered about the plugin every value is one")
}

func coreCategories() []settings.Category {
	return []settings.Category{
		{ID: "telemetry", Settings: map[string]settings.Setting{
			"endpoint":        {ID: "endpoint", Type: settings.Text},
			"auth_value":      {ID: "auth_value", Type: settings.Password, Sensitive: true},
			"loki_auth_value": {ID: "loki_auth_value", Type: settings.Text, Sensitive: true},
			"bare_password":   {ID: "bare_password", Type: settings.Password},
		}},
		{ID: "appearance", Settings: map[string]settings.Setting{
			"theme": {ID: "theme", Type: settings.Select},
		}},
	}
}

func TestWithCredentialSettingsListsTheSensitiveAndPasswordSettings(t *testing.T) {
	cfg := newConfig([]Option{WithCredentialSettings(coreCategories())})

	telemetry := cfg.coreCredentials("telemetry")
	assert.True(t, telemetry("auth_value"))
	assert.True(t, telemetry("loki_auth_value"), "declared Sensitive")
	assert.True(t, telemetry("bare_password"), "declared a Password")
	assert.False(t, telemetry("endpoint"))
	assert.False(t, telemetry("undeclared"))
	assert.False(t, cfg.coreCredentials("appearance")("theme"))
	assert.False(t, cfg.coreCredentials("unknown")("auth_value"))
	assert.False(t, newConfig(nil).coreCredentials("telemetry")("auth_value"), "without the option no core value is one")
}

func TestAClearedOrReplacedCoreCredentialLeavesNoCopy(t *testing.T) {
	const planted = "core-sentinel-4a90e7c2b815"
	cases := map[string]func(*Store) error{
		"patch to empty": func(s *Store) error {
			return s.PatchSettings(map[string]any{"telemetry.auth_value": ""})
		},
		"patch to another value": func(s *Store) error {
			return s.PatchSettings(map[string]any{"telemetry.auth_value": "rotated"})
		},
		"save the category without it": func(s *Store) error {
			return s.SaveCategory("telemetry", map[string]any{"endpoint": "https://example.test"})
		},
		"save the category with another value": func(s *Store) error {
			return s.SaveCategories(map[string]map[string]any{
				"telemetry": {"endpoint": "https://example.test", "auth_value": "rotated"},
			})
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			s, err := Open(filepath.Join(dir, "settings.db"), WithCredentialSettings(coreCategories()))
			require.NoError(t, err)
			t.Cleanup(func() { _ = s.Close() })
			require.NoError(t, s.SaveCategory("telemetry", map[string]any{"endpoint": "https://example.test", "auth_value": planted}))
			require.NotEmpty(t, filesContaining(t, dir, planted))

			require.NoError(t, change(s))

			assert.Empty(t, filesContaining(t, dir, planted))
			saved, err := s.LoadCategory("telemetry")
			require.NoError(t, err)
			assert.Equal(t, "https://example.test", saved["endpoint"])
		})
	}
}

func TestACoreValueThatIsNotACredentialDoesNotScrub(t *testing.T) {
	plan := &faultPlan{}
	s, _ := openScrubStore(t, plan, WithCredentialSettings(coreCategories()))
	require.NoError(t, s.SaveCategory("telemetry", map[string]any{"endpoint": "https://a.example.test", "auth_value": "kept"}))
	require.NoError(t, s.SaveCategory("appearance", map[string]any{"theme": "dark"}))

	require.NoError(t, s.PatchSettings(map[string]any{"telemetry.endpoint": "https://b.example.test", "appearance.theme": "light"}))
	require.NoError(t, s.SaveCategory("telemetry", map[string]any{"endpoint": "https://c.example.test", "auth_value": "kept"}))

	assert.Empty(t, plan.steps(), "a preference changes and no scrub runs")
}

func TestWithoutTheOptionNoCoreValueIsScrubbed(t *testing.T) {
	// The store cannot tell a core credential from a preference unless the host
	// says which settings are credentials. This pins that the option is what does it.
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	require.NoError(t, s.SaveCategory("telemetry", map[string]any{"auth_value": scrubPlanted}))

	require.NoError(t, s.PatchSettings(map[string]any{"telemetry.auth_value": ""}))

	assert.Empty(t, plan.steps())
	assert.NotEmpty(t, filesContaining(t, dir, scrubPlanted))
}

func TestTheHostsOwnDefinitionsNameThreeCredentials(t *testing.T) {
	// main hands the store these definitions. When a core setting becomes a Password
	// or Sensitive, the store learns it from here, and this test says so.
	cfg := newConfig([]Option{WithCredentialSettings(coresettings.Definitions(false))})

	var credentials []string
	for category, ids := range cfg.credentials {
		for id := range ids {
			credentials = append(credentials, category+"."+id)
		}
	}

	assert.ElementsMatch(t, []string{
		"telemetry.auth_value", "telemetry.loki_auth_value", "telemetry.otlp_logs_auth_value",
	}, credentials)
}
