//go:build darwin || linux

package devworkspace

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestOwnedChildProcessFixture(t *testing.T) {
	mode := os.Getenv("OMNIVIEW_OWNED_CHILD_FIXTURE")
	if mode == "" {
		return
	}
	if mode == "descendant" {
		for {
			time.Sleep(time.Hour)
		}
	}
	command := exec.Command(os.Args[0], "-test.run=^TestOwnedChildProcessFixture$")
	command.Env = append(os.Environ(), "OMNIVIEW_OWNED_CHILD_FIXTURE=descendant")
	if err := command.Start(); err != nil {
		os.Exit(80)
	}
	if err := os.WriteFile(os.Getenv("OMNIVIEW_OWNED_PID_FILE"), []byte(strconv.Itoa(command.Process.Pid)), 0600); err != nil {
		os.Exit(81)
	}
	for {
		if _, err := os.Stat(os.Getenv("OMNIVIEW_OWNED_EXIT_FILE")); err == nil {
			os.Exit(17)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestOwnedTreeCleanupOnHostCrashAndAuthenticatedStop(t *testing.T) {
	for _, crash := range []bool{true, false} {
		t.Run(strconv.FormatBool(crash), func(t *testing.T) {
			root := t.TempDir()
			pidFile := filepath.Join(root, "descendant.pid")
			exitFile := filepath.Join(root, "exit")
			env := append(os.Environ(), "OMNIVIEW_OWNED_CHILD_FIXTURE=parent", "OMNIVIEW_OWNED_PID_FILE="+pidFile, "OMNIVIEW_OWNED_EXIT_FILE="+exitFile)
			owner := devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "host", Source: root}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			child, err := startOwnedChild(ctx, root, env, io.Discard, owner, nil, os.Args[0], "-test.run=^TestOwnedChildProcessFixture$")
			if err != nil {
				t.Fatal(err)
			}
			defer child.stop(context.Background())
			var pid int
			for {
				raw, err := os.ReadFile(pidFile)
				if err == nil {
					pid, err = strconv.Atoi(strings.TrimSpace(string(raw)))
					if err != nil {
						t.Fatal(err)
					}
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-child.done:
					t.Fatal(child.failure())
				case <-time.After(10 * time.Millisecond):
				}
			}
			descendant, err := devsession.CaptureProcess(pid, owner)
			if err != nil {
				t.Fatal(err)
			}
			if crash {
				if err = os.WriteFile(exitFile, []byte("exit"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				if err = child.stop(ctx); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case <-child.done:
			case <-ctx.Done():
				t.Fatal("owned leader was not reaped")
			}
			for {
				err = devsession.VerifyOwnedProcess(descendant, owner)
				if errors.Is(err, devsession.ErrProcessGone) {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				select {
				case <-ctx.Done():
					t.Fatal("owned descendant survived leader cleanup")
				case <-time.After(10 * time.Millisecond):
				}
			}
		})
	}
}
