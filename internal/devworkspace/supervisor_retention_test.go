//go:build darwin || linux

package devworkspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestSupervisorFailedStopRetainsOwnerAndLeaseForRetry(t *testing.T) {
	for _, canceled := range []bool{true, false} {
		t.Run(map[bool]string{true: "canceled", false: "signal-failed"}[canceled], func(t *testing.T) {
			w := generatedFixture(t)
			home, err := devcontract.CanonicalPath(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			w.StateRoot = filepath.Join(home, ".omniview-dev", "profiles", w.Manifest.WorkspaceID, "state")
			generation := NewGeneration()
			registry, err := devsession.OpenRegistry(filepath.Join(home, "sessions"), devsession.RegistryOptions{})
			if err != nil {
				t.Fatal(err)
			}
			child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "host", Source: w.Root}, nil, "/bin/sleep", "300")
			if err != nil {
				t.Fatal(err)
			}
			stopTree := child.stopTree
			defer func() { child.stopTree = stopTree; _ = child.stop(context.Background()) }()
			lease, err := registry.Reserve(context.Background(), devsession.LeaseRequest{Key: devsession.ServiceKey{WorkspaceID: w.Manifest.WorkspaceID, Role: "browser"}, Owner: child.identity})
			if err != nil {
				t.Fatal(err)
			}
			s := &workspaceSupervisor{workspace: w, generation: generation, manager: &Manager{options: Options{Home: home}}, registry: registry, children: map[string]*ownedChild{"host": child}, leases: map[string]devsession.Lease{"browser": lease}, output: io.Discard, exit: make(chan struct{}), sessionCancel: func() {}}
			ctx := context.Background()
			if canceled {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			} else {
				child.stopTree = func(bool) error { return errors.New("signal denied") }
			}
			status, err := s.execute(ctx, "stop")
			if err == nil || status.Phase == "stopped" {
				t.Fatalf("failed stop reported terminal: %+v %v", status, err)
			}
			if s.children["host"] != child || s.leases["browser"].Key != lease.Key {
				t.Fatal("failed stop discarded retained handle or lease")
			}
			select {
			case <-s.exit:
				t.Fatal("failed stop exited owner")
			default:
			}
			leases, err := registry.List(context.Background(), w.Manifest.WorkspaceID)
			if err != nil || len(leases) != 1 || leases[0].State == devsession.LeaseReleased {
				t.Fatalf("failed stop released capability: %+v %v", leases, err)
			}
			child.stopTree = stopTree
			status, err = s.execute(context.Background(), "stop")
			if err != nil || status.Phase != "stopped" || len(s.children) != 0 || len(s.leases) != 0 {
				t.Fatalf("retry did not cleanly stop: %+v %v", status, err)
			}
			select {
			case <-s.exit:
			default:
				t.Fatal("successful stop retained supervisor")
			}
		})
	}
}

func TestViteFeedbackStopRetainsHandleUntilExactOwnedDisposal(t *testing.T) {
	for _, tamper := range []bool{false, true} {
		t.Run(map[bool]string{false: "owned-metadata", true: "foreign-replacement"}[tamper], func(t *testing.T) {
			g, s, _, path := feedbackWatchFixture(t)
			ctx := context.Background()
			initial := WatchChange{Nodes: []string{"host-backend"}}
			if err := s.beginFeedback(ctx, initial); err != nil {
				t.Fatal(err)
			}
			assertFeedbackHeld(t, s, true, "initial startup before any child")
			if err := s.commitFeedback(ctx, initial); err != nil {
				t.Fatal(err)
			}
			retained := s.feedback.file
			foreign, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if tamper {
				if err := os.Rename(path, path+".retained"); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, foreign, 0600); err != nil {
					t.Fatal(err)
				}
			}
			host, err := g.workspace.RepositoryPath("omniview")
			if err != nil {
				t.Fatal(err)
			}
			child, err := startOwnedChild(ctx, host, s.environment(), io.Discard, devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: "host", Source: host}, nil, "/bin/sleep", "300")
			if err != nil {
				t.Fatal(err)
			}
			s.children = map[string]*ownedChild{"host": child}
			stopTree := child.stopTree
			defer func() { child.stopTree = stopTree; _ = child.stop(ctx) }()
			denied := errors.New("owned group disposal remains unresolved")
			child.stopTree = func(bool) error { return denied }
			if err := s.stopChildren(ctx); !errors.Is(err, denied) {
				t.Fatalf("lost exact-owned disposal failure: %v", err)
			}
			if _, err := retained.Stat(); err != nil || s.feedback.file != retained || s.children["host"] != child || s.ownedCleanupComplete {
				t.Fatalf("uncertain disposal discarded actual ownership: %v", err)
			}
			if !tamper {
				assertFeedbackHeld(t, s, true, "shutdown held before stopping actual child")
			}
			child.stopTree = stopTree
			stopErr := s.stopChildren(ctx)
			if (stopErr != nil) != tamper || !s.ownedCleanupComplete {
				t.Fatalf("confirmed cleanup lost truthful integrity result: complete=%v err=%v", s.ownedCleanupComplete, stopErr)
			}
			select {
			case <-child.done:
			default:
				t.Fatal("feedback handle closed before actual owned child exited")
			}
			if _, err := retained.Stat(); !errors.Is(err, os.ErrClosed) {
				t.Fatalf("actual feedback descriptor remained open after owned cleanup: %v", err)
			}
			if tamper {
				actual, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(actual, foreign) {
					t.Fatalf("shutdown changed foreign feedback metadata: %q: %v", actual, err)
				}
				if err := s.stopChildren(ctx); err != stopErr {
					t.Fatalf("repeated stop erased or changed fixed integrity failure: %v, original %v", err, stopErr)
				}
			} else {
				assertFeedbackHeld(t, s, true, "closed supervisor leaves reconnect held")
			}
		})
	}
}

