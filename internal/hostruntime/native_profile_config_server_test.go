//go:build server

package hostruntime

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/stretchr/testify/require"
)

func TestBrowserRuntimePreparationNeverCreatesOrChangesNativeStorage(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(map[bool]string{false: "fresh", true: "existing"}[existing], func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			require.NoError(t, err)
			p := instance.Profile{Descriptor: devcontract.InstanceDescriptor{Kind: "production"}, RuntimeRoot: filepath.Join(root, "runtime"), WebviewRoot: filepath.Join(root, "webview")}
			if existing {
				require.NoError(t, os.MkdirAll(p.WebviewRoot, 0700))
				require.NoError(t, os.WriteFile(filepath.Join(p.WebviewRoot, "sentinel"), []byte("retained native data"), 0600))
			}
			require.NoError(t, PrepareProfileRuntime(p))
			require.DirExists(t, filepath.Join(p.RuntimeRoot, "tmp"))
			if existing {
				data, err := os.ReadFile(filepath.Join(p.WebviewRoot, "sentinel"))
				require.NoError(t, err)
				require.Equal(t, "retained native data", string(data))
			} else {
				require.NoDirExists(t, p.WebviewRoot)
			}
			require.Equal(t, filepath.Join(root, "webview"), p.WebviewRoot)
		})
	}
}
