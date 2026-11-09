package instance

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
	"github.com/omniviewdev/omniview/internal/devsource"
)

// sourceIdentity is the validated source evidence a trusted builder passes to
// RecordBuiltArtifact. The directory is irrelevant to the schema-3 record.
func sourceIdentity(t *testing.T, revision, digest string) devsdk.Identity {
	t.Helper()
	identity, err := devsdk.NewSourceIdentity(devsource.Identity{
		Directory: filepath.Join(t.TempDir(), "sdk"), Revision: revision, SourceDigest: digest,
	})
	if err != nil {
		t.Fatal(err)
	}
	return identity
}

func fixtureSDK(t *testing.T) devsdk.Identity {
	t.Helper()
	return sourceIdentity(t, strings.Repeat("a", 40), strings.Repeat("b", 64))
}

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
	if err := RecordBuiltArtifact(workspace, "kubernetes", binary, sourceIdentity(t, revision, strings.Repeat("b", 64))); err != nil {
		t.Fatal(err)
	}
	if err := VerifyPluginArtifact(workspace, "kubernetes", binary); err != nil {
		t.Fatal(err)
	}
	dir, err := artifactDirectory(workspace)
	if err != nil {
		t.Fatal(err)
	}
	recordPath := filepath.Join(dir, "kubernetes.json")
	recordBytes, err := os.ReadFile(recordPath)
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]any
	if err = json.Unmarshal(recordBytes, &legacy); err != nil {
		t.Fatal(err)
	}
	legacy["schemaVersion"] = 2
	legacy["expectedSDKRevision"] = legacy["sdkRevision"]
	delete(legacy, "sdkRevision")
	legacyBytes, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(recordPath, legacyBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if err = VerifyPluginArtifact(workspace, "kubernetes", binary); err == nil ||
		!strings.Contains(err.Error(), "instance: invalid trusted artifact source evidence for kubernetes") {
		t.Fatalf("schema-2 artifact record was not rejected: %v", err)
	}
	if err = os.WriteFile(recordPath, recordBytes, 0600); err != nil {
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
	if err := RecordBuiltArtifact(workspace, "../foreign", binary, fixtureSDK(t)); err == nil {
		t.Fatal("accepted a traversing plugin ID")
	}
	// The typed identity cannot even be built from an unresolved revision, and
	// the recorder refuses the zero identity.
	for _, revision := range []string{"main", ""} {
		if _, err := devsdk.NewSourceIdentity(devsource.Identity{Directory: t.TempDir(), Revision: revision, SourceDigest: strings.Repeat("b", 64)}); err == nil {
			t.Fatalf("accepted unresolved revision %q", revision)
		}
	}
	if err := RecordBuiltArtifact(workspace, "plugin", binary, devsdk.Identity{}); err == nil {
		t.Fatal("accepted a trusted record without verified SDK evidence")
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
		if err := RecordBuiltArtifact(selected, "plugin", binary, fixtureSDK(t)); err == nil {
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
		if _, err := devsdk.NewSourceIdentity(devsource.Identity{Directory: t.TempDir(), Revision: revision, SourceDigest: invalid}); err == nil {
			t.Fatalf("accepted invalid source snapshot %q", invalid)
		}
	}
	if err := RecordBuiltArtifact(workspace, "plugin", binary, sourceIdentity(t, revision, digest)); err != nil {
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
	home, err := filepath.EvalSymlinks(sdktest.Home(t))
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
	if err := RecordBuiltArtifact(workspace, "plugin", binary, fixtureSDK(t)); err != nil {
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
	if err := RecordBuiltArtifact(workspace, "plugin", binary, fixtureSDK(t)); err != nil {
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
	if err := RecordBuiltArtifact(workspace, "plugin", binary, fixtureSDK(t)); err != nil {
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
	if err := RecordBuiltArtifact(foreign, "plugin", foreignBinary, fixtureSDK(t)); err != nil {
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
	if err := RecordBuiltArtifact(workspace, "plugin", binary, fixtureSDK(t)); err != nil {
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
	if err := RecordBuiltArtifact(bound, "plugin", binary, fixtureSDK(t)); err != nil {
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
	if err := RecordBuiltArtifact(workspace, "plugin", binary, fixtureSDK(t)); err == nil {
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

// publishedBuild builds a real consumer binary against a published SDK release
// and returns the identity the production verifier reports for it.
func publishedBuild(t *testing.T, world *sdktest.World, name string, releases ...sdktest.Release) (string, devsdk.Identity) {
	t.Helper()
	directory := world.Consumer(name, releases...)
	// The production rules plus the releases this world serves as reviewed rows:
	// the floor release is the reviewed row itself, any other served release needs
	// its own.
	identity, err := devsdk.NewVerifier(world.Policy(releases...))(context.Background(), devsdk.Request{
		Selection: devsdk.PublishedSelection(),
		Consumer:  devsdk.Consumer{Name: name, Directory: directory},
		Run:       world.Runner(),
	})
	require.NoError(t, err)
	binary := filepath.Join(t.TempDir(), "plugin")
	_, err = world.Runner()(context.Background(), directory, nil, "build", "-mod=readonly", "-o", binary, ".")
	require.NoError(t, err)
	return binary, identity
}

type publishedFixture struct {
	workspace devcontract.ResolvedWorkspace
	world     *sdktest.World
	uuid      sdktest.Release
	other     sdktest.Release
	binary    string
	identity  devsdk.Identity
}

func newPublishedFixture(t *testing.T) publishedFixture {
	t.Helper()
	world := sdktest.New(t)
	sdk := world.PublishSDK(devsdk.FloorVersion, nil)
	uuid := world.PublishPinned("github.com/google/uuid")
	// Publish before the workspace fixture moves HOME away from the module cache
	// the pinned SDK is read from.
	other := world.PublishSDK("v0.99.0", nil)
	workspace := artifactWorkspaceFixture(t)
	binary, identity := publishedBuild(t, world, "plugin", sdk, uuid)
	require.NoError(t, RecordBuiltArtifact(workspace, "plugin", binary, identity))
	return publishedFixture{workspace: workspace, world: world, uuid: uuid, other: other, binary: binary, identity: identity}
}

func (f publishedFixture) recordPath(t *testing.T) string {
	t.Helper()
	dir, err := artifactDirectory(f.workspace)
	require.NoError(t, err)
	return filepath.Join(dir, "plugin.json")
}

func (f publishedFixture) edit(t *testing.T, change func(record map[string]any)) {
	t.Helper()
	editRecord(t, f.recordPath(t), change)
}

func editRecord(t *testing.T, path string, change func(record map[string]any)) {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var record map[string]any
	require.NoError(t, json.Unmarshal(data, &record))
	change(record)
	data, err = json.Marshal(record)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, data, 0600))
}

// requireRefused asserts neither preflight nor preparation accepts the bytes
// and that preparation leaves no launchable snapshot behind.
func requireRefused(t *testing.T, workspace devcontract.ResolvedWorkspace, binary string) (preflight, prepare error) {
	t.Helper()
	preflight = VerifyPluginArtifact(workspace, "plugin", binary)
	require.Error(t, preflight)
	prepared, cleanup, prepare := PreparePluginArtifact(workspace, "plugin", binary)
	defer cleanup()
	require.Error(t, prepare)
	require.Empty(t, prepared)
	dir, err := artifactDirectory(workspace)
	require.NoError(t, err)
	launches, err := filepath.Glob(filepath.Join(dir, ".launch-*"))
	require.NoError(t, err)
	require.Empty(t, launches)
	return preflight, prepare
}

func keys(t *testing.T, object any) []string {
	t.Helper()
	fields, ok := object.(map[string]any)
	require.True(t, ok)
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func TestPublishedArtifactRoundTripsWithARealBinary(t *testing.T) {
	f := newPublishedFixture(t)
	require.NoError(t, VerifyPluginArtifact(f.workspace, "plugin", f.binary))
	prepared, cleanup, err := PreparePluginArtifact(f.workspace, "plugin", f.binary)
	require.NoError(t, err)
	defer cleanup()
	require.NotEqual(t, f.binary, prepared)
	want, err := os.ReadFile(f.binary)
	require.NoError(t, err)
	got, err := os.ReadFile(prepared)
	require.NoError(t, err)
	require.Equal(t, want, got)
}

func TestArtifactRecordFieldSets(t *testing.T) {
	f := newPublishedFixture(t)
	data, err := os.ReadFile(f.recordPath(t))
	require.NoError(t, err)
	var published map[string]any
	require.NoError(t, json.Unmarshal(data, &published))
	require.Equal(t, []string{"binarySHA256", "capability", "pluginID", "schemaVersion", "sdk"}, keys(t, published))
	require.Equal(t, []string{"goModSum", "mode", "module", "moduleSum", "version"}, keys(t, published["sdk"]))
	require.EqualValues(t, 4, published["schemaVersion"])
	require.Equal(t, devsdk.Capability, published["capability"])

	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	require.NoError(t, os.WriteFile(binary, []byte("fixture"), 0700))
	require.NoError(t, RecordBuiltArtifact(workspace, "plugin", binary, fixtureSDK(t)))
	dir, err := artifactDirectory(workspace)
	require.NoError(t, err)
	data, err = os.ReadFile(filepath.Join(dir, "plugin.json"))
	require.NoError(t, err)
	var source map[string]any
	require.NoError(t, json.Unmarshal(data, &source))
	require.Equal(t, []string{"expectedSDKSourceSHA256", "pluginID", "provenance", "schemaVersion", "sdkRevision"}, keys(t, source))
	require.EqualValues(t, 3, source["schemaVersion"])
}

func TestPublishedArtifactRefusesChangedBytes(t *testing.T) {
	t.Run("tampered after recording", func(t *testing.T) {
		f := newPublishedFixture(t)
		data, err := os.ReadFile(f.binary)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(f.binary, append(data, 0), 0700))
		_, prepare := requireRefused(t, f.workspace, f.binary)
		require.ErrorContains(t, prepare, "differ from the recorded build")
	})
	t.Run("built against another release", func(t *testing.T) {
		f := newPublishedFixture(t)
		binary, otherIdentity := publishedBuild(t, f.world, "other", f.other, f.uuid)
		require.NotEqual(t, f.identity, otherIdentity)
		// The recorded digest matches these bytes, so only the buildinfo can disagree.
		digest, err := artifactSHA256(binary)
		require.NoError(t, err)
		f.edit(t, func(record map[string]any) { record["binarySHA256"] = digest })
		_, prepare := requireRefused(t, f.workspace, binary)
		var typed *devcontract.Error
		require.ErrorAs(t, prepare, &typed)
		require.Equal(t, devsdk.CodeIdentityChanged, typed.Code)
	})
}

func TestPublishedArtifactIsRevokedByTheCurrentReleasePolicy(t *testing.T) {
	// The load-time policy is the compiled-in production one, with no injection
	// point. A genuinely reviewed older tuple must be refused by the raised
	// floor, not merely because its checksums are unreviewed.
	t.Run("reviewed v0.18.0 below the floor", func(t *testing.T) {
		workspace := artifactWorkspaceFixture(t)
		binary := filepath.Join(t.TempDir(), "plugin")
		require.NoError(t, os.WriteFile(binary, []byte("fixture"), 0700))
		identity, err := devsdk.NewPublishedIdentity(devsdk.Published{
			Module: devsdk.Module, Version: "v0.18.0",
			ModuleSum: "h1:DLcNbTghtD/Jc2knt+vBJAj+mJRTpuEgHx1lUOdqnso=",
			GoModSum:  "h1:7ZjIDHv7L0YEHsy3Ld2CHKGr/HHTNY4wUrzVyfYRR8E=",
		})
		require.NoError(t, err)
		require.NoError(t, RecordBuiltArtifact(workspace, "plugin", binary, identity))
		preflight, prepare := requireRefused(t, workspace, binary)
		require.ErrorIs(t, preflight, devsdk.ErrNotAccepted)
		require.ErrorIs(t, prepare, devsdk.ErrNotAccepted)
	})

	// These records use checksums that are not a reviewed row of any version.
	for name, version := range map[string]string{
		"below the floor":                    "v0.16.0",
		"pseudo-version":                     "v0.17.1-0.20260101000000-abcdefabcdef",
		"prerelease":                         "v0.18.0-rc.1",
		"unreviewed release above the floor": "v0.99.0",
		"unreviewed future release":          "v1.0.0",
		"reviewed version, other checksums":  devsdk.FloorVersion,
	} {
		t.Run(name, func(t *testing.T) {
			workspace := artifactWorkspaceFixture(t)
			binary := filepath.Join(t.TempDir(), "plugin")
			require.NoError(t, os.WriteFile(binary, []byte("fixture"), 0700))
			identity, err := devsdk.NewPublishedIdentity(devsdk.Published{
				Module: devsdk.Module, Version: version,
				ModuleSum: "h1:q3jMU47l+0APFGpEdbJ4d5NmAnwaloV+siwiu3G4OOU=", GoModSum: "h1:FFxi7m1H27zsC3VwMZ6Z9zVrwIytVTAkRjLT5cpv0G4=",
			})
			require.NoError(t, err)
			require.NoError(t, RecordBuiltArtifact(workspace, "plugin", binary, identity))
			preflight, prepare := requireRefused(t, workspace, binary)
			require.True(t, errors.Is(preflight, devsdk.ErrNotAccepted))
			require.True(t, errors.Is(prepare, devsdk.ErrNotAccepted))
		})
	}
}

func TestMalformedPublishedArtifactRecordsAreRefused(t *testing.T) {
	cases := map[string]struct {
		edit func(record map[string]any)
		want string
	}{
		"wrong capability": {func(r map[string]any) { r["capability"] = "state-root-v2" }, "capability"},
		"mixed union with source fields": {func(r map[string]any) {
			r["sdk"].(map[string]any)["revision"] = strings.Repeat("a", 40)
		}, "invalid trusted artifact source evidence for plugin"},
		"mixed union with provenance": {func(r map[string]any) {
			r["sdk"].(map[string]any)["provenance"] = map[string]any{}
		}, "invalid trusted artifact source evidence for plugin"},
		"flat source fields on schema 4": {func(r map[string]any) { r["sdkRevision"] = strings.Repeat("a", 40) }, "invalid trusted artifact source evidence for plugin"},
		"unknown mode":                   {func(r map[string]any) { r["sdk"].(map[string]any)["mode"] = "vendored" }, "invalid trusted artifact source evidence for plugin"},
		"missing mode":                   {func(r map[string]any) { delete(r["sdk"].(map[string]any), "mode") }, "invalid trusted artifact source evidence for plugin"},
		"missing sdk":                    {func(r map[string]any) { delete(r, "sdk") }, "invalid trusted artifact source evidence for plugin"},
		"missing digest":                 {func(r map[string]any) { delete(r, "binarySHA256") }, "invalid trusted artifact source evidence for plugin"},
		"missing module sum":             {func(r map[string]any) { delete(r["sdk"].(map[string]any), "moduleSum") }, "module h1 checksum"},
		"schema 5":                       {func(r map[string]any) { r["schemaVersion"] = 5 }, "invalid trusted artifact source evidence for plugin"},
		"schema 3 with published fields": {func(r map[string]any) { r["schemaVersion"] = 3 }, "invalid trusted artifact source evidence for plugin"},
		"another plugin":                 {func(r map[string]any) { r["pluginID"] = "other" }, "invalid trusted artifact source evidence for plugin"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			f := newPublishedFixture(t)
			f.edit(t, tc.edit)
			preflight, prepare := requireRefused(t, f.workspace, f.binary)
			require.ErrorContains(t, preflight, tc.want)
			require.ErrorContains(t, prepare, tc.want)
		})
	}
}

func TestSchema3RecordWithPublishedFieldsIsRefused(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	require.NoError(t, os.WriteFile(binary, []byte("fixture"), 0700))
	require.NoError(t, RecordBuiltArtifact(workspace, "plugin", binary, fixtureSDK(t)))
	dir, err := artifactDirectory(workspace)
	require.NoError(t, err)
	path := filepath.Join(dir, "plugin.json")
	require.NoError(t, VerifyPluginArtifact(workspace, "plugin", binary))
	for name, change := range map[string]func(map[string]any){
		"sdk":          func(r map[string]any) { r["sdk"] = map[string]any{"mode": "published"} },
		"capability":   func(r map[string]any) { r["capability"] = devsdk.Capability },
		"binarySHA256": func(r map[string]any) { r["binarySHA256"] = strings.Repeat("a", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			original, err := os.ReadFile(path)
			require.NoError(t, err)
			defer func() { require.NoError(t, os.WriteFile(path, original, 0600)) }()
			editRecord(t, path, change)
			requireRefused(t, workspace, binary)
		})
	}
}

func TestPublishedEvidenceFromAnotherWorkspaceOrMissingIsRefused(t *testing.T) {
	f := newPublishedFixture(t)
	data, err := os.ReadFile(f.recordPath(t))
	require.NoError(t, err)

	other := workspaceFixture(t, os.Getenv("HOME"), "22222222-2222-4222-8222-222222222222", "Other")
	otherWorkspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: other, Home: os.Getenv("HOME")})
	require.NoError(t, err)
	otherDir, err := artifactDirectory(otherWorkspace)
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(otherDir, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(otherDir, "plugin.json"), data, 0600))
	require.NoError(t, os.Remove(f.recordPath(t)))
	_, err = os.Lstat(f.recordPath(t))
	require.True(t, os.IsNotExist(err))
	// The record belongs to another UUID's directory, so this workspace has none.
	requireRefused(t, f.workspace, f.binary)
}

func TestSchema4SourceVariantVerifiesLikeSchema3(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	binary := filepath.Join(t.TempDir(), "plugin")
	require.NoError(t, os.WriteFile(binary, []byte("fixture"), 0700))
	revision, digest := strings.Repeat("a", 40), strings.Repeat("b", 64)
	require.NoError(t, RecordBuiltArtifact(workspace, "plugin", binary, sourceIdentity(t, revision, digest)))
	dir, err := artifactDirectory(workspace)
	require.NoError(t, err)
	path := filepath.Join(dir, "plugin.json")
	convert := func(revision, digest string) func(map[string]any) {
		return func(r map[string]any) {
			provenance := r["provenance"]
			delete(r, "provenance")
			delete(r, "sdkRevision")
			delete(r, "expectedSDKSourceSHA256")
			r["schemaVersion"] = 4
			r["sdk"] = map[string]any{"mode": "source", "revision": revision, "sourceSHA256": digest, "provenance": provenance}
		}
	}
	editRecord(t, path, convert(revision, digest))
	require.NoError(t, VerifyPluginArtifact(workspace, "plugin", binary))
	prepared, cleanup, err := PreparePluginArtifact(workspace, "plugin", binary)
	require.NoError(t, err)
	cleanup()
	require.NotEmpty(t, prepared)

	original, err := os.ReadFile(path)
	require.NoError(t, err)
	restore := func() { require.NoError(t, os.WriteFile(path, original, 0600)) }
	for _, edit := range map[string]func(map[string]any){
		"revision mismatch":  func(r map[string]any) { r["sdk"].(map[string]any)["revision"] = strings.Repeat("c", 40) },
		"digest mismatch":    func(r map[string]any) { r["sdk"].(map[string]any)["sourceSHA256"] = strings.Repeat("c", 64) },
		"published fields":   func(r map[string]any) { r["sdk"].(map[string]any)["version"] = devsdk.FloorVersion },
		"capability":         func(r map[string]any) { r["capability"] = devsdk.Capability },
		"missing provenance": func(r map[string]any) { delete(r["sdk"].(map[string]any), "provenance") },
	} {
		editRecord(t, path, edit)
		requireRefused(t, workspace, binary)
		restore()
	}
	require.NoError(t, os.WriteFile(binary, []byte("replaced"), 0700))
	requireRefused(t, workspace, binary)
}
