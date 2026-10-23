package instance

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestLegacyArtifactBlockedAndTrustedDigestChecked(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("trusted fixture executable"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := VerifyPluginArtifact(workspace, "kubernetes", binary); err == nil {
		t.Fatal("preflight allowed legacy executable without trusted record")
	}
	if _, _, err := PreparePluginArtifact(workspace, "kubernetes", binary); err == nil {
		t.Fatal("legacy executable allowed without trusted record")
	}
	revision := strings.Repeat("a", 40)
	if err := RecordBuiltArtifactSource(workspace, "kubernetes", binary, revision, strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	if err := VerifyPluginArtifact(workspace, "kubernetes", binary); err != nil {
		t.Fatal(err)
	}
	prepared, cleanup, err := PreparePluginArtifact(workspace, "kubernetes", binary)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if prepared == binary {
		t.Fatal("mutable installed executable used directly")
	}
	if err := os.WriteFile(binary, []byte("replaced fixture executable"), 0700); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(prepared)
	if err != nil || string(bytes) != "trusted fixture executable" {
		t.Fatal("verified bytes changed with installation")
	}
	if _, _, err := PreparePluginArtifact(workspace, "kubernetes", binary); err == nil {
		t.Fatal("changed executable passed attestation")
	}
}

func TestArtifactRecordsRejectTraversalAndUnresolvedRevision(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ id, revision string }{{"../foreign", strings.Repeat("a", 40)}, {"plugin", "main"}, {"plugin", ""}} {
		if err := RecordBuiltArtifactSource(workspace, tc.id, binary, tc.revision, strings.Repeat("b", 64)); err == nil {
			t.Fatalf("accepted invalid trusted record %+v", tc)
		}
	}
}

func TestArtifactEvidenceCannotUseRemappedProfileAsState(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	profile := filepath.Dir(workspace.StateRoot)
	if err := os.MkdirAll(profile, 0700); err != nil {
		t.Fatal(err)
	}
	stateAlias := filepath.Join(profile, "state")
	if err := os.Symlink(profile, stateAlias); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("trusted fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{stateAlias, profile} {
		selected := workspace
		selected.StateRoot = root
		if err := RecordBuiltArtifactSource(selected, "plugin", binary, strings.Repeat("a", 40), strings.Repeat("b", 64)); err == nil {
			t.Fatal("remapped state created trusted record outside its UUID boundary")
		}
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(profile), "runtime")); !os.IsNotExist(err) {
		t.Fatal("trusted record created shared parent runtime")
	}
}

func TestTrustedArtifactRequiresSourceSnapshotIdentity(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("trusted source fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	revision := strings.Repeat("a", 40)
	digest := strings.Repeat("b", 64)
	for _, invalid := range []string{"", "branch", strings.Repeat("b", 63), strings.Repeat("B", 64)} {
		if err := RecordBuiltArtifactSource(workspace, "plugin", binary, revision, invalid); err == nil {
			t.Fatalf("accepted invalid source snapshot %q", invalid)
		}
	}
	if err := RecordBuiltArtifactSource(workspace, "plugin", binary, revision, digest); err != nil {
		t.Fatal(err)
	}
	dir, err := artifactDirectory(workspace)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "plugin.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var record artifactRecord
	if err := json.Unmarshal(data, &record); err != nil {
		t.Fatal(err)
	}
	if record.ExpectedSDKSourceSHA256 != digest || record.Provenance.SDKSourceSHA256 != digest {
		t.Fatal("trusted expected and recorded source identities were not retained")
	}
	// The independently expected source identity cannot be downgraded to empty
	// or switched to a different dirty snapshot while retaining the artifact.
	for _, mismatch := range []string{"", strings.Repeat("c", 64)} {
		record.ExpectedSDKSourceSHA256 = mismatch
		changed, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, changed, 0600); err != nil {
			t.Fatal(err)
		}
		if err := VerifyPluginArtifact(workspace, "plugin", binary); err == nil {
			t.Fatal("preflight allowed source identity mismatch/downgrade")
		}
		if _, _, err := PreparePluginArtifact(workspace, "plugin", binary); err == nil {
			t.Fatal("source identity mismatch/downgrade allowed launch")
		}
	}
}

func artifactWorkspaceFixture(t *testing.T) devcontract.ResolvedWorkspace {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	manifest := workspaceFixture(t, home, fixtureID, "Artifact fixture")
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: manifest, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	return workspace
}

