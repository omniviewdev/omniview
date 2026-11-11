package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	goplugin "github.com/hashicorp/go-plugin"
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

const installedNativeChildEnv = "OMNIVIEW_INSTALLED_NATIVE_TEST_CHILD"

type installedNativeReceipt struct {
	PID     int    `json:"pid"`
	Version uint32 `json:"version"`
}

// The installed executable launches this test binary, like the existing activity
// broker fixture. Compatible mode uses the real SDK controller and transport.
// Wire2 mode freezes only the released native-v2 version gate, not old payloads
// or a shipping plugin binary. Public archive acceptance remains a separate gate.
func TestInstalledNativeUpgradeChildProcess(t *testing.T) {
	mode := os.Getenv(installedNativeChildEnv)
	if mode == "" {
		return
	}
	id := os.Getenv("OMNIVIEW_PLUGIN_ID")
	nativePath := filepath.Join(os.Getenv("OMNIVIEW_INSTALLED_NATIVE_TEST_DATA"), id+".json")
	provider, err := resource.NewController(resource.Config[struct{}]{
		Catalog: func(ctx context.Context, _ resource.CatalogRequest) (resource.Catalog, error) {
			if err := ctx.Err(); err != nil {
				return resource.Catalog{}, err
			}
			data, err := os.ReadFile(nativePath)
			if err != nil {
				return resource.Catalog{}, err
			}
			var catalog resource.Catalog
			err = json.Unmarshal(data, &catalog)
			return catalog, err
		},
	})
	require.NoError(t, err)
	goplugin.Serve(&goplugin.ServeConfig{
		HandshakeConfig: (&config.PluginMeta{ID: id}).GenerateHandshakeConfig(),
		Plugins: goplugin.PluginSet{
			"resource": &resourceplugin.GRPCPlugin{Impl: provider},
			"lifecycle": &lc.Plugin{Impl: &lc.Server{
				PluginID: id, SDKProtocolVersion: 1, Capabilities: []string{"resource"},
			}},
		},
		GRPCServer: func(options []grpc.ServerOption) *grpc.Server {
			options = append(options, resourceplugin.ServerOptions()...)
			options = append(options, grpc.UnaryInterceptor(func(ctx context.Context, request any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
				if request, ok := request.(*resourcepb.Request); ok && mode == "wire2" && request.GetVersion() != 2 {
					receipt, err := json.Marshal(installedNativeReceipt{PID: os.Getpid(), Version: request.GetVersion()})
					if err != nil {
						return nil, err
					}
					path := filepath.Join(os.Getenv("OMNIVIEW_INSTALLED_NATIVE_TEST_RECEIPTS"), id+"."+mode+".json")
					if err := os.WriteFile(path, receipt, 0600); err != nil {
						return nil, err
					}
					return nil, resourceplugin.ResourceRPCError(resource.NewError("UNSUPPORTED", "unsupported resource wire version"))
				}
				return handler(ctx, request)
			}))
			return grpc.NewServer(options...)
		},
	})
	_ = provider.Close()
	os.Exit(0)
}

func installedNativeWrapper(mode string) string {
	return fmt.Sprintf("#!/bin/sh\nexport %s=%s\nexec \"$OMNIVIEW_INSTALLED_NATIVE_TEST_BINARY\" -test.run='^TestInstalledNativeUpgradeChildProcess$'\n", installedNativeChildEnv, mode)
}

func installedNativeMetadata(id, version string) string {
	return fmt.Sprintf("id: %s\nversion: %s\ncapabilities: [resource]\n", id, version)
}

func newInstalledNativeManager(t *testing.T) (*pluginManager, hostresource.Controller) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses the established Unix executable wrapper")
	}
	pm := newTestManager(t)
	pm.ctx = context.Background()
	service, err := appstate.New(appstate.WithRoot(pm.stateRoot.ResolvePath("")), appstate.WithFlock(false))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, service.Close()) })
	controller := hostresource.NewController(pm.logger, nil, service.PluginStore, invocation.NewBoundary(nil))
	controller.Run(context.Background())
	pm.connfullControllers[sdktypes.CapabilityResource] = controller
	t.Cleanup(pm.Shutdown)

	binary, err := os.Executable()
	require.NoError(t, err)
	t.Setenv("OMNIVIEW_INSTALLED_NATIVE_TEST_BINARY", binary)
	t.Setenv("OMNIVIEW_INSTALLED_NATIVE_TEST_DATA", t.TempDir())
	t.Setenv("OMNIVIEW_INSTALLED_NATIVE_TEST_RECEIPTS", t.TempDir())
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_WORKSPACE_ID", "")
	t.Setenv("OMNIVIEW_INSTANCE_ID", "")
	t.Setenv("OMNIVIEW_GENERATION", "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, "cache"))
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, "data"))
	sockets, err := os.MkdirTemp("/tmp", "ov-upgrade-")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, os.RemoveAll(sockets)) })
	t.Setenv("TMPDIR", sockets)
	t.Setenv("TMP", sockets)
	t.Setenv("TEMP", sockets)
	pm.telemetryConfigFn = func(string) (TelemetryEnvConfig, error) { return TelemetryEnvConfig{}, nil }
	return pm, controller
}

