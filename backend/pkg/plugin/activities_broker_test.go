package plugin

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	goplugin "github.com/hashicorp/go-plugin"
	hostactivity "github.com/omniviewdev/omniview/backend/pkg/activity"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/connshare"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	sdkactivity "github.com/omniviewdev/plugin-sdk/pkg/activity"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	v2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/hostconnections"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	activitypb "github.com/omniviewdev/plugin-sdk/proto/v1/activity"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// The test binary is the plugin executable. Control RPCs only ask the child to
// make real callback RPCs; they never synthesize reporter results or host state.
const activityBrokerChildEnv = "OMNIVIEW_ACTIVITY_BROKER_TEST_CHILD"

var activityBrokerHandshake = (&config.PluginMeta{ID: "activity-broker-test"}).GenerateHandshakeConfig()

type activityBrokerControl interface {
	Call(context.Context, *structpb.Struct) (*structpb.Struct, error)
}

type activityBrokerPlugin struct {
	goplugin.NetRPCUnsupportedPlugin
	binding     *sdkactivity.Binding
	legacy      bool
	mu          sync.Mutex
	negotiated  sdkactivity.Record
	hostBinding *hostconnections.Binding
}

func (p *activityBrokerPlugin) GRPCServer(broker *goplugin.GRPCBroker, server *grpc.Server) error {
	if p.legacy {
		// A genuine old lifecycle service has no ActivityBinding registration.
		lifecyclepb.RegisterPluginLifecycleServer(server, &lc.Server{})
	} else {
		if err := (&lc.Plugin{Impl: &lc.Server{PluginID: "untrusted-child-metadata", Activities: p.binding, HostConnections: p.hostBinding}}).GRPCServer(broker, server); err != nil {
			return err
		}
	}
	server.RegisterService(&grpc.ServiceDesc{
		ServiceName: "activitytest.Control",
		HandlerType: (*activityBrokerControl)(nil),
		Methods: []grpc.MethodDesc{{MethodName: "Call", Handler: func(srv any, ctx context.Context, decode func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
			request := new(structpb.Struct)
			if err := decode(request); err != nil {
				return nil, err
			}
			handler := func(ctx context.Context, request any) (any, error) {
				return srv.(activityBrokerControl).Call(ctx, request.(*structpb.Struct))
			}
			if interceptor == nil {
				return handler(ctx, request)
			}
			return interceptor(ctx, request, &grpc.UnaryServerInfo{Server: srv, FullMethod: "/activitytest.Control/Call"}, handler)
		}}},
	}, p)
	return nil
}

func (p *activityBrokerPlugin) GRPCClient(_ context.Context, _ *goplugin.GRPCBroker, conn *grpc.ClientConn) (any, error) {
	return conn, nil
}

