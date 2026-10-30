//go:build darwin || linux

package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

func TestSupervisorDeadlineEdgesStalledStatusBodyRetainsOwner(t *testing.T) {
	testSupervisorStalledStatusBody(t, false)
}

func TestSupervisorDeadlineEdgesCompleteStatusRequiresBoundedEOF(t *testing.T) {
	testSupervisorStalledStatusBody(t, true)
}

func testSupervisorStalledStatusBody(t *testing.T, complete bool) {
	t.Helper()
	s := supervisorEdgeFixture(t)
	owner := devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: "supervisor", Source: s.workspace.Root}
	identity, err := devsession.CaptureProcess(os.Getpid(), owner)
	require.NoError(t, err)
	token := []byte("stalled-status-body-exact-supervisor-capability")
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+string(token) {
			http.Error(out, "unauthorized", http.StatusUnauthorized)
			return
		}
		out.Header().Set("Content-Type", "application/json")
		if complete {
			_ = json.NewEncoder(out).Encode(map[string]any{"status": s.snapshot()})
		} else {
			_, _ = io.WriteString(out, `{"status":`)
		}
		out.(http.Flusher).Flush()
		close(started)
		select {
		case <-request.Context().Done():
		case <-release:
		}
	}))
	defer func() { releaseOnce.Do(func() { close(release) }); server.Close() }()
	record := supervisorRecord{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation,
		Endpoint: server.URL + "/v1/supervisor", TokenFile: launchPath(s.workspace, "supervisor-"+s.generation+".secret"), Process: identity}
	require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
	require.NoError(t, rawSaveLaunchJSON(launchPath(s.workspace, "supervisor.json"), record))
	before, err := os.ReadFile(launchPath(s.workspace, "supervisor.json"))
	require.NoError(t, err)
	result := make(chan supervisorEdgeResult, 1)
	go func() {
		status, err := s.manager.Status(context.Background(), s.workspace.Manifest.WorkspaceID)
		result <- supervisorEdgeResult{status, err}
	}()
	joined := false
	defer func() {
		releaseOnce.Do(func() { close(release) })
		if !joined {
			receiveSupervisorEdge(t, result)
		}
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("inspection did not reach authenticated response body")
	}
	var observed supervisorEdgeResult
	select {
	case observed = <-result:
	case <-time.After(6 * time.Second):
		t.Error("inspection has no bounded response-body wait without a caller deadline")
		releaseOnce.Do(func() { close(release) })
		observed = receiveSupervisorEdge(t, result)
	}
	joined = true
	var failure *devcontract.Error
	require.True(t, errors.As(observed.err, &failure), "inspection must return a structured timeout: %v", observed.err)
	require.Equal(t, "timeout", failure.Code)
	require.Equal(t, 7, failure.Exit)
	require.NotEqual(t, "ready", observed.status.Phase)
	after, err := os.ReadFile(launchPath(s.workspace, "supervisor.json"))
	require.NoError(t, err)
	require.Equal(t, before, after)
	require.NoError(t, devsession.VerifyOwnedProcess(identity, owner))
}
