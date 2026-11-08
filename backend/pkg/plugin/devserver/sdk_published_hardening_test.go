package devserver

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/instance"
)

func TestPublishedManagedBuildRefusesEnvironmentFileGoFlags(t *testing.T) {
	for name, flags := range map[string]string{
		"overlay":  "-overlay=/nonexistent/overlay.json",
		"toolexec": "-toolexec=/nonexistent/wrapper",
	} {
		t.Run(name, func(t *testing.T) {
			build := newPublishedBuild(t, nil)
			goEnv := filepath.Join(t.TempDir(), "env")
			require.NoError(t, os.WriteFile(goEnv, []byte("GOFLAGS="+flags+"\n"), 0o600))
			t.Setenv("GOENV", goEnv)

			watcher := build.watcher(t, build.goPath, devsdk.ReleasePolicy())
			err := watcher.buildPlugin(true, "", time.Now())
			typed := requireTyped(t, err, devsdk.CodeSelectionConflict)
			require.Equal(t, 4, typed.Exit)
			require.Contains(t, typed.Message, flags)
			require.NoFileExists(t, build.installed())
			require.Error(t, instance.VerifyPluginArtifact(build.workspace, publishedPluginID, build.installed()), "no artifact record may exist")
		})
	}
}

func TestPublishedManagedBuildRunsInTheNeutralModuleEnvironment(t *testing.T) {
	build := newPublishedBuild(t, nil)
	// Any go command honoring this variable fails.
	t.Setenv("GOFLAGS", "-toolexec=/nonexistent/wrapper")

	watcher := build.watcher(t, build.goPath, devsdk.ReleasePolicy())
	require.NoError(t, watcher.buildPlugin(true, "", time.Now()))
	require.FileExists(t, build.installed())
	require.NoError(t, instance.VerifyPluginArtifact(build.workspace, publishedPluginID, build.installed()))
}

func TestPublishedDependencyWatchesRunInTheNeutralModuleEnvironment(t *testing.T) {
	build := newPublishedBuild(t, nil)
	// The module graph is reduced to the served uuid release: `all` of the
	// full SDK graph is not servable by the hermetic proxy.
	build.world.Write(build.plugin, "go.mod", fmt.Sprintf("module example.com/plugin\n\ngo 1.26.0\n\nrequire %s %s\n", build.uuid.Module, build.uuid.Version))
	build.world.Write(build.plugin, "go.sum", fmt.Sprintf("%s %s %s\n%s %s/go.mod %s\n",
		build.uuid.Module, build.uuid.Version, build.uuid.ModuleSum, build.uuid.Module, build.uuid.Version, build.uuid.GoModSum))
	// The neutral environment drops -modcacherw: let the temp dir be removed.
	modcache := os.Getenv("GOMODCACHE")
	t.Cleanup(func() {
		_ = filepath.WalkDir(modcache, func(path string, entry os.DirEntry, err error) error {
			if err == nil && entry.IsDir() {
				_ = os.Chmod(path, 0o700)
			}
			return nil
		})
	})
	// -mod=vendor makes `go list -m` fail in a tree without vendor/.
	t.Setenv("GOFLAGS", "-mod=vendor")
	watcher := build.watcher(t, build.goPath, devsdk.ReleasePolicy())
	var logs []LogEntry
	watcher.appendLog = func(entry LogEntry) { logs = append(logs, entry) }
	fs, err := fsnotify.NewWatcher()
	require.NoError(t, err)
	defer fs.Close()
	count := 0
	watcher.watchWorkspaceModules(fs, &count)
	require.Empty(t, logs, "the published module listing must ignore the ambient GOFLAGS")
}

func TestPublishedResolutionFailureNeverLeaksProxyCredentials(t *testing.T) {
	build := newPublishedBuild(t, nil)
	t.Setenv("GOPROXY", "http://user:p@ss@word@127.0.0.1:1/proxy?access_token=SECRETTOKEN123")
	// Nothing is cached in the world's module cache yet, so resolution must
	// reach the unreachable proxy.
	watcher := build.watcher(t, build.goPath, devsdk.ReleasePolicy())
	err := watcher.buildPlugin(true, "", time.Now())
	requireTyped(t, err, devsdk.CodeDependencyUnavailable)
	for _, secret := range []string{"p@ss@word", "ss@word", "word@", "SECRETTOKEN123", "user:p"} {
		require.NotContains(t, err.Error(), secret)
	}
	require.NoFileExists(t, build.installed())
}

func TestGoRunnerRedactsBeforeTruncating(t *testing.T) {
	// The cut of a 4096-byte tail would fall inside the credential: redaction
	// must see the whole credential first.
	password := "p@ss" + strings.Repeat("w", 40) + "@word"
	stderr := "https://user:" + password + "@proxy.example/x?access_token=TOPSECRETTOKEN " + strings.Repeat("x", 4090-len("https://user:")-len(password)+30)
	script := "#!/bin/sh\nprintf '%s' \"$GO_STDERR\" >&2\nexit 1\n"
	goPath := filepath.Join(t.TempDir(), "go")
	require.NoError(t, os.WriteFile(goPath, []byte(script), 0o700))
	_, err := goRunner(goPath, []string{"GO_STDERR=" + stderr})(context.Background(), t.TempDir(), nil, "list", "-m")
	require.Error(t, err)
	require.LessOrEqual(t, len(err.Error()), goDiagnosticLimit+64)
	for _, secret := range []string{"TOPSECRETTOKEN", "word", "p@ss", strings.Repeat("w", 8)} {
		require.NotContains(t, err.Error(), secret)
	}
}
