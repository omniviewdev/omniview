package mcprelay

import (
	"errors"
	"fmt"
	"maps"
	"regexp"
	"slices"
)

const (
	PresetAll      = "all"
	PresetReadOnly = "read-only"
	PresetNone     = "none"

	AccessInherit = ""
	AccessAllowed = "allowed"
	AccessBlocked = "blocked"

	DefaultPort = 9590
	minPort     = 1024
	maxPort     = 65535
)

var userPresetNamePattern = regexp.MustCompile(`^[A-Za-z0-9 _-]{1,64}$`)

// ToolOverride pins the enabled and/or confirm state of one tool in a scope.
// A nil field means "no override".
type ToolOverride struct {
	Enabled *bool `json:"enabled,omitempty"`
	Confirm *bool `json:"confirm,omitempty"`
}

func (o ToolOverride) empty() bool { return o.Enabled == nil && o.Confirm == nil }

// Policy is the preset plus per-tool overrides for one scope.
type Policy struct {
	Preset        string                  `json:"preset"`
	ToolOverrides map[string]ToolOverride `json:"toolOverrides"` // keyed by MCP tool name
}

// ConnectionPolicy is the policy of one plugin connection. Access "" inherits
// BlockConnectionsByDefault; Preset "" inherits the global effective state.
type ConnectionPolicy struct {
	Access string `json:"access"`
	Policy
}

// UserPreset is a user-saved set of enabled MCP tool names.
type UserPreset struct {
	Tools []string `json:"tools"`
}

// Config is the persisted relay document.
type Config struct {
	Enabled                   bool                                   `json:"enabled"`
	Port                      int                                    `json:"port"`
	Token                     string                                 `json:"token"`
	BlockConnectionsByDefault bool                                   `json:"blockConnectionsByDefault"`
	Global                    Policy                                 `json:"global"`
	PluginEnabled             map[string]bool                        `json:"pluginEnabled"` // absent = true
	UserPresets               map[string]UserPreset                  `json:"userPresets"`
	Connections               map[string]map[string]ConnectionPolicy `json:"connections"` // pluginID -> connectionID
}

// DefaultConfig returns the initial document: server off, read-only preset.
func DefaultConfig(token string) Config {
	return Config{
		Enabled:       false,
		Port:          DefaultPort,
		Token:         token,
		Global:        Policy{Preset: PresetReadOnly, ToolOverrides: map[string]ToolOverride{}},
		PluginEnabled: map[string]bool{},
		UserPresets:   map[string]UserPreset{},
		Connections:   map[string]map[string]ConnectionPolicy{},
	}
}

// normalize replaces nil maps so that mutators never touch a nil map.
func (c *Config) normalize() {
	if c.Global.ToolOverrides == nil {
		c.Global.ToolOverrides = map[string]ToolOverride{}
	}
	if c.PluginEnabled == nil {
		c.PluginEnabled = map[string]bool{}
	}
	if c.UserPresets == nil {
		c.UserPresets = map[string]UserPreset{}
	}
	if c.Connections == nil {
		c.Connections = map[string]map[string]ConnectionPolicy{}
	}
	for pluginID, policies := range c.Connections {
		for connectionID, policy := range policies {
			if policy.ToolOverrides == nil {
				policy.ToolOverrides = map[string]ToolOverride{}
				policies[connectionID] = policy
			}
		}
		c.Connections[pluginID] = policies
	}
}

// clone deep-copies the document so that a failed mutation leaves the
// current config untouched.
func (c Config) clone() Config {
	out := c
	out.Global.ToolOverrides = cloneOverrides(c.Global.ToolOverrides)
	out.PluginEnabled = maps.Clone(c.PluginEnabled)
	out.UserPresets = make(map[string]UserPreset, len(c.UserPresets))
	for name, preset := range c.UserPresets {
		out.UserPresets[name] = UserPreset{Tools: slices.Clone(preset.Tools)}
	}
	out.Connections = make(map[string]map[string]ConnectionPolicy, len(c.Connections))
	for pluginID, policies := range c.Connections {
		copied := make(map[string]ConnectionPolicy, len(policies))
		for connectionID, policy := range policies {
			policy.ToolOverrides = cloneOverrides(policy.ToolOverrides)
			copied[connectionID] = policy
		}
		out.Connections[pluginID] = copied
	}
	out.normalize()
	return out
}

func cloneOverrides(source map[string]ToolOverride) map[string]ToolOverride {
	result := make(map[string]ToolOverride, len(source))
	for name, override := range source {
		if override.Enabled != nil {
			override.Enabled = new(*override.Enabled)
		}
		if override.Confirm != nil {
			override.Confirm = new(*override.Confirm)
		}
		result[name] = override
	}
	return result
}

func isBuiltInPreset(name string) bool {
	return name == PresetAll || name == PresetReadOnly || name == PresetNone
}

