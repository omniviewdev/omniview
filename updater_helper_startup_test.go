package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdaterHelperRunsBeforeProfileResolution(t *testing.T) {
	if os.Getenv("OMNIVIEW_TEST_UPDATER_HELPER") == "1" {
		main()
		return
	}

	ready := filepath.Join(t.TempDir(), "helper-status")
	cmd := exec.Command(os.Args[0], "-test.run=^TestUpdaterHelperRunsBeforeProfileResolution$")
	cmd.Env = append(os.Environ(),
		"OMNIVIEW_TEST_UPDATER_HELPER=1",
		"OMNIVIEW_CHANNEL=invalid-channel",
		"WAILS_UPDATER_HELPER=1",
		"WAILS_UPDATER_HELPER_TARGET=",
		"WAILS_UPDATER_HELPER_NEW=",
		"WAILS_UPDATER_HELPER_READY="+ready,
	)
	output, err := cmd.CombinedOutput()
	if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 2 {
		t.Fatalf("helper exit = %v, output = %s", err, output)
	}
	status, err := os.ReadFile(ready)
	if err != nil || !strings.Contains(string(status), "missing helper target") {
		t.Fatalf("helper status = %q, error = %v", status, err)
	}
}
