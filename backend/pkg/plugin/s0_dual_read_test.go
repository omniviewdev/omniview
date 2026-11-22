package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// SPIKE S0 (SDK0-S0-dual-read.md). ONE host process (one pluginManager, one resource controller) runs real
// plugin processes built on two generations of the SDK, at once, and calls each:
//
//	notes-old020  SDK v0.20.0   protocol 1, resource wire 3  (what the shipped Kubernetes plugin is built on)
//	notes-old021  SDK v0.21.0   protocol 1, resource wire 3
//	notes-new     modified SDK  protocol 2, resource wire 4, with a REQUIRED ResourceType.environment
//
// The executables come from testdata/s0/build-fixtures.sh (S0_FIXTURE_DIR). Each is the SDK's own
// examples/resource-plugin, so nothing in the plugin is test code.

const s0FixtureEnv = "S0_FIXTURE_DIR"

func s0Fixture(t *testing.T, name string) string {
	t.Helper()
	dir := os.Getenv(s0FixtureEnv)
	if dir == "" {
		t.Skipf("%s names the directory testdata/s0/build-fixtures.sh filled", s0FixtureEnv)
	}
	exe := filepath.Join(dir, name)
	_, err := os.Stat(exe)
	require.NoError(t, err)
	return exe
}

// s0InstallPrebuilt installs a real executable as plugin id, with a manifest that declares
// sdkProtocol (0 = leave the key out, so the compiled constant applies).
func s0InstallPrebuilt(t *testing.T, pm *pluginManager, id, exe string, sdkProtocol int) {
	t.Helper()
	manifest := "id: " + id + "\nname: " + id + "\nversion: 1.0.0\ncapabilities:\n  - resource\n"
	if sdkProtocol > 0 {
		manifest += "sdk_protocol_version: " + strconv.Itoa(sdkProtocol) + "\n"
	}
	dir := pm.pluginsRoot.ResolvePath(id)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "bin"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(manifest), 0o644))
	data, err := os.ReadFile(exe)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "bin", plugintypes.BinaryName()), data, 0o755))
}

var s0Generations = []struct {
	id          string
	sdk         string
	protocol    int
	environment string
}{
	{"notes-old020", "v0.20.0", 1, ""},
	{"notes-old021", "v0.21.0", 1, ""},
	{"notes-new", "modified SDK (wire 4)", 2, "embedded-notes"},
}

func s0Context() (context.Context, context.CancelFunc) {
	return context.WithTimeout(invocation.HostContext(context.Background()), 10*time.Second)
}

// s0Calls makes the two calls to a loaded plugin: its catalog through the host's own resource controller,
// and a Get through the resource client the loader dispensed for it.
func s0Calls(t *testing.T, pm *pluginManager, controller hostresource.Controller, id string) (resource.Catalog, resource.Record) {
	t.Helper()
	ctx, cancel := s0Context()
	defer cancel()
	route := resource.AccessRoute{Connection: "local"}
	catalog, err := controller.Catalog(ctx, id, resource.CatalogRequest{Route: route})
	require.NoError(t, err, "catalog through the host's resource controller")

	raw, err := pm.records[id].Backend.Dispense("resource")
	require.NoError(t, err)
	provider, ok := raw.(resource.Provider)
	require.True(t, ok, "the dispensed resource client is a resource.Provider")
	getter, ok := provider.(resource.Getter)
	require.True(t, ok)
	pinned := resource.WithCatalogRevisionForRoute(ctx, catalog.Provider, route, catalog.Revision)
	record, err := getter.Get(pinned, resource.GetRequest{
		Route: route,
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{
			Provider: catalog.Provider, Authority: "s0-host", Type: "note", ID: "welcome",
		}},
		Representation: "native",
	})
	require.NoError(t, err, "Get through the dispensed client")
	return catalog, record
}

