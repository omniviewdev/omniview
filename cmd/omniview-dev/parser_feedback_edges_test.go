package main

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestWorkspaceInvalidDurationBoundariesBeforeEffectsEdges(t *testing.T) {
	for _, flags := range [][]string{
		{"up", "--timeout=-1ns"},
		{"up", "--timeout=not-a-duration"},
		{"up", "--timeout=999999999999999999999h"},
		{"follow", "--interval=0s"},
		{"follow", "--interval=-1s"},
		{"follow", "--interval=4999999999ns"},
	} {
		for _, jsonMode := range []bool{false, true} {
			t.Run(flags[0]+flags[1]+map[bool]string{false: "/text", true: "/json"}[jsonMode], func(t *testing.T) {
				f := newCLIEdgeFixture(t)
				before := f.manifest()
				args := []string{"workspace", flags[0], "feature", "--root", f.root, flags[1]}
				if jsonMode {
					args = append(args, "--json")
				}
				var out, diagnostics bytes.Buffer
				if code := run(args, &out, &diagnostics); code != 2 {
					t.Errorf("invalid duration exit=%d stdout=%s stderr=%s", code, &out, &diagnostics)
				}
				if !bytes.Equal(before, f.manifest()) {
					t.Fatal("invalid duration changed workspace")
				}
				if jsonMode {
					var result struct {
						Error *devcontract.Error `json:"error"`
					}
					if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.Error == nil {
						t.Fatalf("missing structured error: %s %v", &out, err)
					}
				} else if out.Len() != 0 || diagnostics.Len() == 0 {
					t.Fatalf("wrong text streams: stdout=%s stderr=%s", &out, &diagnostics)
				}
			})
		}
	}
}

func TestWorkspaceParseErrorJSONLastFlagAndTerminatorEdges(t *testing.T) {
	const secret = "private-token-must-not-leak"
	for _, test := range []struct {
		name string
		args []string
		json bool
	}{
		{"last-true", []string{"workspace", "inspect", "--json=false", "--json=true", "--unknown=" + secret}, true},
		{"last-false", []string{"workspace", "inspect", "--json=true", "--json=false", "--unknown=" + secret}, false},
		{"terminated-json-is-target", []string{"workspace", "inspect", "--", "--json", secret}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var out, diagnostics bytes.Buffer
			if code := run(test.args, &out, &diagnostics); code != 2 {
				t.Fatalf("exit=%d stdout=%s stderr=%s", code, &out, &diagnostics)
			}
			if bytes.Contains(out.Bytes(), []byte(secret)) || bytes.Contains(diagnostics.Bytes(), []byte(secret)) {
				t.Fatal("parse error exposed private argument")
			}
			if test.json {
				var result struct {
					Error *devcontract.Error `json:"error"`
				}
				if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.Error == nil || diagnostics.Len() != 0 {
					t.Fatalf("wrong JSON streams: stdout=%s stderr=%s err=%v", &out, &diagnostics, err)
				}
			} else if out.Len() != 0 || diagnostics.Len() == 0 {
				t.Fatalf("wrong text streams: stdout=%s stderr=%s", &out, &diagnostics)
			}
		})
	}
}

func TestWorkspaceOperationErrorDeliveryFailureEdges(t *testing.T) {
	f := newCLIEdgeFixture(t)
	before := f.manifest()
	var diagnostics bytes.Buffer
	code := run([]string{"workspace", "edit", "feature", "--root", f.root, "--add-plugin", "unregistered", "--json"}, cliEdgeBrokenOutput{}, &diagnostics)
	if code != 5 {
		t.Errorf("failed error delivery must report delivery failure: exit=%d stderr=%s", code, &diagnostics)
	}
	if !bytes.Equal(before, f.manifest()) {
		t.Fatal("failed operation changed workspace")
	}
}

type cliEdgeShortOutput struct{}

func (cliEdgeShortOutput) Write(p []byte) (int, error) {
	return len(p) / 2, nil
}

func TestCLIOutputDeliveryFailuresEdges(t *testing.T) {
	for _, test := range []struct {
		name string
		args []string
		text bool
	}{
		{name: "help", args: []string{"--help"}},
		{name: "parse-json", args: []string{"workspace", "unknown", "--json"}},
		{name: "parse-text", args: []string{"workspace", "unknown"}, text: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var delivered bytes.Buffer
			var code int
			if test.text {
				code = run(test.args, &delivered, cliEdgeShortOutput{})
			} else {
				code = run(test.args, cliEdgeShortOutput{}, &delivered)
			}
			if code != 5 {
				t.Fatalf("short output delivery reported exit %d, want 5", code)
			}
		})
	}
}
