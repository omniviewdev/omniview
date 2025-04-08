package command

import (
	"context"

	"github.com/hashicorp/go-hclog"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// NOTE: Plugin servers (like this one) act akin to api controllers and are only meant for the hanlder to pass on to the Impl
// on the provider. Servers like this should intentionally be lightweight and simple callers to separate the business logic
// from the transport layer.

type PluginServer struct {
	log  hclog.Logger
	Impl Provider
}

// ============================== GENERAL COMMANDER ============================== //

func (s *PluginServer) Call(
	ctx context.Context,
	req *proto.CallCommandRequest,
) (*proto.CallCommandResponse, error) {
	resp, err := s.Impl.Call(types.PluginContextFromContext(ctx), req.GetPath(), req.GetBody())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to call command: %v", err)
	}

	return &proto.CallCommandResponse{
		Body: resp,
	}, nil
}
