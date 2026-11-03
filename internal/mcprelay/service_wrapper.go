package mcprelay

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// ServiceWrapper exposes the relay to the frontend through Wails bindings.
type ServiceWrapper struct {
	Relay *Relay
}

func (s *ServiceWrapper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return s.Relay.ServiceStartup(ctx, options)
}

func (s *ServiceWrapper) ServiceShutdown() error {
	return s.Relay.ServiceShutdown()
}

// ConfigView is the server part of the settings page.
type ConfigView struct {
	Enabled                   bool     `json:"enabled"`
	Port                      int      `json:"port"`
	Endpoint                  string   `json:"endpoint"`
	Token                     string   `json:"token"`
	BlockConnectionsByDefault bool     `json:"blockConnectionsByDefault"`
	GlobalPreset              string   `json:"globalPreset"`
	UserPresets               []string `json:"userPresets"`
}

// ToolView is one catalog row with its effective state in a scope.
type ToolView struct {
	MCPName         string `json:"mcpName"`
	PluginID        string `json:"pluginID"`
	ConnectionID    string `json:"connectionID"`
	PluginName      string `json:"pluginName"`
	Name            string `json:"name"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	Scope           string `json:"scope"`
	Status          string `json:"status"`
	BuiltIn         bool   `json:"builtIn"`
	ReadOnly        bool   `json:"readOnly"`
	Listed          bool   `json:"listed"`
	Ready           bool   `json:"ready"`
	Destructive     bool   `json:"destructive"`
	Enabled         bool   `json:"enabled"`
	EnabledSource   string `json:"enabledSource"` // override | preset | inherited | plugin-disabled | connection-blocked
	Confirm         bool   `json:"confirm"`
	ConfirmSource   string `json:"confirmSource"` // override | global-override | default
	OverrideEnabled *bool  `json:"overrideEnabled"`
	OverrideConfirm *bool  `json:"overrideConfirm"`
}

// PresetView is one selectable preset.
type PresetView struct {
	Name      string `json:"name"`
	BuiltIn   bool   `json:"builtIn"`
	ToolCount int    `json:"toolCount"`
}

// ConnectionPolicyView is one connection row with its policy.
type ConnectionPolicyView struct {
	PluginID        string `json:"pluginID"`
	PluginName      string `json:"pluginName"`
	ConnectionID    string `json:"connectionID"`
	ConnectionName  string `json:"connectionName"`
	Access          string `json:"access"`
	EffectiveAccess bool   `json:"effectiveAccess"`
	Preset          string `json:"preset"`
	EffectivePreset string `json:"effectivePreset"`
}

func (s *ServiceWrapper) GetStatus() Status {
	r := s.Relay
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.statusLocked()
}

func (s *ServiceWrapper) GetConfig() ConfigView {
	r := s.Relay
	r.mu.Lock()
	defer r.mu.Unlock()
	presets := make([]string, 0, len(r.cfg.UserPresets))
	for name := range r.cfg.UserPresets {
		presets = append(presets, name)
	}
	sort.Strings(presets)
	return ConfigView{
		Enabled:                   r.cfg.Enabled,
		Port:                      r.cfg.Port,
		Endpoint:                  r.endpointLocked(),
		Token:                     r.cfg.Token,
		BlockConnectionsByDefault: r.cfg.BlockConnectionsByDefault,
		GlobalPreset:              r.cfg.Global.Preset,
		UserPresets:               presets,
	}
}

// update saves policy and immediately projects it over the discovered inventory.
func (r *Relay) update(mutate func(*Config) error) error {
	r.mu.Lock()
	if !r.loaded {
		r.mu.Unlock()
		return errors.New("mcp relay is not initialised")
	}
	next := r.cfg.clone()
	if err := mutate(&next); err != nil {
		r.mu.Unlock()
		return err
	}
	if err := next.Validate(); err != nil {
		r.mu.Unlock()
		return err
	}
	if err := r.save(next); err != nil {
		r.mu.Unlock()
		return err
	}
	r.cfg = next
	r.configRevision++
	r.authority.UpdatePolicy(next)
	ready := r.inventoryReady
	r.projectPolicyLocked(r.configRevision, false)
	r.mu.Unlock()

	if !ready {
		r.resync()
	}
	r.emit(EventConfigChanged, "")
	return nil
}

func (s *ServiceWrapper) SetEnabled(enabled bool) error {
	if err := s.Relay.update(func(c *Config) error { c.Enabled = enabled; return nil }); err != nil {
		return err
	}
	s.Relay.restartListener()
	return nil
}

func (s *ServiceWrapper) SetPort(port int) error {
	if err := s.Relay.update(func(c *Config) error { c.Port = port; return nil }); err != nil {
		return err
	}
	s.Relay.restartListener()
	return nil
}

func (s *ServiceWrapper) RotateToken() error {
	token, err := devsession.GenerateToken()
	if err != nil {
		return fmt.Errorf("generate token: %w", err)
	}
	if err = s.Relay.update(func(c *Config) error { c.Token = string(token); return nil }); err != nil {
		return err
	}
	s.Relay.restartListener()
	return nil
}

func (s *ServiceWrapper) SetBlockConnectionsByDefault(block bool) error {
	return s.Relay.update(func(c *Config) error { c.BlockConnectionsByDefault = block; return nil })
}

func (s *ServiceWrapper) SetPluginEnabled(pluginID string, enabled bool) error {
	if pluginID == "" {
		return errors.New("pluginID is required")
	}
	return s.Relay.update(func(c *Config) error {
		if enabled {
			delete(c.PluginEnabled, pluginID)
		} else {
			c.PluginEnabled[pluginID] = false
		}
		return nil
	})
}

func (s *ServiceWrapper) SetToolOverride(scope Scope, mcpName string, override ToolOverride) error {
	if mcpName == "" {
		return errors.New("mcpName is required")
	}
	return s.Relay.update(func(c *Config) error { return c.SetToolOverride(scope, mcpName, override) })
}

func (s *ServiceWrapper) ApplyPreset(scope Scope, name string) error {
	return s.Relay.update(func(c *Config) error { return c.ApplyPreset(scope, name) })
}

// SaveUserPreset stores the tools that are enabled in the global scope right
// now under name and applies it.
func (s *ServiceWrapper) SaveUserPreset(name string) error {
	return s.Relay.update(func(c *Config) error {
		enabled := make([]string, 0, len(s.Relay.catalog))
		seen := map[string]bool{}
		for _, tool := range s.Relay.catalog {
			if tool.Status == StatusOK && c.GlobalEnabled(tool) && !seen[tool.MCPName] {
				seen[tool.MCPName] = true
				enabled = append(enabled, tool.MCPName)
			}
		}
		return c.SaveUserPreset(name, enabled)
	})
}

func (s *ServiceWrapper) DeleteUserPreset(name string) error {
	return s.Relay.update(func(c *Config) error { return c.DeleteUserPreset(name) })
}

func (s *ServiceWrapper) SetConnectionAccess(pluginID, connectionID, access string) error {
	return s.Relay.update(func(c *Config) error { return c.SetConnectionAccess(pluginID, connectionID, access) })
}

func (s *ServiceWrapper) ListPresets() []PresetView {
	r := s.Relay
	r.mu.Lock()
	defer r.mu.Unlock()
	okTools := 0
	readOnly := 0
	for _, t := range r.catalog {
		if t.Status != StatusOK {
			continue
		}
		okTools++
		if t.ReadOnly {
			readOnly++
		}
	}
	out := []PresetView{
		{Name: PresetAll, BuiltIn: true, ToolCount: okTools},
		{Name: PresetReadOnly, BuiltIn: true, ToolCount: readOnly},
		{Name: PresetNone, BuiltIn: true, ToolCount: 0},
	}
	names := make([]string, 0, len(r.cfg.UserPresets))
	for name := range r.cfg.UserPresets {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		out = append(out, PresetView{Name: name, ToolCount: len(r.cfg.UserPresets[name].Tools)})
	}
	return out
}

// ListTools returns the catalog with the effective state in scope. A
// connection scope lists only that plugin's connection-scoped tools.
func (s *ServiceWrapper) ListTools(scope Scope) ([]ToolView, error) {
	if err := scope.validate(); err != nil {
		return nil, err
	}
	r := s.Relay
	r.mu.Lock()
	cfg := r.cfg.clone()
	catalog := append([]ToolInfo(nil), r.catalog...)
	listed := make(map[string]bool, len(r.registered))
	for name, registered := range r.registered {
		listed[name] = registered && !r.stopped && r.cfg.Enabled && r.listener != nil
	}
	r.mu.Unlock()
	unavailableOwners := map[string]bool{}
	configuredBorrowed := map[string][]sdktypes.Connection{}
	if r.borrowedConnections != nil {
		for _, tool := range catalog {
			if tool.ConnectionOwner == "" {
				continue
			}
			key := tool.PluginID + "\x00" + tool.ConnectionOwner
			if _, seen := configuredBorrowed[key]; seen {
				continue
			}
			connections, err := r.borrowedConnections(context.Background(), tool.PluginID, tool.ConnectionOwner, false)
			configuredBorrowed[key] = connections
			if err != nil {
				unavailableOwners[tool.ConnectionOwner] = true
			}
		}
	}
	needsLocalInventory := scope.global()
	if !needsLocalInventory {
		for _, tool := range catalog {
			if tool.PluginID == scope.PluginID && tool.Scope == ScopeConnection && tool.ConnectionOwner == "" {
				needsLocalInventory = true
				break
			}
		}
	}
	ready := map[string]map[string]bool{}
	if needsLocalInventory && r.connections != nil {
		ctx, cancel := context.WithTimeout(invocation.HostContext(context.Background()), 10*time.Second)
		defer cancel()
		states, err := r.connections.GetAllConnectionStates(ctx)
		if err != nil && len(unavailableOwners) == 0 {
			return nil, err
		}
		for pluginID, connections := range states {
			ready[pluginID] = map[string]bool{}
			for _, state := range connections {
				if unavailableOwners[pluginID] {
					continue
				}
				if state.ReadinessError != nil {
					return nil, fmt.Errorf("connection readiness unavailable for plugin %s connection %s", pluginID, state.Connection.ID)
				}
				ready[pluginID][state.Connection.ID] = state.Readiness == sdktypes.ConnectionStatusConnected
			}
		}
	}
	borrowedReady := map[string]map[string]bool{}
	if r.borrowedConnections != nil {
		for _, tool := range catalog {
			if tool.ConnectionOwner == "" {
				continue
			}
			key := tool.PluginID + "\x00" + tool.ConnectionOwner
			if _, seen := borrowedReady[key]; seen {
				continue
			}
			configured := configuredBorrowed[key]
			if unavailableOwners[tool.ConnectionOwner] {
				borrowedReady[key] = map[string]bool{}
				continue
			}
			started, err := r.borrowedConnections(context.Background(), tool.PluginID, tool.ConnectionOwner, true)
			if err != nil {
				borrowedReady[key] = map[string]bool{}
				continue
			}
			borrowedReady[key] = map[string]bool{}
			for _, connection := range configured {
				borrowedReady[key][connection.ID] = false
			}
			for _, connection := range started {
				borrowedReady[key][connection.ID] = true
			}
		}
	}
	out := make([]ToolView, 0, len(catalog))
	for _, t := range catalog {
		toolReady := ready[t.PluginID]
		if t.ConnectionOwner != "" {
			toolReady = borrowedReady[t.PluginID+"\x00"+t.ConnectionOwner]
		}
		if !scope.global() && (t.PluginID != scope.PluginID || t.Scope != ScopeConnection) {
			continue
		}
		if !scope.global() && t.Resource != nil && t.Resource.Route.Connection != scope.ConnectionID {
			continue
		}
		if scope.global() && t.Scope == ScopeConnection && t.Resource == nil && len(toolReady) > 0 {
			ids := make([]string, 0, len(toolReady))
			for id := range toolReady {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			for _, id := range ids {
				view := toolView(&cfg, Scope{PluginID: t.PluginID, ConnectionID: id}, t)
				view.ConnectionID = id
				view.Ready = toolReady[id] && t.Status == StatusOK
				view.Listed = listed[t.MCPName] && (view.Ready || t.ConnectionOwner != "") && cfg.ConnectionEnabled(t.PluginID, id, t)
				out = append(out, view)
			}
			continue
		}
		effectiveScope := scope
		if t.Resource != nil {
			effectiveScope = Scope{PluginID: t.PluginID, ConnectionID: t.Resource.Route.Connection}
		}
		view := toolView(&cfg, effectiveScope, t)
		view.Listed = listed[t.MCPName]
		view.Ready = t.Status == StatusOK
		if t.Scope == ScopeConnection {
			view.ConnectionID = scope.ConnectionID
			if t.Resource != nil {
				view.ConnectionID = t.Resource.Route.Connection
			}
			view.Ready = false
			if view.ConnectionID != "" {
				view.Ready = toolReady[view.ConnectionID]
			} else {
				for _, connected := range toolReady {
					view.Ready = view.Ready || connected
				}
			}
			view.Ready = view.Ready && t.Status == StatusOK
			if !view.Ready && t.ConnectionOwner == "" {
				view.Listed = false
			}
			if view.ConnectionID != "" {
				if t.ConnectionOwner != "" {
					_, configured := toolReady[view.ConnectionID]
					view.Listed = view.Listed && configured
				}
				view.Listed = view.Listed && cfg.ConnectionEnabled(t.PluginID, view.ConnectionID, t)
			}
		}
		out = append(out, view)
	}
	return out, nil
}

func toolView(cfg *Config, scope Scope, t ToolInfo) ToolView {
	view := ToolView{
		MCPName:     t.MCPName,
		PluginID:    t.PluginID,
		PluginName:  t.PluginName,
		Name:        t.Name,
		Title:       t.Title,
		Description: t.Description,
		Scope:       t.Scope,
		Status:      t.Status,
		BuiltIn:     t.BuiltIn,
		ReadOnly:    t.ReadOnly,
		Destructive: t.Destructive,
	}

	var policy Policy
	if scope.global() {
		policy = cfg.Global
	} else {
		connectionPolicy := cfg.connectionPolicy(scope.PluginID, scope.ConnectionID)
		policy = connectionPolicy.Policy
	}
	if override, ok := policy.ToolOverrides[t.MCPName]; ok {
		view.OverrideEnabled = override.Enabled
		view.OverrideConfirm = override.Confirm
	}

	switch {
	case !cfg.PluginOn(t.PluginID):
		view.EnabledSource = "plugin-disabled"
	case !scope.global() && !cfg.ConnectionAccess(scope.PluginID, scope.ConnectionID):
		view.EnabledSource = "connection-blocked"
	case view.OverrideEnabled != nil:
		view.EnabledSource = "override"
	case scope.global() || policy.Preset != "":
		view.EnabledSource = "preset"
	default:
		view.EnabledSource = "inherited"
	}
	if scope.global() {
		view.Enabled = cfg.GlobalEnabled(t)
		view.Confirm = cfg.Confirm(t.PluginID, "", t)
	} else {
		view.Enabled = cfg.ConnectionEnabled(scope.PluginID, scope.ConnectionID, t)
		view.Confirm = cfg.Confirm(t.PluginID, scope.ConnectionID, t)
	}

	switch {
	case view.OverrideConfirm != nil:
		view.ConfirmSource = "override"
	case !scope.global() && cfg.Global.ToolOverrides[t.MCPName].Confirm != nil:
		view.ConfirmSource = "global-override"
	default:
		view.ConfirmSource = "default"
	}
	return view
}

// ListConnectionPolicies joins every known connection with its policy.
func (s *ServiceWrapper) ListConnectionPolicies() ([]ConnectionPolicyView, error) {
	r := s.Relay
	all, err := r.connections.ListAllConnections(invocation.HostContext(context.Background()))
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	cfg := r.cfg.clone()
	catalog := append([]ToolInfo(nil), r.catalog...)
	r.mu.Unlock()
	if r.borrowedConnections != nil {
		seen := map[string]bool{}
		for _, tool := range catalog {
			if tool.ConnectionOwner == "" {
				continue
			}
			key := tool.PluginID + "\x00" + tool.ConnectionOwner
			if seen[key] {
				continue
			}
			seen[key] = true
			connections, err := r.borrowedConnections(context.Background(), tool.PluginID, tool.ConnectionOwner, false)
			if err != nil {
				continue
			}
			all[tool.PluginID] = append(all[tool.PluginID], connections...)
		}
	}
	pluginNames := map[string]string{}
	for _, t := range catalog {
		pluginNames[t.PluginID] = t.PluginName
	}
	out := []ConnectionPolicyView{}
	seenConnections := map[string]bool{}
	for pluginID, connections := range all {
		name := pluginNames[pluginID]
		if name == "" {
			name = pluginID
		}
		for _, connection := range connections {
			key := pluginID + "\x00" + connection.ID
			if seenConnections[key] {
				continue
			}
			seenConnections[key] = true
			policy := cfg.connectionPolicy(pluginID, connection.ID)
			effectivePreset := policy.Preset
			if effectivePreset == "" {
				effectivePreset = cfg.Global.Preset
			}
			out = append(out, ConnectionPolicyView{
				PluginID:        pluginID,
				PluginName:      name,
				ConnectionID:    connection.ID,
				ConnectionName:  connection.Name,
				Access:          policy.Access,
				EffectiveAccess: cfg.ConnectionAccess(pluginID, connection.ID),
				Preset:          policy.Preset,
				EffectivePreset: effectivePreset,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].PluginID != out[j].PluginID {
			return out[i].PluginID < out[j].PluginID
		}
		return out[i].ConnectionName < out[j].ConnectionName
	})
	return out, nil
}

func (s *ServiceWrapper) ListPendingConfirmations() []PendingConfirmation {
	return s.Relay.ListPendingConfirmations()
}

func (s *ServiceWrapper) ResolveConfirmation(id string, approved bool) error {
	return s.Relay.ResolveConfirmation(id, approved)
}
