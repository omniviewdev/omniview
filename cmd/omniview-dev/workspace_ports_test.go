package main

import (
	"bytes"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestPortReconfigurationPreservesUnchangedAssignmentsAndInput(t *testing.T) {
	current := devcontract.PortPolicy{Policy: "sticky", Overrides: map[string]int{"browser": 20123, "plugin-vite:old": 20124, "plugin-vite:keep": 20125}}
	command, err := parseWorkspaceCommand([]string{"workspace", "edit", "feature", "--remove-plugin", "old", "--add-plugin", "new", "--port-policy", "strict", "--port", "plugin-vite:new=20126", "--port", "browser=0"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	policy, err := workspacePortPolicy(command, current, []string{"old", "keep"})
	if err != nil {
		t.Fatal(err)
	}
	if policy.Policy != "strict" || policy.Overrides["plugin-vite:keep"] != 20125 || policy.Overrides["plugin-vite:new"] != 20126 || len(policy.Overrides) != 2 {
		t.Fatalf("wrong durable policy: %+v", policy)
	}
	if current.Overrides["browser"] != 20123 || current.Overrides["plugin-vite:old"] != 20124 || len(current.Overrides) != 3 {
		t.Fatal("input manifest mutated before journaled edit")
	}
}

func TestPortSelectionRejectsUnknownPluginRolesAndConflictingPorts(t *testing.T) {
	for _, ports := range [][]string{{"plugin-vite:unselected=20123"}, {"browser=20123", "vite=20123"}, {"rpc=20123"}, {"mcp=65536"}, {"browser=20123", "browser=20124"}} {
		command := workspaceCommand{ports: ports, supplied: map[string]bool{}}
		if _, err := workspacePortPolicy(command, devcontract.PortPolicy{Policy: "sticky"}, []string{"selected"}); err == nil {
			t.Fatalf("accepted invalid port selection %v", ports)
		}
	}
}
