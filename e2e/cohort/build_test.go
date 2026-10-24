//go:build e2eapplication && (darwin || linux)

package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestApplicationBuildBranchesOverlapActualOwnedCommands(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	owner := devsession.ProcessOwner{WorkspaceID: uuid.NewString(), Generation: uuid.NewString(), Role: "application-build-test", Source: root}
	report, err := newApplicationBuildReporter(filepath.Join(root, "execution.json"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	branch := func(name, peer string) func(context.Context) error {
		return func(ctx context.Context) error {
			return report.stage(name, name, func() error {
				environment := append(os.Environ(), "OMNIVIEW_COHORT_BUILD_CHILD=join", "OMNIVIEW_COHORT_BUILD_MARKER="+filepath.Join(root, name), "OMNIVIEW_COHORT_BUILD_PEER="+filepath.Join(root, peer))
				_, err := runApplicationBuildCommand(ctx, owner, root, environment, false, os.Args[0], "-test.run=^TestApplicationBuildCommandProcess$")
				return err
			})
		}
	}
	err = runApplicationBuildBranches(ctx, branch("ordered", "plugin-go"), branch("plugin-go", "ordered"))
	if finishErr := report.finish(err); finishErr != nil {
		t.Fatal(finishErr)
	}
	if err != nil {
		t.Fatalf("the two actual command lifetimes did not overlap: %v", err)
	}
	var execution applicationBuildReport
	if err = devsession.ReadPrivateJSON(filepath.Join(root, "execution.json"), &execution); err != nil {
		t.Fatal(err)
	}
	if !execution.Succeeded || len(execution.Stages) != 2 {
		t.Fatalf("actual execution report missing completed branches: %+v", execution)
	}
	for _, stage := range execution.Stages {
		if stage.Status != "succeeded" || stage.StartedMS < 0 || stage.ElapsedMS < 0 || stage.StartedMS+stage.ElapsedMS > execution.ElapsedMS {
			t.Fatalf("invalid actual wall-clock stage: %+v", stage)
		}
	}
}

func TestApplicationBuildFailureCancelsAndDrainsActualSiblingTree(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	owner := devsession.ProcessOwner{WorkspaceID: uuid.NewString(), Generation: uuid.NewString(), Role: "application-build-test", Source: root}
	leaf := filepath.Join(root, "leaf.json")
	base := append(os.Environ(), "OMNIVIEW_COHORT_BUILD_MARKER="+leaf, "OMNIVIEW_COHORT_BUILD_WORKSPACE="+owner.WorkspaceID, "OMNIVIEW_COHORT_BUILD_GENERATION="+owner.Generation, "OMNIVIEW_COHORT_BUILD_SOURCE="+root)
	reportPath := filepath.Join(root, "execution.json")
	report, err := newApplicationBuildReporter(reportPath, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := func(mode string) func(context.Context) error {
		return func(ctx context.Context) error {
			return report.stage(mode, mode, func() error {
				_, err := runApplicationBuildCommand(ctx, owner, root, append(append([]string{}, base...), "OMNIVIEW_COHORT_BUILD_CHILD="+mode), false, os.Args[0], "-test.run=^TestApplicationBuildCommandProcess$")
				return err
			})
		}
	}
	err = runApplicationBuildBranches(ctx, command("parent"), command("fail"))
	if finishErr := report.finish(err); finishErr != nil {
		t.Fatal(finishErr)
	}
	var execution applicationBuildReport
	if reportErr := devsession.ReadPrivateJSON(reportPath, &execution); reportErr != nil {
		t.Fatal(reportErr)
	}
	if execution.Succeeded || len(execution.Stages) != 2 {
		t.Fatalf("failed execution report did not retain both branches: %+v", execution)
	}
	for _, stage := range execution.Stages {
		if stage.Status != "failed" {
			t.Fatalf("actual failed/canceled branch advertised success: %+v", stage)
		}
	}
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 17 {
		t.Fatalf("first actual compiler failure was not retained: %v", err)
	}
	var identity devcontract.ProcessIdentity
	if err = devsession.ReadPrivateJSON(leaf, &identity); err != nil {
		t.Fatal(err)
	}
	leafOwner := devsession.ProcessOwner{WorkspaceID: owner.WorkspaceID, Generation: owner.Generation, Role: "application-build-test-leaf", Source: root}
	if err = devsession.VerifyOwnedProcess(identity, leafOwner); !errors.Is(err, devsession.ErrProcessGone) {
		t.Fatalf("build returned before actual sibling descendant disposal: %v", err)
	}
}

// An actual native process/tree synchronization fixture, not a plugin/compiler
// substitute. The peer marker makes sequential execution fail rather than pass.
func TestApplicationBuildCommandProcess(t *testing.T) {
	mode := os.Getenv("OMNIVIEW_COHORT_BUILD_CHILD")
	if mode == "" {
		return
	}
	marker := os.Getenv("OMNIVIEW_COHORT_BUILD_MARKER")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	waitFor := func(path string) {
		deadline := time.NewTimer(3 * time.Second)
		defer deadline.Stop()
		ticker := time.NewTicker(5 * time.Millisecond)
		defer ticker.Stop()
		for {
			if _, err := os.Stat(path); err == nil {
				return
			}
			select {
			case <-ticker.C:
			case <-deadline.C:
				t.Fatal("actual peer process did not start concurrently")
			case <-signals:
				t.Fatal("actual process canceled before peer readiness")
			}
		}
	}
	switch mode {
	case "join":
		if err := os.WriteFile(marker, []byte("actual process started"), 0600); err != nil {
			t.Fatal(err)
		}
		waitFor(os.Getenv("OMNIVIEW_COHORT_BUILD_PEER"))
	case "parent":
		child := exec.Command(os.Args[0], "-test.run=^TestApplicationBuildCommandProcess$")
		child.Env = append(os.Environ(), "GOWORK=off", "OMNIVIEW_COHORT_BUILD_CHILD=leaf")
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		<-signals
		if err := child.Wait(); err != nil {
			t.Fatal(err)
		}
	case "leaf":
		owner := devsession.ProcessOwner{WorkspaceID: os.Getenv("OMNIVIEW_COHORT_BUILD_WORKSPACE"), Generation: os.Getenv("OMNIVIEW_COHORT_BUILD_GENERATION"), Role: "application-build-test-leaf", Source: os.Getenv("OMNIVIEW_COHORT_BUILD_SOURCE")}
		identity, err := devsession.CaptureProcess(os.Getpid(), owner)
		if err != nil {
			t.Fatal(err)
		}
		if err = devsession.WritePrivateJSON(marker, identity); err != nil {
			t.Fatal(err)
		}
		<-signals
	case "fail":
		waitFor(marker)
		os.Exit(17)
	default:
		t.Fatal("unknown native process fixture mode")
	}
}
