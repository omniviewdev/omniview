package devserver

import (
	"context"
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/go-hclog"
	goplugin "github.com/hashicorp/go-plugin"
	"github.com/stretchr/testify/require"
	"golang.org/x/mod/modfile"

	pluginsettings "github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsource"
	"github.com/omniviewdev/omniview/internal/instance"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const sdkRPCContractID = "sdk-rpc-contract"

type sdkRPCContract struct {
	ctx                                    context.Context
	goPath, root, home, origin, repository string
	env                                    []string
}

// sdkRPCSelectSource admits an explicit source or the source file of the SDK
// function actually linked into this test binary. It never resolves the root
// repository's original go.mod, which may differ from a parent's -modfile.
func sdkRPCSelectSource(explicit, compiledFile string) (string, error) {
	selected := explicit
	authority := "SDK_SOURCE"
	if selected == "" {
		authority = "compiled SDK source; set SDK_SOURCE explicitly"
		if !filepath.IsAbs(compiledFile) || !strings.HasSuffix(filepath.ToSlash(compiledFile), "/pkg/v1/settings/provider.go") {
			return "", fmt.Errorf("cannot locate absolute compiled SDK source (possibly -trimpath); set SDK_SOURCE explicitly")
		}
		selected = filepath.Clean(filepath.Join(filepath.Dir(compiledFile), "../../.."))
		if _, err := os.Stat(compiledFile); err != nil {
			return "", fmt.Errorf("%s: %w", authority, err)
		}
	}
	selected, err := filepath.Abs(selected)
	if err != nil {
		return "", fmt.Errorf("%s: %w", authority, err)
	}
	selected, err = filepath.EvalSymlinks(selected)
	if err != nil {
		return "", fmt.Errorf("%s: %w", authority, err)
	}
	data, err := os.ReadFile(filepath.Join(selected, "go.mod"))
	if err != nil {
		return "", fmt.Errorf("%s: %w", authority, err)
	}
	module, err := modfile.Parse("go.mod", data, nil)
	if err != nil {
		return "", fmt.Errorf("%s: %w", authority, err)
	}
	if module.Module == nil || module.Module.Mod.Path != sdkModulePath {
		return "", fmt.Errorf("%s must select actual module %s", authority, sdkModulePath)
	}
	return selected, nil
}

func newSDKRPCContract(t *testing.T, ctx context.Context) *sdkRPCContract {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	repository := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "../../../.."))
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	home := filepath.Join(root, "home")
	require.NoError(t, os.MkdirAll(home, 0700))
	userHome, err := os.UserHomeDir()
	require.NoError(t, err)
	userCache, err := os.UserCacheDir()
	require.NoError(t, err)
	goPath := filepath.Join(runtime.GOROOT(), "bin", "go")
	// Even environment discovery has a private HOME and no user Go config.
	// Retain only explicit cache paths (or Go's standard defaults) for offline
	// compilation; nothing from the human credential environment is inherited.
	discoveryEnv := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + home, "GOWORK=off", "GOENV=off", "GOTOOLCHAIN=local", "GOPATH=" + filepath.Join(userHome, "go"), "GOCACHE=" + filepath.Join(userCache, "go-build")}
	for _, key := range []string{"GOPATH", "GOCACHE", "GOMODCACHE"} {
		if value := os.Getenv(key); value != "" {
			discoveryEnv = append(discoveryEnv, key+"="+value)
		}
	}
	command := exec.CommandContext(ctx, goPath, "env", "-json", "GOCACHE", "GOMODCACHE")
	command.Env = discoveryEnv
	raw, err := command.CombinedOutput()
	require.NoError(t, err, string(raw))
	var caches map[string]string
	require.NoError(t, json.Unmarshal(raw, &caches))
	// go-plugin's Unix socket pathname must also fit on macOS; testing's long
	// per-test directory names are not a suitable socket parent.
	tmp, err := os.MkdirTemp("", "ov-sdk-rpc-")
	require.NoError(t, err)
	t.Cleanup(func() {
		if err := os.RemoveAll(tmp); err != nil {
			t.Errorf("remove owned subprocess temporary directory: %v", err)
		}
	})
	for _, path := range []string{home, tmp} {
		require.NoError(t, os.MkdirAll(path, 0700))
	}
	kubeconfig := filepath.Join(root, "empty-kubeconfig")
	require.NoError(t, os.WriteFile(kubeconfig, []byte("apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n"), 0600))
	environment := []string{
		"PATH=" + os.Getenv("PATH"), "HOME=" + home, "TMPDIR=" + tmp, "TMP=" + tmp, "TEMP=" + tmp,
		"GOWORK=off", "GOENV=off", "GOTOOLCHAIN=local", "GOFLAGS=", "GOPROXY=off", "GOSUMDB=off",
		"GOCACHE=" + caches["GOCACHE"], "GOMODCACHE=" + caches["GOMODCACHE"], "GOPATH=" + filepath.Join(home, "go"),
		"XDG_CONFIG_HOME=" + filepath.Join(home, ".config"), "XDG_DATA_HOME=" + filepath.Join(home, ".local", "share"),
		"XDG_CACHE_HOME=" + filepath.Join(home, ".cache"), "KUBECONFIG=" + kubeconfig, "OMNIVIEW_TELEMETRY_ENABLED=false",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=" + os.DevNull, "GIT_TERMINAL_PROMPT=0",
	}
	fixture := &sdkRPCContract{ctx: ctx, goPath: goPath, root: root, home: home, repository: repository, env: environment}
	// An explicit source is authoritative and does not depend on unused release
	// metadata. Otherwise inspect the function actually linked by the parent,
	// preserving -modfile replacements that go list on root go.mod would lose.
	explicit, compiledFile := os.Getenv("SDK_SOURCE"), ""
	authority := "SDK_SOURCE"
	if explicit == "" {
		authority = "compiled sdksettings.NewProviderWrapper"
		if function := runtime.FuncForPC(reflect.ValueOf(sdksettings.NewProviderWrapper).Pointer()); function != nil {
			compiledFile, _ = function.FileLine(function.Entry())
		}
	}
	selected, err := sdkRPCSelectSource(explicit, compiledFile)
	require.NoError(t, err)
	fixture.origin = selected
	t.Logf("selected SDK source: authority=%s module=%s directory=%s compiled-source-file=%s", authority, sdkModulePath, selected, compiledFile)
	// If the actual selected source is a released module-cache directory, log
	// its own version/archive checksum, never another root manifest's SDK. These
	// optional metadata bytes are distinct from the verified source digest.
	if moduleCache, cacheErr := filepath.EvalSymlinks(caches["GOMODCACHE"]); cacheErr == nil {
		prefix := filepath.Join(moduleCache, filepath.FromSlash(sdkModulePath)) + "@"
		if version, inCache := strings.CutPrefix(selected, prefix); inCache && !strings.ContainsAny(version, `/\`) {
			archiveSum, sumErr := os.ReadFile(filepath.Join(moduleCache, "cache", "download", filepath.FromSlash(sdkModulePath), "@v", version+".ziphash"))
			t.Logf("selected module-cache SDK metadata: version=%s archiveSum=%s checksumReadError=%v", version, strings.TrimSpace(string(archiveSum)), sumErr)
		}
	}
	if info, statErr := os.Stat(filepath.Join(selected, ".git")); statErr == nil && (info.IsDir() || info.Mode().IsRegular()) {
		command := exec.CommandContext(ctx, "git", "-C", selected, "rev-parse", "HEAD")
		command.Env = environment
		revision, revisionErr := command.CombinedOutput()
		require.NoError(t, revisionErr, string(revision))
		t.Logf("explicit/effective SDK source: directory=%s actual HEAD=%s (distinct from fixture-local snapshot commits)", selected, strings.TrimSpace(string(revision)))
	} else {
		t.Logf("selected SDK source: directory=%s (no Git identity; fixture-local snapshot recorded separately)", selected)
	}
	// Production artifact/profile adapters consult the current process HOME.
	// Test subprocesses still receive only the explicit allowlist above.
	t.Setenv("HOME", home)
	t.Setenv("GOWORK", "off")
	return fixture
}

func sdkRPCCopyTree(source, target string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if entry.Name() == ".git" || entry.Name() == ".local" || entry.Name() == "node_modules" {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("fixture source must be regular, not redirected: %s", path)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(destination, data, 0600)
	})
}

func (f *sdkRPCContract) snapshot(t *testing.T, directory string) string {
	t.Helper()
	git := func(args ...string) string {
		t.Helper()
		prefix := []string{"-C", directory, "-c", "user.name=SDK contract fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=" + os.DevNull}
		command := exec.CommandContext(f.ctx, "git", append(prefix, args...)...)
		command.Env = f.env
		output, err := command.CombinedOutput()
		require.NoError(t, err, string(output))
		return strings.TrimSpace(string(output))
	}
	git("init", "-q")
	git("add", "--all")
	git("commit", "-qm", "Disposable contract snapshot; not an upstream reviewed commit")
	return git("rev-parse", "HEAD")
}

type sdkRPCReady struct {
	hostPID, pluginPID     int
	hostLabel, pluginLabel string
	sdkDigest, buildOrigin string
}

type sdkRPCProfile struct {
	fixture                                 *sdkRPCContract
	source, sdkSource, revision, generation string
	workspace                               devcontract.ResolvedWorkspace
	env                                     []string
	state                                   *appstate.Service
	watcher                                 *goWatcherProcess
	readyEvents                             chan sdkRPCReady
	failures                                chan string
	mu                                      sync.Mutex
	live                                    sdkRPCReady
	buildStatus                             DevProcessStatus
	buildOrigin                             string
	backend                                 *plugintypes.ExternalBackend
	controller                              pluginsettings.Controller
	store                                   *settingsstore.Store
	host                                    *exec.Cmd
	hostInput                               io.WriteCloser
	hostDone                                chan error
	hostDirectory                           string
}

func (f *sdkRPCContract) profile(t *testing.T, name string) *sdkRPCProfile {
	t.Helper()
	root := filepath.Join(f.root, name)
	p := &sdkRPCProfile{fixture: f, source: filepath.Join(root, "consumer"), sdkSource: filepath.Join(root, "sdk"), generation: uuid.NewString(), readyEvents: make(chan sdkRPCReady, 16), failures: make(chan string, 32)}
	require.NoError(t, sdkRPCCopyTree(f.origin, p.sdkSource))
	p.revision = f.snapshot(t, p.sdkSource)
	t.Logf("%s owned SDK snapshot: source=%s actual fixture-local Git SHA=%s (not upstream review identity)", name, p.sdkSource, p.revision)
	require.NoError(t, sdkRPCCopyTree(filepath.Join(f.repository, "backend", "pkg", "plugin", "devserver", "testdata", "sdk-rpc-contract"), p.source))
	// Reuse the host's resolved dependency cohort, not its imports/build graph.
	// Only ./host and ./pkg are compiled. The actual SDK replacement is queried
	// again through VerifySelectedSDK and checked in each compiled executable.
	data, err := os.ReadFile(filepath.Join(f.repository, "go.mod"))
	require.NoError(t, err)
	module, err := modfile.Parse("go.mod", data, nil)
	require.NoError(t, err)
	require.NoError(t, module.AddModuleStmt("example.invalid/omniview-sdk-rpc-contract"))
	for _, replacement := range module.Replace {
		if replacement.Old.Path == sdkModulePath {
			require.NoError(t, module.DropReplace(replacement.Old.Path, replacement.Old.Version))
		}
	}
	require.NoError(t, module.AddReplace(sdkModulePath, "", p.sdkSource, ""))
	data, err = module.Format()
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(p.source, "go.mod"), data, 0600))
	sums, err := os.ReadFile(filepath.Join(f.repository, "go.sum"))
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(p.source, "go.sum"), sums, 0600))
	require.NoError(t, os.WriteFile(filepath.Join(p.source, "plugin.yaml"), []byte("id: sdk-rpc-contract\nname: SDK RPC contract\nversion: 0.1.0\nschema_version: 1\nsdk_protocol_version: 1\ncapabilities: [settings]\n"), 0600))
	consumerRevision := f.snapshot(t, p.source)
	sdkID := "plugin-sdk"
	manifest := devcontract.WorkspaceManifest{
		SchemaVersion: devcontract.SchemaVersion, WorkspaceID: uuid.NewString(), Slug: "sdk-rpc-" + name, DisplayName: "Tiny SDK RPC " + name,
		Repositories: []devcontract.Repository{
			{ID: "omniview", Directory: "consumer", BaseRef: "HEAD", BaseCommit: consumerRevision, Branch: "fixture/consumer"},
			{ID: sdkID, Directory: "sdk", BaseRef: "HEAD", BaseCommit: p.revision, Branch: "fixture/sdk"},
		},
		Plugins: []devcontract.Plugin{{ID: sdkRPCContractID, RepositoryID: "omniview", Mode: "managed"}},
		Links:   devcontract.Links{SDKRepositoryID: &sdkID}, Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"},
	}
	data, err = json.Marshal(manifest)
	require.NoError(t, err)
	manifestPath := filepath.Join(root, "workspace.json")
	require.NoError(t, os.WriteFile(manifestPath, data, 0600))
	p.workspace, err = devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: manifestPath, Home: f.home})
	require.NoError(t, err)
	release, err := devcontract.LockProfile(f.ctx, f.home, p.workspace.Manifest.WorkspaceID)
	require.NoError(t, err)
	err = devcontract.EnsureDefaultProfileOwnership(f.home, p.workspace.Manifest.WorkspaceID)
	release()
	require.NoError(t, err, "claim the disposable profile before creating state children")
	p.env = append(append([]string{}, f.env...), devcontract.WorkspaceEnvironment+"="+p.workspace.ManifestPath, "OMNIVIEW_WORKSPACE_ID="+p.workspace.Manifest.WorkspaceID, "OMNIVIEW_STATE_DIR="+p.workspace.StateRoot)
	p.state, err = appstate.New(appstate.WithRoot(p.workspace.StateRoot))
	require.NoError(t, err)
	t.Cleanup(func() {
		if p.watcher != nil {
			if err := p.watcher.Stop(); err != nil {
				t.Errorf("retire real watcher/compiler before removing owned sources: %v", err)
			}
		}
		p.mu.Lock()
		if err := p.stopConsumers(); err != nil {
			t.Errorf("drain owned consumers: %v", err)
		}
		p.mu.Unlock()
		if err := p.state.Close(); err != nil {
			t.Errorf("close owned profile state: %v", err)
		}
	})
	// Materialize both imported-package and complete-module metadata while this
	// newly generated fixture is still being prepared. Dependency registration
	// uses the second query too: letting that first lazy go.sum update occur
	// after root watches are registered would synthesize a setup rebuild.
	// Only preparation permits module edits; watched compilation uses the same
	// empty GOFLAGS as the production managed-workspace environment.
	for _, args := range [][]string{
		{"list", "-mod=mod", "-deps", "./host", "./pkg"},
		{"list", "-mod=mod", "-m", "-json", "all"},
	} {
		command := exec.CommandContext(f.ctx, f.goPath, args...)
		command.Dir, command.Env = p.source, p.env
		output, err := command.CombinedOutput()
		require.NoError(t, err, string(output))
	}
	p.identity(t)
	return p
}

func (p *sdkRPCProfile) compile(target, output string) ([]byte, error) {
	command := exec.CommandContext(p.fixture.ctx, p.fixture.goPath, "build", "-o", output, target)
	command.Dir, command.Env = p.source, p.env
	return command.CombinedOutput()
}

func (p *sdkRPCProfile) writeAPI(t *testing.T, label string) {
	t.Helper()
	data := fmt.Sprintf("package settings\n\nfunc (s Setting) WithContractLabel(consumer string) Setting {\n s.Label = consumer + %q\n return s\n}\n", " "+label)
	require.NoError(t, os.WriteFile(filepath.Join(p.sdkSource, "settings", "contract_label.go"), []byte(data), 0600))
}

func (p *sdkRPCProfile) writeBrokenAPI(t *testing.T) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(p.sdkSource, "settings", "contract_label.go"), []byte("package settings\nfunc syntax error\n"), 0600))
}

func (p *sdkRPCProfile) identity(t *testing.T) devsource.Identity {
	t.Helper()
	identity, err := VerifySelectedSDK(p.fixture.ctx, p.fixture.goPath, p.source, p.revision, p.env)
	require.NoError(t, err)
	require.Equal(t, p.sdkSource, identity.Directory, "actual Go module replacement must select the owned copy")
	require.Equal(t, p.revision, identity.ReviewedRevision, "fixture-local source-verifier baseline, not invented upstream identity")
	require.Len(t, identity.SourceDigest, 64)
	return identity
}

func (p *sdkRPCProfile) start(t *testing.T) {
	t.Helper()
	metadataBefore := make(map[string][sha256.Size]byte)
	for _, name := range []string{"go.mod", "go.sum"} {
		data, err := os.ReadFile(filepath.Join(p.source, name))
		require.NoError(t, err)
		metadataBefore[name] = sha256.Sum256(data)
	}
	p.watcher = newGoWatcherProcess(p.fixture.ctx, logging.NewNop(), sdkRPCContractID, p.source,
		BuildOpts{GoPath: p.fixture.goPath, Environment: p.env, ExpectedSDKRevision: p.revision, Workspace: &p.workspace, Generation: p.generation},
		p, p.state.Plugins(), func(entry LogEntry) {
			if entry.Source == logSourceGoBuild && entry.Level == logLevelInfo {
				p.mu.Lock()
				p.buildOrigin = entry.Message
				p.mu.Unlock()
			}
		}, func(status DevProcessStatus) {
			p.mu.Lock()
			p.buildStatus = status
			p.mu.Unlock()
		},
		func(_ time.Duration, buildError string) {
			if buildError != "" {
				select {
				case p.failures <- buildError:
				case <-p.fixture.ctx.Done():
				}
			}
		}, func(string, []BuildError) {})
	require.NoError(t, p.watcher.Start())
	for name, before := range metadataBefore {
		data, err := os.ReadFile(filepath.Join(p.source, name))
		require.NoError(t, err)
		require.Equal(t, before, sha256.Sum256(data), "prepared %s must not be rewritten by watcher registration/initial operation; setup events are not SDK mutations", name)
	}
	require.Contains(t, p.watcher.WatchedDirectories(), filepath.Join(p.sdkSource, "settings"), "ordinary SDK API writes must reach the production watcher")
}

// This is a real process owner, not a success-only reload mock. The production
// builder calls it only after source verification and atomic artifact publish.
// It compiles/starts the host consumer, launches SDK Serve through go-plugin,
// uses production ExternalBackend lifecycle and controller RPC/store adapters,
// and commits a ready observation only after actual schema/hydration RPCs work.
func (p *sdkRPCProfile) ReloadPlugin(string) error {
	return fmt.Errorf("the contract requires generation-bound reload")
}

func (p *sdkRPCProfile) ReloadManagedPlugin(ctx context.Context, id, source, generation string) error {
	if id != sdkRPCContractID || source != p.source || generation != p.generation {
		return fmt.Errorf("unowned reload target")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	before, err := VerifySelectedSDK(ctx, p.fixture.goPath, p.source, p.revision, p.env)
	if err != nil {
		return err
	}
	hostDirectory, err := os.MkdirTemp(p.workspace.StateRoot, ".host-consumer-")
	if err != nil {
		return err
	}
	defer func() {
		if hostDirectory != "" {
			_ = os.RemoveAll(hostDirectory)
		}
	}()
	hostBinary := filepath.Join(hostDirectory, "host")
	command := exec.CommandContext(ctx, p.fixture.goPath, "build", "-o", hostBinary, "./host")
	command.Dir, command.Env = p.source, p.env
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("compile host consumer: %w: %s", err, output)
	}
	if err := p.verifyCompiledSDK(hostBinary); err != nil {
		return err
	}
	after, err := VerifySelectedSDK(ctx, p.fixture.goPath, p.source, p.revision, p.env)
	if err != nil {
		return err
	}
	if before != after {
		return fmt.Errorf("selected source changed during host compile")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := p.stopConsumers(); err != nil {
		return err
	}
	p.hostDirectory, hostDirectory = hostDirectory, ""
	if err := p.launchHost(hostBinary); err != nil {
		return err
	}
	if err := p.launchPlugin(); err != nil {
		return err
	}
	category, err := p.controller.Snapshot(sdkRPCContractID)
	if err != nil {
		return err
	}
	if category.Settings["counter"].Label != p.live.pluginLabel {
		return fmt.Errorf("controller schema differs from actual SDK settings RPC")
	}
	p.live.pluginPID = p.backend.ReattachConfig().Pid
	p.live.sdkDigest, p.live.buildOrigin = before.SourceDigest, p.buildOrigin
	select {
	case p.readyEvents <- p.live:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *sdkRPCProfile) launchHost(binary string) error {
	command := exec.CommandContext(p.fixture.ctx, binary)
	command.Env = p.fixture.env
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	input, err := command.StdinPipe()
	if err != nil {
		return err
	}
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		_ = input.Close()
		return err
	}
	p.host, p.hostInput, p.hostDone = command, input, make(chan error, 1)
	go func() { p.hostDone <- command.Wait() }()
	var response struct {
		PID    int                             `json:"pid"`
		Schema map[string]pkgsettings.Category `json:"schema"`
	}
	if err := json.NewDecoder(stdout).Decode(&response); err != nil {
		return fmt.Errorf("read actual host provider schema: %w", err)
	}
	if response.PID != command.Process.Pid {
		return fmt.Errorf("host provider response did not originate from owned child")
	}
	p.live.hostPID = response.PID
	p.live.hostLabel = response.Schema["host"].Settings["counter"].Label
	return nil
}

func (p *sdkRPCProfile) launchPlugin() error {
	installed := p.state.Plugins().ResolvePath(filepath.Join(sdkRPCContractID, "bin", "plugin"))
	if err := p.verifyCompiledSDK(installed); err != nil {
		return err
	}
	// Use the same attested private executable snapshot and child environment
	// adapters as the production plugin loader, not the mutable source output.
	binary, cleanup, err := instance.PreparePluginArtifact(p.workspace, sdkRPCContractID, installed)
	if err != nil {
		return err
	}
	metadata, err := sdktypes.LoadPluginMetadata(p.state.Plugins().ResolvePath(sdkRPCContractID))
	if err != nil {
		cleanup()
		return err
	}
	environment, err := instance.PluginEnvironment(p.workspace.StateRoot, sdkRPCContractID, p.env)
	if err != nil {
		cleanup()
		return err
	}
	command := exec.CommandContext(p.fixture.ctx, binary)
	command.Env = environment
	client := goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: metadata.GenerateHandshakeConfig(),
		VersionedPlugins: map[int]goplugin.PluginSet{1: {
			"settings": &sdksettings.SettingsPlugin{}, "lifecycle": &lifecycle.Plugin{},
		}},
		GRPCDialOptions: sdk.GRPCDialOptions(), Cmd: command, SkipHostEnv: true,
		StartTimeout: 10 * time.Second, AllowedProtocols: []goplugin.Protocol{goplugin.ProtocolGRPC}, Logger: hclog.NewNullLogger(),
	})
	rpc, err := client.Client()
	if err != nil {
		client.Kill()
		cleanup()
		return fmt.Errorf("actual SDK Serve handshake: %w", err)
	}
	backend := plugintypes.NewExternalBackend(client, rpc)
	backend.SetProcessCleanup(cleanup)
	p.backend = backend
	if !backend.Healthy() {
		return fmt.Errorf("actual SDK lifecycle RPC is not healthy")
	}
	// A fresh controller and reopened bbolt store on every replacement prevent
	// cached schema/value state from masquerading as persisted rehydration.
	p.store, err = settingsstore.Open(filepath.Join(p.workspace.StateRoot, "settings-contract.db"))
	if err != nil {
		return err
	}
	p.controller = pluginsettings.NewController(logging.NewNop(), p.store)
	p.controller.OnPluginInit(sdkRPCContractID, metadata)
	if err := p.controller.OnPluginStart(sdkRPCContractID, metadata, backend); err != nil {
		return err
	}
	// Query the SDK client itself as well: the controller schema-cache fallback
	// is not admissible evidence for a functioning plugin transport.
	raw, err := backend.Dispense("settings")
	if err != nil {
		return err
	}
	provider, ok := raw.(sdksettings.Provider)
	if !ok {
		return fmt.Errorf("unexpected actual settings RPC provider %T", raw)
	}
	setting, err := provider.GetSetting("counter")
	if err != nil {
		return fmt.Errorf("direct settings RPC after hydration: %w", err)
	}
	p.live.pluginLabel = setting.Label
	return nil
}

func (p *sdkRPCProfile) verifyCompiledSDK(binary string) error {
	info, err := buildinfo.ReadFile(binary)
	if err != nil {
		return err
	}
	for _, dependency := range info.Deps {
		if dependency.Path == sdkModulePath {
			if dependency.Replace == nil || dependency.Replace.Path != p.sdkSource {
				return fmt.Errorf("compiled consumer did not select owned SDK module: %+v", dependency)
			}
			return nil
		}
	}
	return fmt.Errorf("compiled consumer does not contain actual SDK module %s", sdkModulePath)
}

func (p *sdkRPCProfile) stopConsumers() error {
	var result error
	if p.controller != nil {
		result = p.controller.OnPluginStop(sdkRPCContractID, config.PluginMeta{ID: sdkRPCContractID})
		p.controller = nil
	}
	if p.backend != nil {
		_ = p.backend.Stop()
		p.backend.Kill() // production adapter drains its owned go-plugin runner
		if !p.backend.Exited() {
			result = fmt.Errorf("owned plugin process did not exit")
		}
		p.backend = nil
	}
	if p.store != nil {
		if err := p.store.Close(); err != nil {
			result = err
		}
		p.store = nil
	}
	if p.host != nil {
		_ = p.hostInput.Close()
		select {
		case err := <-p.hostDone:
			if err != nil {
				result = fmt.Errorf("owned host consumer exit: %w", err)
			}
		case <-time.After(5 * time.Second):
			_ = p.host.Process.Kill()
			<-p.hostDone
			result = fmt.Errorf("owned host consumer failed to exit on stdin close")
		}
		p.host, p.hostInput, p.hostDone = nil, nil, nil
	}
	if p.hostDirectory != "" {
		if err := os.RemoveAll(p.hostDirectory); err != nil {
			result = err
		}
		p.hostDirectory = ""
	}
	return result
}

func (p *sdkRPCProfile) ready(t *testing.T) sdkRPCReady {
	t.Helper()
	select {
	case event := <-p.readyEvents:
		return event
	case failure := <-p.failures:
		t.Fatalf("real compile/reload failed before ready: %s", failure)
	case <-p.fixture.ctx.Done():
		t.Fatalf("waiting for actual host/settings RPC ready: %v", p.fixture.ctx.Err())
	}
	return sdkRPCReady{}
}

func (p *sdkRPCProfile) failed(t *testing.T) string {
	t.Helper()
	select {
	case failure := <-p.failures:
		// The error callback precedes the builder's final status transition.
		// Synchronize on the actual operation, never sleep or use fake time.
		p.watcher.buildMu.Lock()
		p.watcher.buildMu.Unlock()
		return failure
	case event := <-p.readyEvents:
		t.Fatalf("invalid SDK source unexpectedly committed ready: %+v", event)
	case <-p.fixture.ctx.Done():
		t.Fatalf("waiting for real compiler syntax failure: %v", p.fixture.ctx.Err())
	}
	return ""
}

func (p *sdkRPCProfile) current(t *testing.T) sdkRPCReady {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	require.NotNil(t, p.backend)
	require.True(t, p.backend.Healthy())
	require.NotNil(t, p.host)
	select {
	case err := <-p.hostDone:
		p.hostDone <- err // retain exit evidence for the cleanup owner
		t.Fatalf("owned host provider exited before replacement: %v", err)
	default:
	}
	return p.live
}

func (p *sdkRPCProfile) assertNoReady(t *testing.T) {
	t.Helper()
	p.mu.Lock()
	status := p.buildStatus
	p.mu.Unlock()
	require.Equal(t, DevProcessStatusError, status, "compiler failure cannot advertise build readiness")
	select {
	case event := <-p.readyEvents:
		t.Fatalf("failed SDK build advertised a new ready generation: %+v", event)
	default:
	}
}

func (p *sdkRPCProfile) set(t *testing.T, value int) {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	result, err := p.controller.CommitSettings(
		context.Background(), sdkRPCContractID, map[string]any{"counter": value},
		func(values map[string]any) error { return p.store.PatchPluginSettings(sdkRPCContractID, values) },
	)
	require.NoError(t, err)
	require.True(t, result.Applied, "the actual plugin subprocess must apply the durable settings")
}

func (p *sdkRPCProfile) assertValue(t *testing.T, expected int) {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	raw, err := p.backend.Dispense("settings")
	require.NoError(t, err)
	provider, ok := raw.(sdksettings.Provider)
	require.True(t, ok)
	value, err := provider.GetSettingValue("counter")
	require.NoError(t, err, "value must come from the actual subprocess SDK provider")
	require.EqualValues(t, expected, value)
}

func (p *sdkRPCProfile) assertLabels(t *testing.T, suffix string) {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	raw, err := p.backend.Dispense("settings")
	require.NoError(t, err)
	provider, ok := raw.(sdksettings.Provider)
	require.True(t, ok)
	setting, err := provider.GetSetting("counter")
	require.NoError(t, err)
	require.Equal(t, "plugin "+suffix, setting.Label)
	require.Equal(t, "host "+suffix, p.live.hostLabel)
}

func (p *sdkRPCProfile) assertPersisted(t *testing.T, expected int) {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	values, err := p.store.LoadPluginSettings(sdkRPCContractID)
	require.NoError(t, err)
	require.EqualValues(t, expected, values["counter"])
}

func (p *sdkRPCProfile) artifactDigest(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(p.state.Plugins().ResolvePath(filepath.Join(sdkRPCContractID, "bin", "plugin")))
	require.NoError(t, err)
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
