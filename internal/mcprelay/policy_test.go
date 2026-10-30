package mcprelay

import (
	"testing"

	"github.com/stretchr/testify/require"
)

var (
	listTool   = ToolInfo{MCPName: "kubernetes_list_namespaces", PluginID: "kubernetes", Scope: ScopeConnection, ReadOnly: true, Status: StatusOK, BuiltIn: true}
	deleteTool = ToolInfo{MCPName: "kubernetes_delete_resource", PluginID: "kubernetes", Scope: ScopeConnection, Destructive: true, Status: StatusOK, BuiltIn: true}
	pingTool   = ToolInfo{MCPName: "alpha_ping", PluginID: "alpha", Scope: ScopePlugin, Status: StatusOK}
)

func TestDefaultConfigIsReadOnlyAndOff(t *testing.T) {
	cfg := DefaultConfig("tok")
	require.NoError(t, cfg.Validate())
	require.False(t, cfg.Enabled)
	require.Equal(t, DefaultPort, cfg.Port)
	require.True(t, cfg.GlobalEnabled(listTool))
	require.False(t, cfg.GlobalEnabled(deleteTool))
	require.False(t, cfg.GlobalEnabled(pingTool))
	require.False(t, cfg.Listed(deleteTool, []string{"prod"}))
	require.False(t, cfg.Listed(listTool, nil), "connection tools need at least one eligible route")
}

func TestValidateRejectsBadValues(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{"low port", func(c *Config) { c.Port = 80 }, "port must be"},
		{"empty token", func(c *Config) { c.Token = "" }, "token is empty"},
		{"unknown global preset", func(c *Config) { c.Global.Preset = "nope" }, "unknown global preset"},
		{"reserved user preset", func(c *Config) { c.UserPresets["all"] = UserPreset{} }, "reserved"},
		{"bad preset name", func(c *Config) { c.UserPresets["a/b"] = UserPreset{} }, "must match"},
		{"bad access", func(c *Config) {
			c.Connections["k"] = map[string]ConnectionPolicy{"c": {Access: "maybe"}}
		}, "access"},
		{"unknown connection preset", func(c *Config) {
			c.Connections["k"] = map[string]ConnectionPolicy{"c": {Policy: Policy{Preset: "ghost"}}}
		}, "unknown preset"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultConfig("tok")
			tc.mutate(&cfg)
			require.ErrorContains(t, cfg.Validate(), tc.want)
		})
	}
}

func TestConnectionPolicyLayering(t *testing.T) {
	cfg := DefaultConfig("tok")
	require.NoError(t, cfg.ApplyPreset(Scope{"kubernetes", "prod"}, PresetReadOnly))
	require.NoError(t, cfg.ApplyPreset(Scope{"kubernetes", "test"}, PresetAll))

	require.False(t, cfg.ConnectionEnabled("kubernetes", "prod", deleteTool))
	require.True(t, cfg.ConnectionEnabled("kubernetes", "test", deleteTool))
	require.True(t, cfg.ConnectionEnabled("kubernetes", "prod", listTool))
	// A connection without its own policy inherits the global effective state.
	require.True(t, cfg.ConnectionEnabled("kubernetes", "staging", listTool))
	require.False(t, cfg.ConnectionEnabled("kubernetes", "staging", deleteTool))
	// Listed when any accessible connection enables it.
	require.True(t, cfg.Listed(deleteTool, []string{"prod", "test"}))
	require.False(t, cfg.Listed(deleteTool, []string{"prod"}))

	// A global override is inherited only by connections without their own preset.
	require.NoError(t, cfg.SetToolOverride(Scope{}, deleteTool.MCPName, ToolOverride{Enabled: new(true)}))
	require.True(t, cfg.GlobalEnabled(deleteTool))
	require.True(t, cfg.ConnectionEnabled("kubernetes", "staging", deleteTool))
	require.False(t, cfg.ConnectionEnabled("kubernetes", "prod", deleteTool), "own preset is a fresh baseline")

	// A connection override wins over its preset.
	require.NoError(t, cfg.SetToolOverride(Scope{"kubernetes", "prod"}, deleteTool.MCPName, ToolOverride{Enabled: new(true)}))
	require.True(t, cfg.ConnectionEnabled("kubernetes", "prod", deleteTool))

	// Applying a preset clears Enabled overrides but keeps Confirm overrides.
	require.NoError(t, cfg.SetToolOverride(Scope{"kubernetes", "prod"}, deleteTool.MCPName, ToolOverride{Enabled: new(true), Confirm: new(false)}))
	require.NoError(t, cfg.ApplyPreset(Scope{"kubernetes", "prod"}, PresetReadOnly))
	require.False(t, cfg.ConnectionEnabled("kubernetes", "prod", deleteTool))
	require.False(t, cfg.Confirm("kubernetes", "prod", deleteTool))
	require.Nil(t, cfg.Connections["kubernetes"]["prod"].ToolOverrides[deleteTool.MCPName].Enabled)

	// Removing the override returns to the preset rule.
	require.NoError(t, cfg.SetToolOverride(Scope{"kubernetes", "prod"}, deleteTool.MCPName, ToolOverride{}))
	require.True(t, cfg.Confirm("kubernetes", "prod", deleteTool))
	_, present := cfg.Connections["kubernetes"]["prod"].ToolOverrides[deleteTool.MCPName]
	require.False(t, present)
}

