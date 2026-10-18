//go:build windows

package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestWindowsOwnedJobClosesBeforeInheritedPipeDrain(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "descendant.json")
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	owner := devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "host", Source: exe}
	env := append(os.Environ(), "OMNIVIEW_WINDOWS_PIPE_FIXTURE=parent", "OMNIVIEW_WINDOWS_PIPE_MARKER="+marker)
	child, err := startOwnedChild(ctx, filepath.Dir(exe), env, &childOutput{output: io.Discard}, owner, nil, exe, "-test.run=TestWindowsOwnedPipeFixture")
	if err != nil {
		t.Fatal(err)
	}
	defer child.stop(context.Background())
	select {
	case <-child.done:
	case <-time.After(3 * time.Second):
		t.Fatal("leader exited but Cmd.Wait remained blocked on descendant's inherited pipe")
	}
	var identity devcontract.ProcessIdentity
	data, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &identity); err != nil {
		t.Fatal(err)
	}
	descendantOwner := devsession.ProcessOwner{WorkspaceID: identity.WorkspaceID, Generation: identity.Generation, Role: identity.Role, Source: identity.Source}
	if err = devsession.VerifyOwnedProcess(identity, descendantOwner); !errors.Is(err, devsession.ErrProcessGone) {
		t.Fatalf("owned Job did not dispose actual descendant: %v", err)
	}
}

func TestWindowsOwnedPipeFixture(t *testing.T) {
	role := os.Getenv("OMNIVIEW_WINDOWS_PIPE_FIXTURE")
	if role == "" {
		return
	}
	marker := os.Getenv("OMNIVIEW_WINDOWS_PIPE_MARKER")
	if role == "descendant" {
		exe, _ := os.Executable()
		identity, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: "pipe-descendant", Role: "pipe-descendant", Source: exe})
		if err != nil {
			os.Exit(23)
		}
		data, _ := json.Marshal(identity)
		if os.WriteFile(marker, data, 0600) != nil {
			os.Exit(24)
		}
		time.Sleep(time.Hour)
		os.Exit(0)
	}
	command := exec.Command(os.Args[0], "-test.run=TestWindowsOwnedPipeFixture")
	command.Env = append(os.Environ(), "OMNIVIEW_WINDOWS_PIPE_FIXTURE=descendant")
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if command.Start() != nil {
		os.Exit(25)
	}
	for range 100 {
		if _, err := os.Stat(marker); err == nil {
			os.Exit(0)
		}
		time.Sleep(10 * time.Millisecond)
	}
	os.Exit(26)
}
