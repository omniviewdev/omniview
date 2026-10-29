package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
)

var errPhaseInterrupted = errors.New("interrupt after durable phase write")

// This matrix interrupts actual transaction execution, not synthesized recovery
// intents. Stopped source updates cover every persisted source phase; pinned,
// current and stopped are result classifications, not durable intent phases.
func TestSourceDurablePhaseRecovery(t *testing.T) {
	phases := []string{
		sourceUpdatePrepared, sourceUpdateCheckout, sourceUpdateOverlays, sourceUpdateBuild, sourceUpdateComplete,
	}
	for _, phase := range phases {
		t.Run(phase, func(t *testing.T) {
			m, w, plan := sourcePlanFixture(t, "plugin-sdk")
			assertCanaries := phaseRecoveryCanaries(t, m, w)
			observed := false
			m.afterDurablePhase = func(kind, current string) error {
				if kind == "source" && current == phase {
					observed = true
					return errPhaseInterrupted
				}
				return nil
			}
			_, err := m.applySourceUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
			require.ErrorIs(t, err, errPhaseInterrupted)
			require.True(t, observed)
			retained, err := readSourceUpdate(m, w)
			require.NoError(t, err)
			require.Equal(t, phase, retained.Phase)
			require.Equal(t, plan, retained.Plan)
			assertCanaries()

			// Interrupt recovery again after each subsequent durable transition.
			// Replaying each retained boundary must preserve the immutable cohort.
			m.afterDurablePhase = func(kind, _ string) error {
				if kind == "source" {
					return errPhaseInterrupted
				}
				return nil
			}
			completed := false
			for range len(phases) + 1 {
				result, recoverErr := m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
				assertCanaries()
				if recoverErr == nil {
					require.Equal(t, sourceUpdateComplete, result.Phase)
					completed = true
					break
				}
				require.ErrorIs(t, recoverErr, errPhaseInterrupted)
				retained, err = readSourceUpdate(m, w)
				require.NoError(t, err)
				require.Equal(t, plan, retained.Plan)
			}
			require.True(t, completed, "recovery must terminate without re-resolving upstream")
			require.NoFileExists(t, sourceUpdatePath(m, w))
			_, found, err := m.resumeSourceUpdate(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
			require.NoError(t, err)
			require.False(t, found, "second recovery must not recreate completed intent")
			assertTerminalRecoveryIdempotent(t, m, w)
			assertPhaseRecoveryTargets(t, m, w, plan)
			assertCanaries()
		})
	}
}

// Real native12 installs exercise stop/retire/update/install/start/verify. The
// retained authenticated process below isolates transaction recovery from app
// builds and rendering: its ready response proves supervisor transport only,
// not host/plugin application readiness. No installer or Git operation is mocked.
func TestRefreshDurablePhaseRecovery(t *testing.T) {
	if native := "/opt/homebrew/Cellar/pnpm/12.14.0/bin/pnpm"; os.Getenv("OMNIVIEW_PNPM_EXECUTABLE") == "" {
		// Prefer the installed native binary over an ambient Corepack shim.
		// Elsewhere, use the normal production PATH/configuration selection.
		if _, err := os.Stat(native); err == nil {
			t.Setenv("OMNIVIEW_PNPM_EXECUTABLE", native)
		}
	}
	for _, phase := range []string{"stop", "retire", "update", "install", "start", "verify"} {
		t.Run(phase, func(t *testing.T) { runRefreshPhaseRecovery(t, phase) })
	}
}

func runRefreshPhaseRecovery(t *testing.T, phase string) {
	t.Helper()
	m, w, plan := refreshPhaseFixture(t)
	assertCanaries := phaseRecoveryCanaries(t, m, w)
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	attached := false
	var assertSupervisor func()
	attach := func(current string) {
		if current == "start" && !attached {
			attached = true
			assertSupervisor = phaseRecoverySupervisor(t, m, w)
			writer, err := devoutputs.BeginVite(context.Background(), w.ResolvedWorkspace, filepath.Join(w.Root, "omniview"))
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, writer.Finish(context.Background())) })
			cache := filepath.Join(w.Root, "omniview", "node_modules", ".vite-temp", "live-recovery-cache")
			require.NoError(t, os.MkdirAll(filepath.Dir(cache), 0700))
			require.NoError(t, os.WriteFile(cache, []byte("live cache bytes"), 0600))
		}
	}
	observed := false
	m.afterDurablePhase = func(kind, current string) error {
		if kind != "refresh" {
			return nil
		}
		attach(current)
		if current == phase {
			observed = true
			return errPhaseInterrupted
		}
		return nil
	}
	launch := LaunchOptions{Mode: "browser", ReviewedSDKRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	evidence := LinkProtocolEvidence{
		Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true,
	}
	options := RefreshOptions{Launch: &launch, Evidence: evidence, Restart: true, plan: &plan}
	refs := map[string]string{}
	for _, repository := range plan.Repositories {
		refs[repository.ID] = repository.TargetSHA
	}
	_, err := m.refresh(context.Background(), w.Manifest.WorkspaceID, options, refs)
	require.ErrorIs(t, err, errPhaseInterrupted)
	require.True(t, observed, "must execute target boundary through the real installer")
	var retained refreshIntent
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, &retained))
	require.Equal(t, phase, retained.Phase)
	require.Equal(t, &plan, retained.Plan)
	assertCanaries()

	m.afterDurablePhase = func(kind, current string) error {
		if kind == "refresh" {
			attach(current)
			return errPhaseInterrupted
		}
		return nil
	}
	resumeRefreshPhaseSequence(t, m, w, plan, assertCanaries)
	assertPhaseRecoveryTargets(t, m, w, plan)
	require.True(t, attached)
	assertSupervisor()
	_, err = m.InspectLinks(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	assertTerminalRecoveryIdempotent(t, m, w)
	require.Error(t, devoutputs.Validate(context.Background(), w.ResolvedWorkspace),
		"terminal recovery must not retire the actual live Vite writer")
	assertSupervisor()
	assertCanaries()
}

