package devserver

import (
	"context"
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
	"github.com/omniviewdev/omniview/internal/instance"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

const publishedPluginID = "published-fixture"

// publishedBuild is a real managed workspace whose manifest has no SDK link, a
// real plugin module requiring the SDK floor release served by a hermetic world.
type publishedBuild struct {
	world     *sdktest.World
	sdk       sdktest.Release
	extra     map[string]sdktest.Release
	uuid      sdktest.Release
	plugin    string
	goPath    string
	workspace devcontract.ResolvedWorkspace
	state     *appstate.Service
}

func newPublishedBuild(t *testing.T, mutateSDK func(tree string), extraVersions ...string) *publishedBuild {
	t.Helper()
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("Go tool unavailable")
	}
	// The service is created before the managed workspace environment exists:
	// it refuses a state root that disagrees with the profile.
	state := appstate.NewTestService(t)
	world := sdktest.New(t)
	home := sdktest.Home(t)
	sdk := world.PublishSDK(devsdk.FloorVersion, mutateSDK)
	extra := map[string]sdktest.Release{}
	for _, version := range extraVersions {
		extra[version] = world.PublishSDK(version, nil)
	}
	uuid := world.PublishPinned("github.com/google/uuid")
	// The pinned releases are derived from the controller's own module graph, so
	// the hermetic environment applies only after they are published.
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, ".cache"))
	for _, entry := range world.Environment() {
		key, value, _ := strings.Cut(entry, "=")
		t.Setenv(key, value)
	}
	plugin := world.Consumer("plugin", sdk, uuid)
	require.NoError(t, os.MkdirAll(filepath.Join(plugin, "pkg"), 0o700))
	require.NoError(t, os.Rename(filepath.Join(plugin, "main.go"), filepath.Join(plugin, "pkg", "main.go")))
	world.Write(plugin, "plugin.yaml", "id: "+publishedPluginID+"\nname: Published Fixture\nversion: 1.0.0\ncapabilities: [ui]\n")

	revision := strings.Repeat("a", 40)
	require.NoError(t, os.MkdirAll(filepath.Join(world.Root, "host"), 0o700))
	manifest := devcontract.WorkspaceManifest{
		SchemaVersion: devcontract.SchemaVersion,
		WorkspaceID:   "5b0c9a3e-1f0a-4c55-9d52-9d7a1d5b7a11",
		Slug:          "published-sdk",
		DisplayName:   "Published SDK",
		Repositories: []devcontract.Repository{
			{ID: "omniview", Directory: "host", BaseRef: "main", BaseCommit: revision, Branch: "feature/published"},
			{ID: "plugin", Directory: "plugin", BaseRef: "main", BaseCommit: revision, Branch: "feature/published"},
		},
		Plugins: []devcontract.Plugin{{ID: publishedPluginID, RepositoryID: "plugin", Mode: "managed"}},
		Links:   devcontract.Links{SDKRepositoryID: nil},
		Profile: devcontract.Profile{Kind: "development"},
		Ports:   devcontract.PortPolicy{Policy: "sticky"},
	}
	data, err := json.Marshal(manifest)
	require.NoError(t, err)
	manifestPath := filepath.Join(world.Root, "workspace.json")
	require.NoError(t, os.WriteFile(manifestPath, data, 0o600))
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: manifestPath, Home: home})
	require.NoError(t, err)
	selection, err := devsdk.SelectionOf(workspace)
	require.NoError(t, err)
	require.Equal(t, devsdk.ModePublished, selection.Mode(), "a null SDK link selects the published SDK")
	t.Setenv(devcontract.WorkspaceEnvironment, workspace.ManifestPath)
	t.Setenv("OMNIVIEW_WORKSPACE_ID", workspace.Manifest.WorkspaceID)
	t.Setenv("OMNIVIEW_STATE_DIR", workspace.StateRoot)
	return &publishedBuild{world: world, sdk: sdk, extra: extra, uuid: uuid, plugin: plugin, goPath: goPath, workspace: workspace, state: state}
}

