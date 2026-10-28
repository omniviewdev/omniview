package resource

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	goplugin "github.com/hashicorp/go-plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const nativeChildPluginID = "p45-native-verification"

func compileNativeChild(t *testing.T) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	require.True(t, ok)
	sdkRoot := filepath.Clean(filepath.Join(filepath.Dir(source), "../../../../../plugin-sdk"))
	binary := filepath.Join(t.TempDir(), "p45-native-fixture")
	command := exec.Command("go", "test", "-c", "-o", binary, "./internal/resourceconformance")
	command.Dir = sdkRoot
	command.Env = append(os.Environ(), "GOWORK=off")
	output, err := command.CombinedOutput()
	require.NoError(t, err, "compile actual SDK fixture: %s", output)
	return binary
}

func startNativeChild(t *testing.T, binary, profile string) (resource.Provider, string, func()) {
	t.Helper()
	root := t.TempDir()
	home := filepath.Join(root, "home")
	receipts := filepath.Join(root, "receipts")
	require.NoError(t, os.MkdirAll(home, 0700))
	require.NoError(t, os.MkdirAll(receipts, 0700))
	sockets, err := os.MkdirTemp("/tmp", "p45-native-")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.RemoveAll(sockets) })
	meta := config.PluginMeta{ID: nativeChildPluginID}
	handshake := meta.GenerateHandshakeConfig()
	command := exec.Command(binary, "-test.run=^TestCurrentSDKChild$")
	command.Env = []string{
		"HOME=" + home, "USERPROFILE=" + home, "TMPDIR=" + sockets, "TMP=" + sockets, "TEMP=" + sockets,
		"XDG_CONFIG_HOME=" + filepath.Join(home, "config"), "XDG_CACHE_HOME=" + filepath.Join(home, "cache"), "XDG_DATA_HOME=" + filepath.Join(home, "data"),
		"GOWORK=off", "OMNIVIEW_STATE_DIR=" + root, "OMNIVIEW_TELEMETRY_ENABLED=false", "OMNIVIEW_TELEMETRY_PROFILING=false",
		"P45_NATIVE_CHILD=1", "P45_NATIVE_PROFILE=" + profile, "P45_NATIVE_RECEIPTS=" + receipts,
		handshake.MagicCookieKey + "=" + handshake.MagicCookieValue, "PLUGIN_PROTOCOL_VERSIONS=1",
	}
	client := goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: handshake, SkipHostEnv: true, Cmd: command,
		VersionedPlugins: map[int]goplugin.PluginSet{1: {"resource": &resourceplugin.GRPCPlugin{}}},
		AllowedProtocols: []goplugin.Protocol{goplugin.ProtocolGRPC}, StartTimeout: 15 * time.Second,
	})
	t.Cleanup(client.Kill)
	rpc, err := client.Client()
	require.NoError(t, err)
	capability, err := rpc.Dispense("resource")
	require.NoError(t, err)
	provider, ok := capability.(resource.Provider)
	require.True(t, ok)
	return provider, receipts, func() { client.Kill(); assert.True(t, client.Exited(), "native child must exit") }
}

func nativeCloudScope() resource.QueryScope {
	account := []string{"111111111111"}
	region := []string{"us-west-2"}
	return resource.QueryScope{{Dimension: "account", Match: resource.ScopeOneOf, Values: &account}, {Dimension: "region", Match: resource.ScopeOneOf, Values: &region}}
}

