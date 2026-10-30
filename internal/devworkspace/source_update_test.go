package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcompose"
)

func sourcePlanFixture(t *testing.T, repositories ...string) (*Manager, Workspace, UpdatePlan) {
	t.Helper()
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "source-only", Repositories: repositories})
	require.NoError(t, err)
	plan := UpdatePlan{
		WorkspaceID: w.Manifest.WorkspaceID, OperationID: "captured-operation", Result: "update_available",
		ConfigurationFingerprint: UpdateConfigurationFingerprint(w.Manifest),
	}
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	for _, r := range j.Resources {
		// Commit in the registered source, never in the owned feature checkout.
		source := filepath.Dir(r.CommonDir)
		require.NoError(t, os.WriteFile(filepath.Join(source, "README"), []byte("captured target\n"), 0600))
		fixtureGit(t, source, "add", "README")
		fixtureGit(t, source, "commit", "-m", "captured source change")
		target := fixtureGit(t, source, "rev-parse", "HEAD")
		plan.Repositories = append(plan.Repositories, RepositoryUpdatePlan{
			ID: r.Repository.ID, OldSHA: r.Repository.BaseCommit, ActualHEAD: r.Repository.BaseCommit,
			TargetSHA: target, Classification: "behind",
		})
	}
	return m, w, plan
}

