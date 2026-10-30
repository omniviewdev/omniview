package store_test

import (
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/mcprelay"
	"github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMCPRelayConfig_RoundTrip(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "settings.db")
	first, err := store.Open(path)
	require.NoError(t, err)
	t.Cleanup(func() {
		if first != nil {
			assert.NoError(t, first.Close())
		}
	})

	var loaded mcprelay.Config
	found, err := first.LoadMCPRelayConfig(&loaded)
	require.NoError(t, err)
	require.False(t, found)

	want := mcprelay.DefaultConfig("private-fixture-token")
	want.Enabled = true
	want.Global.ToolOverrides = map[string]mcprelay.ToolOverride{
		"inherit": {},
		"deny":    {Enabled: new(false), Confirm: new(true)},
		"allow":   {Enabled: new(true), Confirm: new(false)},
	}
	want.Connections["plugin/opaque"] = map[string]mcprelay.ConnectionPolicy{
		"connection/%2F": {
			Access: mcprelay.AccessAllowed,
			Policy: mcprelay.Policy{
				ToolOverrides: map[string]mcprelay.ToolOverride{
					"inherit": {},
					"deny":    {Enabled: new(false), Confirm: new(true)},
					"allow":   {Enabled: new(true), Confirm: new(false)},
				},
			},
		},
	}
	require.NoError(t, first.SaveMCPRelayConfig(want))
	require.NoError(t, first.Close())
	first = nil

	second, err := store.Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, second.Close()) })
	found, err = second.LoadMCPRelayConfig(&loaded)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, want, loaded)

	for name, overrides := range map[string]map[string]mcprelay.ToolOverride{
		"global":     loaded.Global.ToolOverrides,
		"connection": loaded.Connections["plugin/opaque"]["connection/%2F"].ToolOverrides,
	} {
		t.Run(name, func(t *testing.T) {
			require.Contains(t, overrides, "inherit")
			assert.Nil(t, overrides["inherit"].Enabled)
			assert.Nil(t, overrides["inherit"].Confirm)
			require.NotNil(t, overrides["deny"].Enabled)
			require.NotNil(t, overrides["deny"].Confirm)
			assert.False(t, *overrides["deny"].Enabled)
			assert.True(t, *overrides["deny"].Confirm)
			require.NotNil(t, overrides["allow"].Enabled)
			require.NotNil(t, overrides["allow"].Confirm)
			assert.True(t, *overrides["allow"].Enabled)
			assert.False(t, *overrides["allow"].Confirm)
		})
	}
}
