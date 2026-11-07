package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
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
	worker := filepath.Join(f.host, "ui", "providers", "monaco", "yaml.worker.bundle.js")
	require.NoError(t, os.MkdirAll(filepath.Dir(worker), 0700))
	require.NoError(t, os.WriteFile(worker, []byte("postinstall output"), 0600))
	neighbor := filepath.Join(filepath.Dir(worker), "foreign-neighbor")
	require.NoError(t, os.WriteFile(neighbor, []byte("untouched"), 0600))
	err = devoutputs.Validate(ctx, f.w.ResolvedWorkspace)
	require.Error(t, err)
	payload := workspaceOwnershipError(err, f.w)
	conflict := payload.Details["ownershipConflict"].(*devoutputs.Conflict)
	t.Setenv("OMNIVIEW_OWNERSHIP_REPLAY_HELPER", "1")
	t.Setenv("OMNIVIEW_OWNERSHIP_REPLAY_ROOT", f.m.Root)
	t.Setenv("OMNIVIEW_OWNERSHIP_REPLAY_HOME", f.m.options.Home)
	t.Setenv("OMNIVIEW_OWNERSHIP_REPLAY_WORKSPACE", f.w.Manifest.WorkspaceID)
	t.Cleanup(func() { _, _ = f.m.Down(context.Background(), f.w.Manifest.Slug) })
	launched := false
	for _, argv := range conflict.NextCommands {
		if argv[0] == "/bin/mkdir" {
			require.NoError(t, os.Mkdir(argv[3], 0700))
			t.Cleanup(func() { _ = os.RemoveAll(argv[3]) })
			continue
		}
		switch argv[2] {
		case "ownership":
			_, err = devoutputs.Inspect(ctx, f.w.ResolvedWorkspace, nil)
		case "down":
			_, err = f.m.Down(ctx, f.w.Manifest.Slug)
		case "reset-modules":
			_, err = f.m.resetModules(ctx, f.w.Manifest.Slug, f.run)
		case "reconcile-output":
			var report devoutputs.Reconciliation
			report, err = f.m.ReconcileOutput(ctx, f.w.Manifest.Slug, argv[6], argv[8], argv[10])
			require.NoError(t, err)
			require.True(t, report.RestoredBaseline)
			raw, readErr := os.ReadFile(argv[10])
			require.NoError(t, readErr)
			require.Equal(t, "postinstall output", string(raw))
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
	raw, err := os.ReadFile(neighbor)
	require.NoError(t, err)
	require.Equal(t, "untouched", string(raw))
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

func TestProducerOwnershipRecoveryRetainsRefreshRoute(t *testing.T) {
	f := newResetModulesFixture(t, "plugin-sdk")
	ctx := context.Background()
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	require.NoError(t, saveLaunchJSON(launchPath(f.w, "launch.json"), LaunchOptions{Mode: "browser", LinkEvidence: j.Evidence}))
	path := filepath.Join(f.m.Root, ".omniview-dev", "recovery", f.w.Manifest.WorkspaceID, "refresh.json")
	require.NoError(t, atomicJSON(path, refreshIntent{WorkspaceID: f.w.Manifest.WorkspaceID, Root: f.w.Root, Phase: refreshStart, WasRunning: true, Evidence: j.Evidence, Launch: LaunchOptions{Mode: "browser"}}))
	worker := filepath.Join(f.host, "ui", "providers", "monaco", "yaml.worker.bundle.js")
	require.NoError(t, os.MkdirAll(filepath.Dir(worker), 0700))
	require.NoError(t, os.WriteFile(worker, []byte("postinstall"), 0600))
	inspection, err := InspectOwnership(ctx, f.w)
	require.NoError(t, err)
	var found bool
	for _, entry := range inspection.Entries {
		if entry.Producer != devoutputs.YAMLWorker {
			continue
		}
		require.NotNil(t, entry.Conflict)
		payload := workspaceOwnershipError(entry.Conflict, f.w)
		conflict := payload.Details["ownershipConflict"].(*devoutputs.Conflict)
		require.Equal(t, "recover", conflict.NextCommands[len(conflict.NextCommands)-1][2])
		found = true
	}
	require.True(t, found)
	require.FileExists(t, path, "guidance must not consume retained intent")
}

func TestProducerOwnershipRecoveryRetriesOriginalPreservation(t *testing.T) {
	for _, moved := range []bool{false, true} {
		t.Run(map[bool]string{false: "intent", true: "moved"}[moved], func(t *testing.T) {
			f := newResetModulesFixture(t, "plugin-sdk")
			ctx := context.Background()
			require.NoError(t, os.MkdirAll(filepath.Join(f.host, "ui", "providers", "monaco"), 0700))
			stage, err := devoutputs.Prepare(ctx, f.w.ResolvedWorkspace, f.host, devoutputs.YAMLWorker)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(filepath.Join(stage.Directory, "yaml.worker.bundle.js"), []byte("preserve me"), 0600))
			require.NoError(t, devoutputs.Publish(ctx, stage))
			worker := filepath.Join(f.host, "ui", "providers", "monaco", "yaml.worker.bundle.js")
			parent, err := filepath.EvalSymlinks(t.TempDir())
			require.NoError(t, err)
			require.NoError(t, os.Chmod(parent, 0700))
			destination := filepath.Join(parent, "original")
			destinationID, err := preservationDirectoryIdentity(parent)
			require.NoError(t, err)
			sourceID, err := preservationDirectoryIdentity(filepath.Dir(worker))
			require.NoError(t, err)
			journalPath := filepath.Join(f.m.Root, ".omniview-dev", "repository-outputs", f.w.Manifest.WorkspaceID, "journal.json")
			raw, err := os.ReadFile(journalPath)
			require.NoError(t, err)
			var journal map[string]any
			require.NoError(t, json.Unmarshal(raw, &journal))
			entry := journal["Entries"].(map[string]any)[worker+"|yaml-worker"].(map[string]any)
			entry["Preservation"] = map[string]any{
				"Path": destination, "ParentIdentity": destinationID.Device + ":" + destinationID.FileID,
				"SourceParentIdentity": sourceID.Device + ":" + sourceID.FileID,
				"Before":               entry["Expected"], "Head": fixtureGit(t, f.host, "rev-parse", "HEAD"),
			}
			raw, err = json.Marshal(journal)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(journalPath, raw, 0600))
			if moved {
				require.NoError(t, os.Rename(worker, destination))
			}
			inspection, err := InspectOwnership(ctx, f.w)
			require.NoError(t, err)
			var retried bool
			for _, item := range inspection.Entries {
				if item.Producer != devoutputs.YAMLWorker {
					continue
				}
				require.NotNil(t, item.Conflict)
				payload := workspaceOwnershipError(item.Conflict, f.w)
				conflict := payload.Details["ownershipConflict"].(*devoutputs.Conflict)
				for _, argv := range conflict.NextCommands {
					require.NotEqual(t, "/bin/mkdir", argv[0])
					if argv[2] == "reconcile-output" {
						require.Equal(t, destination, argv[10])
						report, err := f.m.ReconcileOutput(ctx, f.w.Manifest.Slug, argv[6], argv[8], argv[10])
						require.NoError(t, err)
						require.True(t, report.RestoredBaseline)
						retried = true
					}
				}
			}
			require.True(t, retried)
			raw, err = os.ReadFile(destination)
			require.NoError(t, err)
			require.Equal(t, "preserve me", string(raw))
			next, err := devoutputs.Prepare(ctx, f.w.ResolvedWorkspace, f.host, devoutputs.YAMLWorker)
			require.NoError(t, err)
			require.NoError(t, next.Abort(ctx))
		})
	}
}

func TestProducerPreservationBaseRequiresProducerFilesystem(t *testing.T) {
	f := newResetModulesFixture(t)
	base := filepath.Dir(f.m.Root)
	target := filepath.Join(f.host, "ui", "providers", "monaco", "yaml.worker.bundle.js")
	for _, sameDevice := range []bool{false, true} {
		got, err := producerPreservationBase(f.w, target, func(path string) (generatedFileIdentity, error) {
			if path == filepath.Dir(target) {
				return generatedFileIdentity{Device: "producer"}, nil
			}
			require.Equal(t, base, path)
			device := "producer"
			if !sameDevice {
				device = "other"
			}
			return generatedFileIdentity{Device: device}, nil
		})
		if sameDevice {
			require.NoError(t, err)
			require.Equal(t, base, got)
		} else {
			require.ErrorContains(t, err, "different filesystems")
			require.Empty(t, got)
		}
	}
	_, err := producerPreservationBase(f.w, target, func(string) (generatedFileIdentity, error) {
		return generatedFileIdentity{}, errors.New("unavailable")
	})
	require.ErrorContains(t, err, "unavailable")
}
