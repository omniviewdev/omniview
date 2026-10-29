//go:build devcontrol && (darwin || linux)

package devworkspace

import (
	"context"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestSourceUpdateSuccessfulBuildCannotCommitFailedPluginReadiness(t *testing.T) {
	for _, stage := range []string{"RPC", "controllers", "Vite"} {
		t.Run(stage, func(t *testing.T) { testSourceUpdateFailedReadiness(t, stage) })
	}
}

func testSourceUpdateFailedReadiness(t *testing.T, stage string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	m, root := fixtureManager(t)
	source := filepath.Join(root, "omniview")
	packageJSON := `{"name":"fixture","private":true,"packageManager":"pnpm@12.14.0",` +
		`"scripts":{"build":"fixture-compiler"}}`
	writeGraphFixture(t, filepath.Join(source, "package.json"), packageJSON)
	for _, name := range []string{"runtime", "providers", "vite-plugin"} {
		path := filepath.Join(source, "packages", "omniviewdev-"+name, "package.json")
		writeGraphFixture(t, path, `{"name":"@omniviewdev/`+name+`","version":"1.0.0"}`)
	}
	writeGraphFixture(t, filepath.Join(source, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n")
	writeGraphFixture(t, filepath.Join(source, ".gitignore"), "dist/\nnode_modules/\n")
	fixtureGit(t, source, "add", ".")
	fixtureGit(t, source, "commit", "-m", "readiness composition")
	w, err := m.Create(ctx, CreateOptions{Slug: "failed-readiness", Plugins: []string{"kubernetes"}})
	require.NoError(t, err)
	evidence := LinkProtocolEvidence{
		Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true,
	}
	_, err = m.Link(ctx, w.Manifest.WorkspaceID, LinkOptions{Evidence: evidence})
	require.NoError(t, err)
	links, err := loadLinkJournal(w)
	require.NoError(t, err)
	old := w.Manifest.Repositories[0]
	writeGraphFixture(t, filepath.Join(source, "README"), "new cohort compiler input\n")
	fixtureGit(t, source, "add", "README")
	fixtureGit(t, source, "commit", "-m", "readiness source target")
	target := fixtureGit(t, source, "rev-parse", "HEAD")
	plan := UpdatePlan{
		WorkspaceID: w.Manifest.WorkspaceID, OperationID: "failed-readiness", Result: "update_available",
		ConfigurationFingerprint: UpdateConfigurationFingerprint(w.Manifest),
	}
	for _, repo := range w.Manifest.Repositories {
		p := RepositoryUpdatePlan{
			ID: repo.ID, OldSHA: repo.BaseCommit, ActualHEAD: repo.BaseCommit,
			TargetSHA: repo.BaseCommit, Classification: "current",
		}
		if repo.ID == old.ID {
			p.TargetSHA, p.Classification = target, "behind"
		}
		plan.Repositories = append(plan.Repositories, p)
	}
	intent := sourceUpdateIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan, Running: true,
		Paths: []string{filepath.Join(w.Root, "omniview", "README")},
	}
	require.NoError(t, saveSourceUpdate(m, w, &intent, sourceUpdatePrepared))
	generation := NewGeneration()
	host := filepath.Join(w.Root, "omniview")
	children := map[string]*ownedChild{}
	for _, role := range []string{"host", "supervisor"} {
		directory := host
		if role == "supervisor" {
			directory = w.Root
		}
		owner := devsession.ProcessOwner{
			WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: role, Source: directory,
		}
		child, startErr := startOwnedChild(
			ctx, directory, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300",
		)
		require.NoError(t, startErr)
		children[role] = child
		t.Cleanup(func() { require.NoError(t, child.stop(context.Background())) })
	}
	profile, err := profileFor(w, m.options.Home, generation)
	require.NoError(t, err)
	descriptor := profile.Descriptor
	descriptor.Process, descriptor.Readiness = children["host"].identity, "host-ready"
	store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	require.NoError(t, err)
	state := devcontrol.DevState{PluginState: devcontract.PluginState{
		ID: "kubernetes", Mode: "managed", Generation: "retained-plugin",
		BuildStatus: "ready", ViteStatus: "ready", RPCStatus: "ready", ControllerStatus: "ready",
	}, Ready: true}
	switch stage {
	case "RPC":
		state.RPCStatus = "error"
	case "controllers":
		state.ControllerStatus = "error"
	case "Vite":
		state.ViteStatus = "error"
	}
	producer := &readinessProducer{states: map[string]devcontrol.DevState{"kubernetes": state}}
	control, err := devcontrol.Start(ctx, devcontrol.Config{
		Descriptor: descriptor, Discovery: store, Adapters: devcontrol.Adapters{
			Inspect: func(context.Context) (devcontract.InstanceDescriptor, error) {
				return descriptor, nil
			},
			Dev: producer, Plugins: struct{ devcontrol.Plugins }{}, Settings: struct{ devcontrol.Settings }{},
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, control.Close(context.Background())) })
	served := map[string]CheckoutStatus{"omniview": {Commit: old.BaseCommit}}
	s := &workspaceSupervisor{
		manager: m, workspace: w, generation: generation, sessionContext: ctx,
		options: LaunchOptions{Timeout: time.Second}, output: io.Discard, children: children,
		status: Status{Workspace: w, Generation: generation, Phase: "ready", ServedCheckouts: served},
	}
	builds := 0
	audits := 0
	graph := &BuildGraph{
		workspace: w, plan: links.Plan, options: BuildOptions{Generation: generation},
		Nodes: []BuildNode{{ID: "fixture-frontend", Kind: "javascript", Directory: host}},
	}
	graph.run = func(ctx context.Context, directory, program string, args ...string) ([]byte, error) {
		if program == "pnpm" {
			audits++
		}
		return linkCommand(context.WithValue(ctx, linkToolchainKey{}, graph), directory, program, args...)
	}
	graph.runProducer = func(
		ctx context.Context, directory string, environment []string, _ string, _ ...string,
	) ([]byte, error) {
		builds++
		script := `tr '[:lower:]' '[:upper:]' < README > "$OMNIVIEW_BUILD_OUTPUT_DIRECTORY/index.js"`
		command := exec.CommandContext(ctx, "/bin/sh", "-c", script)
		command.Dir, command.Env = directory, append(os.Environ(), environment...)
		return command.CombinedOutput()
	}
	s.graphInstance = graph
	token := []byte("failed-readiness-authenticated-supervisor-token")
	server := httptest.NewServer(supervisorHandler(w.Manifest.WorkspaceID, generation, token, s.execute))
	defer server.Close()
	record := supervisorRecord{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation,
		Endpoint:  server.URL + "/v1/supervisor",
		TokenFile: launchPath(w, "supervisor-"+generation+".secret"), Process: children["supervisor"].identity,
	}
	require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
	_, err = m.supervisorCommand(ctx, w.Manifest.WorkspaceID, "source-update")
	require.ErrorContains(t, err, "failed readiness stage")
	require.Equal(t, 1, builds)
	require.Positive(t, audits, "the actual composition audit must run before readiness fails")
	artifact, err := os.ReadFile(filepath.Join(host, "dist", "index.js"))
	require.NoError(t, err)
	require.Equal(t, "NEW COHORT COMPILER INPUT\n", string(artifact))
	status := s.snapshot()
	require.Equal(t, "error", status.Phase)
	require.Equal(t, "plugin:kubernetes:"+stage, status.FailedStage)
	require.Equal(t, served, status.ServedCheckouts)
	require.NotNil(t, status.LastError)
	retained, err := readSourceUpdate(m, s.workspace)
	require.NoError(t, err)
	require.Equal(t, sourceUpdateBuild, retained.Phase)
	require.Equal(t, plan.OperationID, retained.Plan.OperationID)
	require.Equal(t, target, fixtureGit(t, host, "rev-parse", "HEAD"))
	for role, child := range children {
		directory := host
		if role == "supervisor" {
			directory = w.Root
		}
		owner := devsession.ProcessOwner{
			WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: role, Source: directory,
		}
		require.NoError(t, devsession.VerifyOwnedProcess(child.identity, owner))
	}
}