func resumeRefreshPhaseSequence(t *testing.T, m *Manager, w Workspace, plan UpdatePlan, assertCanaries func()) {
	t.Helper()
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	const durablePhases = 6
	for range durablePhases + 1 {
		result, err := m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
		assertCanaries()
		if err == nil {
			require.Equal(t, "complete", result.Phase)
			require.NoFileExists(t, path)
			return
		}
		require.ErrorIs(t, err, errPhaseInterrupted)
		raw, readErr := os.ReadFile(path)
		require.NoError(t, readErr)
		var retained refreshIntent
		require.NoError(t, json.Unmarshal(raw, &retained))
		require.Equal(t, &plan, retained.Plan)
	}
	t.Fatal("recovery must terminate without resolving a new cohort")
}

func refreshPhaseFixture(t *testing.T) (*Manager, Workspace, UpdatePlan) {
	t.Helper()
	m, root := fixtureManager(t)
	source := filepath.Join(root, "omniview")
	put := func(relative, content string) {
		t.Helper()
		path := filepath.Join(source, relative)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
		require.NoError(t, os.WriteFile(path, []byte(content), 0600))
	}
	put("package.json", `{"name":"phase-host","private":true,"packageManager":"pnpm@12.14.0"}`)
	put("pnpm-workspace.yaml", "packages:\n  - packages/*\n")
	for _, name := range []string{"runtime", "providers", "vite-plugin"} {
		put("packages/omniviewdev-"+name+"/package.json", `{"name":"@omniviewdev/`+name+`","version":"1.0.0"}`)
	}
	fixtureGit(t, source, "add", ".")
	fixtureGit(t, source, "commit", "-m", "seed real native12 composition")
	w, err := m.Create(context.Background(), CreateOptions{Slug: "refresh-phases"})
	require.NoError(t, err)
	put("package.json", `{"name":"phase-host","private":true,`+
		`"description":"captured dependency input change","packageManager":"pnpm@12.14.0"}`)
	fixtureGit(t, source, "add", "package.json")
	fixtureGit(t, source, "commit", "-m", "change captured dependency input")
	plan := UpdatePlan{
		WorkspaceID: w.Manifest.WorkspaceID, OperationID: "refresh-phase-operation", Result: "update_available",
		ConfigurationFingerprint: UpdateConfigurationFingerprint(w.Manifest), DependencyChanged: true,
		Repositories: []RepositoryUpdatePlan{{ID: "omniview", OldSHA: w.Manifest.Repositories[0].BaseCommit,
			ActualHEAD: w.Manifest.Repositories[0].BaseCommit, TargetSHA: fixtureGit(t, source, "rev-parse", "HEAD"),
			Classification: "behind"}},
	}
	return m, w, plan
}