func (b *publishedBuild) watcher(t *testing.T, goPath string, policy devsdk.Policy) *goWatcherProcess {
	t.Helper()
	workspace := b.workspace
	var logs []LogEntry
	watcher := newGoWatcherProcess(context.Background(), logging.NewNop(), publishedPluginID, b.plugin,
		BuildOpts{GoPath: goPath, Environment: os.Environ(), Workspace: &workspace, SDKPolicy: policy},
		nil, b.state.Plugins(), func(entry LogEntry) { logs = append(logs, entry) }, func(DevProcessStatus) {}, func(time.Duration, string) {}, func(string, []BuildError) {})
	t.Cleanup(watcher.cancel)
	return watcher
}

func (b *publishedBuild) installed() string {
	return b.state.Plugins().ResolvePath(filepath.Join(publishedPluginID, "bin", "plugin"))
}

func digestOf(t *testing.T, directory string, names ...string) [32]byte {
	t.Helper()
	hash := sha256.New()
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(directory, name))
		require.NoError(t, err)
		hash.Write(data)
	}
	var sum [32]byte
	copy(sum[:], hash.Sum(nil))
	return sum
}

func requireTyped(t *testing.T, err error, code string) *devcontract.Error {
	t.Helper()
	require.Error(t, err)
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed, "the refusal must stay typed: %v", err)
	require.Equal(t, code, typed.Code, typed.Message)
	return typed
}

func TestPublishedManagedBuildCompilesAgainstTheDeclaredRelease(t *testing.T) {
	build := newPublishedBuild(t, nil)
	before := digestOf(t, build.plugin, "go.mod", "go.sum", "pkg/main.go")
	entries, err := os.ReadDir(build.plugin)
	require.NoError(t, err)

	watcher := build.watcher(t, build.goPath, devsdk.ReleasePolicy())
	require.NoError(t, watcher.buildPlugin(true, "", time.Now()))

	published, ok := watcher.sdk.Published()
	require.True(t, ok)
	require.Equal(t, build.sdk.Published(), published)
	info, err := buildinfo.ReadFile(build.installed())
	require.NoError(t, err)
	var found bool
	for _, dependency := range info.Deps {
		if dependency.Path == devsdk.Module {
			found = true
			require.Equal(t, build.sdk.Version, dependency.Version)
			require.Equal(t, build.sdk.ModuleSum, dependency.Sum)
			require.Nil(t, dependency.Replace)
		}
	}
	require.True(t, found)
	require.Equal(t, before, digestOf(t, build.plugin, "go.mod", "go.sum", "pkg/main.go"), "the build must not edit consumer Go files")
	after, err := os.ReadDir(build.plugin)
	require.NoError(t, err)
	require.Len(t, after, len(entries), "no vendor tree or workspace file may appear in the plugin repository")
	require.NoError(t, instance.VerifyPluginArtifact(build.workspace, publishedPluginID, build.installed()),
		"the published build attests through the same artifact record")
	installed, err := sdktypes.LoadPluginMetadata(build.state.Plugins().ResolvePath(publishedPluginID))
	require.NoError(t, err)
	require.Nil(t, installed.StateIsolation, "private host evidence authorizes a published launch, not installed provenance")
}