func TestS0OneHostRunsTwoSDKGenerationsAtOnce(t *testing.T) {
	pm, controller := newInstalledNativeManager(t)
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	for _, g := range s0Generations {
		s0InstallPrebuilt(t, pm, g.id, s0Fixture(t, g.id), 0)
		_, err := pm.LoadPlugin(g.id, nil)
		require.NoError(t, err, "%s (%s) must load on the one host", g.id, g.sdk)
	}
	// All three are running together; each has the protocol its own SDK speaks.
	for _, g := range s0Generations {
		assert.Equal(t, g.protocol, pm.records[g.id].Backend.NegotiatedVersion(), g.id)
		assert.Equal(t, string(lifecycle.PhaseRunning), pm.records[g.id].ToInfo().Phase, g.id)
	}
	for _, g := range s0Generations {
		catalog, record := s0Calls(t, pm, controller, g.id)
		require.Len(t, catalog.Types, 1, g.id)
		assert.Equal(t, "note", catalog.Types[0].Type, g.id)
		assert.Equal(t, g.environment, catalog.Types[0].Environment,
			"%s: the new member arrives from the wire-4 plugin and is absent (not required) from the wire-3 ones", g.id)
		assert.Equal(t, "Welcome to resource plugins", record.Body.Map["title"].String, g.id)
	}
	// A side effect of CurrentProtocolVersion becoming 2: EventDeprecatedProtocol, unreachable while the host offered only 1,
	// now fires for every protocol-1 plugin on every start (denied to the window by internal/auditgate/policy.json, but logged and emitted).
	deprecated := 0
	for _, event := range recorder.getEvents() {
		if event.event == EventDeprecatedProtocol {
			deprecated++
		}
	}
	assert.Equal(t, 2, deprecated, "the two protocol-1 plugins, not the protocol-2 one")
}

// The protocol number is only a proxy for the wire: the SDK lets the manifest's sdk_protocol_version override
// the compiled constant (pkg/sdk/plugin.go effectiveProtocolVersion), so a manifest that lies puts the host on
// the wrong wire. The plugin's own strict reader refuses the first call, typed, and the host says "failed":
// it cannot know why from a number alone, which is what GetInfo carrying the wire (SDK0 row V1) would fix.
func TestS0AManifestThatMovesTheProtocolPutsTheHostOnTheWrongWireAndFailsTyped(t *testing.T) {
	for _, tc := range []struct {
		name, id string
		manifest int
	}{
		{"wire-4 plugin whose manifest says protocol 1", "notes-new", 1},
		{"wire-3 plugin whose manifest says protocol 2", "notes-old020", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pm, controller := newInstalledNativeManager(t)
			recorder := &testRecordingEmitter{}
			pm.emitter = recorder
			s0InstallPrebuilt(t, pm, tc.id, s0Fixture(t, tc.id), tc.manifest)
			_, err := pm.LoadPlugin(tc.id, nil)
			require.Error(t, err)
			assert.Equal(t, "UNSUPPORTED", resource.ErrorCode(err), "the plugin's strict reader answered with a typed class")
			assert.Equal(t, UnloadFailed, loadFailureCause(err))
			present, hasErr := controller.HasPlugin(invocation.HostContext(context.Background()), tc.id)
			require.NoError(t, hasErr)
			assert.False(t, present, "no provider is exposed for a plugin the host could not speak to")
		})
	}
}

type s0Refusal struct {
	name     string
	id       string
	manifest int // sdk_protocol_version the plugin's manifest declares; 0 leaves the compiled constant
	floor    int // the host's floor for its channel
	protocol int // what the plugin negotiates
	tooOld   bool
	sentence string
}

