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

func TestApplicationBuildCommandFailureDrainsDescendantsAndReportsFailure(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	owner := devsession.ProcessOwner{WorkspaceID: uuid.NewString(), Generation: uuid.NewString(), Role: "application-build-test", Source: root}
	leaf := filepath.Join(root, "leaf.json")
	environment := append(os.Environ(), "OMNIVIEW_COHORT_BUILD_CHILD=fail-with-leaf", "OMNIVIEW_COHORT_BUILD_MARKER="+leaf, "OMNIVIEW_COHORT_BUILD_WORKSPACE="+owner.WorkspaceID, "OMNIVIEW_COHORT_BUILD_GENERATION="+owner.Generation, "OMNIVIEW_COHORT_BUILD_SOURCE="+root)
	reportPath := filepath.Join(root, "execution.json")
	report, err := newApplicationBuildReporter(reportPath, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err = report.stage("compiler", "ordered", func() error {
		_, err := runApplicationBuildCommand(ctx, owner, root, environment, false, os.Args[0], "-test.run=^TestApplicationBuildCommandProcess$")
		return err
	})
	if finishErr := report.finish(err); finishErr != nil {
		t.Fatal(finishErr)
	}
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 17 {
		t.Fatalf("actual failed command exit was not retained: %v", err)
	}
	var identity devcontract.ProcessIdentity
	if err = devsession.ReadPrivateJSON(leaf, &identity); err != nil {
		t.Fatal(err)
	}
	leafOwner := devsession.ProcessOwner{WorkspaceID: owner.WorkspaceID, Generation: owner.Generation, Role: "application-build-test-leaf", Source: root}
	if err = devsession.VerifyOwnedProcess(identity, leafOwner); !errors.Is(err, devsession.ErrProcessGone) {
		t.Fatalf("failed command returned before actual descendant disposal: %v", err)
	}
	var execution applicationBuildReport
	if err = devsession.ReadPrivateJSON(reportPath, &execution); err != nil {
		t.Fatal(err)
	}
	if execution.Succeeded || len(execution.Stages) != 1 || len(execution.Plugins) != 0 {
		t.Fatalf("failed execution report advertised completed artifacts: %+v", execution)
	}
	stage := execution.Stages[0]
	if stage.Status != "failed" || stage.StartedMS < 0 || stage.ElapsedMS < 0 || stage.StartedMS+stage.ElapsedMS > execution.ElapsedMS {
		t.Fatalf("invalid actual failed-command stage report: %+v", stage)
	}
}

// An actual failing native command with a live descendant, not a compiler or
// plugin substitute. The production command owner must drain the orphaned leaf.
func TestApplicationBuildCommandProcess(t *testing.T) {
	mode := os.Getenv("OMNIVIEW_COHORT_BUILD_CHILD")
	if mode == "" {
		return
	}
	marker := os.Getenv("OMNIVIEW_COHORT_BUILD_MARKER")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	switch mode {
	case "fail-with-leaf":
		child := exec.Command(os.Args[0], "-test.run=^TestApplicationBuildCommandProcess$")
		child.Env = append(os.Environ(), "GOWORK=off", "OMNIVIEW_COHORT_BUILD_CHILD=leaf")
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		deadline := time.NewTimer(3 * time.Second)
		defer deadline.Stop()
		ticker := time.NewTicker(5 * time.Millisecond)
		defer ticker.Stop()
		for {
			if _, err := os.Stat(marker); err == nil {
				os.Exit(17)
			}
			select {
			case <-ticker.C:
			case <-deadline.C:
				t.Fatal("actual descendant did not publish readiness")
			case <-signals:
				t.Fatal("failing command canceled before descendant readiness")
			}
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
	default:
		t.Fatal("unknown native process fixture mode")
	}
}
