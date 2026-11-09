package devsdk

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/mod/modfile"
	"golang.org/x/mod/semver"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

func TestReleasePolicyAdmitsOnlyReviewedReleasesAtOrAboveTheFloor(t *testing.T) {
	reviewed := ReviewedReleases()
	require.NotEmpty(t, reviewed)
	newer := Published{Module: Module, Version: "v0.99.0", ModuleSum: fixturePublished().ModuleSum, GoModSum: fixturePublished().GoModSum}
	policy := NewReleasePolicy(FloorVersion, append(reviewed, newer)...)
	admit := func(policy Policy, published Published) error {
		identity, err := NewPublishedIdentity(published)
		require.NoError(t, err, published.Version)
		return policy.Admit(identity)
	}
	for _, release := range append(reviewed, newer) {
		if semver.Compare(release.Version, FloorVersion) < 0 {
			require.ErrorIs(t, admit(policy, release), ErrNotAccepted, "historical reviewed releases below the current floor stay refused")
			continue
		}
		require.NoError(t, admit(policy, release), release.Version)
	}
	for _, release := range reviewed {
		if semver.Compare(release.Version, FloorVersion) < 0 {
			require.ErrorIs(t, admit(ReleasePolicy(), release), ErrNotAccepted)
			continue
		}
		require.NoError(t, admit(ReleasePolicy(), release), "the production policy admits the compiled-in rows")
	}
	require.ErrorIs(t, admit(ReleasePolicy(), newer), ErrNotAccepted, "a release at or above the floor that the table does not name is not reviewed")

	withVersion := func(row Published, version string) Published {
		row.Version = version
		return row
	}
	pinned := pinnedSDK(t)
	wrongSum := "h1:" + strings.Repeat("A", 43) + "="
	for name, test := range map[string]struct {
		policy    Policy
		published Published
		cause     string
	}{
		"below the floor":            {NewReleasePolicy(FloorVersion, withVersion(pinned, "v0.16.0")), withVersion(pinned, "v0.16.0"), "below the accepted floor"},
		"far below the floor":        {policy, withVersion(pinned, "v0.1.0"), "below the accepted floor"},
		"pseudo-version":             {NewReleasePolicy(FloorVersion, withVersion(pinned, "v0.17.1-0.20261108000000-abcdefabcdef")), withVersion(pinned, "v0.17.1-0.20261108000000-abcdefabcdef"), "not a released tag"},
		"prerelease":                 {NewReleasePolicy(FloorVersion, withVersion(pinned, "v0.18.0-rc.1")), withVersion(pinned, "v0.18.0-rc.1"), "not a released tag"},
		"unreviewed release":         {policy, withVersion(pinned, "v0.99.1"), "not a release this controller has reviewed"},
		"unreviewed future release":  {ReleasePolicy(), withVersion(pinned, "v1.0.0"), "not a release this controller has reviewed"},
		"module checksum differs":    {ReleasePolicy(), Published{Module: Module, Version: pinned.Version, ModuleSum: wrongSum, GoModSum: pinned.GoModSum}, "differ from the reviewed release"},
		"go.mod checksum differs":    {ReleasePolicy(), Published{Module: Module, Version: pinned.Version, ModuleSum: pinned.ModuleSum, GoModSum: wrongSum}, "differ from the reviewed release"},
		"zero policy has no rows":    {Policy{}, pinned, "not accepted"},
		"empty table, floor release": {NewReleasePolicy(FloorVersion), pinned, "not a release this controller has reviewed"},
	} {
		t.Run(name, func(t *testing.T) {
			err := admit(test.policy, test.published)
			require.ErrorIs(t, err, ErrNotAccepted)
			require.Contains(t, err.Error(), test.cause)
		})
	}
	require.Error(t, admitRelease(FloorVersion, nil, Published{Module: Module, Version: "v0.17.0+build"}), "build metadata is never a release tag")
}

func mustPublished(t *testing.T) Identity {
	t.Helper()
	identity, err := NewPublishedIdentity(fixturePublished())
	require.NoError(t, err)
	return identity
}

