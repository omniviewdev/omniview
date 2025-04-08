package exec

import (
	"context"
	"errors"
	"io"
	"log"

	"github.com/hashicorp/go-hclog"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type PluginServer struct {
	log  hclog.Logger
	Impl Provider
}

func (s *PluginServer) GetSupportedResources(
	ctx context.Context,
	_ *emptypb.Empty,
) (*proto.GetSupportedResourcesResponse, error) {
	resp := s.Impl.GetSupportedResources(types.PluginContextFromContext(ctx))
	handlers := make([]*proto.ExecHandler, 0, len(resp))
	for _, h := range resp {
		handlers = append(handlers, h.ToProto())
	}
	return &proto.GetSupportedResourcesResponse{
		Handlers: handlers,
	}, nil
}

func (s *PluginServer) GetSession(
	ctx context.Context,
	in *proto.GetSessionRequest,
) (*proto.GetSessionResponse, error) {
	if in == nil {
		return nil, status.Errorf(codes.InvalidArgument, "request is nil")
	}
	resp, err := s.Impl.GetSession(types.PluginContextFromContext(ctx), in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get session: %v", err)
	}

	return &proto.GetSessionResponse{
		Session: resp.ToProto(),
		Success: true,
	}, nil
}

func (s *PluginServer) ListSessions(
	ctx context.Context,
	in *emptypb.Empty,
) (*proto.ListSessionsResponse, error) {
	if in == nil {
		return nil, status.Errorf(codes.InvalidArgument, "request is nil")
	}
	resp, err := s.Impl.ListSessions(types.PluginContextFromContext(ctx))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list sessions: %v", err)
	}

	sessions := make([]*proto.Session, 0, len(resp))
	for _, session := range resp {
		sessions = append(sessions, session.ToProto())
	}

	return &proto.ListSessionsResponse{
		Sessions: sessions,
		Success:  true,
	}, nil
}

func (s *PluginServer) CreateSession(
	ctx context.Context,
	in *proto.SessionOptions,
) (*proto.CreateSessionResponse, error) {
	if in == nil {
		return nil, status.Errorf(codes.InvalidArgument, "request is nil")
	}
	resp, err := s.Impl.CreateSession(
		types.PluginContextFromContext(ctx),
		*NewSessionOptionsFromProto(in),
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create session: %v", err)
	}

	return &proto.CreateSessionResponse{
		Session: resp.ToProto(),
		Success: true,
	}, nil
}

func (s *PluginServer) AttachSession(
	ctx context.Context,
	in *proto.AttachSessionRequest,
) (*proto.AttachSessionResponse, error) {
	if in == nil {
		return nil, status.Errorf(codes.InvalidArgument, "request is nil")
	}
	resp, buffer, err := s.Impl.AttachSession(types.PluginContextFromContext(ctx), in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to attach session: %v", err)
	}

	return &proto.AttachSessionResponse{
		Session: resp.ToProto(),
		Buffer:  buffer,
	}, nil
}

func (s *PluginServer) DetachSession(
	ctx context.Context,
	in *proto.AttachSessionRequest,
) (*proto.AttachSessionResponse, error) {
	if in == nil {
		return nil, status.Errorf(codes.InvalidArgument, "request is nil")
	}
	resp, err := s.Impl.DetachSession(types.PluginContextFromContext(ctx), in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to detach session: %v", err)
	}

	return &proto.AttachSessionResponse{
		Session: resp.ToProto(),
	}, nil
}

func (s *PluginServer) CloseSession(
	ctx context.Context,
	in *proto.CloseSessionRequest,
) (*proto.CloseSessionResponse, error) {
	if in == nil {
		return nil, status.Errorf(codes.InvalidArgument, "request is nil")
	}
	if err := s.Impl.CloseSession(types.PluginContextFromContext(ctx), in.GetId()); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to close session: %v", err)
	}
	return &proto.CloseSessionResponse{
		Success: true,
	}, nil
}

func (s *PluginServer) ResizeSession(
	ctx context.Context,
	in *proto.ResizeSessionRequest,
) (*proto.ResizeSessionResponse, error) {
	if in == nil {
		return nil, status.Errorf(codes.InvalidArgument, "request is nil")
	}
	if err := s.Impl.ResizeSession(
		types.PluginContextFromContext(ctx),
		in.GetId(),
		in.GetCols(),
		in.GetRows(),
	); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resize session: %v", err)
	}

	return &proto.ResizeSessionResponse{
		Success: true,
	}, nil
}

func (s *PluginServer) Stream(stream proto.ExecPlugin_StreamServer) error {
	ctx, cancel := context.WithCancel(stream.Context())
	defer cancel()

	multiplexer := make(chan StreamInput)
	out, err := s.Impl.Stream(ctx, multiplexer)
	if err != nil {
		return err
	}

	// handle the output
	go s.handleOut(ctx, out, stream)

	// handle the input
	for {
		var in *proto.StreamInput
		in, err = stream.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			// log it somewhere
			log.Printf("failed to receive stream: %v", err)
			continue
		}
		multiplexer <- NewStreamInputFromProto(in)
	}
}

func (s *PluginServer) handleOut(
	ctx context.Context,
	out <-chan StreamOutput,
	stream proto.ExecPlugin_StreamServer,
) {
	for {
		select {
		case <-ctx.Done():
			return
		case out := <-out:
			// write to the output
			if err := stream.Send(out.ToProto()); err != nil {
				if ctx.Err() == context.Canceled {
					return
				}
			}
		}
	}
}