func (p *activityBrokerPlugin) Call(ctx context.Context, request *structpb.Struct) (*structpb.Struct, error) {
	operation := request.GetFields()["operation"].GetStringValue()
	payload := request.GetFields()["payload"].GetStringValue()
	var record sdkactivity.Record
	var err error
	switch operation {
	case "pid":
		return structpb.NewStruct(map[string]any{"pid": float64(os.Getpid())})
	case "negotiated":
		p.mu.Lock()
		record = p.negotiated
		p.mu.Unlock()
	case "host-catalog":
		var value activityBrokerHostRequest
		if err = json.Unmarshal([]byte(payload), &value); err != nil {
			break
		}
		var invocationContext context.Context
		invocationContext, err = p.hostBinding.Context(ctx, value.Owner, v2.AccessRoute{Connection: value.Connection}, value.Token)
		if err != nil {
			break
		}
		var client hostconnections.Client
		client, err = hostconnections.FromContext(invocationContext)
		if err == nil {
			_, err = client.Catalog(invocationContext, value.Owner, v2.CatalogRequest{Route: v2.AccessRoute{Connection: value.Connection}})
		}
	case "begin", "message":
		var value sdkactivity.Spec
		if err = json.Unmarshal([]byte(payload), &value); err == nil {
			if operation == "begin" {
				record, err = p.binding.BeginTask(ctx, value)
			} else {
				record, err = p.binding.PublishMessage(ctx, value)
			}
		}
	case "report":
		var value sdkactivity.ReportTaskRequest
		if err = json.Unmarshal([]byte(payload), &value); err == nil {
			record, err = p.binding.ReportTask(ctx, value)
		}
	case "finish":
		var value sdkactivity.FinishTaskRequest
		if err = json.Unmarshal([]byte(payload), &value); err == nil {
			record, err = p.binding.FinishTask(ctx, value)
		}
	case "upsert":
		var value sdkactivity.AlertRequest
		if err = json.Unmarshal([]byte(payload), &value); err == nil {
			record, err = p.binding.UpsertAlert(ctx, value)
		}
	case "resolve":
		var value sdkactivity.ResolveAlertRequest
		if err = json.Unmarshal([]byte(payload), &value); err == nil {
			record, err = p.binding.ResolveAlert(ctx, value)
		}
	default:
		return nil, status.Error(codes.InvalidArgument, "unknown test operation")
	}
	encoded, marshalErr := json.Marshal(record)
	if marshalErr != nil {
		return nil, marshalErr
	}
	message := ""
	if err != nil {
		message = err.Error()
	}
	return structpb.NewStruct(map[string]any{"record": string(encoded), "error": message, "code": float64(status.Code(err))})
}

func TestActivityBrokerChildProcess(t *testing.T) {
	mode := os.Getenv(activityBrokerChildEnv)
	if mode == "" {
		return
	}
	implementation := &activityBrokerPlugin{binding: &sdkactivity.Binding{}, hostBinding: &hostconnections.Binding{}, legacy: mode == "legacy"}
	goplugin.Serve(&goplugin.ServeConfig{
		HandshakeConfig: activityBrokerHandshake,
		Plugins:         goplugin.PluginSet{"lifecycle": implementation},
		GRPCServer: func(options []grpc.ServerOption) *grpc.Server {
			return grpc.NewServer(append(options, grpc.UnaryInterceptor(func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
				response, err := handler(ctx, request)
				if metadata, ok := response.(*lifecyclepb.GetInfoResponse); ok && err == nil && mode == "host-wire1" {
					metadata.HostConnectionsVersion = 1
				}
				if _, binding := request.(*activitypb.BindRequest); binding && err == nil && (mode == "late-unimplemented" || mode == "late-failure" || mode == "wrong-version") {
					record, reportErr := implementation.binding.BeginTask(ctx, sdkactivity.Spec{Presentation: sdkactivity.Presentation{Title: "Accepted before negotiation failed"}})
					if reportErr != nil {
						return nil, reportErr
					}
					implementation.mu.Lock()
					implementation.negotiated = record
					implementation.mu.Unlock()
					switch mode {
					case "late-unimplemented":
						return nil, status.Error(codes.Unimplemented, "legacy negotiation")
					case "late-failure":
						return nil, status.Error(codes.Internal, "negotiation failed")
					case "wrong-version":
						return &activitypb.BindResponse{Version: sdkactivity.Version + 1}, nil
					}
				}
				return response, err
			}))...)
		},
	})
	os.Exit(0)
}

type activityBrokerChild struct {
	backend *plugintypes.ExternalBackend
	control *grpc.ClientConn
}

