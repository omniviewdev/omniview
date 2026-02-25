package interceptors

import (
	"context"
	"log"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

// UnaryLogging returns a unary interceptor that logs each RPC call with method, duration, and error.
func UnaryLogging() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		duration := time.Since(start)
		if err != nil {
			st, _ := status.FromError(err)
			log.Printf("[RPC] %s duration=%s error=%q code=%s", info.FullMethod, duration, err, st.Code())
		} else {
			log.Printf("[RPC] %s duration=%s", info.FullMethod, duration)
		}
		return resp, err
	}
}

// StreamLogging returns a stream interceptor that logs stream open/close with method and duration.
func StreamLogging() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		start := time.Now()
		log.Printf("[STREAM] %s opened", info.FullMethod)
		err := handler(srv, ss)
		duration := time.Since(start)
		if err != nil {
			st, _ := status.FromError(err)
			log.Printf("[STREAM] %s closed duration=%s error=%q code=%s", info.FullMethod, duration, err, st.Code())
		} else {
			log.Printf("[STREAM] %s closed duration=%s", info.FullMethod, duration)
		}
		return err
	}
}
