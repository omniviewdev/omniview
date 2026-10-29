package devworkspace

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/stretchr/testify/require"
)

func TestRenameDestinationPreservesFilesystemErrorEdges(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "workspaces")
	before := []byte("not a directory; preserve these bytes\n")
	if err := os.WriteFile(parent, before, 0600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(parent, "renamed")
	_, expected := os.Lstat(destination)
	if !errors.Is(expected, syscall.ENOTDIR) {
		t.Fatalf("fixture must produce ENOTDIR: %v", expected)
	}
	manager := &Manager{Root: root}
	_, err := manager.renameDestination("renamed")
	var pathError *os.PathError
	if !errors.Is(err, syscall.ENOTDIR) || !errors.As(err, &pathError) || pathError.Path != destination || pathError.Op != "lstat" {
		t.Errorf("rename destination lost filesystem error: %v", err)
	}
	after, readErr := os.ReadFile(parent)
	if readErr != nil || string(after) != string(before) {
		t.Fatalf("destination inspection changed parent bytes: %q %v", after, readErr)
	}
}

func editOutputFixture(t *testing.T) (*Manager, Workspace, string) {
	t.Helper()
	m, root := fixtureManager(t)
	source := filepath.Join(root, "omniview")
	worker := "ui/providers/monaco/yaml.worker.bundle.js"
	writeGraphFixture(t, filepath.Join(source, worker), "reviewed worker\n")
	writeGraphFixture(t, filepath.Join(source, ".gitignore"), "node_modules/\n")
	writeGraphFixture(t, filepath.Join(source, "package.json"), "{\"name\":\"fixture\",\"private\":true}\n")
	fixtureGit(t, source, "add", ".")
	fixtureGit(t, source, "commit", "-m", "tracked producer output")
	w, err := m.Create(context.Background(), CreateOptions{Slug: "output-edit"})
	require.NoError(t, err)
	return m, w, filepath.Join(w.Root, "omniview")
}

func TestPreflightRenameProjectsCompletedTrackedOutputWithoutMutationEdges(t *testing.T) {
	for _, name := range []string{"owned", "tampered", "staged-original"} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			m, w, host := editOutputFixture(t)
			path := filepath.Join(host, "ui/providers/monaco/yaml.worker.bundle.js")
			if name == "staged-original" {
				writeGraphFixture(t, path, "staged human original\n")
				fixtureGit(t, host, "add", path)
				// A pristine working copy does not erase authored index changes.
				writeGraphFixture(t, path, "reviewed worker\n")
			}
			stage, err := devoutputs.Prepare(ctx, w.ResolvedWorkspace, host, devoutputs.YAMLWorker)
			require.NoError(t, err)
			writeGraphFixture(t, filepath.Join(stage.Directory, "yaml.worker.bundle.js"), "published worker\n")
			require.NoError(t, devoutputs.Publish(ctx, stage))
			if name == "tampered" {
				writeGraphFixture(t, path, "human edited worker\n")
			}
			require.NotEmpty(t, fixtureGit(t, host, "status", "--porcelain=v1"))
			paths := []string{path, w.ManifestPath, filepath.Join(w.Root, ".local", "ownership.json")}
			before := make(map[string][]byte, len(paths))
			for _, path := range paths {
				before[path], err = os.ReadFile(path)
				require.NoError(t, err)
			}
			indexBefore := fixtureGit(t, host, "diff", "--cached", "--binary")
			slug := "renamed-output"
			err = m.PreflightEdit(ctx, w.Manifest.WorkspaceID, EditOptions{Slug: &slug})
			if name == "tampered" {
				require.Error(t, err)
			} else if name == "staged-original" {
				var typed *devcontract.Error
				require.ErrorAs(t, err, &typed)
				require.Equal(t, "dirty_worktree", typed.Code)
			} else {
				require.NoError(t, err, "validated tracked producer bytes are not authored dirt")
			}
			for path, raw := range before {
				after, readErr := os.ReadFile(path)
				require.NoError(t, readErr)
				require.True(t, bytes.Equal(raw, after), "preflight changed %s", path)
			}
			require.Equal(t, indexBefore, fixtureGit(t, host, "diff", "--cached", "--binary"))
			_, statErr := os.Lstat(filepath.Join(m.Root, "workspaces", slug))
			require.True(t, os.IsNotExist(statErr))
		})
	}
}

func TestPreflightRenameRefusesDirtyOriginalBeforeProducerCaptureEdges(t *testing.T) {
	ctx := context.Background()
	m, w, host := editOutputFixture(t)
	path := filepath.Join(host, "ui/providers/monaco/yaml.worker.bundle.js")
	control, err := devoutputs.Prepare(ctx, w.ResolvedWorkspace, host, devoutputs.YAMLWorker)
	require.NoError(t, err, "producer must accept the pristine original before the dirt-only change")
	require.NoError(t, control.Abort(ctx))
	// Retire the control capability so only the dirty original remains.
	require.NoError(t, RestoreRepositoryOutputs(ctx, w))
	journals := map[string][]byte{}
	absent := map[string]bool{}
	for _, journal := range []string{
		w.ManifestPath,
		filepath.Join(w.Root, ".local", "ownership.json"),
		filepath.Join(m.Root, ".omniview-dev", "repository-outputs", w.Manifest.WorkspaceID, "journal.json"),
	} {
		journals[journal], err = os.ReadFile(journal)
		absent[journal] = os.IsNotExist(err)
		if !absent[journal] {
			require.NoError(t, err)
		}
	}
	writeGraphFixture(t, path, "human original must survive\n")
	_, err = devoutputs.Prepare(ctx, w.ResolvedWorkspace, host, devoutputs.YAMLWorker)
	require.Error(t, err, "a real producer cannot capture dirty original bytes")
	slug := "renamed-dirty-original"
	err = m.PreflightEdit(ctx, w.Manifest.WorkspaceID, EditOptions{Slug: &slug})
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed)
	require.Equal(t, "dirty_worktree", typed.Code)
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "human original must survive\n", string(raw))
	for journal, before := range journals {
		after, readErr := os.ReadFile(journal)
		if absent[journal] {
			require.True(t, os.IsNotExist(readErr), "refusal created %s", journal)
			continue
		}
		require.NoError(t, readErr)
		require.Equal(t, before, after, "dirty refusal changed %s", journal)
	}
}

func TestPreflightMetadataAcceptsLiveOwnedIgnoredCacheWriterEdges(t *testing.T) {
	ctx := context.Background()
	m, w, host := editOutputFixture(t)
	install, err := devoutputs.BeginInstall(ctx, w.ResolvedWorkspace, host)
	require.NoError(t, err)
	writeGraphFixture(t, filepath.Join(host, "node_modules/package/index.js"), "installed bytes\n")
	require.NoError(t, install.Finish(ctx))
	writer, err := devoutputs.BeginVite(ctx, w.ResolvedWorkspace, host)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, writer.Finish(ctx)) })
	// The live ownership token must not grant stopped-writer retirement authority.
	require.Error(t, devoutputs.Validate(ctx, w.ResolvedWorkspace))
	var stopped int
	m.options.Stopped = func(context.Context, devcontract.ResolvedWorkspace) error {
		stopped++
		return nil
	}
	name := "Metadata during live cache writes"
	require.NoError(t, m.PreflightEdit(ctx, w.Manifest.WorkspaceID, EditOptions{DisplayName: &name}))
	require.Zero(t, stopped)
	raw, err := os.ReadFile(filepath.Join(host, "node_modules/package/index.js"))
	require.NoError(t, err)
	require.Equal(t, "installed bytes\n", string(raw))
}
