package logs

import (
	"context"
	"net"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/interceptors"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

func TestHeadlessActualGRPCCreationCarriesSelectedConnection(t *testing.T) {
	ctrl := &controller{clients: make(map[string]Provider)}
	source := &headlessSourceProvider{controller: ctrl, closed: make(chan struct{})}
	// This is the production request metadata adapter and resource logs handler.
	// In particular, an empty request ID causes the adapter to omit Connection,
	// and the actual resource route validation then rejects before this source.
	server := grpc.NewServer(grpc.UnaryInterceptor(interceptors.UnaryPluginContext()))
	sdklogs.RegisterLogPluginServer(server, &sdklogs.PluginServer{Impl: source})
	listener := bufconn.Listen(1 << 20)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	defer listener.Close()
	transport, err := grpc.NewClient("passthrough:///headless-context", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpc.WithUnaryInterceptor(sdk.ClientPluginContextInterceptor(logging.NewNop())))
	if err != nil {
		t.Fatal(err)
	}
	defer transport.Close()
	remote, err := (&sdklogs.Plugin{}).GRPCClient(context.Background(), nil, transport)
	if err != nil {
		t.Fatal(err)
	}
	ctrl.clients["plugin"] = NewAdapterV1(remote.(sdklogs.Provider))
	var admittedID string
	boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(principal invocation.Principal, _ string, _ invocation.Target) error {
		if principal.Origin() != invocation.ExternalAgent {
			t.Error("agent invocation identity changed")
		}
		return nil
	}))
	ctrl.SetReferenceAdmitter(func(ctx context.Context, operation, plugin string, route sdkresource.AccessRoute, reference sdkresource.ResourceReference) (context.Context, error) {
		bound, admitErr := boundary.Admit(ctx, operation, invocation.Target{Provider: plugin, Connection: route.Connection, ResourceType: reference.Address.Type, Object: reference.Address.ID})
		if request, ok := invocation.FromContext(bound); ok {
			admittedID = request.ID()
		}
		return bound, admitErr
	})
	ctx := invocation.NewScope(invocation.ExternalAgent).Context(context.Background())
	result, err := ctrl.ReadResourceLogs(ctx, "plugin", sdklogs.CreateSessionOptions{ResourceKey: "pod", ResourceID: "pod", Route: &sdkresource.AccessRoute{Connection: "route"}, Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{}}}})
	if err != nil {
		t.Fatal(err)
	}
	if admittedID == "" || source.requestID != admittedID {
		t.Fatal("host admission diagnostic was not propagated through actual gRPC")
	}
	if source.closeRequestID != admittedID {
		t.Fatal("cleanup omitted canonical request context")
	}
	if len(result.Lines) != 2 {
		t.Fatalf("native source output missing: %#v", result)
	}
	select {
	case <-source.closed:
	default:
		t.Fatal("actual gRPC session cleanup did not reach source")
	}
}
