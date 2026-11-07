package devworkspace

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

// The subprocess serves an authenticated fake supervisor after the real Restart
// path launches this test binary. No host/toolchain dependencies are needed.
func init() {
	if os.Getenv("OMNIVIEW_OWNERSHIP_REPLAY_HELPER") != "1" {
		return
	}
	m, err := Open(os.Getenv("OMNIVIEW_OWNERSHIP_REPLAY_ROOT"), Options{Home: os.Getenv("OMNIVIEW_OWNERSHIP_REPLAY_HOME"), Stopped: RequireStopped})
	if err != nil {
		os.Exit(20)
	}
	w, err := m.Inspect(context.Background(), os.Getenv("OMNIVIEW_OWNERSHIP_REPLAY_WORKSPACE"))
	if err != nil {
		os.Exit(21)
	}
	launch, err := LoadLaunchOptions(w)
	if err != nil || launch.Mode != "browser" || !launch.Watch || !launch.LiveFrontend {
		os.Exit(22)
	}
	generation := NewGeneration()
	identity, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root})
	if err != nil {
		os.Exit(23)
	}
	token := []byte("ownership-replay-authenticated-test-supervisor-token")
	server := httptest.NewServer(supervisorHandler(w.Manifest.WorkspaceID, generation, token, func(_ context.Context, command string) (Status, error) {
		phase := "ready"
		if command == supervisorStopCommand || command == supervisorRestartCommand {
			phase = "stopped"
			go func() { time.Sleep(100 * time.Millisecond); os.Exit(0) }()
		}
		return Status{Workspace: w, Generation: generation, Phase: phase}, nil
	}))
	record := supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Endpoint: server.URL + "/v1/supervisor", TokenFile: launchPath(w, "supervisor-"+generation+".secret"), Process: identity}
	if os.WriteFile(record.TokenFile, token, 0600) != nil {
		os.Exit(24)
	}
	if rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record) != nil {
		os.Exit(25)
	}
	select {}
}

func TestInitialUpOwnershipGuidanceReplaysSavedLaunch(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	f := newResetModulesFixture(t, "plugin-sdk")
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	j.Phase = "applying"
	require.NoError(t, saveLinkJournal(j))
	launch := LaunchOptions{Mode: "browser", Watch: true, LiveFrontend: true, Timeout: 10 * time.Second, LinkEvidence: j.Evidence}
	require.NoError(t, saveLaunchJSON(launchPath(f.w, "launch.json"), launch))
	require.NoError(t, os.WriteFile(filepath.Join(f.w.Root, "node_modules", "foreign"), []byte("unowned install"), 0600))
	payload := workspaceOwnershipError(&devoutputs.Conflict{Producer: "modules"}, f.w)
	conflict := payload.Details["ownershipConflict"].(*devoutputs.Conflict)
	t.Setenv("OMNIVIEW_OWNERSHIP_REPLAY_HELPER", "1")
	t.Setenv("OMNIVIEW_OWNERSHIP_REPLAY_ROOT", f.m.Root)
	t.Setenv("OMNIVIEW_OWNERSHIP_REPLAY_HOME", f.m.options.Home)
	t.Setenv("OMNIVIEW_OWNERSHIP_REPLAY_WORKSPACE", f.w.Manifest.WorkspaceID)
	t.Cleanup(func() { _, _ = f.m.Down(context.Background(), f.w.Manifest.Slug) })
	launched := false
	for _, argv := range conflict.NextCommands {
		switch argv[2] {
		case "ownership":
			_, err = devoutputs.Inspect(ctx, f.w.ResolvedWorkspace, nil)
		case "down":
			_, err = f.m.Down(ctx, f.w.Manifest.Slug)
		case "reset-modules":
			_, err = f.m.ResetModules(ctx, f.w.Manifest.Slug)
		case "recover":
			_, err = f.m.Recover(ctx, f.w.Manifest.Slug, RefreshOptions{})
		case "restart":
			// Fake supervisor substitutes only runtime startup; replay and receipt
			// handling still run through the same manager transaction used by Link.
			_, err = f.m.link(ctx, f.w.Manifest.Slug, LinkOptions{Evidence: j.Evidence}, f.run)
			require.NoError(t, err)
			var status Status
			status, err = f.m.Restart(ctx, f.w.Manifest.Slug)
			require.Equal(t, "ready", status.Phase)
			launched = true
		default:
			t.Fatalf("unexpected recovery action: %v", argv)
		}
		require.NoError(t, err, "%v", argv)
	}
	require.True(t, launched, "recovery sequence stopped without replaying saved launch")
	saved, err := LoadLaunchOptions(f.w)
	require.NoError(t, err)
	require.Equal(t, launch, saved)
}

func TestUnlinkingOwnershipGuidanceCompletesInterruptedTeardown(t *testing.T) {
	for _, savedLaunch := range []bool{false, true} {
		t.Run(map[bool]string{false: "without-launch", true: "saved-launch"}[savedLaunch], func(t *testing.T) {
			ctx := context.Background()
			f := newResetModulesFixture(t)
			if savedLaunch {
				j, err := loadLinkJournal(f.w)
				require.NoError(t, err)
				require.NoError(t, saveLaunchJSON(launchPath(f.w, "launch.json"), LaunchOptions{
					Mode: "browser", Watch: true, LiveFrontend: true,
					Timeout: 10 * time.Second, LinkEvidence: j.Evidence,
				}))
			}
			foreign := filepath.Join(f.w.Root, "node_modules", "foreign")
			require.NoError(t, os.WriteFile(foreign, []byte("unowned install"), 0600))
			_, err := f.m.Unlink(ctx, f.w.Manifest.Slug)
			require.Error(t, err)
			payload := workspaceOwnershipError(err, f.w)
			conflict := payload.Details["ownershipConflict"].(*devoutputs.Conflict)
			require.Equal(t, "unlinking", conflict.LifecyclePhase)
			var actions []string
			for _, argv := range conflict.NextCommands {
				actions = append(actions, argv[2])
				switch argv[2] {
				case "ownership":
					_, err = devoutputs.Inspect(ctx, f.w.ResolvedWorkspace, nil)
				case "down":
					_, err = f.m.Down(ctx, f.w.Manifest.Slug)
				case "reset-modules":
					var report ResetModulesReport
					report, err = f.m.ResetModules(ctx, f.w.Manifest.Slug)
					require.False(t, report.Reinstalled)
				case "unlink":
					var report LinkReport
					report, err = f.m.Unlink(ctx, f.w.Manifest.Slug)
					require.Equal(t, "unlinked", report.Phase)
				default:
					t.Fatalf("unexpected teardown recovery action: %v", argv)
				}
				require.NoError(t, err, "%v", argv)
			}
			require.Equal(t, []string{"ownership", "down", "reset-modules", "unlink"}, actions)
			require.Equal(t, 1, f.installs, "teardown must not reinstall dependencies")
			require.NoFileExists(t, foreign)
			_, err = loadLinkJournal(f.w)
			require.True(t, os.IsNotExist(err), "unlink must retire its interrupted journal")
			require.NoError(t, devoutputs.Validate(ctx, f.w.ResolvedWorkspace))
		})
	}
}
