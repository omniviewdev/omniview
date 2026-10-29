//go:build devcontrol && (darwin || linux)

package devworkspace

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type preflightRetentionConfig struct {
	Workspace   Workspace `json:"workspace"`
	Home        string    `json:"home"`
	Generation  string    `json:"generation"`
	Cohort      string    `json:"cohort"`
	Diagnostics string    `json:"diagnostics"`
}

// The helper runs real retained owners without building the desktop application.
// Both control readiness and served cohort bytes come from the host child.
func TestUpstreamPreflightRetentionProcess(t *testing.T) {
	mode := os.Getenv("OMNIVIEW_PREFLIGHT_RETENTION_MODE")
	if mode == "" {
		return
	}
	var config preflightRetentionConfig
	require.NoError(t, json.Unmarshal([]byte(os.Getenv("OMNIVIEW_PREFLIGHT_RETENTION_CONFIG")), &config))
	ctx := context.Background()
	w := config.Workspace
	if mode == "supervisor" {
		var stopSignals context.CancelFunc
		ctx, stopSignals = signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
		defer stopSignals()
	}
	diagnostics, diagnosticsErr := os.OpenFile(config.Diagnostics, os.O_APPEND|os.O_WRONLY, 0600)
	require.NoError(t, diagnosticsErr)
	defer diagnostics.Close()
	owner := devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: config.Generation, Role: mode, Source: w.Root,
	}
	if mode == "host" {
		hostSource, sourceErr := w.RepositoryPath("omniview")
		require.NoError(t, sourceErr)
		owner.Source = hostSource
	}
	identity, err := devsession.CaptureProcess(os.Getpid(), owner)
	require.NoError(t, err)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	if mode == "host" {
		profile, profileErr := profileFor(w, config.Home, config.Generation)
		require.NoError(t, profileErr)
		descriptor := profile.Descriptor
		descriptor.Process = identity
		descriptor.Readiness = "host-ready"
		store, storeErr := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
		require.NoError(t, storeErr)
		control, controlErr := devcontrol.Start(ctx, devcontrol.Config{
			Descriptor: descriptor,
			Discovery:  store,
			Adapters: devcontrol.Adapters{
				Inspect:  func(context.Context) (devcontract.InstanceDescriptor, error) { return descriptor, nil },
				Dev:      &readinessProducer{states: map[string]devcontrol.DevState{}},
				Plugins:  struct{ devcontrol.Plugins }{},
				Settings: struct{ devcontrol.Settings }{},
			},
		})
		require.NoError(t, controlErr)
		defer control.Close(ctx)
		require.NoError(t, rawSaveLaunchJSON(launchPath(w, "preflight-host.json"), identity))
		hostURL := []byte("http://" + listener.Addr().String())
		require.NoError(t, os.WriteFile(launchPath(w, "preflight-host.url"), hostURL, 0600))
		handler := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(response, config.Cohort)
		})
		require.NoError(t, http.Serve(listener, handler))
		return
	}
	require.Equal(t, "supervisor", mode)
	environment := append(os.Environ(), "OMNIVIEW_PREFLIGHT_RETENTION_MODE=host")
	owner.Role = "host"
	hostSource, sourceErr := w.RepositoryPath("omniview")
	require.NoError(t, sourceErr)
	owner.Source = hostSource
	host, err := startOwnedChild(ctx, w.Root, environment, diagnostics, owner, nil,
		os.Args[0], "-test.run=^TestUpstreamPreflightRetentionProcess$")
	require.NoError(t, err)
	defer func() { require.NoError(t, host.stop(context.Background())) }()
	s := &workspaceSupervisor{
		workspace:      w,
		generation:     config.Generation,
		manager:        &Manager{options: Options{Home: config.Home}},
		sessionContext: ctx,
		options:        LaunchOptions{Timeout: time.Second},
		output:         io.Discard,
		children:       map[string]*ownedChild{"host": host},
		status:         Status{Workspace: w, Generation: config.Generation, Phase: "ready"},
		exit:           make(chan struct{}),
		sessionCancel:  func() {},
	}
	token := []byte("preflight-retention-authenticated-owner-token")
	record := supervisorRecord{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: config.Generation,
		Endpoint:  "http://" + listener.Addr().String() + "/v1/supervisor",
		TokenFile: launchPath(w, "supervisor-"+config.Generation+".secret"),
		Process:   identity,
	}
	require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
	handler := supervisorHandler(w.Manifest.WorkspaceID, config.Generation, token, s.execute)
	server := &http.Server{Handler: handler, ReadHeaderTimeout: time.Second}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	select {
	case <-ctx.Done():
	case <-s.exit:
	}
	require.NoError(t, s.stopChildren(context.Background()))
	require.NoError(t, server.Close())
	require.ErrorIs(t, <-serveDone, http.ErrServerClosed)
	select {
	case <-host.done:
	default:
		t.Fatal("supervisor cleanup returned before host was reaped")
	}
}