func writeInstalledNativeCatalog(t *testing.T, id, resourceType string) {
	t.Helper()
	catalog := resource.Catalog{
		Provider: id, Revision: "native-r1", Coverage: resource.Coverage{Kind: "complete", Paths: []string{}},
		Types: []resource.ResourceType{{
			Type: resourceType, DisplayName: "Native fixture object",
			IdentityDimensions: []resource.Dimension{}, QueryDimensions: []resource.Dimension{},
			Representations:       []resource.Representation{{ID: "native", Revision: "r1"}},
			DefaultRepresentation: "native", Capabilities: []resource.Capability{},
		}},
	}
	data, err := json.Marshal(catalog)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(os.Getenv("OMNIVIEW_INSTALLED_NATIVE_TEST_DATA"), id+".json"), data, 0600))
}

func installNativeProcessFixture(t *testing.T, pm *pluginManager, id, version, mode string) {
	t.Helper()
	installPluginFixture(t, pm, id, []string{"resource"}, true)
	require.NoError(t, pm.pluginsRoot.WriteFile(id+"/plugin.yaml", []byte(installedNativeMetadata(id, version)), 0644))
	require.NoError(t, pm.pluginsRoot.WriteFile(id+"/bin/plugin", []byte(installedNativeWrapper(mode)), 0755))
	writeInstalledNativeCatalog(t, id, "native/object")
}

func installedNativeArchive(t *testing.T, id, version, mode string) string {
	t.Helper()
	return writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: installedNativeMetadata(id, version)},
		{name: "bin/", mode: 0755, dir: true},
		{name: "bin/plugin", mode: 0755, body: installedNativeWrapper(mode)},
	})
}

func assertInstalledNativeServing(t *testing.T, pm *pluginManager, controller hostresource.Controller, id, resourceType string) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(invocation.HostContext(context.Background()), 5*time.Second)
	defer cancel()
	catalog, err := controller.Catalog(ctx, id, resource.CatalogRequest{Route: resource.AccessRoute{Connection: "fixture"}})
	require.NoError(t, err)
	require.Equal(t, id, catalog.Provider)
	require.Len(t, catalog.Types, 1)
	require.Equal(t, resourceType, catalog.Types[0].Type, "the host must receive the child's native file catalog")
	require.Equal(t, 1, pm.records[id].Backend.NegotiatedVersion(), "resource wire3 does not bump the process protocol")
	backend, ok := pm.records[id].Backend.(*plugintypes.ExternalBackend)
	require.True(t, ok, "installed acceptance must cross the real process boundary")
	pid := backend.ReattachConfig().Pid
	require.Positive(t, pid)
	require.NotEqual(t, os.Getpid(), pid)
	return pid
}

func assertInstalledWire2Receipt(t *testing.T, id string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(os.Getenv("OMNIVIEW_INSTALLED_NATIVE_TEST_RECEIPTS"), id+".wire2.json"))
	require.NoError(t, err, "rejection must reach the native wire-version gate")
	var receipt installedNativeReceipt
	require.NoError(t, json.Unmarshal(data, &receipt))
	require.Equal(t, uint32(3), receipt.Version)
	require.Positive(t, receipt.PID)
	require.NotEqual(t, os.Getpid(), receipt.PID)
}