func (c *Config) presetExists(name string) bool {
	if isBuiltInPreset(name) {
		return true
	}
	_, ok := c.UserPresets[name]
	return ok
}

// Validate checks every field that a mutation can set.
func (c *Config) Validate() error {
	if c.Port < minPort || c.Port > maxPort {
		return fmt.Errorf("port must be between %d and %d", minPort, maxPort)
	}
	if c.Token == "" {
		return errors.New("token is empty")
	}
	for name := range c.UserPresets {
		if !userPresetNamePattern.MatchString(name) {
			return fmt.Errorf("preset name %q must match %s", name, userPresetNamePattern)
		}
		if isBuiltInPreset(name) {
			return fmt.Errorf("preset name %q is reserved", name)
		}
	}
	if !c.presetExists(c.Global.Preset) {
		return fmt.Errorf("unknown global preset %q", c.Global.Preset)
	}
	for pluginID, policies := range c.Connections {
		for connectionID, policy := range policies {
			switch policy.Access {
			case AccessInherit, AccessAllowed, AccessBlocked:
			default:
				return fmt.Errorf("connection %s/%s: access %q is not one of allowed, blocked", pluginID, connectionID, policy.Access)
			}
			if policy.Preset != "" && !c.presetExists(policy.Preset) {
				return fmt.Errorf("connection %s/%s: unknown preset %q", pluginID, connectionID, policy.Preset)
			}
		}
	}
	return nil
}

// ---- evaluation ----

func (c *Config) presetRule(name string, t ToolInfo) (bool, error) {
	switch name {
	case PresetAll:
		return true, nil
	case PresetNone:
		return false, nil
	case PresetReadOnly:
		// Custom tool annotations are provider hints, not host authority.
		return (t.BuiltIn || t.Resource != nil) && t.ReadOnly, nil
	}
	preset, ok := c.UserPresets[name]
	if !ok {
		return false, fmt.Errorf("unknown preset %q", name)
	}
	return slices.Contains(preset.Tools, t.MCPName), nil
}

// PluginOn reports whether the plugin switch is on (absent = on).
func (c *Config) PluginOn(pluginID string) bool {
	on, ok := c.PluginEnabled[pluginID]
	return !ok || on
}

// GlobalEnabled is the effective global state of a tool.
func (c *Config) GlobalEnabled(t ToolInfo) bool {
	if !c.PluginOn(t.PluginID) {
		return false
	}
	if o, ok := c.Global.ToolOverrides[t.MCPName]; ok && o.Enabled != nil {
		return *o.Enabled
	}
	enabled, err := c.presetRule(c.Global.Preset, t)
	if err != nil {
		return false
	}
	return enabled
}

func (c *Config) connectionPolicy(pluginID, connectionID string) ConnectionPolicy {
	return c.Connections[pluginID][connectionID]
}

// ConnectionAccess reports whether the relay may target the connection at all.
func (c *Config) ConnectionAccess(pluginID, connectionID string) bool {
	policy := c.connectionPolicy(pluginID, connectionID)
	switch policy.Access {
	case AccessAllowed:
		return true
	case AccessBlocked:
		return false
	default:
		return !c.BlockConnectionsByDefault
	}
}

// ConnectionEnabled is the effective state of a tool on one connection.
func (c *Config) ConnectionEnabled(pluginID, connectionID string, t ToolInfo) bool {
	if !c.PluginOn(t.PluginID) || !c.ConnectionAccess(pluginID, connectionID) {
		return false
	}
	policy := c.connectionPolicy(pluginID, connectionID)
	if o, ok := policy.ToolOverrides[t.MCPName]; ok && o.Enabled != nil {
		return *o.Enabled
	}
	if policy.Preset != "" {
		enabled, err := c.presetRule(policy.Preset, t)
		if err != nil {
			return false
		}
		return enabled
	}
	return c.GlobalEnabled(t)
}

// Confirm reports whether a call must be confirmed by the user. connectionID
// is empty for plugin-scoped tools.
func (c *Config) Confirm(pluginID, connectionID string, t ToolInfo) bool {
	// A custom handler may do arbitrary native work despite its hints. Always
	// ask for consent, even when a preset or override explicitly enables it.
	if !t.BuiltIn && t.Resource == nil {
		return true
	}
	if connectionID != "" {
		policy := c.connectionPolicy(pluginID, connectionID)
		if o, ok := policy.ToolOverrides[t.MCPName]; ok && o.Confirm != nil {
			return *o.Confirm
		}
	}
	if o, ok := c.Global.ToolOverrides[t.MCPName]; ok && o.Confirm != nil {
		return *o.Confirm
	}
	return t.Destructive
}