func startActivityBrokerChild(t *testing.T, mode string) activityBrokerChild {
	t.Helper()
	binary, err := os.Executable()
	require.NoError(t, err)
	root := t.TempDir()
	// Keep Unix socket paths below platform limits, independently of test names.
	socketRoot := "/tmp"
	if runtime.GOOS == "windows" {
		socketRoot = os.TempDir()
	}
	sockets, err := os.MkdirTemp(socketRoot, "ab-")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.RemoveAll(sockets) })
	command := exec.Command(binary, "-test.run=^TestActivityBrokerChildProcess$")
	command.Env = []string{
		"HOME=" + root, "USERPROFILE=" + root,
		"TMPDIR=" + sockets, "TMP=" + sockets, "TEMP=" + sockets,
		"XDG_CONFIG_HOME=" + filepath.Join(root, "config"),
		"XDG_CACHE_HOME=" + filepath.Join(root, "cache"),
		"XDG_DATA_HOME=" + filepath.Join(root, "data"),
		"OMNIVIEW_STATE_DIR=" + root, "OMNIVIEW_TELEMETRY_ENABLED=false",
		"GOWORK=off", activityBrokerChildEnv + "=" + mode,
		activityBrokerHandshake.MagicCookieKey + "=" + activityBrokerHandshake.MagicCookieValue,
		"PLUGIN_PROTOCOL_VERSIONS=1",
	}
	client := goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: activityBrokerHandshake, SkipHostEnv: true, Cmd: command,
		Plugins:          goplugin.PluginSet{"lifecycle": &lc.Plugin{}},
		AllowedProtocols: []goplugin.Protocol{goplugin.ProtocolGRPC}, StartTimeout: 15 * time.Second,
	})
	t.Cleanup(func() { client.Kill(); require.True(t, client.Exited(), "child process must exit") })
	rpc, err := client.Client()
	require.NoError(t, err)
	// Control and lifecycle adapters share the actual child gRPC connection.
	child := activityBrokerChild{backend: plugintypes.NewExternalBackend(client, rpc), control: rpc.(*goplugin.GRPCClient).Conn}
	response := new(structpb.Struct)
	request, err := structpb.NewStruct(map[string]any{"operation": "pid"})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.NoError(t, child.control.Invoke(ctx, "/activitytest.Control/Call", request, response))
	require.NotEqual(t, os.Getpid(), int(response.GetFields()["pid"].GetNumberValue()), "callback producer must be another OS process")
	return child
}

func (c activityBrokerChild) call(t *testing.T, operation string, payload any, rejected bool) sdkactivity.Record {
	t.Helper()
	encoded, err := json.Marshal(payload)
	require.NoError(t, err)
	request, err := structpb.NewStruct(map[string]any{"operation": operation, "payload": string(encoded)})
	require.NoError(t, err)
	response := new(structpb.Struct)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.NoError(t, c.control.Invoke(ctx, "/activitytest.Control/Call", request, response))
	if rejected {
		require.NotEmpty(t, response.GetFields()["error"].GetStringValue(), operation)
	} else {
		require.Empty(t, response.GetFields()["error"].GetStringValue(), operation)
	}
	var record sdkactivity.Record
	require.NoError(t, json.Unmarshal([]byte(response.GetFields()["record"].GetStringValue()), &record))
	return record
}

func activityBrokerManager(service *hostactivity.Service) *pluginManager {
	return &pluginManager{activities: &activityBinding{service: service, processes: make(map[string]activityProcess)}}
}

func TestActivityBrokerUnsupportedNegotiationDoesNotExhaustProducers(t *testing.T) {
	service := activityObserverService(t)
	manager := activityBrokerManager(service)
	legacy := startActivityBrokerChild(t, "legacy")
	for i := range 513 {
		require.NoError(t, manager.bindActivities("legacy", legacy.backend), "negotiation %d", i)
	}
	producer := startActivityBrokerChild(t, "supported")
	require.NoError(t, manager.bindActivities("supported", producer.backend))
	t.Cleanup(func() { manager.retireActivities("supported") })
	record := producer.call(t, "begin", sdkactivity.Spec{Presentation: sdkactivity.Presentation{Title: "Capacity remains available"}}, false)
	require.Equal(t, "supported", record.Source.PluginID)
	producer.call(t, "report", sdkactivity.ReportTaskRequest{ID: record.ID, Presentation: sdkactivity.Presentation{Title: "Progress"}}, false)
	finished := producer.call(t, "finish", sdkactivity.FinishTaskRequest{ID: record.ID, State: "succeeded"}, false)
	require.Equal(t, "succeeded", finished.Task.State)
}

