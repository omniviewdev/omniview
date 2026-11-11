package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	goplugin "github.com/hashicorp/go-plugin"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const nativeChildPluginID = "p45-native-verification"

func compileNativeChild(t *testing.T) string {
	t.Helper()
	return compileSourceChild(t)
}

func startNativeChild(t *testing.T, binary, profile string) (resource.Provider, string, func()) {
	return startSDKChild(t, binary, profile, "TestCurrentSDKChild", nil)
}

func startSDKChild(t *testing.T, binary, profile, testName string, childEnv []string) (resource.Provider, string, func()) {
	t.Helper()
	root := t.TempDir()
	home := filepath.Join(root, "home")
	receipts := filepath.Join(root, "receipts")
	require.NoError(t, os.MkdirAll(home, 0700))
	require.NoError(t, os.MkdirAll(receipts, 0700))
	pluginDir := filepath.Join(root, "plugins", nativeChildPluginID)
	require.NoError(t, os.MkdirAll(pluginDir, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(pluginDir, "plugin.yaml"), []byte("id: "+nativeChildPluginID+"\nversion: 0.0.0\n"), 0600))
	socketRoot := "/tmp"
	if runtime.GOOS == "windows" {
		socketRoot = os.TempDir()
	}
	sockets, err := os.MkdirTemp(socketRoot, "p45-native-")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.RemoveAll(sockets) })
	meta := config.PluginMeta{ID: nativeChildPluginID}
	handshake := meta.GenerateHandshakeConfig()
	command := exec.Command(binary, "-test.run=^"+testName+"$")
	command.Env = []string{
		"HOME=" + home, "USERPROFILE=" + home, "TMPDIR=" + sockets, "TMP=" + sockets, "TEMP=" + sockets,
		"XDG_CONFIG_HOME=" + filepath.Join(home, "config"), "XDG_CACHE_HOME=" + filepath.Join(home, "cache"), "XDG_DATA_HOME=" + filepath.Join(home, "data"),
		"GOWORK=off", "OMNIVIEW_STATE_DIR=" + root, "OMNIVIEW_TELEMETRY_ENABLED=false", "OMNIVIEW_TELEMETRY_PROFILING=false",
		"P45_NATIVE_CHILD=1", "P45_NATIVE_PROFILE=" + profile, "P45_NATIVE_RECEIPTS=" + receipts,
		handshake.MagicCookieKey + "=" + handshake.MagicCookieValue, "PLUGIN_PROTOCOL_VERSIONS=1",
	}
	command.Env = append(command.Env, childEnv...)
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
			denied, err := ctrl.Get(context.Background(), nativeChildPluginID, request)
			require.Error(t, err, "unissued caller must be denied before acquisition")
			assert.Empty(t, denied.Key)
			assert.Empty(t, denied.Record.Body.Kind, "denial must not expose native data")
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

// generationCatalogGate delays a genuine child catalog response while the child
// refreshes its native source. It never changes the response or the Get context.
type generationCatalogGate struct {
	resource.Provider
	resource.Getter
	resource.ConnectionLifecycle
	afterCatalog func()
}

func (p *generationCatalogGate) Catalog(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
	catalog, err := p.Provider.Catalog(ctx, request)
	if err == nil && p.afterCatalog != nil {
		after := p.afterCatalog
		p.afterCatalog = nil
		after()
	}
	return catalog, err
}