func TestPublishedManagedBuildRefusesUntrustedSDKSelectionsTypedAndUnattested(t *testing.T) {
	appendTo := func(name, content string) func(*publishedBuild, *testing.T) {
		return func(b *publishedBuild, t *testing.T) {
			path := filepath.Join(b.plugin, name)
			data, err := os.ReadFile(path)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(path, append(data, []byte(content)...), 0o600))
		}
	}
	wrong := "h1:" + strings.Repeat("A", 43) + "="
	tests := map[string]struct {
		mutateSDK func(tree string)
		prepare   func(*publishedBuild, *testing.T)
		code      string
	}{
		"sdk replace": {
			prepare: appendTo("go.mod", "\nreplace "+devsdk.Module+" => ./sdk\n"), code: devsdk.CodeSelectionConflict,
		},
		"vendor directory": {
			prepare: func(b *publishedBuild, t *testing.T) { b.world.Write(b.plugin, "vendor/modules.txt", "# vendored\n") },
			code:    devsdk.CodeSelectionConflict,
		},
		"below the floor": {
			prepare: func(b *publishedBuild, t *testing.T) {
				old := b.extra["v0.16.0"]
				b.world.Write(b.plugin, "go.mod", fmt.Sprintf("module example.com/plugin\n\ngo 1.26.0\n\nrequire (\n\t%s %s\n\t%s %s\n)\n",
					old.Module, old.Version, b.uuid.Module, b.uuid.Version))
				b.world.Write(b.plugin, "go.sum", fmt.Sprintf("%s %s %s\n%s %s/go.mod %s\n%s %s %s\n%s %s/go.mod %s\n",
					old.Module, old.Version, old.ModuleSum, old.Module, old.Version, old.GoModSum,
					b.uuid.Module, b.uuid.Version, b.uuid.ModuleSum, b.uuid.Module, b.uuid.Version, b.uuid.GoModSum))
			},
			code: devsdk.CodeReleaseUntrusted,
		},
		"wrong go.sum checksum": {
			prepare: func(b *publishedBuild, t *testing.T) {
				b.world.Write(b.plugin, "go.sum", fmt.Sprintf("%s %s %s\n%s %s/go.mod %s\n%s %s %s\n%s %s/go.mod %s\n",
					b.sdk.Module, b.sdk.Version, wrong, b.sdk.Module, b.sdk.Version, b.sdk.GoModSum,
					b.uuid.Module, b.uuid.Version, b.uuid.ModuleSum, b.uuid.Module, b.uuid.Version, b.uuid.GoModSum))
			},
			// The recorded tuple is not the reviewed one: a branch's go.sum cannot attest itself.
			code: devsdk.CodeReleaseUntrusted,
		},
		"tampered module cache": {
			prepare: func(b *publishedBuild, t *testing.T) {
				b.world.Download(b.plugin, b.sdk)
				path := filepath.Join(b.world.Extracted(b.sdk), "pkg", "state", "root.go")
				data, err := os.ReadFile(path)
				require.NoError(t, err)
				require.NoError(t, os.Chmod(path, 0o600))
				require.NoError(t, os.WriteFile(path, append(data, []byte("\n// tampered\n")...), 0o600))
			},
			code: devsdk.CodeIntegrityMismatch,
		},
		"capability-less release": {
			mutateSDK: func(tree string) {
				path := filepath.Join(tree, "pkg", "config", "isolation.go")
				data, err := os.ReadFile(path)
				require.NoError(t, err)
				require.NoError(t, os.WriteFile(path, []byte(strings.Replace(string(data), `"state-root-v1"`, `"none"`, 1)), 0o600))
			},
			code: devsdk.CodeReleaseUntrusted,
		},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			build := newPublishedBuild(t, test.mutateSDK, "v0.16.0")
			if test.prepare != nil {
				test.prepare(build, t)
			}
			// The world's policy is the production table plus the world's synthetic
			// releases, and refuses to let a release override a reviewed row. A
			// mutated floor release has synthetic checksums for a reviewed version,
			// so its case names it as the only reviewed row: the capability check,
			// not the reviewed table, is then the subject.
			var policy devsdk.Policy
			if test.mutateSDK != nil {
				policy = devsdk.NewReleasePolicy(devsdk.FloorVersion, build.sdk.Published())
			} else {
				policy = build.world.Policy(build.sdk)
			}
			watcher := build.watcher(t, build.goPath, policy)
			err := watcher.buildPlugin(true, "", time.Now())
			requireTyped(t, err, test.code)
			require.NoFileExists(t, build.installed())
			require.Error(t, instance.VerifyPluginArtifact(build.workspace, publishedPluginID, build.installed()), "no artifact record may exist")
		})
	}
}