func TestActivityBrokerIdentityAndRetirement(t *testing.T) {
	service := activityObserverService(t)
	manager := activityBrokerManager(service)
	alpha := startActivityBrokerChild(t, "supported")
	beta := startActivityBrokerChild(t, "supported")
	require.NoError(t, manager.bindActivities("alpha", alpha.backend))
	require.NoError(t, manager.bindActivities("beta", beta.backend))
	t.Cleanup(func() { manager.retireActivities("alpha"); manager.retireActivities("beta") })
	plain := sdkactivity.Spec{Presentation: sdkactivity.Presentation{Title: "Real callback"}}
	own := alpha.call(t, "begin", plain, false)
	foreign := beta.call(t, "begin", plain, false)
	require.Equal(t, "alpha", own.Source.PluginID, "child metadata cannot override host identity")
	require.Equal(t, "beta", foreign.Source.PluginID)
	spoof := plain
	spoof.Source = &sdkactivity.Source{PluginID: "beta"}
	alpha.call(t, "begin", spoof, true)
	spoof = plain
	spoof.Source = &sdkactivity.Source{PluginID: "alpha", ConnectionID: "connection", Resource: navigationPresentation("beta").Actions[0].Target}
	alpha.call(t, "message", spoof, true)
	spoof = sdkactivity.Spec{Presentation: navigationPresentation("beta")}
	alpha.call(t, "begin", spoof, true)
	navigation := navigationPresentation("beta").Actions[0].Target
	actionSpoof := sdkactivity.Spec{Presentation: sdkactivity.Presentation{Title: "Foreign action", Actions: []v2.ActivityAction{{
		ID: "act", Kind: "resource-action", Label: "Act",
		Intent: &v2.ResourceActionIntent{PluginID: "beta", Request: v2.ActionRequest{
			Route: navigation.Route, Reference: navigation.Reference, Action: "refresh", Input: v2.Value{Kind: "map", Map: map[string]v2.Value{}},
		}},
	}}}}
	require.NoError(t, sdkactivity.ValidateRequest("begin-task", actionSpoof), "spoof must reach host, not fail SDK shape validation")
	alpha.call(t, "begin", actionSpoof, true)
	alpha.call(t, "begin", sdkactivity.Spec{Presentation: plain.Presentation, ParentID: foreign.ID}, true)
	alpha.call(t, "report", sdkactivity.ReportTaskRequest{ID: foreign.ID, Presentation: plain.Presentation}, true)
	alpha.call(t, "finish", sdkactivity.FinishTaskRequest{ID: foreign.ID, State: "succeeded"}, true)
	alpha.call(t, "report", sdkactivity.ReportTaskRequest{ID: own.ID, Presentation: navigationPresentation("beta")}, true)
	alpha.call(t, "finish", sdkactivity.FinishTaskRequest{ID: own.ID, State: "succeeded", Presentation: &spoof.Presentation}, true)
	alert := sdkactivity.AlertRequest{Spec: plain, Key: "same-key", ObservedAt: "2026-11-04T00:00:00Z"}
	alpha.call(t, "upsert", alert, false)
	manager.retireActivities("alpha")
	for _, attempt := range []struct {
		operation string
		payload   any
	}{
		{"begin", plain}, {"message", plain},
		{"report", sdkactivity.ReportTaskRequest{ID: own.ID, Presentation: plain.Presentation}},
		{"finish", sdkactivity.FinishTaskRequest{ID: own.ID, State: "succeeded"}},
		{"upsert", alert}, {"resolve", sdkactivity.ResolveAlertRequest{Key: alert.Key, ObservedAt: "2026-11-04T00:00:01Z"}},
	} {
		t.Run("retired-"+attempt.operation, func(t *testing.T) { alpha.call(t, attempt.operation, attempt.payload, true) })
	}
	for _, record := range service.Snapshot().Records {
		if record.ID == own.ID {
			require.Equal(t, "unknown", record.Task.State)
		}
	}
	replacement := startActivityBrokerChild(t, "supported")
	require.NoError(t, manager.bindActivities("alpha", replacement.backend))
	replacement.call(t, "report", sdkactivity.ReportTaskRequest{ID: own.ID, Presentation: plain.Presentation}, true)
	replacement.call(t, "finish", sdkactivity.FinishTaskRequest{ID: own.ID, State: "succeeded"}, true)
	replacement.call(t, "upsert", alert, false)
	fresh := replacement.call(t, "begin", plain, false)
	replacement.call(t, "finish", sdkactivity.FinishTaskRequest{ID: fresh.ID, State: "succeeded"}, false)
	beta.call(t, "finish", sdkactivity.FinishTaskRequest{ID: foreign.ID, State: "succeeded"}, false)
}

