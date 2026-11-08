package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

const (
	fixtureModuleSum = "h1:y+On5xnaevx96M744EQrwuMDdB37bjhdfhWMUpfU6xI="
	fixtureGoModSum  = "h1:FFxi7m1H27zsC3VwMZ6Z9zVrwIytVTAkRjLT5cpv0G4="
)

func launchEvidence() LinkProtocolEvidence {
	return LinkProtocolEvidence{Protocol: "workspace", Versions: []string{devcompose.Version}, AtomicDist: true, Peers: true, Runtime: true}
}

// moduleFiles writes a consumer whose go.mod requires the plugin SDK at version
// and whose go.sum records its two checksums.
func writeConsumerModule(t *testing.T, directory, version string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(directory, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(directory, "go.mod"),
		[]byte("module example.com/"+filepath.Base(directory)+"\n\ngo 1.26.0\n\nrequire "+devsdk.Module+" "+version+"\n"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(directory, "go.sum"),
		[]byte(devsdk.Module+" "+version+" "+fixtureModuleSum+"\n"+devsdk.Module+" "+version+"/go.mod "+fixtureGoModSum+"\n"), 0o600))
}

// publishedWorkspace is a materialized published-SDK workspace: a host and one
// plugin repository, both Go consumers of the SDK at the release floor, and no
// SDK repository.
func publishedWorkspace(t *testing.T) Workspace {
	t.Helper()
	// Preflight queries the Go environment: keep the user's Go environment file out of it.
	t.Setenv("GOENV", filepath.Join(t.TempDir(), "env"))
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	writeConsumerModule(t, filepath.Join(root, "omniview"), devsdk.FloorVersion)
	writeConsumerModule(t, filepath.Join(root, "kubernetes"), devsdk.FloorVersion)
	return Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{
		Repositories: []devcontract.Repository{{ID: "omniview", Directory: "omniview"}, {ID: "kubernetes", Directory: "kubernetes"}},
		Plugins:      []devcontract.Plugin{{ID: "kubernetes", RepositoryID: "kubernetes", Mode: "managed"}},
	}}}
}

func treeDigest(t *testing.T, root string) string {
	t.Helper()
	var entries []string
	require.NoError(t, filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		require.NoError(t, err)
		relative, _ := filepath.Rel(root, path)
		if entry.IsDir() {
			entries = append(entries, relative+"/")
			return nil
		}
		data, readErr := os.ReadFile(path)
		require.NoError(t, readErr)
		sum := sha256.Sum256(data)
		entries = append(entries, relative+" "+hex.EncodeToString(sum[:]))
		return nil
	}))
	sort.Strings(entries)
	return strings.Join(entries, "\n")
}

func issueCodes(report LaunchPreflight) []string {
	codes := []string{}
	for _, issue := range report.Issues {
		codes = append(codes, issue.Code)
	}
	return codes
}

func TestLaunchPreflightRequiresActualProtocolProof(t *testing.T) {
	w := publishedWorkspace(t)
	o := LaunchOptions{Mode: "browser", LinkEvidence: launchEvidence()}
	if report := PreflightLaunch(context.Background(), w, o, devsdk.ReleasePolicy()); !report.Ready || len(report.Issues) != 0 {
		t.Fatalf("valid inputs refused: %+v", report)
	}
	o.LinkEvidence.Peers = false
	report := PreflightLaunch(context.Background(), w, o, devsdk.ReleasePolicy())
	if report.Ready || len(report.Issues) != 1 || report.Issues[0].Code != "link_protocol_unproved" {
		t.Fatalf("unproved evidence accepted: %+v", report)
	}
}