// pinnedSDK returns the controller's own SDK requirement and the module and
// go.mod checksums its go.sum records for it.
func pinnedSDK(t *testing.T) Published {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "go.mod"))
	require.NoError(t, err)
	module, err := modfile.Parse("go.mod", data, nil)
	require.NoError(t, err)
	pinned := Published{Module: Module}
	for _, requirement := range module.Require {
		if requirement.Mod.Path == Module {
			pinned.Version = requirement.Mod.Version
		}
	}
	sums, err := os.ReadFile(filepath.Join("..", "..", "go.sum"))
	require.NoError(t, err)
	pinned.ModuleSum, pinned.GoModSum, err = recordedSums(sums, pinned.Version)
	require.NoError(t, err)
	return pinned
}

// The reviewed table anchors the controller's own pin and retains older review
// history. Rows cannot predate the reviewed minimum, repeat or go out of order.
func TestReviewedReleasesCoverTheControllerPin(t *testing.T) {
	pinned := pinnedSDK(t)
	require.NotEmpty(t, pinned.ModuleSum)
	require.NotEmpty(t, pinned.GoModSum)

	reviewed := ReviewedReleases()
	var row *Published
	for i, release := range reviewed {
		require.NoError(t, release.validate(), release.Version)
		require.Equal(t, semver.Canonical(release.Version), release.Version, "rows are canonical versions")
		require.Empty(t, semver.Prerelease(release.Version), "rows are released tags, never prereleases or pseudo-versions: %s", release.Version)
		require.Empty(t, semver.Build(release.Version), release.Version)
		require.GreaterOrEqual(t, semver.Compare(release.Version, minimumFloor), 0, "%s predates the reviewed minimum %s", release.Version, minimumFloor)
		if i > 0 {
			require.Equal(t, 1, semver.Compare(release.Version, reviewed[i-1].Version), "rows are unique and ascending: %s after %s", release.Version, reviewed[i-1].Version)
		}
		if release.Version == pinned.Version {
			row = &reviewed[i]
		}
	}
	require.NotNil(t, row, "the controller pins %s %s; its reviewed row is missing from reviewedReleases", Module, pinned.Version)
	require.Equal(t, pinned, *row, "the reviewed row of the controller's pin must equal the checksums in the controller's go.sum")

	// The table is returned as a copy: callers cannot edit what anchors production.
	reviewed[0].ModuleSum = "edited"
	require.NotEqual(t, "edited", ReviewedReleases()[0].ModuleSum)
}

func TestFloorNeverDropsBelowTheReviewedMinimum(t *testing.T) {
	require.GreaterOrEqual(t, semver.Compare(FloorVersion, minimumFloor), 0,
		"FloorVersion %s fell below the reviewed minimum %s; the first release with state-root isolation is the lowest allowed floor", FloorVersion, minimumFloor)
	require.True(t, semver.IsValid(minimumFloor))
	require.Empty(t, semver.Prerelease(minimumFloor))
}

// The floor is the SDK the controller is itself built against. When the
// controller's pin moves, raising the floor must be a deliberate edit.
func TestFloorMatchesTheControllerPin(t *testing.T) {
	pinned := pinnedSDK(t)
	require.Equal(t, pinned.Version, FloorVersion, "go.mod pins the SDK the controller builds against; FloorVersion must equal it (edit both deliberately)")
	require.NotEmpty(t, pinned.ModuleSum)
	require.NotEmpty(t, pinned.GoModSum)

	require.Equal(t, config.StateIsolationCapability, Capability, "the SDK's own capability constant is the one the verifier requires")
	require.Equal(t, config.StateIsolationSDKModule, Module)
}