func TestActualSDKChildHostFiniteBoundary(t *testing.T) {
	binary := compileNativeChild(t)
	for _, profile := range []string{"read-only", "get-only", "native-query-only", "catalog-only"} {
		t.Run(profile, func(t *testing.T) {
			provider, receipts, stop := startNativeChild(t, binary, profile)
			defer stop()
			ctrl, _ := newTestControllerWithEmitter(t)
			registerMockPlugin(ctrl, nativeChildPluginID, provider)
			const connection = "cloud-bundled-pages"
			_, err := ctrl.StartConnection(testInvocationContext(), nativeChildPluginID, connection)
			require.NoError(t, err)
			route := resource.AccessRoute{Connection: connection}
			catalog, err := ctrl.Catalog(testInvocationContext(), nativeChildPluginID, resource.CatalogRequest{Route: route})
			require.NoError(t, err)
			require.Len(t, catalog.Types, 1)
			operations := map[resource.Operation]bool{}
			for _, capability := range catalog.Types[0].Capabilities {
				operations[capability.Operation] = true
			}
			assert.Equal(t, profile == "read-only" || profile == "get-only", operations[resource.OperationGet])
			assert.Equal(t, profile == "read-only", operations[resource.OperationEnumerate])
			assert.Equal(t, profile == "native-query-only", operations[resource.OperationNativeQuery])
			target, err := ctrl.ResolveTarget(testInvocationContext(), nativeChildPluginID, ResolveTargetRequest{Route: route, Type: catalog.Types[0].Type, Representation: "native", Scope: nativeCloudScope()})
			require.NoError(t, err)
			assert.NotEmpty(t, target.Target.Authority)
			assert.NotEqual(t, "cloud-partition:fixture", target.Target.Authority)
			request := HostGetRequest{TargetID: target.TargetID, Request: resource.GetRequest{Route: route, Representation: "native", Reference: resource.ResourceReference{Address: resource.ResourceAddress{
				Provider: catalog.Provider, Authority: target.Target.Authority, Type: target.Target.Type,
				ID: "arn:fixture:compute:us-west-2:111111111111:instance/a::b/雪%2F", Scope: []resource.ScopeEntry{{Dimension: "account", Value: "111111111111"}, {Dimension: "region", Value: "us-west-2"}},
			}}}}
			_, err = ctrl.Get(context.Background(), nativeChildPluginID, request)
			require.Error(t, err, "unissued caller must be denied before acquisition")
			_, found := ctrl.registryStore.Get(nativeChildPluginID, request.Request.Reference, route)
			assert.False(t, found, "denial must not materialize registry state")
			get, err := ctrl.Get(testInvocationContext(), nativeChildPluginID, request)
			if operations[resource.OperationGet] {
				require.NoError(t, err)
				assert.Equal(t, request.Request.Reference, get.Record.Reference)
				assert.Equal(t, "9007199254740993", get.Record.Body.Map["sizeBytes"].Int)
				assert.NotEmpty(t, get.Key)
			} else {
				assert.Equal(t, "UNSUPPORTED", requireAppError(t, err).Code)
			}
			pageRequest := HostEnumerateRequest{TargetID: target.TargetID, Request: resource.EnumerateRequest{Target: target.Target}}
			page, err := ctrl.Enumerate(testInvocationContext(), nativeChildPluginID, pageRequest)
			if operations[resource.OperationEnumerate] {
				require.NoError(t, err)
				require.Len(t, page.Records, 1)
				require.NotNil(t, page.SourcePage.NextCursor)
				assert.Equal(t, "unknown", page.SourcePage.Count.Kind)
				assert.Equal(t, "bestEffort", page.SourcePage.Consistency)
				pageRequest.Request.Cursor = page.SourcePage.NextCursor
				next, err := ctrl.Enumerate(testInvocationContext(), nativeChildPluginID, pageRequest)
				require.NoError(t, err)
				require.Len(t, next.Records, 1)
				assert.Equal(t, "18446744073709551615", next.Records[0].Record.Body.Map["sizeBytes"].Uint)
				assert.NotEqual(t, page.Records[0].Key, next.Records[0].Key)
				verifyNativeChildCancellation(t, ctrl, pageRequest, receipts, connection)
			} else {
				assert.Equal(t, "UNSUPPORTED", requireAppError(t, err).Code)
			}
			query, err := ctrl.NativeQuery(testInvocationContext(), nativeChildPluginID, HostNativeQueryRequest{TargetID: target.TargetID, Request: resource.NativeQueryRequest{Target: target.Target, Language: "fixture.compute.v1", Query: resource.Value{Kind: "int64", Int: "9007199254740993"}}})
			if operations[resource.OperationNativeQuery] {
				require.NoError(t, err)
				require.Len(t, query.Records, 1)
				assert.Equal(t, "9007199254740994", query.Records[0].Record.Body.Map["computed"].Int)
				assert.Equal(t, "1969-12-31T23:59:59.999999999Z", query.Records[0].Record.Body.Map["beforeEpoch"].Timestamp)
			} else {
				assert.Equal(t, "UNSUPPORTED", requireAppError(t, err).Code)
			}
			_, err = ctrl.StopConnection(testInvocationContext(), nativeChildPluginID, connection)
			require.NoError(t, err)
			_, err = os.Stat(filepath.Join(receipts, connection+".closed"))
			require.NoError(t, err, "native source must close before host stop returns")
		})
	}
}

func verifyNativeChildCancellation(t *testing.T, ctrl *controller, request HostEnumerateRequest, receipts, connection string) {
	t.Helper()
	cursor := "verification:wait-for-cancel"
	request.Request.Cursor = &cursor
	ctx, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := ctrl.Enumerate(ctx, nativeChildPluginID, request); done <- err }()
	require.Eventually(t, func() bool { _, err := os.Stat(filepath.Join(receipts, connection+".waiting")); return err == nil }, 5*time.Second, 10*time.Millisecond)
	cancel()
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("host cancellation did not return")
	}
	require.Eventually(t, func() bool { _, err := os.Stat(filepath.Join(receipts, connection+".cancelled")); return err == nil }, 5*time.Second, 10*time.Millisecond)
}
