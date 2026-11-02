package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
)

func TestExtensionCLIParameters(t *testing.T) {
	command, err := parseControlCommandForTest([]string{"extensions", "inspect", "--plugin", "plugin", "--point", "point", "--issues-only", "--query", "problem", "--include-sensitive", "--window", "w-second", "--timeout", "2s", "--workspace", "workspace", "--root", "/root", "--json"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	params, ok := command.params.(devcontrol.ExtensionParams)
	if !ok || command.operation != "extensions.inspect" || params.PluginID != "plugin" || params.PointID != "point" || !params.IssuesOnly || params.Query != "problem" || !params.IncludeSensitive || !command.includeSensitive || params.WindowName != "w-second" || params.TimeoutMS != 2000 || command.workspace != "workspace" || command.root != "/root" {
		t.Fatalf("inspect parameters: %+v %+v", command, params)
	}
	command, err = parseControlCommandForTest([]string{"extensions", "lookup", "--point", "point", "--plugin", "plugin", "--resource-key", "resource"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	params = command.params.(devcontrol.ExtensionParams)
	if command.operation != "extensions.lookup" || params.ResourceKey != "resource" || params.WindowName != "main" || params.IncludeSensitive || command.includeSensitive {
		t.Fatalf("lookup parameters: %+v %+v", command, params)
	}
}

func TestExtensionCLIRejectsUnsafeOrIncompleteRequests(t *testing.T) {
	for _, args := range [][]string{
		{"extensions", "lookup"},
		{"extensions", "lookup", "--point", "point", "--plugin", "plugin"},
		{"extensions", "lookup", "--point", "point", "--resource-key", "resource"},
		{"extensions", "inspect", "positional"},
		{"extensions", "inspect", "--window="},
		{"extensions", "inspect", "--timeout=0s"},
		{"extensions", "inspect", "--timeout=-1s"},
		{"extensions", "inspect", "--timeout=31s"},
		{"extensions", "inspect", "--eval", "PRIVATE_SCRIPT"},
		{"extensions", "inspect", "--reload"},
	} {
		_, err := parseControlCommandForTest(args, nil, &bytes.Buffer{})
		if devcontract.ExitCode(err) != 2 || strings.Contains(err.Error(), "PRIVATE_SCRIPT") {
			t.Fatalf("unsafe request accepted: %v %v", args, err)
		}
	}
}

func TestExtensionCLIActualOperationsAndSensitiveWarning(t *testing.T) {
	workspace, requests := controlFixture(t, nil, func(request devcontract.Request, response *devcontract.Response) {
		if !strings.HasPrefix(request.Operation, "extensions.") {
			return
		}
		var params devcontrol.ExtensionParams
		if err := json.Unmarshal(request.Params, &params); err != nil {
			t.Error(err)
		}
		response.Status = "succeeded"
		response.OperationID = ""
		message := "[REDACTED]"
		if params.IncludeSensitive {
			message = "PRIVATE_PLUGIN_EXCEPTION"
		}
		response.Result, _ = json.Marshal(map[string]any{"schemaVersion": 1, "windowName": params.WindowName, "message": message})
	})
	for _, test := range []struct {
		operation string
		sensitive bool
	}{
		{"inspect", false}, {"inspect", true}, {"lookup", false},
	} {
		var out, diagnostics bytes.Buffer
		args := []string{"extensions", test.operation, "--workspace", workspace, "--json", "--plugin", "plugin", "--point", "point"}
		if test.operation == "lookup" {
			args = append(args, "--resource-key", "resource")
		}
		if test.sensitive {
			args = append(args, "--include-sensitive")
		}
		_, code := executeControlTestCommand(context.Background(), args, nil, &out, &diagnostics)
		if code != 0 {
			t.Fatalf("CLI failed: %d %s %s", code, out.String(), diagnostics.String())
		}
		last := (*requests)[len(*requests)-1]
		if last.Operation != "extensions."+test.operation {
			t.Fatalf("wrong operation: %+v", last)
		}
		if strings.Contains(out.String(), "PRIVATE_PLUGIN_EXCEPTION") != test.sensitive || strings.Contains(diagnostics.String(), "WARNING: --include-sensitive") != test.sensitive {
			t.Fatalf("sensitive flag/warning mismatch: stdout=%s stderr=%s", out.String(), diagnostics.String())
		}
		var response devcontract.Response
		if json.Unmarshal(out.Bytes(), &response) != nil || response.Status != "succeeded" {
			t.Fatalf("stdout is not structured JSON: %s", out.String())
		}
	}
}

func TestExtensionCLIWindowsDiscovery(t *testing.T) {
	command, err := parseControlCommandForTest([]string{"extensions", "windows", "--json"}, nil, &bytes.Buffer{})
	if err != nil || command.operation != "extensions.windows" {
		t.Fatalf("windows command: %+v %v", command, err)
	}
	if _, ok := command.params.(devcontrol.EmptyParams); !ok {
		t.Fatalf("windows parameters: %#v", command.params)
	}
	workspace, requests := controlFixture(t, nil, func(request devcontract.Request, response *devcontract.Response) {
		if request.Operation == "extensions.windows" {
			response.Status = "succeeded"
			response.OperationID = ""
			response.Result = json.RawMessage(`[{"windowName":"browser-3","registeredAt":"2026-11-01T12:00:00Z","lastSeen":"2026-11-01T12:00:00Z"}]`)
		}
	})
	var out, diagnostics bytes.Buffer
	_, code := executeControlTestCommand(context.Background(), []string{"extensions", "windows", "--workspace", workspace, "--json"}, nil, &out, &diagnostics)
	if code != 0 || !strings.Contains(out.String(), `"windowName":"browser-3"`) || (*requests)[len(*requests)-1].Operation != "extensions.windows" {
		t.Fatalf("windows discovery failed: %d %s %s", code, out.String(), diagnostics.String())
	}
}
