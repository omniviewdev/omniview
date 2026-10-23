package devserver

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsource"
	"github.com/stretchr/testify/require"
)

type managedSDKSelectionFixture struct {
	source      string
	sdk         string
	revision    string
	goPath      string
	environment []string
}

func cloneSDKSelectionFixture(t *testing.T, source, target string) {
	t.Helper()
	cmd := exec.Command("git", "-c", "core.hooksPath="+t.TempDir(), "clone", "--quiet", "--no-hardlinks", source, target)
	cmd.Env = goBuildEnv(os.Environ())
	output, err := cmd.CombinedOutput()
	require.NoError(t, err, string(output))
}

func managedSDKSelection(t *testing.T) managedSDKSelectionFixture {
	t.Helper()
	_, seed, revision, goPath := sdkSourceFixture(t)
	root, home := t.TempDir(), t.TempDir()
	root, err := filepath.EvalSymlinks(root)
	require.NoError(t, err)
	t.Setenv("HOME", home)
	t.Setenv("GOFLAGS", "")
	t.Setenv("OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES", "0")
	fixture := managedSDKSelectionFixture{source: filepath.Join(root, "plugin"), sdk: filepath.Join(root, "sdk-a"), revision: revision, goPath: goPath}
	cloneSDKSelectionFixture(t, seed, fixture.sdk)
	for _, directory := range []string{fixture.source, filepath.Join(root, "host")} {
		require.NoError(t, os.MkdirAll(directory, 0700))
	}
	require.NoError(t, os.WriteFile(filepath.Join(fixture.source, "go.mod"), []byte(fmt.Sprintf("module fixture\n\ngo 1.24.0\nrequire github.com/omniviewdev/plugin-sdk v0.0.0\nreplace github.com/omniviewdev/plugin-sdk => %q\n", fixture.sdk)), 0600))
	sdkID := "plugin-sdk"
	manifest := devcontract.WorkspaceManifest{
		SchemaVersion: devcontract.SchemaVersion,
		WorkspaceID:   "c1cdd6bf-7db0-4700-9634-0e2ac8a02df4",
		Slug:          "sdk-selection",
		DisplayName:   "SDK selection regression",
		Repositories: []devcontract.Repository{
			{ID: "omniview", Directory: "host", BaseRef: "main", BaseCommit: revision, Branch: "feature/sdk-selection"},
			{ID: sdkID, Directory: "sdk-a", BaseRef: "main", BaseCommit: revision, Branch: "feature/sdk-selection"},
			{ID: "plugin", Directory: "plugin", BaseRef: "main", BaseCommit: revision, Branch: "feature/sdk-selection"},
		},
		Plugins: []devcontract.Plugin{{ID: "fixture", RepositoryID: "plugin", Mode: "managed"}},
		Links:   devcontract.Links{SDKRepositoryID: &sdkID},
		Profile: devcontract.Profile{Kind: "development"},
		Ports:   devcontract.PortPolicy{Policy: "sticky"},
	}
	data, err := json.Marshal(manifest)
	require.NoError(t, err)
	manifestPath := filepath.Join(root, "workspace.json")
	require.NoError(t, os.WriteFile(manifestPath, data, 0600))
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: manifestPath, Home: home})
	require.NoError(t, err, "the regression must use a genuinely validated workspace/profile selection")
	t.Setenv(devcontract.WorkspaceEnvironment, workspace.ManifestPath)
	t.Setenv("OMNIVIEW_WORKSPACE_ID", workspace.Manifest.WorkspaceID)
	t.Setenv("OMNIVIEW_STATE_DIR", workspace.StateRoot)
	fixture.environment = os.Environ()
	return fixture
}

