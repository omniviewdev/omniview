package sdktest_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
)

func admit(t *testing.T, policy devsdk.Policy, release sdktest.Release) error {
	t.Helper()
	identity, err := devsdk.NewPublishedIdentity(release.Published())
	require.NoError(t, err)
	return policy.Admit(identity)
}

// The world's policy is the production policy plus the synthetic releases a test
// serves: the floor release (the real pinned SDK) is already a reviewed row.
func TestWorldPolicyExtendsTheProductionRulesWithTheServedReleases(t *testing.T) {
	table := devsdk.ReviewedReleases()
	world := sdktest.New(t)
	floor := world.PublishSDK(devsdk.FloorVersion, nil)
	newer := world.PublishSDK("v0.19.0", nil)
	uuid := world.PublishPinned("github.com/google/uuid")

	require.NoError(t, admit(t, world.Policy(), floor), "the floor release needs no extra row")
	require.NoError(t, admit(t, world.Policy(floor), floor), "naming the reviewed floor release again changes nothing")
	require.ErrorIs(t, admit(t, devsdk.ReleasePolicy(), newer), devsdk.ErrNotAccepted, "production does not know the synthetic release")
	require.ErrorIs(t, admit(t, world.Policy(), newer), devsdk.ErrNotAccepted, "a served release is reviewed only when the test says so")
	require.NoError(t, admit(t, world.Policy(newer), newer))
	require.NoError(t, admit(t, world.Policy(newer, uuid), newer), "releases of other modules are not SDK rows and are ignored")

	below := world.PublishSDK("v0.16.0", nil)
	require.ErrorIs(t, admit(t, world.Policy(below), below), devsdk.ErrNotAccepted, "a row never lowers the floor")
	require.Equal(t, table, devsdk.ReviewedReleases(), "the compiled-in table is not edited by a world")
}

func TestWorldServesAndRequiresReleases(t *testing.T) {
	world := sdktest.New(t)
	sdk := world.PublishSDK(devsdk.FloorVersion, nil)
	required := world.PublishRequiring("example.com/helper", "v1.0.0", sdk)
	require.Equal(t, "example.com/helper", required.Module)
	require.Equal(t, "v1.0.0", required.Version)
	require.NotEmpty(t, required.ModuleSum)
	require.NotEmpty(t, required.GoModSum)
	require.DirExists(t, world.Proxy+"/example.com/helper/@v")
}

func TestTempDirRemovesReadOnlyTrees(t *testing.T) {
	var directory string
	t.Run("body", func(t *testing.T) {
		directory = sdktest.TempDir(t)
		locked := filepath.Join(directory, "a", "b")
		require.NoError(t, os.MkdirAll(locked, 0o700))
		require.NoError(t, os.WriteFile(filepath.Join(locked, "file"), []byte("x"), 0o600))
		require.NoError(t, os.Chmod(filepath.Join(locked, "file"), 0o444))
		require.NoError(t, os.Chmod(locked, 0o555))
		require.NoError(t, os.Chmod(filepath.Join(directory, "a"), 0o555))
	})
	require.NoDirExists(t, directory)
}

func TestTempDirSurvivesALateWriter(t *testing.T) {
	var directory string
	t.Run("body", func(t *testing.T) {
		directory = sdktest.TempDir(t)
		go func() {
			// A real concurrent writer that outlives the test body and stops
			// by itself: after 300 ms, or once the directory is gone.
			deadline := time.Now().Add(300 * time.Millisecond)
			for i := 0; time.Now().Before(deadline); i++ {
				if os.WriteFile(filepath.Join(directory, fmt.Sprintf("late-%d", i)), []byte("x"), 0o600) != nil {
					return
				}
				time.Sleep(time.Millisecond)
			}
		}()
	})
	require.NoDirExists(t, directory)
}

func TestHomeTurnsGoTelemetryOff(t *testing.T) {
	home := sdktest.Home(t)
	for _, mode := range []string{
		filepath.Join(home, ".config", "go", "telemetry", "mode"),
		filepath.Join(home, "Library", "Application Support", "go", "telemetry", "mode"),
	} {
		data, err := os.ReadFile(mode)
		require.NoError(t, err)
		require.Equal(t, "off 2024-01-01\n", string(data))
	}
}

func TestWorldRootIsWritableCleaned(t *testing.T) {
	var root string
	t.Run("body", func(t *testing.T) {
		world := sdktest.New(t)
		root = world.Root
		extracted := filepath.Join(world.ModCache, "example.com", "m@v1.0.0")
		require.NoError(t, os.MkdirAll(extracted, 0o700))
		require.NoError(t, os.WriteFile(filepath.Join(extracted, "go.mod"), []byte("module m\n"), 0o444))
		require.NoError(t, os.Chmod(extracted, 0o555))
	})
	require.NoDirExists(t, root)
}