func TestConnectionAccess(t *testing.T) {
	cfg := DefaultConfig("tok")
	require.True(t, cfg.ConnectionAccess("kubernetes", "prod"))

	cfg.BlockConnectionsByDefault = true
	require.False(t, cfg.ConnectionAccess("kubernetes", "prod"))
	require.False(t, cfg.ConnectionEnabled("kubernetes", "prod", listTool))

	require.NoError(t, cfg.SetConnectionAccess("kubernetes", "prod", AccessAllowed))
	require.True(t, cfg.ConnectionAccess("kubernetes", "prod"))
	require.True(t, cfg.ConnectionEnabled("kubernetes", "prod", listTool))

	require.NoError(t, cfg.SetConnectionAccess("kubernetes", "prod", AccessBlocked))
	cfg.BlockConnectionsByDefault = false
	require.False(t, cfg.ConnectionAccess("kubernetes", "prod"))
	require.ErrorContains(t, cfg.SetConnectionAccess("kubernetes", "prod", "maybe"), "access")
	require.ErrorContains(t, cfg.SetConnectionAccess("", "prod", AccessAllowed), "scope needs")
}

func TestPluginSwitchAndConfirmDefaults(t *testing.T) {
	cfg := DefaultConfig("tok")
	require.True(t, cfg.Confirm("kubernetes", "", deleteTool))
	require.False(t, cfg.Confirm("kubernetes", "", listTool))

	require.NoError(t, cfg.SetToolOverride(Scope{}, deleteTool.MCPName, ToolOverride{Confirm: new(false)}))
	require.False(t, cfg.Confirm("kubernetes", "", deleteTool))
	require.False(t, cfg.Confirm("kubernetes", "prod", deleteTool), "connection inherits the global confirm override")
	require.NoError(t, cfg.SetToolOverride(Scope{"kubernetes", "prod"}, deleteTool.MCPName, ToolOverride{Confirm: new(true)}))
	require.True(t, cfg.Confirm("kubernetes", "prod", deleteTool))

	cfg.PluginEnabled["kubernetes"] = false
	require.False(t, cfg.GlobalEnabled(listTool))
	require.False(t, cfg.ConnectionEnabled("kubernetes", "prod", listTool))
	require.False(t, cfg.Listed(listTool, []string{"prod"}))
}