func TestArtifactIdentityRevalidatedWithoutAmbientWorkspace(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("trusted fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv(devcontract.WorkspaceEnvironment, "/unrelated/workspace.json")
	if err := RecordBuiltArtifactSource(workspace, "plugin", binary, strings.Repeat("a", 40), strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	prepared, cleanup, err := PreparePluginArtifact(workspace, "plugin", binary)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if prepared == "" {
		t.Fatal("explicit workspace identity did not select artifact")
	}
	stale := workspace
	stale.Manifest.WorkspaceID = "22f2dbb0-9ecd-4b17-9690-a0c2239387ac"
	if _, _, err := PreparePluginArtifact(stale, "plugin", binary); err == nil {
		t.Fatal("caller identity disagreed with revalidated manifest")
	}
}

func TestVerifyPluginArtifactDoesNotRequireWritableRuntime(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("trusted preflight fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := RecordBuiltArtifactSource(workspace, "plugin", binary, strings.Repeat("a", 40), strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	dir, err := artifactDirectory(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chmod(dir, 0700); err != nil {
			t.Error(err)
		}
	})
	if err := VerifyPluginArtifact(workspace, "plugin", binary); err != nil {
		t.Fatalf("static preflight required runtime writes: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "plugin.json" {
		t.Fatalf("static preflight changed trusted artifact directory: %v", entries)
	}
	if err := os.WriteFile(binary, []byte("replaced preflight fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := VerifyPluginArtifact(workspace, "plugin", binary); err == nil {
		t.Fatal("preflight accepted bytes differing from trusted build evidence")
	}
}

func TestVerifyPluginArtifactRejectsCrossProfileEvidence(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("first profile artifact"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := RecordBuiltArtifactSource(workspace, "plugin", binary, strings.Repeat("a", 40), strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	foreignManifest := workspaceFixture(t, home, "22f2dbb0-9ecd-4b17-9690-a0c2239387ac", "Foreign artifact fixture")
	foreign, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: foreignManifest, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	foreignBinary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(foreignBinary, []byte("foreign profile artifact"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := RecordBuiltArtifactSource(foreign, "plugin", foreignBinary, strings.Repeat("a", 40), strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	if err := VerifyPluginArtifact(foreign, "plugin", foreignBinary); err != nil {
		t.Fatalf("foreign fixture lacks genuine trusted evidence: %v", err)
	}
	if err := VerifyPluginArtifact(workspace, "plugin", foreignBinary); err == nil {
		t.Fatal("preflight accepted another profile's trusted artifact")
	}
	if _, cleanup, err := PreparePluginArtifact(workspace, "plugin", foreignBinary); err == nil {
		cleanup()
		t.Fatal("launch accepted another profile's trusted artifact")
	}
	stale := workspace
	stale.StateRoot = foreign.StateRoot
	if err := VerifyPluginArtifact(stale, "plugin", binary); err == nil {
		t.Fatal("preflight accepted a root outside the selected workspace")
	}
	stale = workspace
	stale.Manifest.WorkspaceID = foreign.Manifest.WorkspaceID
	if err := VerifyPluginArtifact(stale, "plugin", binary); err == nil {
		t.Fatal("preflight accepted a caller identity differing from the manifest")
	}
	if err := VerifyPluginArtifact(workspace, "../plugin", binary); err == nil {
		t.Fatal("preflight accepted a traversing plugin ID")
	}
}

func TestVerifyPluginArtifactRequiresSelectedProfileOwnership(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("trusted ownership fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := RecordBuiltArtifactSource(workspace, "plugin", binary, strings.Repeat("a", 40), strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	if err := VerifyPluginArtifact(workspace, "plugin", binary); err != nil {
		t.Fatal(err)
	}
	owner := filepath.Join(filepath.Dir(workspace.StateRoot), ".workspace-owner.json")
	if err := os.Remove(owner); err != nil {
		t.Fatal(err)
	}
	if err := VerifyPluginArtifact(workspace, "plugin", binary); err == nil {
		t.Fatal("preflight accepted trusted evidence without profile ownership proof")
	}
	if _, cleanup, err := PreparePluginArtifact(workspace, "plugin", binary); err == nil {
		cleanup()
		t.Fatal("launch accepted trusted evidence without profile ownership proof")
	}
	if _, err := os.Lstat(owner); !os.IsNotExist(err) {
		t.Fatal("read-only artifact verification claimed profile ownership")
	}
}

func TestBoundCustomStateArtifactsStayInDefaultUUIDRuntime(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	customBase, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	customState := filepath.Join(customBase, "dedicated", "state")
	bound, err := devcontract.SetCustomProfile(context.Background(), workspace, customState, home)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("trusted custom source fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := RecordBuiltArtifactSource(bound, "plugin", binary, strings.Repeat("a", 40), strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	dir, err := artifactDirectory(bound)
	if err != nil {
		t.Fatal(err)
	}
	expected := filepath.Join(home, ".omniview-dev", "profiles", fixtureID, "runtime", "artifacts")
	if dir != expected {
		t.Fatalf("custom root moved trusted artifact namespace: %s", dir)
	}
	prepared, cleanup, err := PreparePluginArtifact(bound, "plugin", binary)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if !contained(expected, prepared) {
		t.Fatal("verified executable snapshot left UUID runtime")
	}
	if _, err := os.Stat(customState); !os.IsNotExist(err) {
		t.Fatal("artifact handling created bound state")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(customState), "runtime")); !os.IsNotExist(err) {
		t.Fatal("artifact handling created custom-root sibling runtime")
	}
}

func TestArtifactWriterCannotClaimUnmarkedDefaultTransientProfile(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	runtime := filepath.Join(filepath.Dir(workspace.StateRoot), "runtime")
	if err := os.MkdirAll(runtime, 0700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(runtime, "foreign")
	if err := os.WriteFile(sentinel, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(binary, []byte("trusted fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := RecordBuiltArtifactSource(workspace, "plugin", binary, strings.Repeat("a", 40), strings.Repeat("b", 64)); err == nil {
		t.Fatal("artifact writer claimed nonempty unmarked default profile")
	}
	got, err := os.ReadFile(sentinel)
	if err != nil || string(got) != "preserve" {
		t.Fatal("foreign runtime changed")
	}
	if _, err := os.Stat(filepath.Join(runtime, "artifacts")); !os.IsNotExist(err) {
		t.Fatal("artifact outputs created before ownership proof")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(workspace.StateRoot), ".workspace-owner.json")); !os.IsNotExist(err) {
		t.Fatal("artifact writer created foreign ownership marker")
	}
}
