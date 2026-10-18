package devserver

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

func TestGoBuildPublishesProfileArtifactWithoutSourceWrites(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOWORK", "off")
	t.Setenv("GOFLAGS", "")
	t.Setenv("OMNIVIEW_WORKSPACE_ID", "")
	for _, existing := range []bool{false, true} {
		name := "absent-source-output"
		if existing {
			name = "existing-source-output"
		}
		t.Run(name, func(t *testing.T) {
			source := t.TempDir()
			if err := os.Mkdir(filepath.Join(source, "pkg"), 0700); err != nil {
				t.Fatal(err)
			}
			files := map[string]string{
				"go.mod":      "module example.invalid/private-artifact\n\ngo 1.22\n",
				"pkg/main.go": "package main\nimport (\"fmt\"; \"os\"; \"strconv\")\nfunc main() { value, err := strconv.Atoi(os.Args[1]); if err != nil { panic(err) }; fmt.Print(value * 2) }\n",
				"plugin.yaml": "id: private-artifact\nname: Private Artifact\nversion: 1.0.0\ncapabilities: [ui]\n",
			}
			for relative, content := range files {
				if err := os.WriteFile(filepath.Join(source, relative), []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			legacy := filepath.Join(source, "build", "bin", "plugin")
			canary := []byte("user-owned source artifact must not be overwritten")
			if existing {
				if err := os.MkdirAll(filepath.Dir(legacy), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(legacy, canary, 0600); err != nil {
					t.Fatal(err)
				}
			}
			installedPaths := map[string]bool{}
			for range 2 {
				state := appstate.NewTestService(t)
				watcher := newGoWatcherProcess(context.Background(), logging.NewNop(), "private-artifact", source,
					BuildOpts{GoPath: goPath}, nil, state.Plugins(), func(LogEntry) {}, func(DevProcessStatus) {}, nil, func(string, []BuildError) {})
				defer watcher.cancel()
				if err := watcher.runGoBuild(); err != nil {
					t.Fatal(err)
				}
				if err := watcher.syncPluginYaml(); err != nil {
					t.Fatal(err)
				}
				if err := watcher.transferBinary(); err != nil {
					t.Fatal(err)
				}
				installed := state.Plugins().ResolvePath(filepath.Join("private-artifact", "bin", "plugin"))
				if installedPaths[installed] {
					t.Fatal("independent profiles published to the same executable")
				}
				installedPaths[installed] = true
				command := &exec.Cmd{Path: installed, Args: []string{installed, "21"}, Env: os.Environ()}
				output, err := command.Output()
				if err != nil || string(output) != "42" {
					t.Fatalf("profile artifact did not execute the compiled consumer: %v, %q", err, output)
				}
				if existing {
					actual, err := os.ReadFile(legacy)
					if err != nil || !bytes.Equal(actual, canary) {
						t.Error("Go producer overwrote the source-owned executable", err)
					}
				} else if _, err := os.Lstat(filepath.Join(source, "build")); !os.IsNotExist(err) {
					t.Errorf("Go producer created an unowned source build directory: %v", err)
				}
			}
		})
	}
}