func TestS0IncompatibleIsDecidedByNumberAndNamesBothVersions(t *testing.T) {
	for _, tc := range []s0Refusal{
		{
			name: "a protocol-1 plugin on a host whose channel floor is 2", id: "notes-old020", floor: 2, protocol: 1, tooOld: true,
			sentence: "This plugin was built for plugin protocol 1. This Omniview needs 2 or newer. Update the plugin.",
		},
		{
			name: "a protocol-3 plugin on a host that runs up to 2", id: "notes-new", manifest: 3, floor: 1, protocol: 3,
			sentence: "This plugin was built for plugin protocol 3. This Omniview runs up to 2. Update Omniview.",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pm, _ := newInstalledNativeManager(t)
			recorder := &testRecordingEmitter{}
			pm.emitter = recorder
			pm.minProtocol = tc.floor
			s0InstallPrebuilt(t, pm, tc.id, s0Fixture(t, tc.id), tc.manifest)

			started := time.Now()
			_, err := pm.LoadPlugin(tc.id, nil)
			took := time.Since(started)
			require.Error(t, err)
			assert.Less(t, took, 10*time.Second)

			facts, typed := plugintypes.IncompatibilityOf(err)
			require.True(t, typed, "the refusal is a typed value, found by errors.As: %v", err)
			assert.Equal(t, plugintypes.Incompatibility{PluginProtocol: tc.protocol, HostFloor: tc.floor, HostNewest: plugintypes.CurrentProtocolVersion}, facts,
				"both numbers, and the newest the host runs")
			assert.Equal(t, tc.tooOld, facts.PluginTooOld())
			assert.Equal(t, UnloadIncompatible, loadFailureCause(err))

			// The sentence is the host's, composed from the numbers: none of go-plugin's.
			var public apperror.AppError
			require.NoError(t, json.Unmarshal([]byte(err.Error()), &public), "the load error stays a frontend-safe problem")
			assert.Equal(t, tc.sentence, public.Detail)
			assert.NotContains(t, err.Error(), "incompatible API version")

			info, getErr := pm.GetPlugin(tc.id)
			require.NoError(t, getErr)
			assert.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
			assert.Equal(t, tc.sentence, info.LastError)
			require.NotNil(t, info.Incompatible, "the facts ride the inventory record the window already reads")
			assert.Equal(t, facts, *info.Incompatible)
			raw, jsonErr := json.Marshal(info)
			require.NoError(t, jsonErr)
			var wire map[string]any
			require.NoError(t, json.Unmarshal(raw, &wire))
			assert.Equal(t, map[string]any{"pluginProtocol": float64(tc.protocol), "hostFloor": float64(tc.floor), "hostNewest": float64(plugintypes.CurrentProtocolVersion)}, wire["incompatible"])

			// The window is told one word and nothing else (TestTheEventIsAPluginIDAndACauseCodeAndNothingElse).
			assert.Equal(t, toldOf(tc.id, "incompatible"), toldUnloaded(t, recorder.getEvents()))
			require.Nil(t, pm.records[tc.id].Backend, "the refused process is not kept")
		})
	}
}

// What stays untyped: a plugin more than offeredProtocolCeiling protocols ahead is not named by go-plugin's
// handshake at all, so it still fails with go-plugin's string and the generic cause.
func TestS0APluginBeyondTheOfferedCeilingIsStillGoPluginsText(t *testing.T) {
	pm, _ := newInstalledNativeManager(t)
	s0InstallPrebuilt(t, pm, "notes-new", s0Fixture(t, "notes-new"), offeredProtocolCeiling+24)
	_, err := pm.LoadPlugin("notes-new", nil)
	require.Error(t, err)
	_, typed := plugintypes.IncompatibilityOf(err)
	assert.False(t, typed)
	assert.Equal(t, UnloadFailed, loadFailureCause(err))
	assert.Contains(t, err.Error(), "incompatible API version with plugin. Plugin version: "+strconv.Itoa(offeredProtocolCeiling+24))
}

func TestS0TheCauseIsReadFromTheTypeAndNeverFromTheText(t *testing.T) {
	text := errors.New("incompatible API version with plugin. Plugin version: 2, Client versions: [1]")
	assert.Equal(t, UnloadFailed, loadFailureCause(text), "words say nothing: go-plugin's sentence is not a decision")
	typed := &plugintypes.IncompatibleError{Incompatibility: plugintypes.Incompatibility{PluginProtocol: 1, HostFloor: 2, HostNewest: 2}}
	assert.Equal(t, UnloadIncompatible, loadFailureCause(typed))
	assert.Equal(t, UnloadIncompatible, loadFailureCause(apperror.Wrap(typed, apperror.TypePluginLoadFailed, 500, "Failed to initialize plugin RPC")),
		"it survives the wrapping the loader applies")
	assert.Equal(t, UnloadIncompatible, loadFailureCause(errors.Join(errors.New("x"), typed)))
}

func TestS0TheFloorFollowsTheReleaseChannel(t *testing.T) {
	pm := newTestManager(t)
	assert.Equal(t, stableProtocolFloor, pm.protocolFloor(), "no registry: the stable floor")
	for channel, want := range map[string]int{
		"stable": stableProtocolFloor, "nightly": stableProtocolFloor, "feature-ui-next": featureProtocolFloor,
	} {
		pm.registryClient = registry.NewClient("").WithHostReleaseChannel(channel)
		assert.Equal(t, want, pm.protocolFloor(), channel)
	}
	pm.minProtocol = 7
	assert.Equal(t, 7, pm.protocolFloor(), "a test may hold another")
}

func TestS0ProtocolsTheHostRunsAndTheirWires(t *testing.T) {
	wire, ok := plugintypes.ResourceWire(1)
	assert.True(t, ok)
	assert.Equal(t, uint32(3), wire)
	wire, ok = plugintypes.ResourceWire(2)
	assert.True(t, ok)
	assert.Equal(t, uint32(4), wire)
	for _, protocol := range []int{-1, 0, 3, 16} {
		_, ok = plugintypes.ResourceWire(protocol)
		assert.False(t, ok, protocol)
	}
	sets := versionedPlugins()
	require.Len(t, sets, offeredProtocolCeiling)
	assert.NotEmpty(t, sets[1])
	assert.NotEmpty(t, sets[2])
	assert.Empty(t, sets[3], "offered so that go-plugin names it, but carries no capability")
}

