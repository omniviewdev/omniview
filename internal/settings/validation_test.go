package categories

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/omniviewdev/plugin-sdk/settings"
)

func TestGoExecutableValidation(t *testing.T) {
	if result := validateGoExecutable(""); !result.Valid || result.Code != "automatic" {
		t.Fatalf("empty override: %+v", result)
	}
	for _, value := range []any{42, filepath.Join(t.TempDir(), "missing"), t.TempDir()} {
		if result := validateGoExecutable(value); result.Valid {
			t.Fatalf("accepted invalid executable: %+v", result)
		}
	}
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Fatal(err)
	}
	if result := validateGoExecutable(goPath); !result.Valid || result.Code != "go_version" {
		t.Fatalf("real Go: %+v", result)
	}
	if runtime.GOOS == "windows" {
		return
	}
	for _, tc := range []struct {
		name, body, code string
		mode             os.FileMode
	}{
		{"permissions", "exit 0", "not_executable", 0600},
		{"failure", "echo secret-input >&2; exit 1", "execution", 0700},
		{"output", "echo secret-input", "unexpected_output", 0700},
		{"timeout", "sleep 30", "timeout", 0700},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "go")
			if err := os.WriteFile(path, []byte("#!/bin/sh\n"+tc.body+"\n"), tc.mode); err != nil {
				t.Fatal(err)
			}
			result := validateGoExecutable(path)
			if result.Valid || result.Code != tc.code || strings.Contains(result.Message, "secret-input") {
				t.Fatalf("unexpected feedback: %+v", result)
			}
			provider := settings.NewProvider(settings.ProviderOpts{PluginSettings: []settings.Category{Developer}})
			if err := provider.SetSetting("developer.gopath", path); err == nil {
				t.Fatal("invalid executable saved")
			}
			value, _ := provider.GetString("developer.gopath")
			if value != "" {
				t.Fatal("failed validation changed saved value")
			}
		})
	}
}

func TestGoExecutableValidationInaccessiblePath(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires Unix permissions and an unprivileged user")
	}
	directory := t.TempDir()
	path := filepath.Join(directory, "go")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(directory, 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chmod(directory, 0700); err != nil {
			t.Error(err)
		}
	})
	result := validateGoExecutable(path)
	if result.Valid || result.Code != "unreadable" || strings.Contains(result.Message, path) {
		t.Fatalf("inaccessible executable feedback: %+v", result)
	}
}
