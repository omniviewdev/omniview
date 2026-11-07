package devworkspace

import (
	"context"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func commitGoMod(t *testing.T, dir, require string) {
	t.Helper()
	require_ := "module example.com/consumer\n\ngo 1.26.0\n\nrequire github.com/omniviewdev/plugin-sdk " + require + "\n"
	require2 := os.WriteFile(filepath.Join(dir, "go.mod"), []byte(require_), 0o600)
	if require2 != nil {
		t.Fatal(require2)
	}
	for _, args := range [][]string{{"init", "-q"}, {"add", "go.mod"}, {"-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"}} {
		out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
}

func TestSDKSourceRequiredNamesDeclaredRefAcrossSupervisorBoundary(t *testing.T) {
	for _, test := range []struct{ name, version, ref, kind string }{
		{"tag", "v0.16.0", "v0.16.0", "tag"},
		{"pseudo-version", "v0.14.4-0.20261103022722-1712cd3b66e1", "1712cd3b66e1", "pseudo-version"},
	} {
		t.Run(test.name, func(t *testing.T) {
			w := generatedFixture(t)
			host := filepath.Join(w.Root, "omniview")
			require.NoError(t, os.MkdirAll(host, 0o700))
			commitGoMod(t, host, test.version)
			require.NoError(t, os.WriteFile(filepath.Join(host, "package.json"), []byte(`{"name":"host","packageManager":"pnpm@12.14.0"}`), 0o600))

			// The real launch error path: preflight -> supervisor JSON -> controller.
			token := []byte("sdk-guidance-token")
			generation := NewGeneration()
			server := httptest.NewServer(supervisorHandler(w.Manifest.WorkspaceID, generation, token, func(ctx context.Context, _ string) (Status, error) {
				return Status{Workspace: w, Generation: generation}, compatibilityPreflight(ctx, w)
			}))
			defer server.Close()
			_, err := callSupervisor(context.Background(), supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Endpoint: server.URL + "/v1/supervisor"}, token, supervisorStatusCommand)
			var failure *devcontract.Error
			require.ErrorAs(t, err, &failure)
			require.Equal(t, "sdk_source_required", failure.Code, failure.Message)
			require.Equal(t, 2, failure.Exit, "exit must survive the json:\"-\" Exit field")
			want := "'omniview-dev' 'workspace' 'edit' '--workspace' '" + w.ManifestPath + "' '--add-repo' 'plugin-sdk' '--ref' 'plugin-sdk=" + test.ref + "'"
			require.Equal(t, want, failure.Details["nextCommand"])
			require.Equal(t, test.ref, failure.Details["ref"])
			requirements := failure.Details["requirements"].([]any)
			require.Len(t, requirements, 1)
			first := requirements[0].(map[string]any)
			require.Equal(t, test.kind, first["kind"])
			require.Equal(t, test.version, first["version"])
			require.Contains(t, failure.Message, want)
			// Guidance never selects the SDK.
			require.Nil(t, w.Manifest.Links.SDKRepositoryID)
		})
	}
}

func TestSDKSourceRequiredWithoutDeclaredRequirementKeepsPlainError(t *testing.T) {
	w := generatedFixture(t)
	failure := sdkSourceRequired(context.Background(), "m", workspaceSDKProbes(w), editAddSDKCommand(w))
	require.Equal(t, 2, failure.Exit)
	require.Equal(t, "m", failure.Message)
	require.Nil(t, failure.Details)
}

func TestSDKSourceRequiredPrefersHostAndComparesDeclaredCommit(t *testing.T) {
	probes := func(host, plugin string) []sdkProbe {
		root := t.TempDir()
		// "demo" sorts before "omniview": ordering must still prefer the host.
		hostDir, pluginDir := filepath.Join(root, "omniview"), filepath.Join(root, "demo")
		require.NoError(t, os.MkdirAll(hostDir, 0o700))
		require.NoError(t, os.MkdirAll(pluginDir, 0o700))
		commitGoMod(t, hostDir, host)
		commitGoMod(t, pluginDir, plugin)
		return []sdkProbe{{Repository: "demo", GitDir: pluginDir, Revision: "HEAD"}, {Repository: "omniview", GitDir: hostDir, Revision: "HEAD"}}
	}
	command := func(ref string) string { return "use " + ref }

	failure := sdkSourceRequired(context.Background(), "m", probes("v0.16.0", "v0.14.4-0.20261103022722-1712cd3b66e1"), command)
	require.Equal(t, "v0.16.0", failure.Details["ref"])
	require.Equal(t, true, failure.Details["mixed"])
	require.Equal(t, "use v0.16.0", failure.Details["nextCommand"])

	// Different pseudo-version strings naming the same commit agree.
	failure = sdkSourceRequired(context.Background(), "m", probes("v0.14.4-0.20261103022722-1712cd3b66e1", "v0.14.5-0.20261104000000-1712cd3b66e1"), command)
	require.Equal(t, "1712cd3b66e1", failure.Details["ref"])
	require.Equal(t, false, failure.Details["mixed"])
}
