package devcontract

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

// Accepting an unknown operation or stale generation could mutate the wrong running application.
func TestRequestRejectsStaleAndUnlistedOperations(t *testing.T) {
	valid := Request{ProtocolVersion: 1, RequestID: "request", WorkspaceID: "workspace", Generation: "generation", Operation: "settings.set", Params: json.RawMessage(`{"id":"terminal.fontSize","value":17}`)}
	for _, tc := range []struct {
		name   string
		change func(*Request)
		exit   int
	}{
		{"wrong workspace", func(r *Request) { r.WorkspaceID = "other" }, 4},
		{"stale generation", func(r *Request) { r.Generation = "previous" }, 4},
		{"shell escape", func(r *Request) { r.Operation = "shell.exec" }, 2},
		{"unknown protocol", func(r *Request) { r.ProtocolVersion = 2 }, 2},
		{"bad parameters", func(r *Request) { r.Params = json.RawMessage(`{`) }, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := valid
			tc.change(&r)
			if err := r.ValidateTarget("workspace", "generation"); ExitCode(err) != tc.exit {
				t.Fatalf("wrong result: %v", err)
			}
		})
	}
}

// Bootstrap data is rendered before React; it must not expose filesystem/control secrets or executable markup.
func TestBootIdentityOmitsPrivateDiscovery(t *testing.T) {
	d := Discovery{InstanceDescriptor: InstanceDescriptor{SchemaVersion: 1, InstanceID: "profile", DisplayName: "</script><script>alert(1)</script>", Kind: "development", StateRoot: "/private/state"}, TokenFile: "/private/control-token"}
	data, err := json.Marshal(d.BootIdentity())
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"/private/state", "control-token", "</script>"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("unsafe bootstrap payload: %s", data)
		}
	}
	var decoded map[string]any
	if err = json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["instanceID"] != "profile" || decoded["kind"] != "development" {
		t.Fatalf("missing safe identity: %s", data)
	}
}

// Conflicting explicit state overrides must not make a named workspace silently use another profile.
func TestResolveWorkspaceRejectsStateRootConflict(t *testing.T) {
	root := t.TempDir()
	saveFixture(t, root)
	home := t.TempDir()
	_, err := ResolveWorkspace(ResolveOptions{CWD: root, Home: home, StateRoot: filepath.Join(home, ".omniview")})
	if ExitCode(err) != 4 {
		t.Fatalf("production override accepted: %v", err)
	}
}
