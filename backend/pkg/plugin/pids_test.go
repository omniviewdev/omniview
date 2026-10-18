//go:build !windows

package plugin

import (
	"encoding/json"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

const trackerWorkspace = "9f479dc5-9fd0-4359-915a-ed307fbe5510"

func trackerOwner() devsession.ProcessOwner {
	return devsession.ProcessOwner{WorkspaceID: trackerWorkspace, Generation: "fixture-generation", Role: "plugin-backend", Source: "fixture-source"}
}

func TestPIDTrackerCapturesIdentityAndRemovesCleanOwnedChild(t *testing.T) {
	svc := appstate.NewTestService(t)
	tracker := NewPIDTracker(svc.RootDir())
	child := exec.Command("sleep", "300")
	require.NoError(t, child.Start())
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	require.NoError(t, tracker.RecordOwned("fixture", child.Process.Pid, trackerOwner()))
	require.NoError(t, tracker.Save())
	b, err := svc.RootDir().ReadFile(pluginPIDFileName)
	require.NoError(t, err)
	var records map[string]devcontract.ProcessIdentity
	require.NoError(t, json.Unmarshal(b, &records))
	require.NotEmpty(t, records["fixture"].StartIdentity)
	require.NotEmpty(t, records["fixture"].Executable)
	tracker.Remove("fixture")
	require.NoError(t, tracker.Save())
	b, err = svc.RootDir().ReadFile(pluginPIDFileName)
	require.NoError(t, err)
	require.JSONEq(t, "{}", string(b))
}

func TestPIDTrackerNeverKillsLegacyNumericRecord(t *testing.T) {
	svc := appstate.NewTestService(t)
	child := exec.Command("sleep", "300")
	require.NoError(t, child.Start())
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	b, err := json.Marshal(map[string]int{"foreign": child.Process.Pid})
	require.NoError(t, err)
	require.NoError(t, svc.RootDir().WriteFile(pluginPIDFileName, b, 0600))
	tracker := NewPIDTracker(svc.RootDir())
	tracker.CleanupStale(testLogger(t))
	require.NoError(t, tracker.Save())
	require.NoError(t, syscall.Kill(child.Process.Pid, 0), "legacy numeric recovery killed a live foreign child")
	after, err := svc.RootDir().ReadFile(pluginPIDFileName)
	require.NoError(t, err)
	require.JSONEq(t, string(b), string(after))
}

func TestPIDTrackerOwnedRecoveryCapabilities(t *testing.T) {
	t.Setenv("OMNIVIEW_WORKSPACE_ID", trackerWorkspace)
	svc := appstate.NewTestService(t)
	child := exec.Command("sleep", "300")
	require.NoError(t, child.Start())
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	tracker := NewPIDTracker(svc.RootDir())
	require.NoError(t, tracker.RecordOwned("fixture", child.Process.Pid, trackerOwner()))
	require.NoError(t, tracker.Save())
	NewPIDTracker(svc.RootDir()).CleanupStale(testLogger(t))
	if runtime.GOOS == "darwin" {
		require.NoError(t, syscall.Kill(child.Process.Pid, 0), "unsupported detached recovery must not signal by number")
		b, err := svc.RootDir().ReadFile(pluginPIDFileName)
		require.NoError(t, err)
		require.Contains(t, string(b), "startIdentity")
	} else if runtime.GOOS == "linux" {
		_ = child.Wait()
		require.ErrorIs(t, syscall.Kill(child.Process.Pid, 0), syscall.ESRCH)
	}
}

func TestPIDTrackerRejectsForeignWorkspaceAndMalformedOwnership(t *testing.T) {
	t.Setenv("OMNIVIEW_WORKSPACE_ID", trackerWorkspace)
	svc := appstate.NewTestService(t)
	owner := trackerOwner()
	owner.WorkspaceID = "cf5bd0a4-d197-47fb-8dfe-93bf51fb2c2d"
	record, err := devsession.CaptureProcess(os.Getpid(), owner)
	require.NoError(t, err)
	b, err := json.Marshal(map[string]devcontract.ProcessIdentity{"foreign": record})
	require.NoError(t, err)
	require.NoError(t, svc.RootDir().WriteFile(pluginPIDFileName, b, 0600))
	tracker := NewPIDTracker(svc.RootDir())
	tracker.CleanupStale(testLogger(t))
	require.NoError(t, tracker.Save())
	after, err := svc.RootDir().ReadFile(pluginPIDFileName)
	require.NoError(t, err)
	require.JSONEq(t, string(b), string(after))
	require.Error(t, tracker.RecordOwned("bad", os.Getpid(), devsession.ProcessOwner{}))
}