func phaseRecoveryCanaries(t *testing.T, _ *Manager, w Workspace) func() {
	t.Helper()
	path := filepath.Join(w.Root, "authored-phase-canary")
	bytes := []byte("user authored bytes\x00\xff\n")
	require.NoError(t, os.WriteFile(path, bytes, 0640))
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	type sourceCanary struct{ path, head, readme string }
	var sources []sourceCanary
	for _, resource := range j.Resources {
		source := filepath.Dir(resource.CommonDir)
		raw, readErr := os.ReadFile(filepath.Join(source, "README"))
		require.NoError(t, readErr)
		sources = append(sources, sourceCanary{source, fixtureGit(t, source, "rev-parse", "HEAD"), string(raw)})
	}
	return func() {
		t.Helper()
		raw, readErr := os.ReadFile(path)
		require.NoError(t, readErr)
		require.Equal(t, bytes, raw)
		info, statErr := os.Stat(path)
		require.NoError(t, statErr)
		require.Equal(t, os.FileMode(0640), info.Mode().Perm())
		for _, source := range sources {
			require.Equal(t, source.head, fixtureGit(t, source.path, "rev-parse", "HEAD"))
			raw, readErr = os.ReadFile(filepath.Join(source.path, "README"))
			require.NoError(t, readErr)
			require.Equal(t, source.readme, string(raw))
		}
	}
}

func assertPhaseRecoveryTargets(t *testing.T, m *Manager, w Workspace, plan UpdatePlan) {
	t.Helper()
	fresh, err := m.Inspect(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	for _, target := range plan.Repositories {
		for _, resource := range j.Resources {
			if resource.Repository.ID == target.ID {
				require.Equal(t, target.TargetSHA, fixtureGit(t, resource.Path, "rev-parse", "HEAD"))
				require.Equal(t, target.TargetSHA, fixtureGit(t, resource.CommonDir, "rev-parse", resource.Marker))
			}
		}
		for _, repository := range fresh.Manifest.Repositories {
			if repository.ID == target.ID {
				require.Equal(t, target.TargetSHA, repository.BaseCommit)
			}
		}
	}
}

func phaseRecoverySupervisor(t *testing.T, m *Manager, w Workspace) func() {
	t.Helper()
	generation := NewGeneration()
	owner := devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root,
	}
	child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, child.stop(context.Background())) })
	token := []byte("durable-refresh-authenticated-retained-supervisor-token")
	server := httptest.NewServer(supervisorHandler(w.Manifest.WorkspaceID, generation, token,
		func(_ context.Context, command string) (Status, error) {
			if command != supervisorStatusCommand {
				return Status{}, errors.New("phase fixture accepts status only")
			}
			if verifyErr := devsession.VerifyOwnedProcess(child.identity, owner); verifyErr != nil {
				return Status{}, verifyErr
			}
			return Status{Workspace: w, Generation: generation, Phase: "ready"}, nil
		}))
	t.Cleanup(server.Close)
	record := supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation,
		Endpoint: server.URL + "/v1/supervisor", TokenFile: launchPath(w, "supervisor-"+generation+".secret"),
		Process: child.identity}
	require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
	return func() {
		t.Helper()
		require.NoError(t, devsession.VerifyOwnedProcess(child.identity, owner))
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		status, statusErr := m.Status(ctx, w.Manifest.WorkspaceID)
		require.NoError(t, statusErr)
		require.Equal(t, generation, status.Generation)
		require.Equal(t, "ready", status.Phase)
	}
}

