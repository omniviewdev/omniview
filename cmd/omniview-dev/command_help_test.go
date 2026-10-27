package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestWorkspaceUsageDiagnosticsFormats(t *testing.T) {
	var out, diagnostics bytes.Buffer
	if code := run([]string{"workspace", "unknown"}, &out, &diagnostics); code != 2 || out.Len() != 0 || !strings.Contains(diagnostics.String(), "valid commands") {
		t.Fatalf("human: %d %s %s", code, &out, &diagnostics)
	}
	out.Reset()
	diagnostics.Reset()
	if code := run([]string{"workspace", "unknown", "--json"}, &out, &diagnostics); code != 2 || !strings.Contains(out.String(), `"error"`) {
		t.Fatalf("JSON: %d %s %s", code, &out, &diagnostics)
	}
}

func TestCobraFlagErrorsKeepPrivateValuesOutOfBothStreams(t *testing.T) {
	const secret = "PRIVATE_INPUT"
	for _, args := range [][]string{
		{"plugin", "dev", "logs", "one", "--cursor", secret},
		{"settings", "get", "--timeout", secret, "--json"},
		{"workspace", "up", "--watch=" + secret, "--json"},
	} {
		var out, diagnostics bytes.Buffer
		if code := run(args, &out, &diagnostics); code != 2 {
			t.Fatalf("invalid flags must fail before target discovery: exit %d", code)
		}
		if strings.Contains(out.String()+diagnostics.String(), secret) {
			t.Fatal("Cobra usage error exposed a private argument")
		}
		var failure struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(out.Bytes(), &failure); err != nil || failure.Error.Code != "usage" {
			t.Fatalf("usage error must retain its structured contract: %s (%v)", &out, err)
		}
	}
}
