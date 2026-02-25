package utils

import (
	"context"
	"errors"
	"log"

	"github.com/grpc-ecosystem/go-grpc-middleware/v2/metadata"
	"google.golang.org/grpc"

	"github.com/omniviewdev/plugin-sdk/pkg/interceptors"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	PluginContextMDKey = "plugin_context"
)

// ErrNoPluginContextError is returned when the plugin context is not found in the metadata.
var ErrNoPluginContextError = errors.New("no plugin context in metadata")

// RegisterServerOpts returns a list of gRPC server options with the necessary interceptors
// for the plugin SDK.
func RegisterServerOpts(opts []grpc.ServerOption) []grpc.ServerOption {
	unaryinterceptors, streaminterceptors := NewServerInterceptors()

	opts = append(opts, grpc.ChainUnaryInterceptor(unaryinterceptors...))
	opts = append(opts, grpc.ChainStreamInterceptor(streaminterceptors...))

	return opts
}

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

// ServerPluginContextInterceptor is a gRPC server interceptor that extracts the plugin context
// from the metadata and attaches it to the context.
//
// Deprecated: Use interceptors.UnaryPluginContext() instead.
func ServerPluginContextInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (interface{}, error) {
	ctx, err := UseServerPluginContext(ctx)
	if err != nil {
		// just log for now
		log.Println("error:", err)
	}
	return handler(ctx, req)
}

// NewServerInterceptors returns the default unary and stream interceptor chains
// for the plugin SDK gRPC server.
func NewServerInterceptors() ([]grpc.UnaryServerInterceptor, []grpc.StreamServerInterceptor) {
	return interceptors.DefaultUnaryInterceptors(), interceptors.DefaultStreamInterceptors()
}
