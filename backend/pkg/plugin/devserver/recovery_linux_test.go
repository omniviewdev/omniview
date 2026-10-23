//go:build linux

package devserver

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/stretchr/testify/require"
)

func TestViteRecoveryRetainsIdentityWhenSIGTERMIgnored(t *testing.T) {
	allocator := workspacePortAllocatorFixture(t)
	child := exec.Command("sh", "-c", "trap '' TERM; exec sleep 300")
	child.Env = goBuildEnv(os.Environ())
	require.NoError(t, child.Start())
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	owner := devsession.ProcessOwner{WorkspaceID: allocator.owner.WorkspaceID, Generation: "old-generation", Role: "plugin-vite", Source: t.TempDir()}
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
	data, err := json.Marshal(map[string]devcontract.ProcessIdentity{"15173": record})
	require.NoError(t, err)
	require.NoError(t, allocator.stateRoot.WriteFile(devserverPIDFileName, data, 0600))
	allocator.CleanupStaleProcesses(context.Background(), logging.NewNop())
	require.NoError(t, devsession.VerifyOwnedProcess(record, owner))
	retained, err := allocator.stateRoot.ReadFile(devserverPIDFileName)
	require.NoError(t, err)
	require.JSONEq(t, string(data), string(retained), "signal delivery is not confirmed exit")
}