func TestActualSDKChildHostCatalogGenerationFence(t *testing.T) {
	binary := compileNativeChild(t)
	for _, restoreA := range []bool{false, true} {
		t.Run(fmt.Sprintf("restore-A=%t", restoreA), func(t *testing.T) {
			var aReads, bReads atomic.Int64
			a := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				aReads.Add(1)
				_, _ = w.Write([]byte("native-A"))
			}))
			defer a.Close()
			b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				bReads.Add(1)
				_, _ = w.Write([]byte("native-B"))
			}))
			defer b.Close()
			control := t.TempDir()
			child, _, stop := startSDKChild(t, binary, "", "TestGenerationChild", []string{
				"P45_GENERATION_CHILD=1", "P45_GENERATION_CONTROL=" + control, "P45_GENERATION_ENDPOINT=" + a.URL,
			})
			defer stop()
			provider := &generationCatalogGate{Provider: child, Getter: child.(resource.Getter), ConnectionLifecycle: child.(resource.ConnectionLifecycle)}
			_, err := provider.LoadConnections(context.Background())
			require.NoError(t, err)
			ctrl, _ := newTestControllerWithEmitter(t)
			registerMockPlugin(ctrl, nativeChildPluginID, provider)
			_, err = ctrl.StartConnection(testInvocationContext(), nativeChildPluginID, "generation")
			require.NoError(t, err)
			route := resource.AccessRoute{Connection: "generation"}
			target, err := ctrl.ResolveTarget(testInvocationContext(), nativeChildPluginID, ResolveTargetRequest{
				Route: route, Type: "native/object", Representation: "document", Scope: resource.QueryScope{},
			})
			require.NoError(t, err)
			request := HostGetRequest{TargetID: target.TargetID, Request: resource.GetRequest{
				Route: route, Representation: "document", Reference: resource.ResourceReference{Address: resource.ResourceAddress{
					Provider: "generation", Authority: target.Target.Authority, Type: "native/object", ID: "object", Scope: []resource.ScopeEntry{},
				}},
			}}
			provider.afterCatalog = func() {
				refreshNativeGeneration(t, control, 1, b.URL)
				if restoreA {
					refreshNativeGeneration(t, control, 2, a.URL)
				}
			}
			// Admission receives the real A observation only after B (or restored
			// A) is active. Get must carry A, not the SDK's newest cached token.
			stale, err := ctrl.Get(testInvocationContext(), nativeChildPluginID, request)
			require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
			assert.Zero(t, aReads.Load(), "retired A must not regain native access")
			assert.Zero(t, bReads.Load(), "stale A must not dispatch against B")
			_, err = os.Stat(filepath.Join(control, "entered-1"))
			require.True(t, os.IsNotExist(err), "stale admission must fail before native Get")
			assert.Empty(t, stale.Key)
			assert.Empty(t, stale.Record.Body.Kind, "rejected native data must not reach the caller")
			// Observing the replacement binding closes this request first.
			rejected, err := ctrl.ResolveTarget(testInvocationContext(), nativeChildPluginID, ResolveTargetRequest{
				Route: route, Type: "native/object", Representation: "document", Scope: resource.QueryScope{},
			})
			require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
			require.Empty(t, rejected.TargetID)
			require.Empty(t, rejected.Target.Authority)
			require.Zero(t, aReads.Load())
			require.Zero(t, bReads.Load())
			_, err = os.Stat(filepath.Join(control, "entered-1"))
			require.True(t, os.IsNotExist(err), "binding transition must not dispatch native Get")
			// A new caller request explicitly acquires the active observation.
			current, err := ctrl.ResolveTarget(testInvocationContext(), nativeChildPluginID, ResolveTargetRequest{
				Route: route, Type: "native/object", Representation: "document", Scope: resource.QueryScope{},
			})
			require.NoError(t, err)
			require.NotEqual(t, target.TargetID, current.TargetID)
			require.NotEqual(t, target.Target.Authority, current.Target.Authority, "A/B/A must not restore retired authority")
			request.TargetID = current.TargetID
			request.Request.Reference.Address.Authority = current.Target.Authority
			record, err := ctrl.Get(testInvocationContext(), nativeChildPluginID, request)
			require.NoError(t, err)
			if restoreA {
				assert.Equal(t, "native-A", record.Record.Body.Map["native"].String)
				assert.EqualValues(t, 1, aReads.Load())
				assert.Zero(t, bReads.Load())
			} else {
				assert.Equal(t, "native-B", record.Record.Body.Map["native"].String)
				assert.EqualValues(t, 1, bReads.Load())
				assert.Zero(t, aReads.Load())
			}
		})
	}
}

func refreshNativeGeneration(t *testing.T, control string, sequence int, endpoint string) {
	t.Helper()
	body, err := json.Marshal(struct {
		Sequence int    `json:"sequence"`
		Endpoint string `json:"endpoint"`
	}{sequence, endpoint})
	require.NoError(t, err)
	temporary := filepath.Join(control, "command.tmp")
	require.NoError(t, os.WriteFile(temporary, body, 0600))
	require.NoError(t, os.Rename(temporary, filepath.Join(control, "command.json")))
	var applied []byte
	require.Eventually(t, func() bool {
		failure, err := os.ReadFile(filepath.Join(control, "control-error"))
		require.True(t, os.IsNotExist(err), "native refresh failed: %s (%v)", failure, err)
		applied, err = os.ReadFile(filepath.Join(control, fmt.Sprintf("applied-%d", sequence)))
		return err == nil
	}, 10*time.Second, 10*time.Millisecond)
	require.Equal(t, endpoint, string(applied))
}