func TestManagedBridgeFinalizationFailureIsNotTerminalExit(t *testing.T) {
	w := generatedFixture(t)
	generation := NewGeneration()
	owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "host", Source: w.Root}
	host, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
	if err != nil {
		t.Fatal(err)
	}
	defer host.stop(context.Background())
	owner.Role = "plugin-vite"
	finalizeErr := errors.New("writer finalization failed")
	exitFile := filepath.Join(w.Root, "exit")
	child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, owner, func() error { return finalizeErr }, "/bin/sh", "-c", `while [ ! -e "$1" ]; do sleep 0.01; done; exit 17`, "fixture", exitFile)
	if err != nil {
		t.Fatal(err)
	}
	defer child.stop(context.Background())
	if err := os.WriteFile(exitFile, nil, 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-child.done:
	case <-time.After(10 * time.Second):
		t.Fatal("child did not finish")
	}
	record := &managedProcessRecord{id: NewGeneration(), host: host.identity, child: child, output: &managedProcessOutput{}}
	s := &workspaceSupervisor{workspace: w, generation: generation, children: map[string]*ownedChild{"host": host}, hostCaptureReady: make(chan struct{}), managedProcesses: map[string]*managedProcessRecord{record.id: record}}
	close(s.hostCaptureReady)
	token := []byte("retained-process-finalization-authorization")
	server := httptest.NewServer(s.processHandler(token))
	defer server.Close()
	for _, operation := range []string{"status", "wait", "logs", "stop"} {
		request := devsession.ProcessRequest{RequestID: NewGeneration(), WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Host: host.identity, Operation: operation, ProcessID: record.id, TimeoutMS: 1}
		raw, _ := json.Marshal(request)
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/process", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+string(token))
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var result devsession.ProcessResponse
		err = json.NewDecoder(response.Body).Decode(&result)
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if result.Error == nil || (result.Process != nil && !result.Process.Running) {
			t.Fatalf("%s converted unresolved finalization into a terminal exit: %+v", operation, result)
		}
		if s.managedProcesses[record.id] != record {
			t.Fatal("bridge discarded unresolved owner")
		}
	}
}

func TestOwnedChildRetriesFailedFinalizationAfterConfirmedDisposal(t *testing.T) {
	w := generatedFixture(t)
	attempts := 0
	exitFile := filepath.Join(w.Root, "exit")
	child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: NewGeneration(), Role: "vite", Source: w.Root}, func() error {
		attempts++
		if attempts == 1 {
			return errors.New("temporary finalization failure")
		}
		return nil
	}, "/bin/sh", "-c", `while [ ! -e "$1" ]; do sleep 0.01; done; exit 17`, "fixture", exitFile)
	if err != nil {
		t.Fatal(err)
	}
	defer child.stop(context.Background())
	if err := os.WriteFile(exitFile, nil, 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-child.done:
	case <-time.After(10 * time.Second):
		t.Fatal("child did not finish")
	}
	record := &managedProcessRecord{id: NewGeneration(), child: child}
	if status, err := record.status(); err == nil || !status.Running {
		t.Fatalf("unfinalized child appeared terminal: %+v %v", status, err)
	}
	if err := child.stop(context.Background()); err != nil {
		t.Fatalf("finalization retry failed: %v", err)
	}
	if status, err := record.status(); err != nil || status.Running || status.ExitCode != 17 {
		t.Fatalf("confirmed exit lost its original status: %+v %v", status, err)
	}
	if attempts != 2 {
		t.Fatalf("finalization attempts = %d", attempts)
	}
}

func TestSourceUpdateCommandRetainsAuthenticatedSupervisorProcess(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "retained-source-supervisor"})
	if err != nil {
		t.Fatal(err)
	}
	generation := NewGeneration()
	owner := devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root,
	}
	child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if stopErr := child.stop(context.Background()); stopErr != nil {
			t.Errorf("stop supervisor child: %v", stopErr)
		}
	}()
	token := []byte("source-update-retains-authenticated-process-token")
	commands := make(chan string, 2)
	handler := supervisorHandler(w.Manifest.WorkspaceID, generation, token,
		func(_ context.Context, command string) (Status, error) {
			commands <- command
			return Status{Workspace: w, Generation: generation, Phase: "ready"}, nil
		})
	server := httptest.NewServer(handler)
	defer server.Close()
	record := supervisorRecord{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Endpoint: server.URL + "/v1/supervisor",
		TokenFile: launchPath(w, "supervisor-"+generation+".secret"), Process: child.identity,
	}
	if err = os.WriteFile(record.TokenFile, token, 0600); err != nil {
		t.Fatal(err)
	}
	if err = rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := m.supervisorCommand(ctx, w.Manifest.WorkspaceID, "source-update")
	if err != nil || status.Phase != "ready" {
		t.Fatalf("source update waited for supervisor shutdown: %+v %v", status, err)
	}
	if err = devsession.VerifyOwnedProcess(child.identity, owner); err != nil {
		t.Fatalf("source update retired supervisor: %v", err)
	}
	status, err = m.supervisorCommand(ctx, w.Manifest.WorkspaceID, "status")
	if err != nil || status.Phase != "ready" {
		t.Fatalf("retained supervisor cannot serve next request: %+v %v", status, err)
	}
	first, second := <-commands, <-commands
	if first != "source-update" || second != "status" {
		t.Fatalf("unexpected commands: %s, %s", first, second)
	}
	select {
	case <-child.done:
		t.Fatal("source update exited retained supervisor")
	default:
	}
}
