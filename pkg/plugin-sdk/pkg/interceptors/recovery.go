package interceptors

import (
	"context"
	"log"
	"runtime/debug"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// UnaryPanicRecovery returns a unary server interceptor that recovers from panics,
// logs the stack trace, and returns a codes.Internal gRPC error.
func UnaryPanicRecovery() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (resp interface{}, err error) {
		defer func() {
			if r := recover(); r != nil {
				stack := debug.Stack()
				log.Printf("[PANIC] %s: %v\n%s", info.FullMethod, r, stack)
				err = status.Errorf(codes.Internal, "panic in %s: %v", info.FullMethod, r)
			}
		}()
		return handler(ctx, req)
	}
}

// StreamPanicRecovery returns a stream server interceptor that recovers from panics,
// logs the stack trace, and returns a codes.Internal gRPC error.
func StreamPanicRecovery() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) (err error) {
		defer func() {
			if r := recover(); r != nil {
				stack := debug.Stack()
				log.Printf("[PANIC] %s: %v\n%s", info.FullMethod, r, stack)
				err = status.Errorf(codes.Internal, "panic in %s: %v", info.FullMethod, r)
			}
		}()
		return handler(srv, ss)
	}
}
