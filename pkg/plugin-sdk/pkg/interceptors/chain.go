package interceptors

import "google.golang.org/grpc"

// DefaultUnaryInterceptors returns the standard interceptor chain for unary RPCs.
// Order: recovery (outermost) → logging → context (innermost, closest to handler).
func DefaultUnaryInterceptors() []grpc.UnaryServerInterceptor {
	return []grpc.UnaryServerInterceptor{
		UnaryPanicRecovery(),
		UnaryLogging(),
		UnaryPluginContext(),
	}
}

// DefaultStreamInterceptors returns the standard interceptor chain for stream RPCs.
// Order: recovery (outermost) → logging → context (innermost, closest to handler).
func DefaultStreamInterceptors() []grpc.StreamServerInterceptor {
	return []grpc.StreamServerInterceptor{
		StreamPanicRecovery(),
		StreamLogging(),
		StreamPluginContext(),
	}
}
