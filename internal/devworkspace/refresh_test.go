package devworkspace

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func recoveryFixture(t *testing.T) (*Manager, Workspace, *linkJournal) {
	t.Helper()
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "recovery"})
	require.NoError(t, err)
	host := filepath.Join(w.Root, "omniview")
	require.NoError(t, os.WriteFile(filepath.Join(host, "package.json"), []byte(`{"name":"fixture","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}`), 0600))
	for _, name := range []string{"runtime", "providers", "vite-plugin"} {
		path := filepath.Join(host, "packages", "omniviewdev-"+name, "package.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
		require.NoError(t, os.WriteFile(path, []byte(`{"name":"@omniviewdev/`+name+`","version":"1.0.0"}`), 0600))
	}
	require.NoError(t, os.WriteFile(filepath.Join(host, "pnpm-workspace.yaml"), []byte("packages:\n  - packages/*\n"), 0600))
	return m, w, compositionJournalFixture(t, w)
}

func TestRecoverLinksBacksUpChangedBytesBeforeRestore(t *testing.T) {
	m, w, j := recoveryFixture(t)
	path := filepath.Join(w.Root, "omniview", "go.mod")
	original := []byte("module fixture\n\ngo 1.26.0\n\n// one\n// two\n// three\n// four\n// five\n// six\n\nrequire example.com/base v1.0.0\n")
	require.NoError(t, os.WriteFile(path, original, 0600))
	e, err := snapshotLinkFile(w.Root, path)
	require.NoError(t, err)
	e.Applied = []byte("module fixture\n\ngo 1.26.0\nreplace example.com/sdk => ../sdk\n// one\n// two\n// three\n// four\n// five\n// six\n\nrequire example.com/base v1.0.0\n")
	e.AppliedHash = linkHash(e.Applied, true)
	e.Pending = true
	j.Files = append(j.Files, e)
	j.Plan.GoRoots = append(j.Plan.GoRoots, filepath.Dir(path))
	changed := append(append([]byte{}, e.Applied...), []byte("require example.com/user v1.0.0\n")...)
	require.NoError(t, os.WriteFile(path, changed, 0600))
	require.NoError(t, saveLinkJournal(j))
	proof, err := m.ProtocolEvidence(context.Background(), "recovery")
	require.NoError(t, err)
	require.Equal(t, j.Evidence, proof)
	_, err = m.RecoverLinks(context.Background(), "recovery")
	require.NoError(t, err)
	key := linkHash([]byte(e.Path+"\x00"+linkHash(changed, true)), true)
	raw, err := os.ReadFile(filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, key+".json"))
	require.NoError(t, err)
	var backup linkFile
	require.NoError(t, json.Unmarshal(raw, &backup))
	require.Equal(t, changed, backup.Original)
	restored, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, string(original)+"require example.com/user v1.0.0\n", string(restored))
	// A second recovery models a crash after restoration and before unlink.
	_, err = m.RecoverLinks(context.Background(), "recovery")
	require.NoError(t, err)
	rawAgain, err := os.ReadFile(filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, key+".json"))
	require.NoError(t, err)
	require.Equal(t, raw, rawAgain)
}

func TestRefreshRejectsUnknownDurablePhase(t *testing.T) {
	m, w, _ := recoveryFixture(t)
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	require.NoError(t, atomicJSON(path, refreshIntent{WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: "unknown"}))
	_, err := m.Refresh(context.Background(), "recovery", RefreshOptions{})
	require.ErrorContains(t, err, "unknown phase")
}

func TestRecoverLinksPendingAggregateRestoresAbsence(t *testing.T) {
	for _, pending := range []bool{true, false} {
		t.Run(map[bool]string{true: "pending", false: "not-pending"}[pending], func(t *testing.T) {
			m, w, j := recoveryFixture(t)
			var entry *linkFile
			for i := range j.Files {
				if j.Files[i].Path == "pnpm-lock.yaml" {
					entry = &j.Files[i]
				}
			}
			require.NotNil(t, entry)
			require.False(t, entry.OriginalExists)
			entry.Pending = pending
			path := filepath.Join(w.Root, entry.Path)
			changed := []byte("unknown interrupted installer output")
			require.NoError(t, os.WriteFile(path, changed, 0600))
			require.NoError(t, saveLinkJournal(j))
			report, err := m.RecoverLinks(context.Background(), "recovery")
			key := linkHash([]byte(entry.Path+"\x00"+linkHash(changed, true)), true)
			raw, readErr := os.ReadFile(filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, key+".json"))
			require.NoError(t, readErr)
			var backup linkFile
			require.NoError(t, json.Unmarshal(raw, &backup))
			require.Equal(t, changed, backup.Original)
			if !pending {
				require.ErrorContains(t, err, "requires reconciliation")
				active, readErr := os.ReadFile(path)
				require.NoError(t, readErr)
				require.Equal(t, changed, active)
				return
			}
			require.NoError(t, err)
			require.Equal(t, "unlinking", report.Phase)
			require.NoFileExists(t, path)
			_, err = m.RecoverLinks(context.Background(), "recovery")
			require.NoError(t, err, "recovery after restoration must be idempotent")
		})
	}
}

func TestPreserveGeneratedEditsReportsDeletedPath(t *testing.T) {
	w := generatedFixture(t)
	prepared, err := PrepareGeneratedTree(w, "bin", "generation")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(prepared.Directory, "host"), []byte("output"), 0700))
	require.NoError(t, RecordGeneratedTree(prepared))
	require.NoError(t, os.Remove(filepath.Join(prepared.Destination, "host")))
	err = preserveGeneratedEdits(w, t.TempDir())
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, "generated_conflict", failure.Code)
	require.ErrorContains(t, err, "bin/host")
}

func TestRefreshRejectsChangedCapturedTargetsBeforeRecoveryMutation(t *testing.T) {
	m, w, _ := recoveryFixture(t)
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	intent := refreshIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: "update",
		Refs: map[string]string{"omniview": "captured"},
	}
	require.NoError(t, atomicJSON(path, intent))
	before, err := os.ReadFile(path)
	require.NoError(t, err)
	_, err = m.refresh(context.Background(), w.Manifest.Slug, RefreshOptions{}, map[string]string{"omniview": "different"})
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed)
	require.Equal(t, "refresh_intent_mismatch", typed.Code)
	after, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	require.Equal(t, before, after)
}

func TestRefreshConfigurationAcceptsOnlyCapturedProgress(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	upstreamCommit(t, remote, "package.json", `{"name":"changed","packageManager":"pnpm@12.14.0"}`)
	plan, err := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, validateRefreshConfiguration(w.Manifest, &plan))
	progress := w.Manifest
	progress.Repositories = append([]devcontract.Repository(nil), w.Manifest.Repositories...)
	progress.Repositories[0].BaseCommit = plan.Repositories[0].TargetSHA
	require.NoError(t, validateRefreshConfiguration(progress, &plan))
	progress.Repositories[0].Upstream = &devcontract.RepositoryUpstream{Remote: "different", Branch: "refs/heads/main"}
	require.ErrorContains(t, validateRefreshConfiguration(progress, &plan), "configuration differs")
}
