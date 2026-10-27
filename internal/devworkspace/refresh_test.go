package devworkspace

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

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