func TestUserPresets(t *testing.T) {
	cfg := DefaultConfig("tok")
	require.NoError(t, cfg.SetToolOverride(Scope{}, pingTool.MCPName, ToolOverride{Enabled: new(true), Confirm: new(true)}))
	require.NoError(t, cfg.SaveUserPreset("Ops set", []string{pingTool.MCPName, deleteTool.MCPName, pingTool.MCPName}))
	require.NoError(t, cfg.Validate())
	require.Equal(t, "Ops set", cfg.Global.Preset)
	require.Equal(t, []string{pingTool.MCPName, deleteTool.MCPName}, cfg.UserPresets["Ops set"].Tools, "sorted and deduplicated")
	require.True(t, cfg.GlobalEnabled(deleteTool))
	require.True(t, cfg.GlobalEnabled(pingTool))
	require.False(t, cfg.GlobalEnabled(listTool))
	require.Nil(t, cfg.Global.ToolOverrides[pingTool.MCPName].Enabled, "save clears enabled overrides")
	require.NotNil(t, cfg.Global.ToolOverrides[pingTool.MCPName].Confirm, "save keeps confirm overrides")

	require.ErrorContains(t, cfg.DeleteUserPreset("Ops set"), "in use by global")
	require.NoError(t, cfg.ApplyPreset(Scope{"kubernetes", "test"}, "Ops set"))
	require.NoError(t, cfg.ApplyPreset(Scope{}, PresetAll))
	require.ErrorContains(t, cfg.DeleteUserPreset("Ops set"), "in use by kubernetes/test")
	require.NoError(t, cfg.ApplyPreset(Scope{"kubernetes", "test"}, ""))
	require.NoError(t, cfg.DeleteUserPreset("Ops set"))
	require.ErrorContains(t, cfg.DeleteUserPreset("Ops set"), "unknown preset")

	require.ErrorContains(t, cfg.SaveUserPreset("read-only", nil), "reserved")
	require.ErrorContains(t, cfg.SaveUserPreset("bad/name", nil), "must match")
	require.ErrorContains(t, cfg.ApplyPreset(Scope{}, ""), "needs a preset")
	require.ErrorContains(t, cfg.ApplyPreset(Scope{}, "ghost"), "unknown preset")
}

func TestCloneIsIndependent(t *testing.T) {
	cfg := DefaultConfig("tok")
	require.NoError(t, cfg.SetToolOverride(Scope{"kubernetes", "prod"}, deleteTool.MCPName, ToolOverride{Enabled: new(true)}))
	copied := cfg.clone()
	require.NoError(t, copied.SetToolOverride(Scope{"kubernetes", "prod"}, deleteTool.MCPName, ToolOverride{}))
	copied.PluginEnabled["alpha"] = false
	require.True(t, cfg.ConnectionEnabled("kubernetes", "prod", deleteTool))
	require.True(t, cfg.PluginOn("alpha"))
}

func TestCustomHintsNeverGrantReadOnlyAccessOrWaiveConsent(t *testing.T) {
	cfg := DefaultConfig("tok")
	custom := ToolInfo{MCPName: "plugin_safe_hint", PluginID: "plugin", Scope: ScopePlugin, ReadOnly: true}
	require.False(t, cfg.GlobalEnabled(custom))
	require.True(t, cfg.Confirm(custom.PluginID, "", custom))
	require.NoError(t, cfg.SetToolOverride(Scope{}, custom.MCPName, ToolOverride{Enabled: new(true), Confirm: new(false)}))
	require.True(t, cfg.GlobalEnabled(custom), "explicit policy grants custom tool access")
	require.True(t, cfg.Confirm(custom.PluginID, "", custom), "custom code always needs conservative consent")
}

func TestCloneOwnsOverrideValues(t *testing.T) {
	cfg := DefaultConfig("tok")
	cfg.Global.ToolOverrides["custom"] = ToolOverride{Enabled: new(true), Confirm: new(true)}
	cfg.Connections["plugin"] = map[string]ConnectionPolicy{
		"route": {Policy: Policy{ToolOverrides: map[string]ToolOverride{"custom": {Enabled: new(true), Confirm: new(true)}}}},
	}
	copied := cfg.clone()
	*cfg.Global.ToolOverrides["custom"].Enabled = false
	*cfg.Global.ToolOverrides["custom"].Confirm = false
	*cfg.Connections["plugin"]["route"].ToolOverrides["custom"].Enabled = false
	*cfg.Connections["plugin"]["route"].ToolOverrides["custom"].Confirm = false
	require.True(t, *copied.Global.ToolOverrides["custom"].Enabled)
	require.True(t, *copied.Global.ToolOverrides["custom"].Confirm)
	require.True(t, *copied.Connections["plugin"]["route"].ToolOverrides["custom"].Enabled)
	require.True(t, *copied.Connections["plugin"]["route"].ToolOverrides["custom"].Confirm)
}
