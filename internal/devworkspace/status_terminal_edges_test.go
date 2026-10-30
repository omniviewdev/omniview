//go:build devcontrol && (darwin || linux)

package devworkspace

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

// The proxy holds a complete authenticated response while the real owner exits.
// Only transport timing changes; process proof and response bytes remain real.
func TestStatusTerminalEdgesOwnerExitsAfterAuthenticatedResponse(t *testing.T) {
	for _, scenario := range []string{"stopped-response", "saved-stopped-proof", "ready-without-proof", "replacement"} {
		t.Run(scenario, func(t *testing.T) {
			m, _ := fixtureManager(t)
			w, err := m.Create(context.Background(), CreateOptions{Slug: "terminal-inspect"})
			require.NoError(t, err)
			owner := startGenerationEdge(t, m, w, NewGeneration(), "", "")
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			token, err := readSupervisorToken(w, owner.record)
			require.NoError(t, err)
			var savedProof Status
			stop := func() {
				stopped, err := callSupervisor(ctx, owner.record, token, supervisorStopCommand)
				require.NoError(t, err)
				require.Equal(t, "stopped", stopped.Phase)
				var saved Status
				require.NoError(t, readLaunchJSON(launchPath(w, "launch-status.json"), &saved))
				require.Equal(t, owner.record.Generation, saved.Generation)
				require.Equal(t, "stopped", saved.Phase)
				savedProof = saved
			}
			if scenario == "stopped-response" || scenario == "replacement" {
				stop()
			}
			target, err := url.Parse(owner.record.Endpoint)
			require.NoError(t, err)
			target.Path = ""
			captured := make(chan error, 1)
			release := make(chan struct{})
			var releaseOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(release) }) }
			proxy := httputil.NewSingleHostReverseProxy(target)
			proxy.ModifyResponse = func(response *http.Response) error {
				body, err := io.ReadAll(response.Body)
				_ = response.Body.Close()
				captured <- err
				if err != nil {
					return err
				}
				response.Body = io.NopCloser(bytes.NewReader(body))
				select {
				case <-release:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			server := httptest.NewServer(proxy)
			defer server.Close()
			defer unblock()
			selected := owner.record
			selected.Endpoint = server.URL + "/v1/supervisor"
			require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), selected))
			done := make(chan generationEdgeOutcome, 1)
			go func() {
				status, err := m.Status(ctx, w.Manifest.WorkspaceID)
				done <- generationEdgeOutcome{status, err}
			}()
			select {
			case err := <-captured:
				require.NoError(t, err)
			case <-ctx.Done():
				t.Fatal("authenticated response did not reach transport gate")
			}
			if scenario == "saved-stopped-proof" {
				stop()
			}
			require.NoError(t, owner.input.Close())
			select {
			case <-owner.child.done:
			case <-ctx.Done():
				t.Fatal("exact owner did not exit")
			}
			require.ErrorIs(t, verifySupervisor(selected, w), devsession.ErrProcessGone)
			var successor *generationEdgeOwner
			if scenario == "replacement" {
				successor = startGenerationEdge(t, m, w, NewGeneration(), "", "")
			}
			unblock()
			result := generationEdgeAwait(t, done)
			if scenario == "replacement" {
				var failure *devcontract.Error
				require.ErrorAs(t, result.err, &failure)
				require.Equal(t, "stale_target", failure.Code)
				require.NoError(t, verifySupervisor(successor.record, w))
			} else {
				require.NoError(t, result.err)
				require.Equal(t, owner.record.Generation, result.status.Generation)
				require.Equal(t, w.Manifest, result.status.Manifest)
				if scenario == "ready-without-proof" {
					require.Equal(t, "crashed", result.status.Phase)
					require.Equal(t, "crashed", result.status.Health.Liveness)
				} else {
					require.Equal(t, "stopped", result.status.Phase)
					require.Equal(t, "stopped", result.status.Health.Liveness)
					require.Equal(t, savedProof.Builds, result.status.Builds)
					require.Equal(t, savedProof.LastError, result.status.LastError)
					require.Equal(t, savedProof.FailedStage, result.status.FailedStage)
					require.Equal(t, savedProof.WaitStage, result.status.WaitStage)
					require.Equal(t, savedProof.RecoveryCommand, result.status.RecoveryCommand)
					require.Equal(t, savedProof.ServedCheckouts, result.status.ServedCheckouts)
				}
			}
			var retained supervisorRecord
			require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &retained))
			if successor != nil {
				require.Equal(t, successor.record, retained)
			} else {
				require.Equal(t, selected, retained)
			}
		})
	}
}
