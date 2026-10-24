package devserver

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// These fixtures exercise source-selection admission only, not SDK compilation
// or RPC. TestSelectedSDKAPIRealCompileRPCAndRecovery owns those real boundaries.
func sdkRPCSelectionSource(t *testing.T, modulePath string) (root, providerFile string) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(root, "go.mod"), []byte("module "+modulePath+"\n\ngo 1.26.0\n"), 0600))
	providerFile = filepath.Join(root, "pkg", "v1", "settings", "provider.go")
	require.NoError(t, os.MkdirAll(filepath.Dir(providerFile), 0700))
	require.NoError(t, os.WriteFile(providerFile, []byte("package settings\n"), 0600))
	return root, providerFile
}

func TestSDKRPCSourceSelectionExplicitCheckoutNeedsNoReleasedModule(t *testing.T) {
	selected, _ := sdkRPCSelectionSource(t, sdkModulePath)
	// Even unavailable/trimmed parent source evidence must not trigger a
	// repository go-list query when an explicit valid source was selected.
	actual, err := sdkRPCSelectSource(selected, "trimmed/unavailable/provider.go")
	require.NoError(t, err)
	require.Equal(t, selected, actual)
}

func TestSDKRPCSourceSelectionDefaultUsesCompiledSource(t *testing.T) {
	compiled, providerFile := sdkRPCSelectionSource(t, sdkModulePath)
	// There is deliberately no repository-manifest argument: a parent's
	// -modfile replacement cannot be overridden by the original root go.mod.
	actual, err := sdkRPCSelectSource("", providerFile)
	require.NoError(t, err)
	require.Equal(t, compiled, actual)
}

func TestSDKRPCSourceSelectionInvalidExplicitSourceNeverFallsBack(t *testing.T) {
	_, validCompiledFile := sdkRPCSelectionSource(t, sdkModulePath)
	wrongModule, _ := sdkRPCSelectionSource(t, "example.invalid/not-the-sdk")
	for _, explicit := range []string{filepath.Join(t.TempDir(), "missing"), wrongModule} {
		t.Run(filepath.Base(explicit), func(t *testing.T) {
			actual, err := sdkRPCSelectSource(explicit, validCompiledFile)
			require.Error(t, err)
			require.Empty(t, actual, "valid parent source cannot rescue an invalid explicit selection")
			require.ErrorContains(t, err, "SDK_SOURCE")
		})
	}
}

func TestSDKRPCSourceSelectionRequiresExplicitSourceForTrimpath(t *testing.T) {
	for _, compiledFile := range []string{"", "github.com/omniviewdev/plugin-sdk/pkg/v1/settings/provider.go", "/unavailable/sdk/pkg/v1/settings/provider.go"} {
		t.Run(compiledFile, func(t *testing.T) {
			actual, err := sdkRPCSelectSource("", compiledFile)
			require.Error(t, err)
			require.Empty(t, actual)
			require.ErrorContains(t, err, "SDK_SOURCE")
		})
	}
}
