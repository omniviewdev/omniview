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

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

func TestReleasePolicyAdmitsReleasedTagsAtOrAboveTheFloorOnly(t *testing.T) {
	policy := ReleasePolicy()
	admit := func(version string) error {
		published := fixturePublished()
		published.Version = version
		identity, err := NewPublishedIdentity(published)
		require.NoError(t, err, version)
		return policy.Admit(identity)
	}
	for _, version := range []string{FloorVersion, "v0.17.1", "v0.18.0", "v1.0.0", "v2.3.4"} {
		require.NoError(t, admit(version), version)
	}
	for _, version := range []string{
		"v0.16.0", "v0.16.99", "v0.10.0", "v0.1.0",
		"v0.17.1-0.20261108000000-abcdefabcdef", // pseudo-version above the floor
		"v0.18.0-rc.1", "v0.18.0-0.20261108000000-abcdefabcdef",
	} {
		err := admit(version)
		require.ErrorIs(t, err, ErrNotAccepted, version)
	}
	require.Error(t, admitRelease(Published{Module: Module, Version: "v0.17.0+build"}), "build metadata is never a release tag")
	require.ErrorIs(t, Policy{}.Admit(mustPublished(t)), ErrNotAccepted, "the zero policy still accepts no published release")
}

func mustPublished(t *testing.T) Identity {
	t.Helper()
	identity, err := NewPublishedIdentity(fixturePublished())
	require.NoError(t, err)
	return identity
}

// The floor is the SDK the controller is itself built against. When the
// controller's pin moves, raising the floor must be a deliberate edit.
func TestFloorMatchesTheControllerPin(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "go.mod"))
	require.NoError(t, err)
	module, err := modfile.Parse("go.mod", data, nil)
	require.NoError(t, err)
	pinned := ""
	for _, requirement := range module.Require {
		if requirement.Mod.Path == Module {
			pinned = requirement.Mod.Version
		}
	}
	require.Equal(t, pinned, FloorVersion, "go.mod pins the SDK the controller builds against; FloorVersion must equal it (edit both deliberately)")
	sums, err := os.ReadFile(filepath.Join("..", "..", "go.sum"))
	require.NoError(t, err)
	moduleSum, goModSum, err := recordedSums(sums, pinned)
	require.NoError(t, err)
	require.NotEmpty(t, moduleSum)
	require.NotEmpty(t, goModSum)

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
