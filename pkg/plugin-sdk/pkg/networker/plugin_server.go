package networker

import (
	"context"

	"github.com/hashicorp/go-hclog"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type PluginServer struct {
	log  hclog.Logger
	Impl Provider
}

// ============================== PORT FORWARDING ============================== //

func (s *PluginServer) GetSupportedPortForwardTargets(
	ctx context.Context,
	_ *emptypb.Empty,
) (*proto.GetSupportedPortForwardTargetsResponse, error) {
	resp := s.Impl.GetSupportedPortForwardTargets(types.PluginContextFromContext(ctx))

	return &proto.GetSupportedPortForwardTargetsResponse{
		Resources: resp,
	}, nil
}

func (s *PluginServer) GetPortForwardSession(
	ctx context.Context,
	in *proto.PortForwardSessionByIdRequest,
) (*proto.PortForwardSessionByIdResponse, error) {
	resp, err := s.Impl.GetPortForwardSession(types.PluginContextFromContext(ctx), in.GetId())
	if err != nil {
		return nil, err
	}

	return &proto.PortForwardSessionByIdResponse{
		Session: resp.ToProto(),
	}, nil
}

func (s *PluginServer) ListPortForwardSessions(
	ctx context.Context,
	_ *emptypb.Empty,
) (*proto.PortForwardSessionListResponse, error) {
	resp, err := s.Impl.ListPortForwardSessions(types.PluginContextFromContext(ctx))
	if err != nil {
		return nil, err
	}
	sessions := make([]*proto.PortForwardSession, 0, len(resp))
	for _, session := range resp {
		sessions = append(sessions, session.ToProto())
	}

	return &proto.PortForwardSessionListResponse{
		Sessions: sessions,
	}, nil
}

func (s *PluginServer) FindPortForwardSessions(
	ctx context.Context,
	in *proto.FindPortForwardSessionRequest,
) (*proto.PortForwardSessionListResponse, error) {
	resp, err := s.Impl.FindPortForwardSessions(
		types.PluginContextFromContext(ctx),
		NewFindPortForwardSessionRequestFromProto(in),
	)
	if err != nil {
		return nil, err
	}

	sessions := make([]*proto.PortForwardSession, 0, len(resp))
	for _, session := range resp {
		sessions = append(sessions, session.ToProto())
	}

	return &proto.PortForwardSessionListResponse{
		Sessions: sessions,
	}, nil
}

func (s *PluginServer) StartPortForwardSession(
	ctx context.Context,
	in *proto.PortForwardSessionOptions,
) (*proto.PortForwardSessionByIdResponse, error) {
	resp, err := s.Impl.StartPortForwardSession(
		types.PluginContextFromContext(ctx),
		*NewPortForwardSessionOptionsFromProto(in),
	)
	if err != nil {
		return nil, err
	}

	return &proto.PortForwardSessionByIdResponse{
		Session: resp.ToProto(),
	}, nil
}

func (s *PluginServer) ClosePortForwardSession(
	ctx context.Context,
	in *proto.PortForwardSessionByIdRequest,
) (*proto.PortForwardSessionByIdResponse, error) {
	resp, err := s.Impl.ClosePortForwardSession(
		types.PluginContextFromContext(ctx),
		in.GetId(),
	)
	if err != nil {
		return nil, err
	}

	return &proto.PortForwardSessionByIdResponse{
		Session: resp.ToProto(),
	}, nil
}
