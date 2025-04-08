package utils

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/grpc-ecosystem/go-grpc-middleware/v2/interceptors/logging"
	"github.com/grpc-ecosystem/go-grpc-middleware/v2/metadata"
	"go.uber.org/zap"
	"google.golang.org/grpc"

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

func NewServerInterceptors() ([]grpc.UnaryServerInterceptor, []grpc.StreamServerInterceptor) {
	var unaryinterceptors []grpc.UnaryServerInterceptor
	var streaminterceptors []grpc.StreamServerInterceptor

	// logging
	logger, _ := zap.NewDevelopment()
	unaryinterceptor, streaminterceptor := addLoggingInterceptor(logger)
	unaryinterceptors = append(unaryinterceptors, unaryinterceptor)
	streaminterceptors = append(streaminterceptors, streaminterceptor)

	// context injection
	unaryinterceptors = append(unaryinterceptors, ServerPluginContextInterceptor)

	return unaryinterceptors, streaminterceptors
}

// addLoggingInterceptor adds logging interceptor to the server.
func addLoggingInterceptor(
	logger *zap.Logger,
) (grpc.UnaryServerInterceptor, grpc.StreamServerInterceptor) {
	opts := []logging.Option{
		logging.WithLogOnEvents(logging.StartCall, logging.FinishCall),
	}

	return logging.UnaryServerInterceptor(
			interceptorLogger(logger),
			opts...,
		), logging.StreamServerInterceptor(
			interceptorLogger(logger),
			opts...,
		)
}

// InterceptorLogger adapts zap logger to interceptor logger.
// This code is simple enough to be copied and not imported.
func interceptorLogger(l *zap.Logger) logging.Logger {
	return logging.LoggerFunc(
		func(_ context.Context, lvl logging.Level, msg string, fields ...any) {
			//nolint:gomnd // this is a reasonable default, kv pairs are passed in
			f := make([]zap.Field, 0, len(fields)/2)

			for i := 0; i < len(fields); i += 2 {
				key := fields[i]
				value := fields[i+1]

				switch v := value.(type) {
				case string:
					f = append(f, zap.String(key.(string), v))
				case int:
					f = append(f, zap.Int(key.(string), v))
				case bool:
					f = append(f, zap.Bool(key.(string), v))
				default:
					f = append(f, zap.Any(key.(string), v))
				}
			}

			logger := l.WithOptions(zap.AddCallerSkip(1)).With(f...)

			switch lvl {
			case logging.LevelDebug:
				logger.Debug(msg)
			case logging.LevelInfo:
				logger.Info(msg)
			case logging.LevelWarn:
				logger.Warn(msg)
			case logging.LevelError:
				logger.Error(msg)
			default:
				panic(fmt.Sprintf("unknown level %v", lvl))
			}
		},
	)
}
