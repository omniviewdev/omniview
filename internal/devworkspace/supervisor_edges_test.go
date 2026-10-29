package devworkspace

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The fixture uses real workspace metadata. Locks stand in for an admitted build
// or source transaction, not for a process whose disposal has been established.
func supervisorEdgeFixture(t *testing.T) *workspaceSupervisor {
	t.Helper()
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "supervisor-edges"})
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	generation := NewGeneration()
	return &workspaceSupervisor{
		manager: m, workspace: w, generation: generation,
		status:         Status{Workspace: w, Generation: generation, Phase: "building"},
		sessionContext: ctx, sessionCancel: cancel, output: io.Discard,
		exit: make(chan struct{}),
	}
}

type supervisorEdgeResult struct {
	status Status
	err    error
}

func receiveSupervisorEdge(t *testing.T, result <-chan supervisorEdgeResult) supervisorEdgeResult {
	t.Helper()
	select {
	case value := <-result:
		return value
	case <-time.After(3 * time.Second):
		t.Fatal("supervisor request did not finish after its test barrier was released")
		return supervisorEdgeResult{}
	}
}

func TestSupervisorStatusDuringBlockedStop(t *testing.T) {
	for _, operation := range []string{supervisorStopCommand, supervisorRestartCommand} {
		t.Run(operation, func(t *testing.T) {
			s := supervisorEdgeFixture(t)
			entered := make(chan struct{})
			cancelSession := s.sessionCancel
			s.sessionCancel = func() { cancelSession(); close(entered) }
			s.runMu.Lock()
			var release sync.Once
			unlock := func() { release.Do(s.runMu.Unlock) }
			ctx, cancel := context.WithCancel(context.Background())
			mutation := make(chan supervisorEdgeResult, 1)
			go func() {
				status, err := s.execute(ctx, operation)
				mutation <- supervisorEdgeResult{status, err}
			}()
			defer func() { cancel(); unlock(); receiveSupervisorEdge(t, mutation) }()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("stop never reached the admitted-build barrier")
			}

			token := []byte("supervisor-edge-authenticated-status-capability")
			server := httptest.NewServer(supervisorHandler(s.workspace.Manifest.WorkspaceID, s.generation, token, s.execute))
			// Release operation locks before Close joins handlers, even on failure.
			defer func() { cancel(); unlock(); server.Close() }()
			client := &http.Client{Timeout: time.Second}
			response, err := client.Get(server.URL + "/v1/supervisor")
			require.NoError(t, err)
			require.NoError(t, response.Body.Close())
			require.Equal(t, http.StatusBadRequest, response.StatusCode)
			statusCtx, cancelStatus := context.WithTimeout(context.Background(), time.Second)
			defer cancelStatus()
			status, err := callSupervisor(statusCtx, supervisorRecord{
				WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation,
				Endpoint: server.URL + "/v1/supervisor",
			}, token, supervisorStatusCommand)
			if err != nil {
				t.Errorf("authenticated status became unavailable behind %s waiting for build authority: %v", operation, err)
				return
			}
			require.Equal(t, s.generation, status.Generation)
			require.NotEqual(t, "ready", status.Phase, "an admitted shutdown must not report a ready app")
			require.Equal(t, "build-authority", status.WaitStage, "inspection must expose the current shutdown wait")
			require.Nil(t, status.Instance, "queued shutdown cannot attest host readiness")
		})
	}
}

func TestSupervisorCanceledMutationWaitingForSourceAuthority(t *testing.T) {
	for _, operation := range []string{supervisorStopCommand, supervisorRestartCommand} {
		t.Run(operation, func(t *testing.T) {
			s := supervisorEdgeFixture(t)
			s.sourceMu.Lock()
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			result := make(chan supervisorEdgeResult, 1)
			go func() {
				status, err := s.execute(ctx, operation)
				result <- supervisorEdgeResult{status, err}
			}()
			var value supervisorEdgeResult
			completed := false
			select {
			case value = <-result:
				completed = true
			case <-time.After(time.Second):
				t.Error("canceled mutation remained queued behind source authority")
			}
			s.sourceMu.Unlock()
			if !completed {
				value = receiveSupervisorEdge(t, result)
			}
			require.ErrorIs(t, value.err, context.Canceled)
			require.NoError(t, s.sessionContext.Err(), "a canceled queued request must not later cancel the running session")
			require.Equal(t, "building", s.snapshot().Phase, "a request canceled before admission must not overwrite launch state")
		})
	}
}

func TestSupervisorCanceledMutationWaitingForRunAuthority(t *testing.T) {
	for _, operation := range []string{supervisorStopCommand, supervisorRestartCommand} {
		t.Run(operation, func(t *testing.T) {
			s := supervisorEdgeFixture(t)
			entered := make(chan struct{})
			cancelSession := s.sessionCancel
			s.sessionCancel = func() { cancelSession(); close(entered) }
			s.runMu.Lock()
			ctx, cancel := context.WithCancel(context.Background())
			result := make(chan supervisorEdgeResult, 1)
			go func() {
				status, err := s.execute(ctx, operation)
				result <- supervisorEdgeResult{status, err}
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				cancel()
				s.runMu.Unlock()
				receiveSupervisorEdge(t, result)
				t.Fatal("stop never reached the admitted-build barrier")
			}
			cancel()
			var value supervisorEdgeResult
			completed := false
			select {
			case value = <-result:
				completed = true
			case <-time.After(time.Second):
				t.Error("request cancellation did not release queued run authority")
			}
			s.runMu.Unlock()
			if !completed {
				value = receiveSupervisorEdge(t, result)
			}
			if !errors.Is(value.err, context.Canceled) {
				t.Errorf("canceled run-authority waiter returned %v", value.err)
			}
		})
	}
}