func TestSourceUpdateStoppedNeedsNoLaunchOrProtocolAndDoesNotInstall(t *testing.T) {
	m, w, plan := sourcePlanFixture(t)
	result, err := m.applySourceUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
	require.NoError(t, err)
	require.Equal(t, "complete", result.Phase)
	require.Equal(t, plan.Repositories[0].TargetSHA, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
	require.NoFileExists(t, filepath.Join(w.Root, ".local", "launch.json"))
	require.NoFileExists(t, filepath.Join(w.Root, ".local", "links.json"))
	require.NoDirExists(t, filepath.Join(w.Root, "node_modules"))
	fresh, err := m.Inspect(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, w.Manifest.Repositories[0].BaseRef, fresh.Manifest.Repositories[0].BaseRef)
	require.Equal(t, plan.Repositories[0].TargetSHA, fresh.Manifest.Repositories[0].BaseCommit)
	require.NoFileExists(t, sourceUpdatePath(m, w))
}

func TestSourceUpdateDirtyCohortWritesNoRepository(t *testing.T) {
	m, w, plan := sourcePlanFixture(t, "plugin-sdk")
	last := plan.Repositories[len(plan.Repositories)-1]
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	for _, r := range j.Resources {
		if r.Repository.ID == last.ID {
			require.NoError(t, os.WriteFile(filepath.Join(r.Path, "user-note"), []byte("preserve\n"), 0600))
		}
	}
	_, err = m.applySourceUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
	require.Error(t, err)
	for _, r := range j.Resources {
		require.Equal(t, r.Repository.BaseCommit, fixtureGit(t, r.Path, "rev-parse", "HEAD"))
	}
	require.NoFileExists(t, sourceUpdatePath(m, w))
}

func TestSourceUpdateRejectsChangedConfigurationAndHead(t *testing.T) {
	for _, change := range []string{"configuration", "head"} {
		t.Run(change, func(t *testing.T) {
			m, w, plan := sourcePlanFixture(t)
			if change == "configuration" {
				plan.ConfigurationFingerprint = "different"
			} else {
				path := filepath.Join(w.Root, "omniview")
				require.NoError(t, os.WriteFile(filepath.Join(path, "README"), []byte("user commit\n"), 0600))
				fixtureGit(t, path, "add", "README")
				fixtureGit(t, path, "commit", "-m", "user commit")
			}
			err := m.RevalidateUpdatePlan(context.Background(), w.Manifest.WorkspaceID, plan)
			require.Error(t, err)
			require.NoFileExists(t, sourceUpdatePath(m, w))
		})
	}
}

func TestSourceUpdateRecoveryUsesCapturedTargetAfterUpstreamMoves(t *testing.T) {
	m, w, plan := sourcePlanFixture(t)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	r := &j.Resources[0]
	target := plan.Repositories[0].TargetSHA
	// Model a crash after Git advanced HEAD but before its ownership marker.
	r.RefTarget = target
	require.NoError(t, saveJournal(w.Root, j))
	fixtureGit(t, r.Path, "merge", "--ff-only", target)
	source := filepath.Dir(r.CommonDir)
	require.NoError(t, os.WriteFile(filepath.Join(source, "README"), []byte("later upstream\n"), 0600))
	fixtureGit(t, source, "add", "README")
	fixtureGit(t, source, "commit", "-m", "later upstream")
	intent := sourceUpdateIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan,
		Paths: []string{filepath.Join(r.Path, "README")},
	}
	require.NoError(t, os.MkdirAll(filepath.Dir(sourceUpdatePath(m, w)), 0700))
	require.NoError(t, saveSourceUpdate(m, w, &intent, "checkout"))
	result, found, err := m.resumeSourceUpdate(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
	require.True(t, found)
	require.NoError(t, err)
	require.Equal(t, "complete", result.Phase)
	require.Equal(t, target, fixtureGit(t, r.Path, "rev-parse", "HEAD"))
	require.Equal(t, target, fixtureGit(t, r.CommonDir, "rev-parse", r.Marker))
	require.NotEqual(t, target, fixtureGit(t, source, "rev-parse", "HEAD"))
	require.NoFileExists(t, sourceUpdatePath(m, w))
}

func TestSourceUpdateRecoveryRejectsRedirectedIntent(t *testing.T) {
	m, w, _ := sourcePlanFixture(t)
	path := sourceUpdatePath(m, w)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
	external := filepath.Join(t.TempDir(), "intent.json")
	require.NoError(t, os.WriteFile(external, []byte("{}"), 0600))
	require.NoError(t, os.Symlink(external, path))
	_, found, err := m.resumeSourceUpdate(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
	require.True(t, found)
	require.ErrorContains(t, err, "redirected")
	raw, err := os.ReadFile(external)
	require.NoError(t, err)
	require.Equal(t, "{}", string(raw))
}

func sourceOverlayPlanFixture(t *testing.T) (*Manager, Workspace, UpdatePlan, *linkJournal) {
	t.Helper()
	m, root := fixtureManager(t)
	source := filepath.Join(root, "omniview")
	packageJSON := `{"name":"fixture","private":true,"packageManager":"pnpm@12.14.0",` +
		`"dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}`
	require.NoError(t, os.WriteFile(filepath.Join(source, "package.json"), []byte(packageJSON), 0600))
	for _, name := range []string{"runtime", "providers", "vite-plugin"} {
		path := filepath.Join(source, "packages", "omniviewdev-"+name, "package.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
		require.NoError(t, os.WriteFile(path, []byte(`{"name":"@omniviewdev/`+name+`","version":"1.0.0"}`), 0600))
	}
	require.NoError(t, os.WriteFile(
		filepath.Join(source, "pnpm-workspace.yaml"), []byte("packages:\n  - packages/*\n"), 0600,
	))
	original := []byte("module fixture\n\ngo 1.26.0\n")
	require.NoError(t, os.WriteFile(filepath.Join(source, "go.mod"), original, 0600))
	fixtureGit(t, source, "add", ".")
	fixtureGit(t, source, "commit", "-m", "composition authority")
	w, err := m.Create(context.Background(), CreateOptions{Slug: "overlay-source"})
	require.NoError(t, err)
	links := compositionJournalFixture(t, w)
	path := filepath.Join(w.Root, "omniview", "go.mod")
	file, err := snapshotLinkFile(w.Root, path)
	require.NoError(t, err)
	file.Applied = append(append([]byte{}, original...), []byte("\nreplace example.com/sdk => ../plugin-sdk\n")...)
	file.AppliedHash = linkHash(file.Applied, true)
	require.NoError(t, writeLinkFile(w.Root, file, file.Applied, true))
	links.Files = append(links.Files, file)
	links.Phase = "linked"
	require.NoError(t, saveLinkJournal(links))
	persisted, err := loadLinkJournal(w)
	require.NoError(t, err)
	require.NoError(t, devcompose.CheckInputs(*persisted.Plan.Composition))
	require.NoError(t, os.WriteFile(filepath.Join(source, "README"), []byte("source-only update\n"), 0600))
	fixtureGit(t, source, "add", "README")
	fixtureGit(t, source, "commit", "-m", "source only")
	target := fixtureGit(t, source, "rev-parse", "HEAD")
	repo := w.Manifest.Repositories[0]
	plan := UpdatePlan{
		WorkspaceID: w.Manifest.WorkspaceID, OperationID: "overlay-operation", Result: "update_available",
		ConfigurationFingerprint: UpdateConfigurationFingerprint(w.Manifest),
		Repositories: []RepositoryUpdatePlan{{
			ID: repo.ID, OldSHA: repo.BaseCommit, ActualHEAD: repo.BaseCommit,
			TargetSHA: target, Classification: "behind",
		}},
	}
	return m, w, plan, persisted
}

func TestSourceUpdatePreservesExactSDKOverlayWithoutUnlink(t *testing.T) {
	m, w, plan, persisted := sourceOverlayPlanFixture(t)
	path := filepath.Join(w.Root, "omniview", "go.mod")
	file := persisted.Files[len(persisted.Files)-1]
	require.False(t, plan.DependencyChanged)
	_, err := m.applySourceUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
	require.NoError(t, err)
	applied, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, file.Applied, applied)
	fresh, err := m.Inspect(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	retained, err := loadLinkJournal(fresh)
	require.NoError(t, err)
	require.Equal(t, "linked", retained.Phase)
	manifestPath := "workspace.json"
	oldHash := persisted.Plan.Composition.SourceHashes[manifestPath]
	newHash := retained.Plan.Composition.SourceHashes[manifestPath]
	require.NotEmpty(t, oldHash)
	require.NotEqual(t, oldHash, newHash)
	persisted.Plan.Composition.SourceHashes[manifestPath] = newHash
	require.Equal(t, persisted.Plan, retained.Plan)
	require.NoError(t, devcompose.CheckInputs(*retained.Plan.Composition))
	require.NoDirExists(t, filepath.Join(w.Root, "node_modules"))
	require.Equal(t, persisted.Files, retained.Files)
	require.Equal(t, plan.Repositories[0].TargetSHA, retained.Manifest.Repositories[0].BaseCommit)
	assertSourceCompositionRefusesForeignChanges(t, m, fresh, plan)
}

func TestSourceUpdateAdoptsRebasedCompositionIntoCachedGraph(t *testing.T) {
	m, w, plan, links := sourceOverlayPlanFixture(t)
	graph := &BuildGraph{workspace: w, plan: links.Plan}
	require.NoError(t, devcompose.CheckInputs(*graph.plan.Composition))
	_, err := m.applySourceUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
	require.NoError(t, err)
	fresh, err := m.Inspect(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Error(t, devcompose.CheckInputs(*graph.plan.Composition))
	intent := sourceUpdateIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan, Phase: "build",
	}
	require.NoError(t, graph.adoptSourceComposition(fresh, &intent))
	require.NoError(t, devcompose.CheckInputs(*graph.plan.Composition))
	require.Equal(t, fresh.Manifest, graph.workspace.Manifest)
	retained, err := loadLinkJournal(fresh)
	require.NoError(t, err)
	require.Equal(t, retained.Plan, graph.plan)
	require.NoDirExists(t, filepath.Join(w.Root, "node_modules"))
}

func TestSourceBuildRecoveryRejectsUncapturedCheckoutWithoutLinkJournal(t *testing.T) {
	for _, change := range []string{"head", "marker"} {
		t.Run(change, func(t *testing.T) {
			m, w, plan := sourcePlanFixture(t)
			_, err := m.applySourceUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
			require.NoError(t, err)
			fresh, err := m.Inspect(context.Background(), w.Manifest.WorkspaceID)
			require.NoError(t, err)
			checkout := filepath.Join(w.Root, "omniview")
			expectedHEAD := plan.Repositories[0].TargetSHA
			if change == "head" {
				expectedHEAD = upstreamCommit(t, checkout, "foreign.go", "package foreign\n")
				require.NotEqual(t, expectedHEAD, plan.Repositories[0].TargetSHA)
			} else {
				j, loadErr := loadJournal(w.Root)
				require.NoError(t, loadErr)
				r := j.Resources[0]
				fixtureGit(t, r.CommonDir, "update-ref", r.Marker, plan.Repositories[0].OldSHA)
			}
			intent := sourceUpdateIntent{
				WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan, Phase: "build",
			}
			require.NoError(t, saveSourceUpdate(m, fresh, &intent, "build"))
			intentPath := sourceUpdatePath(m, fresh)
			before, err := os.ReadFile(intentPath)
			require.NoError(t, err)
			_, found, err := m.resumeSourceUpdate(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
			require.True(t, found)
			require.Error(t, err)
			after, err := os.ReadFile(intentPath)
			require.NoError(t, err)
			require.Equal(t, before, after)
			require.Equal(t, expectedHEAD, fixtureGit(t, checkout, "rev-parse", "HEAD"))
			require.NoFileExists(t, filepath.Join(w.Root, ".local", "links.json"))
			require.NoDirExists(t, filepath.Join(w.Root, "node_modules"))
		})
	}
}

func assertSourceCompositionRefusesForeignChanges(t *testing.T, m *Manager, w Workspace, plan UpdatePlan) {
	t.Helper()
	for _, change := range []string{"manifest", "journal-manifest", "dependency-input"} {
		t.Run(change, func(t *testing.T) {
			links, err := loadLinkJournal(w)
			require.NoError(t, err)
			intent := sourceUpdateIntent{
				WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan, Phase: "build",
			}
			switch change {
			case "manifest":
				foreign := w.Manifest
				foreign.DisplayName = "foreign edit"
				require.NoError(t, writeManifest(w.Root, foreign))
				t.Cleanup(func() { require.NoError(t, writeManifest(w.Root, w.Manifest)) })
			case "journal-manifest":
				original := links.Manifest
				links.Manifest.DisplayName = "foreign journal edit"
				require.NoError(t, saveLinkJournal(links))
				t.Cleanup(func() {
					links.Manifest = original
					require.NoError(t, saveLinkJournal(links))
				})
			case "dependency-input":
				path := filepath.Join(w.Root, "omniview", "package.json")
				before, readErr := os.ReadFile(path)
				require.NoError(t, readErr)
				require.NoError(t, os.WriteFile(path, append(before, '\n'), 0600))
				t.Cleanup(func() { require.NoError(t, os.WriteFile(path, before, 0600)) })
			}
			before, err := os.ReadFile(filepath.Join(w.Root, ".local", "links.json"))
			require.NoError(t, err)
			require.Error(t, m.rebaseSourceComposition(context.Background(), w, &intent))
			after, err := os.ReadFile(filepath.Join(w.Root, ".local", "links.json"))
			require.NoError(t, err)
			require.Equal(t, before, after, "refusal must not rewrite captured composition")
		})
	}
}

func TestSourceUpdateRetainedIntentRejectsNewApplyWithoutMutation(t *testing.T) {
	for _, change := range []string{"selection", "configuration", "target", "launch", "same-plan"} {
		t.Run(change, func(t *testing.T) {
			m, w, plan := sourcePlanFixture(t)
			intent := sourceUpdateIntent{WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan}
			require.NoError(t, os.MkdirAll(filepath.Dir(sourceUpdatePath(m, w)), 0700))
			require.NoError(t, saveSourceUpdate(m, w, &intent, "prepared"))
			before, err := os.ReadFile(sourceUpdatePath(m, w))
			require.NoError(t, err)
			request := plan
			request.Repositories = append([]RepositoryUpdatePlan(nil), plan.Repositories...)
			options := UpdateOptions{}
			switch change {
			case "selection":
				request.Repositories = nil
			case "configuration":
				request.ConfigurationFingerprint = "different"
			case "target":
				request.Repositories[0].TargetSHA = request.Repositories[0].OldSHA
			case "launch":
				options.Launch = &LaunchOptions{Mode: "browser", Watch: true}
			}
			result, err := m.applySourceUpdate(context.Background(), w.Manifest.WorkspaceID, request, options)
			require.ErrorContains(t, err, "run workspace recover")
			require.Equal(t, "prepared", result.Phase)
			require.Equal(t, &plan, result.Plan)
			after, err := os.ReadFile(sourceUpdatePath(m, w))
			require.NoError(t, err)
			require.Equal(t, before, after)
			require.Equal(t, plan.Repositories[0].OldSHA, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
		})
	}
}

func TestSourceRecoveryRejectsLaunchOverrideWithoutMutation(t *testing.T) {
	m, w, plan := sourcePlanFixture(t)
	intent := sourceUpdateIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan, Launch: &LaunchOptions{Mode: "native"},
	}
	require.NoError(t, os.MkdirAll(filepath.Dir(sourceUpdatePath(m, w)), 0700))
	require.NoError(t, saveSourceUpdate(m, w, &intent, "prepared"))
	before, err := os.ReadFile(sourceUpdatePath(m, w))
	require.NoError(t, err)
	result, found, err := m.resumeSourceUpdate(
		context.Background(), w.Manifest.WorkspaceID, RefreshOptions{Launch: &LaunchOptions{Mode: "browser"}},
	)
	require.True(t, found)
	require.ErrorContains(t, err, "launch options differ")
	require.Equal(t, &plan, result.Plan)
	require.Equal(t, "prepared", result.Phase)
	after, err := os.ReadFile(sourceUpdatePath(m, w))
	require.NoError(t, err)
	require.Equal(t, before, after)
	require.Equal(t, plan.Repositories[0].OldSHA, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
}

func TestSourceFrontendQuiescenceDoesNotContactOrStopBackendRuntimes(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{
		Slug: "source-frontends", Repositories: []string{"plugin-sdk"}, Plugins: []string{"kubernetes"},
	})
	require.NoError(t, err)
	pluginRoot, err := w.RepositoryPath(w.Manifest.Plugins[0].RepositoryID)
	require.NoError(t, err)
	for _, path := range []string{
		filepath.Join(w.Root, "omniview", "ui", "App.tsx"),
		filepath.Join(w.Root, "omniview", "ui", "style.css"),
		filepath.Join(pluginRoot, "ui", "Component.tsx"),
	} {
		// No manager or control endpoint exists. Any backend control call fails
		// this test instead of silently restarting an unaffected generation.
		supervisor := &workspaceSupervisor{workspace: w}
		ids, quiesceErr := supervisor.quiesceSourceBackends(context.Background(), []string{path})
		require.NoError(t, quiesceErr)
		require.Empty(t, ids)
	}
	require.Equal(t, []string{"kubernetes"},
		affectedSourceBackends(w, []string{filepath.Join(pluginRoot, "pkg", "controller.go")}))
	sdk, err := w.RepositoryPath("plugin-sdk")
	require.NoError(t, err)
	require.Equal(t, []string{"kubernetes"}, affectedSourceBackends(w, []string{filepath.Join(sdk, "pkg", "types.go")}))
}