// A workspace that selects no SDK repository is a published-SDK workspace: it
// is ready, reports its mode and each consumer's declared requirement as
// unresolved, and preflight stays read-only: no process, no network, no writes.
func TestLaunchPreflightOfAPublishedWorkspaceIsReadyAndHonestlyUnresolved(t *testing.T) {
	w := publishedWorkspace(t)
	before := treeDigest(t, w.Root)
	// Nothing may be executed: not Go, not Git, not the network's tooling.
	t.Setenv("PATH", t.TempDir())

	report := PreflightLaunch(context.Background(), w, LaunchOptions{Mode: "browser", LinkEvidence: launchEvidence()}, devsdk.ReleasePolicy())
	require.True(t, report.Ready, "%v", issueCodes(report))
	require.Empty(t, report.Issues)
	require.NotNil(t, report.SDK)
	require.Equal(t, devsdk.ModePublished, report.SDK.Mode)
	require.Empty(t, report.SDK.RepositoryID)
	require.Equal(t, []SDKConsumer{
		{RepositoryID: "omniview", RequiredVersion: devsdk.FloorVersion, Verification: SDKUnresolved},
		{RepositoryID: "kubernetes", RequiredVersion: devsdk.FloorVersion, Verification: SDKUnresolved},
	}, report.SDK.Consumers, "a declared requirement must never be reported as an effective resolution")
	require.Equal(t, before, treeDigest(t, w.Root), "preflight is read-only")
}

func TestLaunchPreflightFlagsEverythingTheDeclarationsAlreadyProve(t *testing.T) {
	const otherSum = "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	for name, test := range map[string]struct {
		mutate func(t *testing.T, w Workspace)
		codes  []string
	}{
		"local SDK replace in the host": {func(t *testing.T, w Workspace) {
			path := filepath.Join(w.Root, "omniview", "go.mod")
			data, err := os.ReadFile(path)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(path, append(data, []byte("\nreplace "+devsdk.Module+" => ../sdk\n")...), 0o600))
		}, []string{devsdk.CodeSelectionConflict}},
		"dormant replace in the plugin": {func(t *testing.T, w Workspace) {
			path := filepath.Join(w.Root, "kubernetes", "go.mod")
			data, err := os.ReadFile(path)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(path, append(data, []byte("\nreplace "+devsdk.Module+" v0.99.0 => ../sdk\n")...), 0o600))
		}, []string{devsdk.CodeSelectionConflict}},
		"vendored host": {func(t *testing.T, w Workspace) {
			require.NoError(t, os.MkdirAll(filepath.Join(w.Root, "omniview", "vendor"), 0o700))
		}, []string{devsdk.CodeSelectionConflict}},
		"plugin does not require the SDK": {func(t *testing.T, w Workspace) {
			require.NoError(t, os.WriteFile(filepath.Join(w.Root, "kubernetes", "go.mod"), []byte("module example.com/kubernetes\n\ngo 1.26.0\n"), 0o600))
		}, []string{devsdk.CodeContractMismatch}},
		"missing checksums": {func(t *testing.T, w Workspace) {
			require.NoError(t, os.WriteFile(filepath.Join(w.Root, "omniview", "go.sum"), nil, 0o600))
		}, []string{devsdk.CodeChecksumsRequired}},
		"release below the floor": {func(t *testing.T, w Workspace) {
			writeConsumerModule(t, filepath.Join(w.Root, "kubernetes"), "v0.16.0")
		}, []string{devsdk.CodeReleaseUntrusted}},
		"pseudo-version": {func(t *testing.T, w Workspace) {
			writeConsumerModule(t, filepath.Join(w.Root, "omniview"), "v0.17.1-0.20261108000000-abcdefabcdef")
		}, []string{devsdk.CodeReleaseUntrusted}},
		"conflicting checksums": {func(t *testing.T, w Workspace) {
			path := filepath.Join(w.Root, "omniview", "go.sum")
			data, err := os.ReadFile(path)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(path, append(data, []byte(devsdk.Module+" "+devsdk.FloorVersion+" "+otherSum+"\n")...), 0o600))
		}, []string{devsdk.CodeIntegrityMismatch}},
		"both consumers refused independently": {func(t *testing.T, w Workspace) {
			writeConsumerModule(t, filepath.Join(w.Root, "omniview"), "v0.16.0")
			require.NoError(t, os.MkdirAll(filepath.Join(w.Root, "kubernetes", "vendor"), 0o700))
		}, []string{devsdk.CodeReleaseUntrusted, devsdk.CodeSelectionConflict}},
	} {
		t.Run(name, func(t *testing.T) {
			w := publishedWorkspace(t)
			test.mutate(t, w)
			before := treeDigest(t, w.Root)
			report := PreflightLaunch(context.Background(), w, LaunchOptions{Mode: "browser", LinkEvidence: launchEvidence()}, devsdk.ReleasePolicy())
			require.False(t, report.Ready)
			require.Equal(t, test.codes, issueCodes(report))
			require.NotNil(t, report.SDK)
			for _, consumer := range report.SDK.Consumers {
				require.Equal(t, SDKUnresolved, consumer.Verification, "preflight never claims a verification")
				require.Empty(t, consumer.ResolvedVersion)
			}
			require.Equal(t, before, treeDigest(t, w.Root), "preflight must not repair or write anything")
		})
	}
}