// Removing the directory binding must fail even when both checkouts have the
// same reviewed commit and identical source bytes, with or without core opt-in.
func TestVerifySelectedSDKManagedRejectsUnselectedReviewedCheckout(t *testing.T) {
	for _, allowCoreChanges := range []string{"0", "1"} {
		t.Run("allow-isolation-source-changes="+allowCoreChanges, func(t *testing.T) {
			fixture := managedSDKSelection(t)
			environment := append(fixture.environment, "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES="+allowCoreChanges)
			selected, err := VerifySelectedSDK(context.Background(), fixture.goPath, fixture.source, fixture.revision, environment)
			require.NoError(t, err, "the manifest-selected checkout must remain acceptable")
			canonical, err := filepath.EvalSymlinks(fixture.sdk)
			require.NoError(t, err)
			require.Equal(t, canonical, selected.Directory)
			require.Equal(t, fixture.revision, selected.ReviewedRevision)
			require.Len(t, selected.SourceDigest, 64)

			foreign := filepath.Join(filepath.Dir(fixture.sdk), "sdk-b")
			cloneSDKSelectionFixture(t, fixture.sdk, foreign)
			foreignIdentity, err := devsource.Verify(context.Background(), foreign, fixture.revision)
			require.NoError(t, err, "B must independently pass the real reviewed ancestry and containment-core verifier")
			require.Equal(t, selected.ReviewedRevision, foreignIdentity.ReviewedRevision)
			require.Equal(t, selected.SourceDigest, foreignIdentity.SourceDigest)
			require.NotEqual(t, selected.Directory, foreignIdentity.Directory, "equal revision and bytes do not make two checkouts the same selected source")

			goMod := filepath.Join(fixture.source, "go.mod")
			original, err := os.ReadFile(goMod)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(goMod, []byte(fmt.Sprintf("module fixture\n\ngo 1.24.0\nrequire github.com/omniviewdev/plugin-sdk v0.0.0\nreplace github.com/omniviewdev/plugin-sdk => %q\n", foreign)), 0600))
			_, err = VerifySelectedSDK(context.Background(), fixture.goPath, fixture.source, fixture.revision, environment)
			require.Error(t, err, "real Go resolution of reviewed but unselected SDK B must not inherit workspace A's authority")

			require.NoError(t, os.WriteFile(goMod, original, 0600))
			restored, err := VerifySelectedSDK(context.Background(), fixture.goPath, fixture.source, fixture.revision, environment)
			require.NoError(t, err)
			require.Equal(t, selected, restored, "restoring selected A must preserve its exact source identity")
		})
	}
}

func TestVerifySelectedSDKManagedCoreChangesRequireExplicitConsent(t *testing.T) {
	fixture := managedSDKSelection(t)
	selected, err := VerifySelectedSDK(context.Background(), fixture.goPath, fixture.source, fixture.revision, fixture.environment)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(fixture.sdk, "pkg", "state", "root.go"), []byte("package state\n// deliberate isolation development\n"), 0600))
	_, err = VerifySelectedSDK(context.Background(), fixture.goPath, fixture.source, fixture.revision, fixture.environment)
	require.Error(t, err, "a validated managed profile alone must not authorize isolation-core edits")
	environment := append(fixture.environment, "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES=1")
	dirty, err := VerifySelectedSDK(context.Background(), fixture.goPath, fixture.source, fixture.revision, environment)
	require.NoError(t, err, "explicit consent in the matching validated profile must still permit isolation development")
	require.Equal(t, selected.Directory, dirty.Directory)
	require.Equal(t, selected.ReviewedRevision, dirty.ReviewedRevision)
	require.NotEqual(t, selected.SourceDigest, dirty.SourceDigest)
}

func TestVerifySelectedSDKManagedRejectsProfileIdentityMismatch(t *testing.T) {
	fixture := managedSDKSelection(t)
	for _, override := range []string{
		"OMNIVIEW_WORKSPACE_ID=7595bdf8-c4e9-46fa-b233-ea2bf9d23eca",
		"OMNIVIEW_STATE_DIR=" + t.TempDir(),
	} {
		for _, allowCoreChanges := range []string{"0", "1"} {
			t.Run(override+"/allow-isolation-source-changes="+allowCoreChanges, func(t *testing.T) {
				environment := append(append([]string{}, fixture.environment...), override, "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES="+allowCoreChanges)
				_, err := VerifySelectedSDK(context.Background(), fixture.goPath, fixture.source, fixture.revision, environment)
				require.Error(t, err, "managed source verification must retain the selected profile identity even without core-change opt-in")
			})
		}
	}
}