// The controller's own pin is a real published release: its extracted module
// directory must hash to the checksum go.sum records, and satisfy the policy,
// the declaration reader and the capability check.
func TestRealPinnedReleaseSatisfiesEveryCheck(t *testing.T) {
	cmd := exec.Command("go", "list", "-mod=readonly", "-m", "-json", Module)
	cmd.Dir = filepath.Join("..", "..")
	cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=")
	output, err := cmd.Output()
	require.NoError(t, err)
	var listed struct{ Dir, Version, Sum, GoModSum string }
	require.NoError(t, json.Unmarshal(output, &listed))
	require.NotEmpty(t, listed.Dir)

	sum, err := hashModuleDirectory(listed.Dir, Module+"@"+listed.Version)
	require.NoError(t, err)
	require.Equal(t, listed.Sum, sum, "dirhash over the extracted directory must reproduce go.sum's module checksum")
	require.NoError(t, verifyCapability(listed.Dir))

	goMod, err := os.ReadFile(filepath.Join("..", "..", "go.mod"))
	require.NoError(t, err)
	goSum, err := os.ReadFile(filepath.Join("..", "..", "go.sum"))
	require.NoError(t, err)
	declared, err := Declare("omniview", ModuleFiles{GoMod: goMod, GoSum: goSum})
	require.NoError(t, err)
	require.Equal(t, Published{Module: Module, Version: listed.Version, ModuleSum: listed.Sum, GoModSum: listed.GoModSum}, declared)
	identity, err := NewPublishedIdentity(declared)
	require.NoError(t, err)
	require.NoError(t, ReleasePolicy().Admit(identity))
}

func TestVerifyCapabilityNamesWhatTheModuleLacks(t *testing.T) {
	write := func(t *testing.T, isolation, root string) string {
		t.Helper()
		directory := t.TempDir()
		for name, content := range map[string]string{"pkg/config/isolation.go": isolation, "pkg/state/root.go": root} {
			if content == "" {
				continue
			}
			path := filepath.Join(directory, filepath.FromSlash(name))
			require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
			require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
		}
		return directory
	}
	const goodIsolation = "package config\n\nconst (\n\tStateIsolationCapability = \"state-root-v1\"\n\tStateIsolationSDKModule = \"github.com/omniviewdev/plugin-sdk\"\n)\n"
	const goodRoot = "package state\n\nfunc ResolveRoot() (string, error) { return \"\", nil }\nfunc OpenPluginRoot(string) error { return nil }\n"
	require.NoError(t, verifyCapability(write(t, goodIsolation, goodRoot)))

	for name, test := range map[string]struct {
		isolation, root, want string
	}{
		"no isolation file":  {"", goodRoot, "isolation.go"},
		"other capability":   {strings.Replace(goodIsolation, "state-root-v1", "state-root-v0", 1), goodRoot, "StateIsolationCapability"},
		"other module":       {strings.Replace(goodIsolation, "plugin-sdk", "fork", 1), goodRoot, "StateIsolationSDKModule"},
		"no state root file": {goodIsolation, "", "root.go"},
		"no resolver":        {goodIsolation, "package state\n\nfunc OpenPluginRoot(string) error { return nil }\n", "ResolveRoot"},
		"no plugin root":     {goodIsolation, "package state\n\nfunc ResolveRoot() (string, error) { return \"\", nil }\n", "OpenPluginRoot"},
		"method only":        {goodIsolation, "package state\n\ntype T struct{}\nfunc (T) ResolveRoot() {}\nfunc (T) OpenPluginRoot() {}\n", "ResolveRoot"},
		"unparsable":         {"package config\nconst (", goodRoot, "isolation.go"},
	} {
		t.Run(name, func(t *testing.T) {
			err := verifyCapability(write(t, test.isolation, test.root))
			require.Error(t, err)
			require.Contains(t, err.Error(), test.want)
		})
	}
}

