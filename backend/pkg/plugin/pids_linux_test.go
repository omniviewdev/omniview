//go:build linux

package plugin

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

func TestBackendRecoveryRetainsIdentityWhenSIGTERMIgnored(t *testing.T) {
	t.Setenv("OMNIVIEW_WORKSPACE_ID", trackerWorkspace)
	service := appstate.NewTestService(t)
	child := exec.Command("sh", "-c", "trap '' TERM; exec sleep 300")
	child.Env = append(os.Environ(), "GOWORK=off")
	require.NoError(t, child.Start())
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	owner := trackerOwner()
	var record devcontract.ProcessIdentity
	deadline := time.Now().Add(2 * time.Second)
	for {
		var err error
		record, err = devsession.CaptureProcess(child.Process.Pid, owner)
		if err == nil && filepath.Base(record.Executable) == "sleep" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("child did not exec sleep: %+v %v", record, err)
		}
		time.Sleep(time.Millisecond)
	}
	data, err := json.Marshal(map[string]devcontract.ProcessIdentity{"ignores-term": record})
	require.NoError(t, err)
	require.NoError(t, service.RootDir().WriteFile(pluginPIDFileName, data, 0600))
	tracker := NewPIDTracker(service.RootDir())
	tracker.CleanupStale(testLogger(t))
	require.NoError(t, devsession.VerifyOwnedProcess(record, owner), "fixture must actually survive the delivered SIGTERM")
	require.ErrorContains(t, tracker.CheckAvailable("ignores-term", owner.WorkspaceID), "recovery is incomplete", "the pre-exec gate must reject the live survivor")
	retained, err := service.RootDir().ReadFile(pluginPIDFileName)
	require.NoError(t, err)
	require.JSONEq(t, string(data), string(retained))
	require.Error(t, tracker.RecordOwned("ignores-term", os.Getpid(), owner), "a second backend must not overwrite the still-live orphan's record")
}