func TestPublishedManagedBuildRefusesAnSDKChangedDuringTheBuild(t *testing.T) {
	build := newPublishedBuild(t, nil, "v0.18.0")
	second := build.extra["v0.18.0"]
	alternate := filepath.Join(sdktest.TempDir(t), "go.mod.alt")
	require.NoError(t, os.WriteFile(alternate, []byte(fmt.Sprintf("module example.com/plugin\n\ngo 1.26.0\n\nrequire (\n\t%s %s\n\t%s %s\n)\n",
		second.Module, second.Version, build.uuid.Module, build.uuid.Version)), 0o600))
	sums, err := os.ReadFile(filepath.Join(build.plugin, "go.sum"))
	require.NoError(t, err)
	build.world.Write(build.plugin, "go.sum", string(sums)+fmt.Sprintf("%s %s %s\n%s %s/go.mod %s\n",
		second.Module, second.Version, second.ModuleSum, second.Module, second.Version, second.GoModSum))

	// The wrapped go swaps the SDK requirement right after the compile, the
	// window between the before and after verifications.
	wrapper := filepath.Join(sdktest.TempDir(t), "go")
	script := fmt.Sprintf("#!/bin/sh\n%q \"$@\"\nstatus=$?\nif [ \"$1\" = build ]; then cp %q go.mod; fi\nexit $status\n", build.goPath, alternate)
	require.NoError(t, os.WriteFile(wrapper, []byte(script), 0o700))

	watcher := build.watcher(t, wrapper, build.world.Policy(build.sdk, second))
	err = watcher.buildPlugin(true, "", time.Now())
	typed := requireTyped(t, err, devsdk.CodeIdentityChanged)
	require.Equal(t, 4, typed.Exit)
	require.NoFileExists(t, build.installed())
	require.Error(t, instance.VerifyPluginArtifact(build.workspace, publishedPluginID, build.installed()))
}

func TestPublishedManagedBuildUsesTheZeroPolicyRefusal(t *testing.T) {
	build := newPublishedBuild(t, nil)
	watcher := build.watcher(t, build.goPath, devsdk.Policy{})
	err := watcher.buildPlugin(true, "", time.Now())
	requireTyped(t, err, devsdk.CodeReleaseUntrusted)
	require.NoFileExists(t, build.installed())
}

func TestUnmanagedBuildVerifiesNothingEvenWithPublishedFiles(t *testing.T) {
	build := newPublishedBuild(t, nil)
	// The zero policy would refuse any published identity: success proves the
	// unmanaged build never asked the verifier.
	for _, key := range []string{devcontract.WorkspaceEnvironment, "OMNIVIEW_WORKSPACE_ID", "OMNIVIEW_STATE_DIR"} {
		t.Setenv(key, "")
	}
	watcher := build.watcher(t, build.goPath, devsdk.Policy{})
	watcher.buildOpts.Workspace = nil
	require.NoError(t, watcher.runGoBuild())
	require.Equal(t, devsdk.Identity{}, watcher.sdk, "an unmanaged build must not verify or attest an SDK")
}

func TestSyncPluginYamlWritesNoStateIsolationForPublishedIdentity(t *testing.T) {
	build := newPublishedBuild(t, nil)
	watcher := build.watcher(t, build.goPath, devsdk.ReleasePolicy())
	require.NoError(t, watcher.runGoBuild())
	require.Equal(t, devsdk.ModePublished, watcher.sdk.Mode())
	source, err := os.ReadFile(filepath.Join(build.plugin, "plugin.yaml"))
	require.NoError(t, err)
	require.NoError(t, watcher.syncPluginYaml())
	installed, err := os.ReadFile(build.state.Plugins().ResolvePath(filepath.Join(publishedPluginID, "plugin.yaml")))
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, yaml.Unmarshal(installed, &decoded))
	require.NotContains(t, decoded, "state_isolation")
	after, err := os.ReadFile(filepath.Join(build.plugin, "plugin.yaml"))
	require.NoError(t, err)
	require.Equal(t, source, after, "never rewrite source metadata")
}
