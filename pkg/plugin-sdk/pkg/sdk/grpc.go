package sdk

import (
	"context"
	"errors"
	"log"

	"github.com/grpc-ecosystem/go-grpc-middleware/v2/metadata"
	"google.golang.org/grpc"
	grpcMetadata "google.golang.org/grpc/metadata"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	PluginContextMDKey = "plugin_context"
)

var ErrNoPluginContextError = errors.New("no plugin context in metadata")

// UseServerPluginContext extracts the plugin context from the gRPC metadata
// and attaches it to the context.
func UseServerPluginContext(ctx context.Context) (context.Context, error) {
	incoming := metadata.ExtractIncoming(ctx)

	serialized := incoming.Get(PluginContextMDKey)
	if serialized == "" {
		// no plugin context in metadata. we'll let the caller decide how to handle this
		// error, and pass the original context in case they want to continue
		return ctx, ErrNoPluginContextError
	}

	// deserialize the plugin context and return with it attached
	deserialized, err := types.DeserializePluginContext(serialized)
	if err != nil {
		// same deal here as above
		return ctx, err
	}

	return types.WithPluginContext(ctx, deserialized), nil
}

func ServerPluginContextInterceptor(
	ctx context.Context,
	req interface{},
	_ *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (interface{}, error) {
	ctx, err := UseServerPluginContext(ctx)
	if err != nil {
		// just log for now
		log.Println("error:", err)
	}
	return handler(ctx, req)
}

// UseClientPluginContext serializes the plugin context from the context and injects
// it into the gRPC metadata.
func UseClientPluginContext(ctx context.Context) (context.Context, error) {
	pc := types.PluginContextFromContext(ctx)
	if pc == nil {
		return ctx, errors.New("no plugin context in context")
	}

	serialized, err := types.SerializePluginContext(pc)
	if err != nil {
		return ctx, err
	}

	md := metadata.MD(grpcMetadata.Pairs(PluginContextMDKey, serialized))

	return md.ToOutgoing(ctx), nil
}

func ClientPluginContextInterceptor(
	ctx context.Context,
	method string,
	req, reply interface{},
	cc *grpc.ClientConn,
	invoker grpc.UnaryInvoker,
	opts ...grpc.CallOption,
) error {
	ctx, err := UseClientPluginContext(ctx)
	if err != nil {
		// do nothing for now
		// we'll just return the error
		log.Println("error:", err)
	}
	return invoker(ctx, method, req, reply, cc, opts...)
}

func withServerOpts(opts []grpc.ServerOption) []grpc.ServerOption {
	opts = append(opts, grpc.UnaryInterceptor(ServerPluginContextInterceptor))
	return opts
}

func withClientOpts(opts []grpc.DialOption) []grpc.DialOption {
	if opts == nil {
		opts = make([]grpc.DialOption, 0)
	}
	opts = append(opts, grpc.WithUnaryInterceptor(ClientPluginContextInterceptor))
	return opts
}