func TestInstalledNativeWire2RejectsAndRecovers(t *testing.T) {
	pm, controller := newInstalledNativeManager(t)
	const id = "installed-native"
	const other = "unrelated-native"
	installNativeProcessFixture(t, pm, other, "1.0.0", "wire3")
	_, err := pm.LoadPlugin(other, nil)
	require.NoError(t, err)
	otherPID := assertInstalledNativeServing(t, pm, controller, other, "native/object")
	installNativeProcessFixture(t, pm, id, "1.0.0", "wire2")

	_, loadErr := pm.LoadPlugin(id, nil)
	require.Error(t, loadErr)
	assertInstalledWire2Receipt(t, id)
	var public apperror.AppError
	require.NoError(t, json.Unmarshal([]byte(loadErr.Error()), &public), "load failure must remain a frontend-safe problem")
	assert.Equal(t, id, public.Instance)
	assert.Equal(t, "UNSUPPORTED", resource.ErrorCode(loadErr), "preserve the native transport rejection classification")
	failed, err := pm.GetPlugin(id)
	require.NoError(t, err)
	assert.Equal(t, string(lifecycle.PhaseFailed), failed.Phase)
	assert.NotEmpty(t, failed.LastError)
	require.Nil(t, pm.records[id].Backend, "rejected native process must not remain an owned runtime")
	present, err := controller.HasPlugin(invocation.HostContext(context.Background()), id)
	require.NoError(t, err)
	assert.False(t, present, "failed feature negotiation must not expose a resource provider")
	assert.Equal(t, otherPID, assertInstalledNativeServing(t, pm, controller, other, "native/object"))
	require.NoError(t, pm.writePluginStateJSON())

	archive := installedNativeArchive(t, id, "2.0.0", "wire3")
	_, err = pm.InstallPluginFromPath(archive)
	require.NoError(t, err, "a compatible real subprocess must replace the failed installed generation")
	writeInstalledNativeCatalog(t, id, "recovered/object")
	assertInstalledNativeServing(t, pm, controller, id, "recovered/object")
	info, err := pm.GetPlugin(id)
	require.NoError(t, err)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	assert.Equal(t, "2.0.0", info.Metadata.Version)
	assert.Empty(t, info.LastError)
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	var recovered *plugintypes.PluginStateRecord
	for i := range states {
		if states[i].ID == id {
			recovered = &states[i]
		}
	}
	require.NotNil(t, recovered)
	assert.Equal(t, "2.0.0", recovered.Metadata.Version)
	assert.Equal(t, lifecycle.PhaseRunning, recovered.Phase)
	assert.Empty(t, recovered.LastError)
	assert.Equal(t, otherPID, assertInstalledNativeServing(t, pm, controller, other, "native/object"))
	assert.FileExists(t, archive, "a successful local install must not consume its caller's archive")
}

func TestInstalledNativeWire2ReplacementRollsBack(t *testing.T) {
	pm, controller := newInstalledNativeManager(t)
	const id = "installed-native"
	installNativeProcessFixture(t, pm, id, "2.0.0", "wire3")
	require.NoError(t, pm.pluginsRoot.MkdirAll(id+"/store", 0700))
	require.NoError(t, pm.pluginsRoot.WriteFile(id+"/store/survivor", []byte("original user data"), 0600))
	_, err := pm.LoadPlugin(id, nil)
	require.NoError(t, err)
	assertInstalledNativeServing(t, pm, controller, id, "native/object")
	require.NoError(t, pm.writePluginStateJSON())
	beforeState, err := pm.stateRoot.ReadFile(stateFileName)
	require.NoError(t, err)
	beforeIdentity, err := pm.pluginsRoot.DirectoryIdentity(id)
	require.NoError(t, err)
	archive := installedNativeArchive(t, id, "3.0.0", "wire2")
	beforeArchive, err := os.ReadFile(archive)
	require.NoError(t, err)
	emitter := &testRecordingEmitter{}
	pm.emitter = emitter

	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err)
	assertInstalledWire2Receipt(t, id)
	info, err := pm.GetPlugin(id)
	require.NoError(t, err)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	assert.Equal(t, "2.0.0", info.Metadata.Version)
	assertInstalledNativeServing(t, pm, controller, id, "native/object")
	afterIdentity, err := pm.pluginsRoot.DirectoryIdentity(id)
	require.NoError(t, err)
	assert.Equal(t, beforeIdentity, afterIdentity, "restore the original installation, not a reconstruction")
	afterState, err := pm.stateRoot.ReadFile(stateFileName)
	require.NoError(t, err)
	assert.Equal(t, beforeState, afterState)
	data, err := pm.pluginsRoot.ReadFile(id + "/store/survivor")
	require.NoError(t, err)
	assert.Equal(t, "original user data", string(data))
	afterArchive, err := os.ReadFile(archive)
	require.NoError(t, err)
	assert.Equal(t, beforeArchive, afterArchive)
	for _, event := range emitter.getEvents() {
		assert.NotEqual(t, EventInventoryChanged, event.event)
		assert.NotEqual(t, EventInstallFinished, event.event)
	}
}