func TestDeclareReadsOnlyWhatTheModuleFilesState(t *testing.T) {
	const moduleSum = "h1:y+On5xnaevx96M744EQrwuMDdB37bjhdfhWMUpfU6xI="
	const goModSum = "h1:FFxi7m1H27zsC3VwMZ6Z9zVrwIytVTAkRjLT5cpv0G4="
	goSum := Module + " v0.17.0 " + moduleSum + "\n" + Module + " v0.17.0/go.mod " + goModSum + "\nexample.com/other v1.0.0 h1:" + strings.Repeat("A", 43) + "=\n"
	files := func(require string) ModuleFiles {
		return ModuleFiles{GoMod: []byte("module example.com/c\n\ngo 1.26.0\n\n" + require + "\n"), GoSum: []byte(goSum)}
	}
	good := files("require " + Module + " v0.17.0")
	declared, err := Declare("c", good)
	require.NoError(t, err)
	require.Equal(t, Published{Module: Module, Version: "v0.17.0", ModuleSum: moduleSum, GoModSum: goModSum}, declared)

	indirect, err := Declare("c", files("require "+Module+" v0.17.0 // indirect"))
	require.NoError(t, err, "an indirect requirement is a requirement")
	require.Equal(t, declared, indirect)

	highest, err := Declare("c", ModuleFiles{
		GoMod: []byte("module example.com/c\n\ngo 1.26.0\n\nrequire (\n\t" + Module + " v0.16.0\n\t" + Module + " v0.17.0\n)\n"), GoSum: []byte(goSum),
	})
	require.NoError(t, err)
	require.Equal(t, "v0.17.0", highest.Version, "the highest requirement is the one MVS would select")

	for name, test := range map[string]struct {
		files ModuleFiles
		code  string
	}{
		"replace":            {files("require " + Module + " v0.17.0\nreplace " + Module + " => ../sdk"), CodeSelectionConflict},
		"dormant replace":    {files("require " + Module + " v0.17.0\nreplace " + Module + " v0.99.0 => ../sdk"), CodeSelectionConflict},
		"block replace":      {files("require " + Module + " v0.17.0\nreplace (\n\texample.com/x => ../x\n\t" + Module + " => ../sdk\n)"), CodeSelectionConflict},
		"vendored":           {ModuleFiles{GoMod: good.GoMod, GoSum: good.GoSum, Vendored: true}, CodeSelectionConflict},
		"no requirement":     {files("require example.com/other v1.0.0"), CodeContractMismatch},
		"unparsable go.mod":  {ModuleFiles{GoMod: []byte("nope"), GoSum: good.GoSum}, CodeContractMismatch},
		"no go.sum":          {ModuleFiles{GoMod: good.GoMod}, CodeChecksumsRequired},
		"other version sums": {files("require " + Module + " v0.17.1"), CodeChecksumsRequired},
		"malformed sum":      {ModuleFiles{GoMod: good.GoMod, GoSum: []byte(Module + " v0.17.0 h1:short\n" + Module + " v0.17.0/go.mod " + goModSum + "\n")}, CodeChecksumsRequired},
		"conflicting sums":   {ModuleFiles{GoMod: good.GoMod, GoSum: []byte(goSum + Module + " v0.17.0 h1:" + strings.Repeat("C", 43) + "=\n")}, CodeIntegrityMismatch},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := Declare("c", test.files)
			var typed *devcontract.Error
			require.ErrorAs(t, err, &typed)
			require.Equal(t, test.code, typed.Code, typed.Message)
		})
	}
}

func TestDeclarationRefusalsNeverEchoReplacementTargets(t *testing.T) {
	_, err := Declare("c", ModuleFiles{GoMod: []byte("module example.com/c\n\ngo 1.26.0\n\nrequire " + Module + " v0.17.0\nreplace " + Module + " => https://user:secret@example.com/sdk\n")})
	// Whatever the parser makes of the target, it must never be copied.
	require.Error(t, err)
	require.NotContains(t, err.Error(), "secret")
	_, err = Declare("c", ModuleFiles{GoMod: []byte("module example.com/c\n\ngo 1.26.0\n\nrequire " + Module + " v0.17.0\nreplace " + Module + " => ../token-in-path\n")})
	require.Error(t, err)
	require.NotContains(t, err.Error(), "token-in-path")
}