// TestActualSDKChildSchemaCatalog drives the host schema catalog against the
// real SDK conformance child over gRPC.
func TestActualSDKChildSchemaCatalog(t *testing.T) {
	binary := compileNativeChild(t)
	provider, _, stop := startNativeChild(t, binary, "read-only")
	defer stop()
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, nativeChildPluginID, provider)
	ctx := testInvocationContext()
	start := func(connection string) resource.AccessRoute {
		_, err := ctrl.StartConnection(ctx, nativeChildPluginID, connection)
		require.NoError(t, err)
		return resource.AccessRoute{Connection: connection}
	}
	catalogType := func(route resource.AccessRoute) resource.ResourceType {
		catalog, err := ctrl.Catalog(ctx, nativeChildPluginID, resource.CatalogRequest{Route: route})
		require.NoError(t, err)
		require.Len(t, catalog.Types, 1)
		return catalog.Types[0]
	}
	schemaRequest := func(route resource.AccessRoute) resource.SchemaRequest {
		typ := catalogType(route)
		for _, representation := range typ.Representations {
			if representation.ID == typ.DefaultRepresentation {
				return resource.SchemaRequest{Route: route, Type: typ.Type, Target: resource.SchemaTarget{Representation: new(representation)}}
			}
		}
		t.Fatal("default representation is not declared")
		return resource.SchemaRequest{}
	}
	fields := func(route resource.AccessRoute, path ...resourcecatalog.PathSegment) SchemaFieldsResult {
		result, err := ctrl.GetSchemaFields(ctx, nativeChildPluginID, SchemaFieldsRequest{Request: schemaRequest(route), Path: path})
		require.NoError(t, err)
		// P44 declares no native filtering or native query capability.
		assert.Empty(t, result.Overlay.NativeQueryLanguages)
		for _, field := range result.Fields {
			assert.Equal(t, "unsupported", field.NativeFilter)
		}
		return result
	}
	catalogAssociation := func(route resource.AccessRoute) EditorSchemaResult {
		request := schemaRequest(route)
		out, err := ctrl.ResolveEditorSchema(ctx, nativeChildPluginID, request)
		require.NoError(t, err)
		assert.Equal(t, request.Type, out.Type)
		assert.Equal(t, request.Target, out.Target, "action/query schemas never replace the selected body-format target")
		return out
	}
	fieldNames := func(result SchemaFieldsResult) []string {
		names := make([]string, 0, len(result.Fields))
		for _, field := range result.Fields {
			names = append(names, field.Segment.Name)
		}
		return names
	}

	bundled := start("cloud-bundled-pages")
	bundledFields := fields(bundled)
	assert.Equal(t, resourcecatalog.HostEvaluationSchemaChecked, bundledFields.Overlay.HostEvaluation)
	assert.Contains(t, fieldNames(bundledFields), "tags")
	bundledAssociation := catalogAssociation(bundled)
	require.Equal(t, "available", bundledAssociation.Status)

	discovered := start("cloud-discovered-schema")
	discoveredBinding, err := ctrl.ResolveSchema(ctx, nativeChildPluginID, schemaRequest(discovered))
	require.NoError(t, err)
	require.NotNil(t, discoveredBinding.DocumentRef, "discovered scenario delivers by reference")
	discoveredFields := fields(discovered)
	assert.Equal(t, resourcecatalog.HostEvaluationSchemaChecked, discoveredFields.Overlay.HostEvaluation)
	assert.Equal(t, fieldNames(bundledFields), fieldNames(discoveredFields))
	raw, err := ctrl.GetSchemaDocument(ctx, nativeChildPluginID, resource.SchemaDocumentRequest{Request: schemaRequest(discovered), Reference: *discoveredBinding.DocumentRef})
	require.NoError(t, err)
	assert.NotEmpty(t, raw.Document)
	_, err = ctrl.GetSchemaDocument(ctx, nativeChildPluginID, resource.SchemaDocumentRequest{Request: schemaRequest(discovered), Reference: resource.SchemaDocumentReference{ID: "conformance/unreferenced", Revision: "schema:opaque/1"}})
	assert.Equal(t, "NOT_FOUND", requireAppError(t, err).Code)

	absent := start("cloud-absent-schema")
	absentFields := fields(absent)
	assert.Equal(t, resourcecatalog.HostEvaluationDynamic, absentFields.Overlay.HostEvaluation)
	assert.Empty(t, absentFields.Fields)
	assert.Equal(t, "absent", catalogAssociation(absent).Status)

	unavailable := start("cloud-unavailable-schema")
	_, err = ctrl.GetSchemaFields(ctx, nativeChildPluginID, SchemaFieldsRequest{Request: schemaRequest(unavailable)})
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code, "schema denial cannot become typed field authority")
	assert.Equal(t, "unavailable", catalogAssociation(unavailable).Status)

	unsupported := start("container-unsupported-dialect")
	unsupportedFields := fields(unsupported)
	assert.Equal(t, resourcecatalog.HostEvaluationUnsupported, unsupportedFields.Overlay.HostEvaluation)
	assert.Equal(t, "UNSUPPORTED", unsupportedFields.Overlay.HostEvaluationCode)
	assert.Equal(t, "unsupported", catalogAssociation(unsupported).Status)

	// Unavailable/absent targets never recover a document by another target's digest.
	assert.Nil(t, catalogAssociation(absent).Document)
	require.NotNil(t, bundledAssociation.Document)
	assert.True(t, json.Valid(bundledAssociation.Document.Schema))

	hypervisor := start("hypervisor-openapi-vms")
	hypervisorCatalog, err := ctrl.Catalog(ctx, nativeChildPluginID, resource.CatalogRequest{Route: hypervisor})
	require.NoError(t, err)
	require.Len(t, hypervisorCatalog.Types, 1)
	hypervisorType := hypervisorCatalog.Types[0]
	placement := fields(hypervisor, resourcecatalog.PathSegment{Kind: "field", Name: "placement"})
	byName := map[string]resourcecatalog.FieldInfo{}
	for _, field := range placement.Fields {
		byName[field.Segment.Name] = field
	}
	assert.Equal(t, "unconditional", byName["pool"].Applicability)
	for _, name := range []string{"sizeGiB", "cores"} {
		assert.Equal(t, "conditional", byName[name].Applicability, name)
		require.Len(t, byName[name].Conditions, 1, name)
		assert.Equal(t, "anyOf", byName[name].Conditions[0].Combinator)
	}
	assert.NotEqual(t, byName["sizeGiB"].Conditions[0].Branch, byName["cores"].Conditions[0].Branch)

	schemas := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	snapshot := schemas.Observe(resourcecatalog.ConnectionKey{PluginID: nativeChildPluginID, Connection: hypervisor.Connection}, hypervisorCatalog)
	entry, err := snapshot.Entry(hypervisorType.Type, hypervisorType.DefaultRepresentation)
	require.NoError(t, err)
	schemaCtx := resource.WithCatalogRevisionForRoute(ctx, hypervisorCatalog.Provider, hypervisor, hypervisorCatalog.Revision)
	resolution, err := entry.Resolve(schemaCtx, schemaBindingSource(provider), schemaDocumentSource(provider, hypervisor))
	require.NoError(t, err)
	require.NotNil(t, resolution.Schema)
	schema := resolution.Schema
	nodes := []string{"node/a::1", "node/b::1"}
	target, err := ctrl.ResolveTarget(ctx, nativeChildPluginID, ResolveTargetRequest{Route: hypervisor, Type: hypervisorType.Type, Representation: hypervisorType.DefaultRepresentation,
		Scope: resource.QueryScope{{Dimension: "node", Match: resource.ScopeOneOf, Values: &nodes}}})
	require.NoError(t, err)
	request := HostEnumerateRequest{TargetID: target.TargetID, Request: resource.EnumerateRequest{Target: target.Target}}
	admitted := 0
	for {
		page, err := ctrl.Enumerate(ctx, nativeChildPluginID, request)
		require.NoError(t, err)
		for _, record := range page.Records {
			admission, err := resourcecatalog.Admit(ctx, schema, record.Record.Body, record.Record.Coverage, resourcecatalog.DefaultPolicy())
			require.NoError(t, err, record.Record.Reference.Address.ID)
			assert.Equal(t, "reduced", admission.Validation, "x-kubernetes-validations is not enforced")
			admitted++
		}
		if page.SourcePage.NextCursor == nil {
			break
		}
		request.Request.Cursor = page.SourcePage.NextCursor
	}
	assert.Equal(t, 3, admitted)
}