func assertTerminalRecoveryIdempotent(t *testing.T, m *Manager, w Workspace) {
	t.Helper()
	before, err := m.Status(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	linkPath := launchPath(w, "links.json")
	linkBytes, linkErr := os.ReadFile(linkPath)
	if linkErr != nil {
		require.True(t, os.IsNotExist(linkErr))
	}
	m.afterDurablePhase = func(kind, phase string) error {
		t.Errorf("completed recovery wrote a new %s/%s intent", kind, phase)
		return errPhaseInterrupted
	}
	for range 2 {
		result, recoverErr := m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{Restart: true})
		require.NoError(t, recoverErr)
		require.Equal(t, "complete", result.Phase)
		require.Equal(t, before.Generation, result.Status.Generation)
		require.Equal(t, before.Phase, result.Status.Phase)
		require.NoFileExists(t, sourceUpdatePath(m, w))
		require.NoFileExists(t, filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json"))
		after, readErr := os.ReadFile(linkPath)
		if linkErr != nil {
			require.True(t, os.IsNotExist(readErr))
		} else {
			require.NoError(t, readErr)
			require.Equal(t, linkBytes, after)
		}
	}
}

func TestRecoverRefusesMalformedOrRedirectedMetadata(t *testing.T) {
	for _, kind := range []string{"source-update.json", "refresh.json", "recover-complete.json"} {
		for _, change := range []string{"malformed", "redirected", "foreign", "unknown-phase"} {
			t.Run(kind+"/"+change, func(t *testing.T) {
				m, w, _ := sourcePlanFixture(t)
				base := filepath.Dir(sourceUpdatePath(m, w))
				require.NoError(t, os.MkdirAll(base, 0700))
				path := filepath.Join(base, kind)
				switch change {
				case "malformed":
					require.NoError(t, os.WriteFile(path, []byte("{"), 0600))
				case "redirected":
					foreign := filepath.Join(t.TempDir(), "foreign-intent")
					require.NoError(t, os.WriteFile(foreign, []byte("{}"), 0600))
					require.NoError(t, os.Symlink(foreign, path))
				default:
					identity, phase := w.Manifest.WorkspaceID, "unknown"
					if change == "foreign" {
						identity, phase = "foreign-workspace", "stop"
					}
					require.NoError(t, atomicJSON(path, map[string]any{
						"workspaceID": identity, "root": w.Root, "phase": phase,
					}))
				}
				before, err := os.ReadFile(path)
				require.NoError(t, err)
				m.afterDurablePhase = func(kind, phase string) error {
					t.Errorf("invalid recovery mutated %s/%s", kind, phase)
					return errPhaseInterrupted
				}
				_, err = m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
				require.Error(t, err)
				after, err := os.ReadFile(path)
				require.NoError(t, err)
				require.Equal(t, before, after)
			})
		}
	}
}

func TestRecoverWithoutTerminalReceiptPreservesInitialUpRefusal(t *testing.T) {
	for _, failedInstall := range []bool{false, true} {
		t.Run(map[bool]string{false: "fresh", true: "failed-install"}[failedInstall], func(t *testing.T) {
			m, w, links := recoveryFixture(t)
			if failedInstall {
				links.Phase = "applying"
				require.NoError(t, saveLinkJournal(links))
			} else {
				require.NoError(t, os.Remove(launchPath(w, "links.json")))
			}
			before, err := os.ReadFile(filepath.Join(w.Root, "workspace.json"))
			require.NoError(t, err)
			_, err = m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
			require.Error(t, err, "missing terminal proof must retain refresh prerequisites, not report completion")
			receiptPath := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "recover-complete.json")
			require.NoFileExists(t, receiptPath)
			after, err := os.ReadFile(filepath.Join(w.Root, "workspace.json"))
			require.NoError(t, err)
			require.Equal(t, before, after)
			status, err := m.Status(context.Background(), w.Manifest.WorkspaceID)
			require.NoError(t, err)
			require.Equal(t, "stopped", status.Phase)
			if failedInstall {
				retained, linkErr := loadLinkJournal(w)
				require.NoError(t, linkErr)
				require.Equal(t, "applying", retained.Phase)
			}
		})
	}
}

