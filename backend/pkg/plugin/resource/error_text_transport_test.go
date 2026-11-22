package resource

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	grpcplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// kubernetesErrors are the classes of the Kubernetes plugin
// (omniview-plugin-kubernetes, pkg/plugin/resource/errors.go): fixed public
// text per class, the native diagnostic only in Err.
var kubernetesErrors = []struct{ code, title, message string }{
	{"NOT_FOUND", "Resource not found", "The requested resource or API group was not found."},
	{"FORBIDDEN", "Access denied", "You do not have permission to perform this resource operation."},
	{"CONFLICT", "Resource conflict", "The resource operation conflicts with the current cluster state."},
	{"TIMEOUT", "Request timed out", "The cluster did not complete the request in time."},
	{"UNAUTHORIZED", "Authentication failed", "The cluster could not authenticate the request."},
	{"INVALID_REQUEST", "Invalid request", "The cluster rejected the resource request."},
	{"UNSUPPORTED", "Unsupported operation", "The cluster does not support this resource operation."},
	{"CONTINUATION_EXPIRED", "Source continuation expired", "The resource listing continuation has expired. Start a new listing."},
	{"RESOURCE_LIMIT", "Resource limit", "The request exceeded a cluster resource or rate limit."},
	{"UNAVAILABLE", "Source unavailable", "The cluster is temporarily unavailable."},
	{"CONNECTION_ERROR", "Connection error", "Unable to connect to the cluster."},
	{"CERTIFICATE_ERROR", "Certificate error", "The cluster certificate could not be verified."},
	{"PROVIDER_ERROR", "Cluster error", "The cluster could not complete the request."},
}

// hostOwnsTheSentence lists the classes whose text is the host's alone, whatever
// the plugin says (the C02 rule in apperror.ForResource).
var hostOwnsTheSentence = map[string]bool{"FORBIDDEN": true, "UNAUTHORIZED": true, "PROVIDER_ERROR": true}

// olderPlugin makes the plugin's server answer as one built on an SDK that does not
// carry the provider's sentence (every release up to v0.20.0): the status keeps the
// class, the ErrorInfo, and loses the LocalizedMessage that the SDK this host is
// built on adds. The server and the client around it are that SDK, so what is
// stripped is exactly what an older server never sent.
func olderPlugin() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		response, err := handler(ctx, request)
		st, ok := status.FromError(err)
		if !ok || err == nil {
			return response, err
		}
		p := st.Proto()
		kept := p.GetDetails()[:0]
		for _, detail := range p.GetDetails() {
			if !detail.MessageIs(&errdetails.LocalizedMessage{}) {
				kept = append(kept, detail)
			}
		}
		p.Details = kept
		return response, status.ErrorProto(p)
	}
}

func setupGRPCProviderWith(t *testing.T, provider resource.Provider, options ...grpc.ServerOption) *grpcplugin.Client {
	t.Helper()
	listener := bufconn.Listen(grpcTestBufSize)
	server := grpc.NewServer(append(grpcplugin.ServerOptions(), options...)...)
	grpcplugin.RegisterServer(server, provider)
	go func() { _ = server.Serve(listener) }()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := grpc.DialContext(ctx, "passthrough:///resource-test", grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock())
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close(); server.Stop(); _ = listener.Close() })
	return grpcplugin.NewClient(conn)
}

// catalogFailure sends one Kubernetes-style failure from a plugin to the host's
// controller over a real gRPC pair and returns the AppError the UI is given.
func catalogFailure(t *testing.T, code, title, message string, options ...grpc.ServerOption) *apperror.AppError {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{}
	provider.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		return resource.Catalog{}, &resource.ResourceOperationError{
			Err:  errors.New("Get \"https://10.0.0.1:6443/api/v1/pods?token=NATIVE-SECRET\": native diagnostic"),
			Code: code, Title: title, Message: message,
			Suggestions: []string{"Check your network connection"},
		}
	}
	registerMockPlugin(ctrl, "kubernetes", setupGRPCProviderWith(t, provider, options...))
	_, err := ctrl.Catalog(testInvocationContext(), "kubernetes", resource.CatalogRequest{Route: resource.AccessRoute{Connection: "route"}})
	return requireAppError(t, err)
}

// What the UI is given for a class when the plugin's text does not arrive: the
// host's own sentence and title.
func classText(t *testing.T, code string) (title, detail string) {
	t.Helper()
	fallback := apperror.ForResource(resource.NewError(code, ""), "request")
	return fallback.Title, fallback.Detail
}

// A plugin built on this SDK sends the provider's sentence in the status, the SDK
// client restores it, and the host's gate decides what the UI is given: the sentence
// for a class that may show it, the host's own words for one that may not.
func TestKubernetesStyleSentenceReachesTheUI(t *testing.T) {
	for _, k := range kubernetesErrors {
		t.Run(k.code, func(t *testing.T) {
			title, fallback := classText(t, k.code)
			app := catalogFailure(t, k.code, k.title, k.message)
			require.Equal(t, k.code, app.Code)
			require.Equal(t, title, app.Title, "the class is the title; the plugin's title is not carried")
			require.Empty(t, app.Suggestions, "suggestions are the host's to give")
			want := k.message
			if hostOwnsTheSentence[k.code] {
				want = fallback
			}
			require.Equal(t, want, app.Detail)
			require.NotContains(t, app.Error(), "NATIVE-SECRET")
		})
	}
}

// A plugin built on an SDK that does not carry the sentence sends the class and
// nothing else, and every plugin published before the SDK that carries it is one.
// The UI is given the host's sentence for the class, not a placeholder.
func TestPluginWithoutCarriedSentenceGetsTheHostsClassText(t *testing.T) {
	for _, k := range kubernetesErrors {
		t.Run(k.code, func(t *testing.T) {
			title, fallback := classText(t, k.code)
			app := catalogFailure(t, k.code, k.title, k.message, grpc.UnaryInterceptor(olderPlugin()))
			require.Equal(t, k.code, app.Code)
			require.Equal(t, title, app.Title)
			require.Equal(t, fallback, app.Detail)
			require.NotContains(t, app.Detail, "operation failed", "the SDK's placeholder must not stand for a sentence")
		})
	}
}