// Listed reports whether the tool is offered to MCP clients at all:
// plugin-scoped tools follow the global state; connection-scoped tools are
// listed when any accessible connection enables them.
func (c *Config) Listed(t ToolInfo, allowedConnections []string) bool {
	if t.Scope != ScopeConnection {
		return c.GlobalEnabled(t)
	}
	for _, connectionID := range allowedConnections {
		if t.Resource != nil && t.Resource.Route.Connection != connectionID {
			continue
		}
		if c.ConnectionEnabled(t.PluginID, connectionID, t) {
			return true
		}
	}
	return false
}

// ---- mutators ----

// Scope selects the global policy (zero value) or one connection policy.
type Scope struct {
	PluginID     string `json:"pluginID"`
	ConnectionID string `json:"connectionID"`
}

func (s Scope) global() bool { return s.PluginID == "" && s.ConnectionID == "" }

func (s Scope) String() string {
	if s.global() {
		return "global"
	}
	return s.PluginID + "/" + s.ConnectionID
}

func (s Scope) validate() error {
	if s.global() {
		return nil
	}
	if s.PluginID == "" || s.ConnectionID == "" {
		return errors.New("scope needs both pluginID and connectionID")
	}
	return nil
}

func (c *Config) withPolicy(scope Scope, mutate func(*Policy)) error {
	if err := scope.validate(); err != nil {
		return err
	}
	if scope.global() {
		mutate(&c.Global)
		return nil
	}
	policies, ok := c.Connections[scope.PluginID]
	if !ok {
		policies = map[string]ConnectionPolicy{}
		c.Connections[scope.PluginID] = policies
	}
	policy, ok := policies[scope.ConnectionID]
	if !ok {
		policy = ConnectionPolicy{Policy: Policy{ToolOverrides: map[string]ToolOverride{}}}
	}
	mutate(&policy.Policy)
	policies[scope.ConnectionID] = policy
	return nil
}

// ApplyPreset sets the scope's preset and clears its Enabled overrides;
// Confirm overrides stay. Name "" on a connection scope means "inherit".
func (c *Config) ApplyPreset(scope Scope, name string) error {
	if scope.global() && name == "" {
		return errors.New("the global scope needs a preset")
	}
	if name != "" && !c.presetExists(name) {
		return fmt.Errorf("unknown preset %q", name)
	}
	return c.withPolicy(scope, func(p *Policy) {
		p.Preset = name
		for mcpName, override := range p.ToolOverrides {
			override.Enabled = nil
			if override.empty() {
				delete(p.ToolOverrides, mcpName)
			} else {
				p.ToolOverrides[mcpName] = override
			}
		}
	})
}

// SetToolOverride replaces the override of one tool in the scope; an empty
// override removes it.
func (c *Config) SetToolOverride(scope Scope, mcpName string, override ToolOverride) error {
	return c.withPolicy(scope, func(p *Policy) {
		if override.empty() {
			delete(p.ToolOverrides, mcpName)
			return
		}
		p.ToolOverrides[mcpName] = override
	})
}

// SaveUserPreset stores the tool set, applies it globally and clears global
// Enabled overrides.
func (c *Config) SaveUserPreset(name string, enabledTools []string) error {
	if !userPresetNamePattern.MatchString(name) {
		return fmt.Errorf("preset name must match %s", userPresetNamePattern)
	}
	if isBuiltInPreset(name) {
		return fmt.Errorf("preset name %q is reserved", name)
	}
	tools := slices.Clone(enabledTools)
	slices.Sort(tools)
	c.UserPresets[name] = UserPreset{Tools: slices.Compact(tools)}
	return c.ApplyPreset(Scope{}, name)
}

// DeleteUserPreset removes a user preset that no scope references.
func (c *Config) DeleteUserPreset(name string) error {
	if _, ok := c.UserPresets[name]; !ok {
		return fmt.Errorf("unknown preset %q", name)
	}
	if c.Global.Preset == name {
		return fmt.Errorf("preset %q is in use by global", name)
	}
	for pluginID, policies := range c.Connections {
		for connectionID, policy := range policies {
			if policy.Preset == name {
				return fmt.Errorf("preset %q is in use by %s/%s", name, pluginID, connectionID)
			}
		}
	}
	delete(c.UserPresets, name)
	return nil
}

// SetConnectionAccess sets the access of one connection.
func (c *Config) SetConnectionAccess(pluginID, connectionID, access string) error {
	switch access {
	case AccessInherit, AccessAllowed, AccessBlocked:
	default:
		return fmt.Errorf("access %q is not one of allowed, blocked", access)
	}
	scope := Scope{PluginID: pluginID, ConnectionID: connectionID}
	if err := scope.validate(); err != nil {
		return err
	}
	policies, ok := c.Connections[pluginID]
	if !ok {
		policies = map[string]ConnectionPolicy{}
		c.Connections[pluginID] = policies
	}
	policy, ok := policies[connectionID]
	if !ok {
		policy = ConnectionPolicy{Policy: Policy{ToolOverrides: map[string]ToolOverride{}}}
	}
	policy.Access = access
	policies[connectionID] = policy
	return nil
}
