//go:build darwin || linux || windows

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func authorityCommandFixture(t *testing.T) (map[string]any, string) {
	t.Helper()
	home, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id, generation := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
	if err := devcontract.EnsureDefaultProfileOwnership(home, id); err != nil {
		t.Fatal(err)
	}
	runtime, err := devsession.EnsurePrivateDirectory(filepath.Join(home, ".omniview-dev", "profiles", id, "runtime"))
	if err != nil {
		t.Fatal(err)
	}
	root, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(runtime, "vite-feedback-"+generation+".json")
	state, err := json.Marshal(map[string]any{"schemaVersion": 1, "workspaceID": id, "generation": generation, "workspaceRoot": root, "held": true})
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.Write(state); err != nil {
		t.Fatal(err)
	}
	identity := authorityFixtureIdentity(t, file)
	executable := os.Getenv("OMNIVIEW_FEEDBACK_TEST_CLI")
	if executable == "" {
		executable, err = os.Executable()
		if err != nil {
			t.Fatal(err)
		}
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{"schemaVersion": 1, "workspaceID": id, "generation": generation, "workspaceRoot": root, "file": path, "authority": map[string]any{"executable": executable, "identity": identity}}, path
}

func invokeAuthorityCommand(t *testing.T, config map[string]any) (int, []byte) {
	t.Helper()
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"vite-feedback-read", "--context", string(encoded)}
	var out, diagnostics bytes.Buffer
	if executable := os.Getenv("OMNIVIEW_FEEDBACK_TEST_CLI"); executable != "" {
		command := exec.Command(executable, args...)
		command.Stdout, command.Stderr = &out, &diagnostics
		err := command.Run()
		if err == nil {
			return 0, out.Bytes()
		}
		if exited, ok := err.(*exec.ExitError); ok {
			return exited.ExitCode(), out.Bytes()
		}
		t.Fatalf("execute actual authority CLI: %v: %s", err, &diagnostics)
	}
	return run(args, &out, &diagnostics), out.Bytes()
}

func TestViteFeedbackReadCommandObservesDurableStateWithoutReplacingIdentity(t *testing.T) {
	config, path := authorityCommandFixture(t)
	for _, held := range []bool{true, false, true} {
		state, err := json.Marshal(map[string]any{"schemaVersion": 1, "workspaceID": config["workspaceID"], "generation": config["generation"], "workspaceRoot": config["workspaceRoot"], "held": held})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, state, 0600); err != nil {
			t.Fatal(err)
		}
		code, output := invokeAuthorityCommand(t, config)
		want := []byte("{\"held\":true}\n")
		if !held {
			want = []byte("{\"held\":false}\n")
		}
		if code != 0 || !bytes.Equal(output, want) {
			t.Fatalf("actual authority state held=%v: code=%d output=%q", held, code, output)
		}
	}
}

func TestViteFeedbackReadCommandRejectsForeignAuthorityAndMetadata(t *testing.T) {
	for _, tamper := range []string{"replaced-inode", "symlink", "malformed", "context", "full-identity", "volume", "executable", "permissions"} {
		t.Run(tamper, func(t *testing.T) {
			config, path := authorityCommandFixture(t)
			switch tamper {
			case "replaced-inode", "symlink":
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.Rename(path, path+".original"); err != nil {
					t.Fatal(err)
				}
				if tamper == "symlink" {
					if err := os.Symlink(path+".original", path); err != nil {
						t.Skipf("symlink fixture unavailable: %v", err)
					}
				} else if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "malformed":
				if err := os.WriteFile(path, []byte(`{"held":false`), 0600); err != nil {
					t.Fatal(err)
				}
			case "context":
				config["workspaceRoot"] = filepath.Dir(config["workspaceRoot"].(string))
			case "full-identity":
				identity := config["authority"].(map[string]any)["identity"].(map[string]string)
				// Change a high byte while preserving the legacy low 64-bit ID.
				fileID := []byte(identity["fileID"])
				high := 0
				if runtime.GOOS == "windows" {
					high = 16
				}
				fileID[high] = 'f'
				if identity["fileID"][high] == 'f' {
					fileID[high] = 'e'
				}
				identity["fileID"] = string(fileID)
			case "volume":
				identity := config["authority"].(map[string]any)["identity"].(map[string]string)
				if identity["volume"] == "0" {
					identity["volume"] = "1"
				} else {
					identity["volume"] = "0"
				}
			case "executable":
				config["authority"].(map[string]any)["executable"] = path
			case "permissions":
				authorityFixturePublicPermissions(t, path)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			code, output := invokeAuthorityCommand(t, config)
			if code == 0 || bytes.Contains(output, []byte(`"held":false`)) {
				t.Fatalf("foreign state yielded authority release: code=%d output=%q", code, output)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("read authority changed foreign metadata: %q: %v", after, err)
			}
		})
	}
}