func TestTerminalRecoveryReceiptDoesNotAdoptChangedState(t *testing.T) {
	for _, change := range []string{"head", "tracked-edit", "pending-generated", "unfinished-links"} {
		t.Run(change, func(t *testing.T) {
			m, w, plan := sourcePlanFixture(t)
			m.afterDurablePhase = func(kind, phase string) error {
				if kind == "source" && phase == sourceUpdatePrepared {
					return errPhaseInterrupted
				}
				return nil
			}
			_, err := m.applySourceUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
			require.ErrorIs(t, err, errPhaseInterrupted)
			m.afterDurablePhase = nil
			_, err = m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
			require.NoError(t, err)
			receiptPath := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "recover-complete.json")
			before, err := os.ReadFile(receiptPath)
			require.NoError(t, err)
			switch change {
			case "head":
				repo := filepath.Join(w.Root, "omniview")
				require.NoError(t, os.WriteFile(filepath.Join(repo, "README"), []byte("new authored commit\n"), 0600))
				fixtureGit(t, repo, "add", "README")
				fixtureGit(t, repo, "commit", "-m", "new authored work after recovery")
			case "tracked-edit":
				require.NoError(t, os.WriteFile(filepath.Join(w.Root, "omniview", "README"), []byte("new authored bytes\n"), 0600))
			case "pending-generated":
				_, err = PrepareGeneratedTree(w, "bin", NewGeneration())
				require.NoError(t, err)
			case "unfinished-links":
				require.NoError(t, os.WriteFile(launchPath(w, "links.json"), []byte(`{"phase":"applying"}`), 0600))
			}
			m.afterDurablePhase = func(kind, phase string) error {
				t.Errorf("changed terminal state started %s/%s", kind, phase)
				return errPhaseInterrupted
			}
			_, err = m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
			require.Error(t, err)
			after, err := os.ReadFile(receiptPath)
			require.NoError(t, err)
			require.Equal(t, before, after, "recovery must not replace terminal evidence by adopting changed state")
		})
	}
}

func TestReadyRecoveryProofKeepsInstallAndModuleOwnershipStrict(t *testing.T) {
	ctx := context.Background()
	m, root := fixtureManager(t)
	source := filepath.Join(root, "omniview")
	packagePath := filepath.Join(source, "package.json")
	require.NoError(t, os.WriteFile(packagePath, []byte(`{"name":"recovery-proof","private":true}`), 0600))
	fixtureGit(t, source, "add", "package.json")
	fixtureGit(t, source, "commit", "-m", "add actual package consumer")
	w, err := m.Create(ctx, CreateOptions{Slug: "ready-proof"})
	require.NoError(t, err)
	assertSupervisor := phaseRecoverySupervisor(t, m, w)
	repo := filepath.Join(w.Root, "omniview")
	install, err := devoutputs.BeginInstall(ctx, w.ResolvedWorkspace, repo)
	require.NoError(t, err)
	_, status, err := m.recoveryProof(ctx, w.Manifest.WorkspaceID)
	require.Equal(t, "ready", status.Phase)
	require.Error(t, err, "ready proof must refuse an actual active installer")
	require.NoError(t, os.MkdirAll(filepath.Join(repo, "node_modules"), 0700))
	require.NoError(t, install.Finish(ctx))

	writer, err := devoutputs.BeginVite(ctx, w.ResolvedWorkspace, repo)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, writer.Finish(ctx)) })
	cache := filepath.Join(repo, "node_modules", ".vite-temp", "live-cache.mjs")
	require.NoError(t, os.WriteFile(cache, []byte("live cache"), 0600))
	journal := filepath.Join(m.Root, ".omniview-dev", "repository-outputs", w.Manifest.WorkspaceID, "journal.json")
	before, err := os.ReadFile(journal)
	require.NoError(t, err)
	_, status, err = m.recoveryProof(ctx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, "ready", status.Phase)
	after, err := os.ReadFile(journal)
	require.NoError(t, err)
	require.Equal(t, before, after, "ready observation must not adopt live bytes or retire writers")
	require.Error(t, devoutputs.Validate(ctx, w.ResolvedWorkspace))

	foreign := filepath.Join(repo, "node_modules", "foreign.js")
	require.NoError(t, os.WriteFile(foreign, []byte("authored module"), 0600))
	t.Cleanup(func() { require.NoError(t, os.Remove(foreign)) })
	_, _, err = m.recoveryProof(ctx, w.Manifest.WorkspaceID)
	require.Error(t, err, "live cache allowance must not hide foreign immutable modules")
	raw, err := os.ReadFile(foreign)
	require.NoError(t, err)
	require.Equal(t, "authored module", string(raw))
	after, err = os.ReadFile(journal)
	require.NoError(t, err)
	require.Equal(t, before, after, "failed observation must not adopt foreign modules")
	assertSupervisor()
}