func TestUpstreamFetchFailureKeepsReadyRetainedCohortReachable(t *testing.T) {
	m, w, remote, source := upstreamFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	checkout := filepath.Join(w.Root, w.Manifest.Repositories[0].Directory)
	cohort := fixtureGit(t, checkout, "rev-parse", "HEAD")
	canonical := fixtureGit(t, source, "rev-parse", "HEAD")
	generation := NewGeneration()
	diagnostics, err := os.CreateTemp(t.TempDir(), "preflight-process-*.log")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, diagnostics.Close()) })
	config, err := json.Marshal(preflightRetentionConfig{
		Workspace: w, Home: m.options.Home, Generation: generation, Cohort: cohort, Diagnostics: diagnostics.Name(),
	})
	require.NoError(t, err)
	environment := append(os.Environ(),
		"OMNIVIEW_PREFLIGHT_RETENTION_MODE=supervisor",
		"OMNIVIEW_PREFLIGHT_RETENTION_CONFIG="+string(config))
	owner := devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root,
	}
	var host devcontract.ProcessIdentity
	supervisor, err := startOwnedChild(ctx, w.Root, environment, diagnostics, owner, nil,
		os.Args[0], "-test.run=^TestUpstreamPreflightRetentionProcess$")
	require.NoError(t, err)
	t.Cleanup(func() {
		stopErr := supervisor.stop(context.Background())
		require.NoError(t, stopErr)
		if host.PID != 0 {
			hostOwner := owner
			hostOwner.Role = "host"
			hostOwner.Source = checkout
			require.ErrorIs(t, devsession.VerifyOwnedProcess(host, hostOwner), devsession.ErrProcessGone)
		}
		if t.Failed() {
			logs, logErr := os.ReadFile(diagnostics.Name())
			require.NoError(t, logErr)
			t.Logf("retained process output:\n%s", logs)
		}
	})
	var before Status
	require.Eventually(t, func() bool {
		before, err = m.supervisorCommand(ctx, w.Manifest.WorkspaceID, "status")
		_, endpointErr := os.Stat(launchPath(w, "preflight-host.url"))
		return err == nil && endpointErr == nil && before.Phase == "ready" && before.Instance != nil
	}, 10*time.Second, 20*time.Millisecond)
	raw, err := os.ReadFile(launchPath(w, "preflight-host.json"))
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, &host))
	require.Equal(t, host, before.Instance.Process)
	url, err := os.ReadFile(launchPath(w, "preflight-host.url"))
	require.NoError(t, err)
	client := &http.Client{Timeout: time.Second}
	assertServed := func() {
		t.Helper()
		response, responseErr := client.Get(string(url))
		require.NoError(t, responseErr)
		defer response.Body.Close()
		body, bodyErr := io.ReadAll(response.Body)
		require.NoError(t, bodyErr)
		require.Equal(t, http.StatusOK, response.StatusCode)
		require.Equal(t, cohort, string(body))
	}
	assertServed()
	upstreamCommit(t, remote, "preflight-new.txt", "new upstream cohort\n")
	// Removing the real local transport endpoint forces git fetch to fail.
	require.NoError(t, os.Rename(remote, remote+".offline"))
	result, err := m.Update(ctx, w.Manifest.Slug, UpdateOptions{})
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, "update_blocked", failure.Code)
	require.NotNil(t, result.Plan)
	require.Equal(t, "blocked", result.Plan.Result)
	require.Len(t, result.Plan.Repositories, 1)
	require.Equal(t, "upstream_fetch_failed", result.Plan.Repositories[0].BlockedReason)
	after, err := m.supervisorCommand(ctx, w.Manifest.WorkspaceID, "status")
	require.NoError(t, err)
	require.Equal(t, "ready", after.Phase)
	require.Equal(t, before.Generation, after.Generation)
	require.Equal(t, before.Instance, after.Instance)
	require.NoError(t, devsession.VerifyOwnedProcess(supervisor.identity, owner))
	owner.Role = "host"
	owner.Source = checkout
	require.NoError(t, devsession.VerifyOwnedProcess(host, owner))
	assertServed()
	require.Equal(t, cohort, fixtureGit(t, checkout, "rev-parse", "HEAD"))
	require.Equal(t, canonical, fixtureGit(t, source, "rev-parse", "HEAD"))
	retained, err := m.Inspect(ctx, w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, w.Manifest, retained.Manifest)
	require.NoFileExists(t, sourceUpdatePath(m, w))
	require.NoFileExists(t, filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json"))
}
