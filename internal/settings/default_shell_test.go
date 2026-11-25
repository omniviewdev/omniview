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
	if setErr := provider.SetSetting("terminal.defaultShell", sh); setErr != nil {
		t.Fatalf("an installed shell was refused: %v", setErr)
	}
	notAShell := filepath.Join(t.TempDir(), "editor")
	if writeErr := os.WriteFile(notAShell, []byte("#!/bin/sh\n"), 0o755); writeErr != nil {
		t.Fatal(writeErr)
	}
	for _, value := range []any{"zhs", "/nowhere/zsh", notAShell, "", 7, nil} {
		if setErr := provider.SetSetting("terminal.defaultShell", value); setErr == nil {
			t.Fatalf("%#v was accepted as the default shell", value)
		}
	}
	if got, getErr := provider.GetString("terminal.defaultShell"); getErr != nil || got != sh {
		t.Fatalf("a refused value changed the default shell: %q, %v", got, getErr)
	}
}