// Missing evidence and SDK refusals are independent issues: neither hides the other.
func TestLaunchPreflightKeepsEvidenceAndSDKIssuesIndependent(t *testing.T) {
	w := publishedWorkspace(t)
	writeConsumerModule(t, filepath.Join(w.Root, "omniview"), "v0.16.0")
	report := PreflightLaunch(context.Background(), w, LaunchOptions{Mode: "browser"}, devsdk.ReleasePolicy())
	require.Equal(t, []string{"link_evidence_required", devsdk.CodeReleaseUntrusted}, issueCodes(report))
}

func TestLaunchPreflightAppliesTheInjectedPolicy(t *testing.T) {
	w := publishedWorkspace(t)
	writeConsumerModule(t, filepath.Join(w.Root, "kubernetes"), "v0.16.0")
	o := LaunchOptions{Mode: "browser", LinkEvidence: launchEvidence()}
	require.False(t, PreflightLaunch(context.Background(), w, o, devsdk.ReleasePolicy()).Ready)
	require.False(t, PreflightLaunch(context.Background(), w, o, devsdk.Policy{}).Ready, "the zero policy accepts no published release")
	accepting := devsdk.NewPolicy(func(devsdk.Published) error { return nil })
	require.True(t, PreflightLaunch(context.Background(), w, o, accepting).Ready)
}

// Source mode is selected by a linked SDK repository, and stays exactly as it
// was: the checkout is the authority, module declarations are not judged.
func TestLaunchPreflightOfASourceWorkspaceIsUnchanged(t *testing.T) {
	w := publishedWorkspace(t)
	sdk := "plugin-sdk"
	w.Manifest.Repositories = append(w.Manifest.Repositories, devcontract.Repository{ID: sdk, Directory: "sdk"})
	w.Manifest.Links.SDKRepositoryID = &sdk
	path := filepath.Join(w.Root, "omniview", "go.mod")
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, append(data, []byte("\nreplace "+devsdk.Module+" => ../sdk\n")...), 0o600))

	for _, mode := range []string{"browser", "native"} {
		report := PreflightLaunch(context.Background(), w, LaunchOptions{Mode: mode, LinkEvidence: launchEvidence()}, devsdk.Policy{})
		require.True(t, report.Ready, "%s: %v", mode, issueCodes(report))
		require.Equal(t, &SDKStatus{Mode: devsdk.ModeSource, RepositoryID: sdk}, report.SDK)
	}
}

func TestLaunchPreflightRefusesNativeForAPublishedWorkspaceOnly(t *testing.T) {
	w := publishedWorkspace(t)
	report := PreflightLaunch(context.Background(), w, LaunchOptions{Mode: "native", LinkEvidence: launchEvidence()}, devsdk.ReleasePolicy())
	require.Equal(t, []string{"sdk_published_native_unsupported"}, issueCodes(report))
	require.Equal(t, 2, report.Issues[0].Exit)
	require.Contains(t, report.Issues[0].Message, "--mode browser")

	// An invalid mode is reported as itself, not as an unsupported native launch.
	report = PreflightLaunch(context.Background(), w, LaunchOptions{Mode: "desktop", LinkEvidence: launchEvidence()}, devsdk.ReleasePolicy())
	require.Equal(t, []string{"invalid_mode"}, issueCodes(report))
}

func TestPublishedNativeRefusalIsTypedAndOnlyForPublishedSelections(t *testing.T) {
	err := refusePublishedNative(devsdk.PublishedSelection(), LaunchOptions{Mode: "native"})
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, "sdk_published_native_unsupported", failure.Code)
	require.Equal(t, 2, failure.Exit)
	require.Equal(t, 2, workspaceExitCode(failure.Code), "the exit must survive the supervisor boundary")
	require.NoError(t, refusePublishedNative(devsdk.PublishedSelection(), LaunchOptions{Mode: "browser"}))
	source, err := devsdk.SourceSelection(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, refusePublishedNative(source, LaunchOptions{Mode: "native"}))
}