func TestActivityBrokerNegotiationFailureRetiresAcceptedCallbacks(t *testing.T) {
	for _, mode := range []string{"late-unimplemented", "late-failure", "wrong-version"} {
		t.Run(mode, func(t *testing.T) {
			service := activityObserverService(t)
			manager := activityBrokerManager(service)
			child := startActivityBrokerChild(t, mode)
			err := manager.bindActivities("alpha", child.backend)
			if mode == "late-unimplemented" {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
			negotiated := child.call(t, "negotiated", nil, false)
			require.NotEmpty(t, negotiated.ID, "child must report through callback before failing negotiation")
			found := false
			for _, record := range service.Snapshot().Records {
				if record.ID == negotiated.ID {
					found = true
					require.Equal(t, "alpha", record.Source.PluginID)
					require.Equal(t, "unknown", record.Task.State, "failed negotiation must retire already accepted work")
				}
			}
			require.True(t, found)
			child.call(t, "report", sdkactivity.ReportTaskRequest{ID: negotiated.ID, Presentation: sdkactivity.Presentation{Title: "Late report"}}, true)
			child.call(t, "finish", sdkactivity.FinishTaskRequest{ID: negotiated.ID, State: "succeeded"}, true)
			child.call(t, "begin", sdkactivity.Spec{Presentation: sdkactivity.Presentation{Title: "Late begin"}}, true)
		})
	}
}

// The protocol carries no activity producer generation or delegated authority in
// activity report payloads. Ownership comes from the negotiated callback server.
// Raw malformed protobuf framing is outside this suite.

type activityBrokerHostRequest struct {
	Token      []byte
	Owner      string
	Connection string
}

// Catalog data, invocation authorization, and manifest revalidation are fixtures.
// Callback binding, boundary context, token lookup, owner/route checks, process
// scoping, revocation, and transport use production code.
type activityBrokerResources struct{ connshare.Resources }

func (activityBrokerResources) ObserveCatalog(context.Context, string, v2.AccessRoute) (v2.Catalog, hostresource.Observation, error) {
	return v2.Catalog{Provider: "owner", Revision: "rev", Coverage: v2.Coverage{Kind: "complete"}, Types: []v2.ResourceType{}}, hostresource.Observation{}, nil
}

func (activityBrokerResources) Catalog(context.Context, string, v2.CatalogRequest) (v2.Catalog, error) {
	return v2.Catalog{Provider: "owner", Revision: "rev", Coverage: v2.Coverage{Kind: "complete"}, Types: []v2.ResourceType{}}, nil
}

type activityBrokerRegistrar struct{}

func (activityBrokerRegistrar) Authorize(invocation.Principal, string, invocation.Target) error {
	return nil
}
func (activityBrokerRegistrar) RegisterDelegation(context.Context, invocation.Delegation) (func(), error) {
	return func() {}, nil
}

func TestActivityBrokerDelegatedHostConnectionIsolation(t *testing.T) {
	service := activityObserverService(t)
	manager := activityBrokerManager(service)
	alpha := startActivityBrokerChild(t, "supported")
	beta := startActivityBrokerChild(t, "supported")
	require.NoError(t, manager.bindActivities("alpha", alpha.backend))
	require.NoError(t, manager.bindActivities("beta", beta.backend))
	t.Cleanup(func() { manager.retireActivities("alpha"); manager.retireActivities("beta") })
	boundary := invocation.NewBoundary(activityBrokerRegistrar{})
	owner := config.PluginMeta{ID: "owner", Exports: &config.ExportsSpec{Connections: &config.ConnectionExport{Operations: []string{"catalog"}, ResourceTypes: []string{"objects/*"}}}}
	services := make(map[string]*connshare.Service)
	children := map[string]activityBrokerChild{"alpha": alpha, "beta": beta}
	tokens := make(map[string][]byte)
	stops := make(map[string]func())
	callbackStops := make(map[string]func())
	for _, id := range []string{"alpha", "beta"} {
		consumer := config.PluginMeta{ID: id, Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{Plugin: "owner", Operations: []string{"catalog"}, ResourceTypes: []string{"objects/*"}}}}}
		grant, err := config.GrantConnections(consumer, owner)
		require.NoError(t, err)
		ctx, err := boundary.Admit(invocation.HostContext(context.Background()), "tools.call", invocation.Target{Provider: id, Connection: "cluster"})
		require.NoError(t, err)
		hostService := connshare.New(id, activityBrokerResources{}, boundary)
		services[id] = hostService
		t.Cleanup(hostService.Close)
		token, stop, err := hostService.Begin(ctx, "owner", v2.AccessRoute{Connection: "cluster"}, grant, true, func() error { return nil })
		require.NoError(t, err)
		tokens[id], stops[id] = token, stop
		t.Cleanup(stop)
		raw, err := children[id].backend.Dispense("lifecycle")
		require.NoError(t, err)
		bindContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		stopCallback, err := raw.(*lc.Client).ServeHostConnections(bindContext, hostService)
		cancel()
		require.NoError(t, err)
		t.Cleanup(stopCallback)
		callbackStops[id] = stopCallback
	}
	alphaRequest := activityBrokerHostRequest{Token: tokens["alpha"], Owner: "owner", Connection: "cluster"}
	betaRequest := activityBrokerHostRequest{Token: tokens["beta"], Owner: "owner", Connection: "cluster"}
	alpha.call(t, "host-catalog", alphaRequest, false)
	beta.call(t, "host-catalog", betaRequest, false)
	// Both grants are live. Rejection must come from another process's
	// capability namespace, not cancellation or a fabricated invalid token.
	beta.call(t, "host-catalog", alphaRequest, true)
	alpha.call(t, "host-catalog", betaRequest, true)
	wrongRoute := alphaRequest
	wrongRoute.Connection = "other-cluster"
	alpha.call(t, "host-catalog", wrongRoute, true)
	plain := sdkactivity.Spec{Presentation: sdkactivity.Presentation{Title: "Independent lanes"}}
	// Ending a delegated invocation revokes its capability but does not
	// revoke the process activity producer or another process's grant.
	stops["alpha"]()
	alpha.call(t, "host-catalog", alphaRequest, true)
	// Stopping the entire host-connections callback must also leave the
	// process's independent activity callback usable.
	services["alpha"].Close()
	callbackStops["alpha"]()
	alpha.call(t, "host-catalog", alphaRequest, true)
	task := alpha.call(t, "begin", plain, false)
	alpha.call(t, "finish", sdkactivity.FinishTaskRequest{ID: task.ID, State: "succeeded"}, false)
	beta.call(t, "host-catalog", betaRequest, false)
	// Retiring the activity generation must not end an independent grant.
	manager.retireActivities("beta")
	beta.call(t, "begin", plain, true)
	beta.call(t, "host-catalog", betaRequest, false)
	services["beta"].Close()
	beta.call(t, "host-catalog", betaRequest, true)
}
