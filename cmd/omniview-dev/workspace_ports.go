package main

import (
	"strconv"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func workspacePortPolicy(c workspaceCommand, current devcontract.PortPolicy, plugins []string) (*devcontract.PortPolicy, error) {
	changed := c.supplied["port-policy"] || len(c.ports) > 0
	for _, id := range c.removePlugins {
		if _, exists := current.Overrides["plugin-vite:"+id]; exists {
			changed = true
		}
	}
	if !changed {
		return nil, nil
	}
	policy := devcontract.PortPolicy{Policy: current.Policy, Overrides: make(map[string]int, len(current.Overrides)+len(c.ports))}
	if policy.Policy == "" {
		policy.Policy = "sticky"
	}
	for role, port := range current.Overrides {
		policy.Overrides[role] = port
	}
	for _, id := range c.removePlugins {
		delete(policy.Overrides, "plugin-vite:"+id)
	}
	if c.supplied["port-policy"] {
		policy.Policy = c.portPolicy
	}
	if policy.Policy != "sticky" && policy.Policy != "strict" {
		return nil, devcontract.Fail(2, "invalid_port_policy", "port policy must be sticky or strict")
	}
	selected := make(map[string]bool, len(plugins))
	for _, id := range plugins {
		selected[id] = true
	}
	for _, id := range c.removePlugins {
		delete(selected, id)
	}
	for _, id := range c.addPlugins {
		selected[id] = true
	}
	assignments, err := workspaceAssignments(c.ports)
	if err != nil {
		return nil, err
	}
	for role, value := range assignments {
		switch role {
		case "browser", "vite", "mcp":
		default:
			if !strings.HasPrefix(role, "plugin-vite:") || !selected[strings.TrimPrefix(role, "plugin-vite:")] {
				return nil, devcontract.Fail(2, "invalid_port_role", "port roles are browser, vite, mcp or plugin-vite:<selected-plugin-id>")
			}
		}
		port, err := strconv.Atoi(value)
		if err != nil || port < 0 || port > 65535 {
			return nil, devcontract.Fail(2, "invalid_port", "port must be 1-65535, or 0 to clear an override")
		}
		if port == 0 {
			delete(policy.Overrides, role)
		} else {
			policy.Overrides[role] = port
		}
	}
	used := map[int]bool{}
	for _, port := range policy.Overrides {
		if used[port] {
			return nil, devcontract.Fail(2, "invalid_port", "distinct service roles require distinct override ports")
		}
		used[port] = true
	}
	return &policy, nil
}
func manifestPluginIDs(manifest devcontract.WorkspaceManifest) []string {
	ids := make([]string, 0, len(manifest.Plugins))
	for _, plugin := range manifest.Plugins {
		ids = append(ids, plugin.ID)
	}
	return ids
}
