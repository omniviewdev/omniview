//go:build ui_next && !server && cgo && !purego && ((darwin && !ios) || (linux && !android && !gtk3))

package windowmaterial

import (
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Exercise actual toolkit objects without opening the user's application or
// changing a desktop preference. This is a hierarchy test, not a pixel capture.
func TestNativeMaterialLifecycle(t *testing.T) {
	if testing.Short() {
		t.Skip("slow: compiles a native fixture and initializes a real webview")
	}
	binary := filepath.Join(t.TempDir(), "material-lifecycle")
	var build *exec.Cmd
	if runtime.GOOS == "darwin" {
		build = exec.CommandContext(t.Context(), "xcrun", "clang", "-fobjc-arc", "-fblocks", "-mmacosx-version-min=13.0", "-framework", "AppKit", "-framework", "WebKit", "native_darwin.m", "testdata/lifecycle_darwin.m", "-o", binary)
	} else {
		flags, err := exec.CommandContext(t.Context(), "pkg-config", "--cflags", "--libs", "gtk4", "webkitgtk-6.0").Output()
		if err != nil {
			t.Fatal(err)
		}
		args := []string{"native_linux.c", "testdata/lifecycle_linux.c", "-o", binary}
		build = exec.CommandContext(t.Context(), "cc", append(args, strings.Fields(string(flags))...)...)
	}
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("compile native lifecycle fixture: %v\n%s", err, output)
	}
	if output, err := exec.CommandContext(t.Context(), binary).CombinedOutput(); err != nil {
		var status *exec.ExitError
		if errors.As(err, &status) && status.ExitCode() == 77 {
			t.Skip("no graphical display available")
		}
		t.Fatalf("native lifecycle: %v\n%s", err, output)
	}
}
