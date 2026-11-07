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

func TestWorkspaceUpstreamHelpExplainsSafetyAndConsent(t *testing.T) {
	for _, test := range []struct {
		verb string
		want []string
	}{
		{"edit", []string{"--upstream", "REMOTE/BRANCH", "does not change the selected ref"}},
		{"update", []string{"--check", "never stops the app", "stopped workspaces remain stopped", "saved options"}},
		{"follow", []string{"--interval", "30s", "minimum 5s", "--apply", "not a sandbox", "Ctrl-C", "--watch", "streams"}},
	} {
		t.Run(test.verb, func(t *testing.T) {
			var out, diagnostics bytes.Buffer
			if code := run([]string{"workspace", test.verb, "--help"}, &out, &diagnostics); code != 0 {
				t.Fatalf("help exit=%d stdout=%s stderr=%s", code, &out, &diagnostics)
			}
			for _, want := range test.want {
				if !strings.Contains(out.String(), want) {
					t.Errorf("help lacks %q: %s", want, &out)
				}
			}
		})
	}
}

func TestFlagFailuresExposeOnlyRegisteredIdentity(t *testing.T) {
	for _, test := range []struct {
		args []string
		flag string
	}{
		{[]string{"workspace", "restart", "--mode=PRIVATE_INPUT", "--json"}, "--mode"},
		{[]string{"workspace", "restart", "--seed-from", "PRIVATE_INPUT", "--json"}, "--seed-from"},
		{[]string{"workspace", "restart", "--PRIVATE_INPUT", "--json"}, ""},
		{[]string{"workspace", "restart", "--sk-live-PRIVATE_INPUT", "--json"}, ""},
		{[]string{"workspace", "restart", "--timeout=PRIVATE_INPUT", "--json"}, "--timeout"},
	} {
		var out, diagnostics bytes.Buffer
		if code := run(test.args, &out, &diagnostics); code != 2 {
			t.Fatalf("invalid flags exit %d", code)
		}
		var result struct {
			Error struct {
				Details map[string]any `json:"details"`
			} `json:"error"`
		}
		if err := json.Unmarshal(out.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(out.String()+diagnostics.String(), "PRIVATE_INPUT") {
			t.Fatal("private flag input escaped")
		}
		if result.Error.Details["helpCommand"] != "omniview-dev workspace restart --help" {
			t.Fatalf("wrong help target: %s", &out)
		}
		if got, _ := result.Error.Details["flag"].(string); got != test.flag {
			t.Fatalf("flag identity %q, want %q", got, test.flag)
		}
		if strings.Contains(out.String(), "valid commands") {
			t.Fatal("leaf failure returned parent command inventory")
		}
	}
}
