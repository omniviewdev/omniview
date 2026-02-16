package sdk

import (
	"context"
	"errors"
	"log"

	"github.com/grpc-ecosystem/go-grpc-middleware/v2/metadata"
	"google.golang.org/grpc"
	grpcMetadata "google.golang.org/grpc/metadata"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
)

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

	md := metadata.MD(grpcMetadata.Pairs(utils.PluginContextMDKey, serialized))

	return md.ToOutgoing(ctx), nil
}

func ClientPluginContextInterceptor(
	ctx context.Context,
	method string,
	req, reply any,
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

func withClientOpts(opts []grpc.DialOption) []grpc.DialOption {
	if opts == nil {
		opts = make([]grpc.DialOption, 0)
	}
	opts = append(opts, grpc.WithUnaryInterceptor(ClientPluginContextInterceptor))
	return opts
}
