package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
)

// These cases protect the registered-value consumption and explicit-false
// semantics shared by the two command parsers, not their implementation shape.
func TestWorkspaceRegisteredFlagSemantics(t *testing.T) {
	command, err := parseWorkspaceCommand([]string{"workspace", "up", "feature", "--watch=false", "--mcp=false", "--live-frontend=false", "--timeout=3s", "--mode", "native"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if command.target != "feature" || command.launch.Watch || command.launch.MCP || command.launch.LiveFrontend || command.launch.Mode != "native" || command.launch.Timeout != 3*time.Second {
		t.Fatalf("unexpected command: %+v", command)
	}
	for _, name := range []string{"watch", "mcp", "live-frontend", "timeout", "mode"} {
		if !command.supplied[name] {
			t.Errorf("explicit flag %s was lost", name)
		}
	}
	if command.supplied["seed-from"] {
		t.Fatal("unsupplied option marked supplied")
	}
}

func TestWorkspaceRegisteredFlagTerminatorAndValues(t *testing.T) {
	command, err := parseWorkspaceCommand([]string{"workspace", "edit", "--name", "--", "--", "--feature"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if command.name != "--" || command.target != "--feature" || !command.supplied["name"] {
		t.Fatalf("flag value or target changed: %+v", command)
	}
	command, err = parseWorkspaceCommand([]string{"workspace", "up", "--", "--watch=false"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if command.target != "--watch=false" || command.supplied["watch"] || !command.launch.Watch {
		t.Fatalf("terminator did not preserve target: %+v", command)
	}
}

func TestWorkspaceRegisteredFlagsKeepEmptyAndRepeatedValues(t *testing.T) {
	command, err := parseWorkspaceCommand([]string{"workspace", "create", "feature", "--repo", "host", "--repo=plugin-sdk", "--name=", "--ref", "host=--reviewed"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if command.target != "feature" || command.name != "" || !command.supplied["name"] || !command.supplied["repo"] || !command.supplied["ref"] {
		t.Fatalf("explicit options changed: %+v", command)
	}
	if len(command.repositories) != 2 || command.repositories[0] != "host" || command.repositories[1] != "plugin-sdk" || len(command.refs) != 1 || command.refs[0] != "host=--reviewed" {
		t.Fatalf("repeatable values changed: %+v", command)
	}
}

func TestControlRegisteredFlagTerminatorAndValues(t *testing.T) {
	command, err := parseControlCommand([]string{"plugin", "get", "--wait=false", "--timeout", "2s", "--", "--plugin"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if command.wait || command.timeout != 2*time.Second || command.params != (devcontrol.PluginParams{ID: "--plugin"}) {
		t.Fatalf("unexpected command: %+v", command)
	}
	command, err = parseControlCommand([]string{"settings", "set", "theme", "--value", `"--"`}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	params, ok := command.params.(devcontrol.SettingsParams)
	if !ok || params.ID != "theme" || string(params.Value) != `"--"` {
		t.Fatalf("unexpected settings params: %#v", command.params)
	}
}

func TestControlParserKeepsUsageErrorsPrivate(t *testing.T) {
	const secret = "PRIVATE_FLAG_VALUE"
	for _, args := range [][]string{
		{"plugin", "get", "one", "--" + secret},
		{"plugin", "dev", "logs", "one", "--cursor", secret},
		{"settings", "set", "x", "--value", secret},
	} {
		_, err := parseControlCommand(args, nil, &bytes.Buffer{})
		if devcontract.ExitCode(err) != 2 || strings.Contains(err.Error(), secret) {
			t.Fatalf("unsafe usage error: %v", err)
		}
	}
}
