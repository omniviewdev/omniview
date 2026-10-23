package devserver

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/require"
)

func sdkSourceFixture(t *testing.T) (source, sdk, revision, goPath string) {
	t.Helper()
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("Go tool unavailable")
	}
	if _, err = exec.LookPath("git"); err != nil {
		t.Skip("Git unavailable")
	}
	sdk = t.TempDir()
	source = t.TempDir()
	files := map[string]string{"go.mod": "module github.com/omniviewdev/plugin-sdk\n\ngo 1.24.0\n", "pkg/state/root.go": "package state\n", "pkg/utils/store.go": "package utils\n", "pkg/sdk/plugin.go": "package sdk\n", "settings/value.go": "package settings\nconst Value=1\n", "log/value.go": "package log\nconst Value=1\n", "proto/value.go": "package proto\nconst Value=1\n"}
	files["pkg/state/custom.go"] = "package state\n"
	files["pkg/profilecontract/profile.go"] = "package profilecontract\n"
	for name, value := range files {
		path := filepath.Join(sdk, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
		require.NoError(t, os.WriteFile(path, []byte(value), 0600))
	}
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", sdk, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=" + t.TempDir()}, args...)...)
		cmd.Env = goBuildEnv(os.Environ())
		b, err := cmd.CombinedOutput()
		require.NoError(t, err, string(b))
		return string(b)
	}
	git("init", "-q")
	git("add", ".")
	git("commit", "-qm", "reviewed fixture")
	revision = strings.TrimSpace(git("rev-parse", "HEAD"))
	require.NoError(t, os.WriteFile(filepath.Join(source, "go.mod"), []byte(fmt.Sprintf("module fixture\n\ngo 1.24.0\nrequire github.com/omniviewdev/plugin-sdk v0.0.0\nreplace github.com/omniviewdev/plugin-sdk => %q\n", sdk)), 0600))
	return source, sdk, revision, goPath
}

func TestVerifySelectedSDKUsesActualGoModuleAndDirtySourceDigest(t *testing.T) {
	source, sdk, revision, goPath := sdkSourceFixture(t)
	identity, err := VerifySelectedSDK(context.Background(), goPath, source, revision, os.Environ())
	require.NoError(t, err)
	canonical, err := filepath.EvalSymlinks(sdk)
	require.NoError(t, err)
	require.Equal(t, canonical, identity.Directory)
	require.Len(t, identity.SourceDigest, 64)
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "settings", "value.go"), []byte("package settings\nconst Value=2\n"), 0600))
	dirty, err := VerifySelectedSDK(context.Background(), goPath, source, revision, os.Environ())
	require.NoError(t, err)
	require.NotEqual(t, identity.SourceDigest, dirty.SourceDigest, "ordinary dirty SDK API edits must receive fresh source evidence")
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "pkg", "state", "root.go"), []byte("package state\n// containment changed\n"), 0600))
	_, err = VerifySelectedSDK(context.Background(), goPath, source, revision, os.Environ())
	require.Error(t, err, "changed containment core must not inherit baseline trust")
	env := append(os.Environ(), "OMNIVIEW_WORKSPACE_ID=9f479dc5-9fd0-4359-915a-ed307fbe5510", "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES=1")
	_, err = VerifySelectedSDK(context.Background(), goPath, source, revision, env)
	require.ErrorContains(t, err, "explicit validated workspace", "a bare environment flag must not authorize containment-core changes")
}

func TestVerifySelectedSDKRejectsDirtyProfileContract(t *testing.T) {
	source, sdk, revision, goPath := sdkSourceFixture(t)
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "pkg", "profilecontract", "profile.go"), []byte("package profilecontract\n// containment changed\n"), 0600))
	_, err := VerifySelectedSDK(context.Background(), goPath, source, revision, os.Environ())
	require.ErrorContains(t, err, "pkg/profilecontract/profile.go", "the shared ownership reader must not inherit baseline trust after a dirty edit")
	require.ErrorContains(t, err, "--allow-isolation-source-changes")
}

func TestVerifySelectedSDKIgnoresYAMLAndFollowsReplacement(t *testing.T) {
	source, _, revision, goPath := sdkSourceFixture(t)
	require.NoError(t, os.WriteFile(filepath.Join(source, "plugin.yaml"), []byte("state_isolation: {sdk_revision: arbitrary}\n"), 0600))
	_, err := VerifySelectedSDK(context.Background(), goPath, source, "", os.Environ())
	require.ErrorContains(t, err, "trusted exact")
	_, foreign, _, _ := sdkSourceFixture(t)
	// A same-ID foreign module cannot inherit the reviewed selected repository's proof.
	require.NoError(t, os.WriteFile(filepath.Join(foreign, "settings", "value.go"), []byte("package settings\nconst Value=99\n"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(source, "go.mod"), []byte(fmt.Sprintf("module fixture\n\ngo 1.24.0\nrequire github.com/omniviewdev/plugin-sdk v0.0.0\nreplace github.com/omniviewdev/plugin-sdk => %q\n", foreign)), 0600))
	actual, err := VerifySelectedSDK(context.Background(), goPath, source, revision, os.Environ())
	// Fixture repositories may have the same initial commit; source evidence must
	// nevertheless identify the actual replacement, never the prior selected dir.
	if err == nil {
		canonical, e := filepath.EvalSymlinks(foreign)
		require.NoError(t, e)
		require.Equal(t, canonical, actual.Directory)
	}
}

func TestDependencyWatchesCoverEffectiveSDKSettingsLogAndProto(t *testing.T) {
	source, sdk, _, goPath := sdkSourceFixture(t)
	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)
	defer watcher.Close()
	gw := &goWatcherProcess{ctx: context.Background(), devPath: source, buildOpts: BuildOpts{GoPath: goPath, Environment: os.Environ()}, watcher: watcher, appendLog: func(LogEntry) {}}
	count := 0
	gw.watchWorkspaceModules(watcher, &count)
	for _, name := range []string{"settings", "log", "proto", "pkg/state"} {
		canonical, e := filepath.EvalSymlinks(filepath.Join(sdk, name))
		require.NoError(t, e)
		require.Contains(t, gw.WatchedDirectories(), canonical)
	}
	require.NoError(t, gw.SetDependencyWatching(false))
	require.Empty(t, gw.WatchedDirectories(), "graph handoff must remove the canonical dependency watches")
}