// The shipped Kubernetes plugin itself (main, v0.21.2, built on SDK v0.20.0: protocol 1, wire 3): the binary
// the plan says must keep loading until it is rebuilt. S0_KUBERNETES_EXE is the executable built from
// omniview-plugin-kubernetes@524d1232 (`go build ./pkg`), S0_KUBERNETES_MANIFEST its plugin.yaml. The UI
// capability is dropped from the installed copy of the manifest: there is no UI bundle in a Go test.
func s0InstallShipped(t *testing.T) (*pluginManager, hostresource.Controller, string) {
	t.Helper()
	exe, manifest := os.Getenv("S0_KUBERNETES_EXE"), os.Getenv("S0_KUBERNETES_MANIFEST")
	if exe == "" || manifest == "" {
		t.Skip("S0_KUBERNETES_EXE and S0_KUBERNETES_MANIFEST name the shipped Kubernetes plugin build")
	}
	pm, controller := newInstalledNativeManager(t)
	const id = "kubernetes"
	text, err := os.ReadFile(manifest)
	require.NoError(t, err)
	text = []byte(strings.Replace(string(text), "    - ui\n", "", 1))
	dir := pm.pluginsRoot.ResolvePath(id)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "bin"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), text, 0o644))
	data, err := os.ReadFile(exe)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "bin", plugintypes.BinaryName()), data, 0o755))
	return pm, controller, id
}

func TestS0TheShippedKubernetesPluginKeepsLoadingOnTheDualReadHost(t *testing.T) {
	pm, controller, id := s0InstallShipped(t)
	_, err := pm.LoadPlugin(id, nil)
	require.NoError(t, err, "the shipped plugin must load on the dual-read host")
	assert.Equal(t, 1, pm.records[id].Backend.NegotiatedVersion(), "protocol 1: it is built on SDK v0.20.0")

	ctx, cancel := s0Context()
	defer cancel()
	raw, err := pm.records[id].Backend.Dispense("resource")
	require.NoError(t, err)
	provider, ok := raw.(resource.Provider)
	require.True(t, ok)
	// Two resource-lane calls over wire 3 to the real binary: the call lane (features) and the ancillary lane (connections).
	features, err := resource.DetectFeatures(ctx, provider)
	require.NoError(t, err)
	assert.NotEmpty(t, features.Traits)
	t.Logf("negotiated protocol 1; the shipped plugin's resource traits over wire 3: %v", features.Traits)
	lister, ok := raw.(interface {
		ListConnections(context.Context) ([]sdktypes.Connection, error)
	})
	require.True(t, ok)
	connections, err := lister.ListConnections(ctx)
	require.NoError(t, err)
	t.Logf("ListConnections over wire 3: %d connections (the test's HOME has no kubeconfig)", len(connections))
	present, err := controller.HasPlugin(invocation.HostContext(context.Background()), id)
	require.NoError(t, err)
	assert.True(t, present, "the host exposes the shipped plugin's resource provider")
}

func TestS0TheShippedKubernetesPluginIsRefusedInWordsWhenTheChannelFloorMoves(t *testing.T) {
	pm, controller, id := s0InstallShipped(t)
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	pm.minProtocol = 2 // the flip: every channel floor 2
	_, err := pm.LoadPlugin(id, nil)
	require.Error(t, err)
	facts, typed := plugintypes.IncompatibilityOf(err)
	require.True(t, typed, "%v", err)
	assert.Equal(t, plugintypes.Incompatibility{PluginProtocol: 1, HostFloor: 2, HostNewest: 2}, facts)
	info, getErr := pm.GetPlugin(id)
	require.NoError(t, getErr)
	assert.Equal(t, "This plugin was built for plugin protocol 1. This Omniview needs 2 or newer. Update the plugin.", info.LastError)
	assert.Equal(t, toldOf(id, "incompatible"), toldUnloaded(t, recorder.getEvents()))
	present, hasErr := controller.HasPlugin(invocation.HostContext(context.Background()), id)
	require.NoError(t, hasErr)
	assert.False(t, present, "no provider is exposed for a refused plugin")
}
