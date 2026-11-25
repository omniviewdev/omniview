package categories

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/omniviewdev/plugin-sdk/settings"
)

// A shell typed in Settings is refused when it is not one the host starts: a typo, a program that is not a shell,
// a path that does not exist. The host never replaces it silently with another shell.
func TestDefaultShellSettingRefusesWhatTheHostCannotStart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell fixture")
	}
	provider := settings.NewProvider(settings.ProviderOpts{PluginSettings: []settings.Category{Terminal}})
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("sh unavailable")
	}
	if err := provider.SetSetting("terminal.defaultShell", sh); err != nil {
		t.Fatalf("an installed shell was refused: %v", err)
	}
	notAShell := filepath.Join(t.TempDir(), "editor")
	if err := os.WriteFile(notAShell, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{"zhs", "/nowhere/zsh", notAShell, "", 7, nil} {
		if err := provider.SetSetting("terminal.defaultShell", value); err == nil {
			t.Fatalf("%#v was accepted as the default shell", value)
		}
	}
	if got, err := provider.GetString("terminal.defaultShell"); err != nil || got != sh {
		t.Fatalf("a refused value changed the default shell: %q, %v", got, err)
	}
}
