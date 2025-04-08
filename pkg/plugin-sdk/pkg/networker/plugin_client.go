package networker

import (
	"context"

	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type PluginClient struct {
	client proto.NetworkerPluginClient
}

var _ Provider = (*PluginClient)(nil)

// ============================== PORT FORWARDING ============================== //

// GetSupportedPortForwardTargets returns the list of targets that are supported
// by this plugin for port forwarding.
func (p *PluginClient) GetSupportedPortForwardTargets(ctx *types.PluginContext) []string {
	resp, err := p.client.GetSupportedPortForwardTargets(
		types.WithPluginContext(context.Background(), ctx),
		&emptypb.Empty{},
	)
	if err != nil {
		return nil
	}

	return resp.GetResources()
}

// GetPortForwardSession returns a port forward session by ID.
func (p *PluginClient) GetPortForwardSession(
	ctx *types.PluginContext,
	sessionID string,
) (*PortForwardSession, error) {
	resp, err := p.client.GetPortForwardSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.PortForwardSessionByIdRequest{Id: sessionID},
	)
	if err != nil {
		return nil, err
	}

	return NewPortForwardSessionFromProto(resp.GetSession()), nil
}

// ListPortForwardSessions returns all of the port forward sessions.
func (p *PluginClient) ListPortForwardSessions(
	ctx *types.PluginContext,
) ([]*PortForwardSession, error) {
	resp, err := p.client.ListPortForwardSessions(
		types.WithPluginContext(context.Background(), ctx),
		&emptypb.Empty{},
	)
	if err != nil {
		return nil, err
	}

	found := resp.GetSessions()

	sessions := make([]*PortForwardSession, 0, len(found))
	for _, s := range found {
		sessions = append(sessions, NewPortForwardSessionFromProto(s))
	}
	return sessions, nil
}

// FindPortForwardSessions returns all of the port forward sessions that match the given request.
func (p *PluginClient) FindPortForwardSessions(
	ctx *types.PluginContext,
	req FindPortForwardSessionRequest,
) ([]*PortForwardSession, error) {
	resp, err := p.client.FindPortForwardSessions(
		types.WithPluginContext(context.Background(), ctx),
		req.ToProto(),
	)
	if err != nil {
		return nil, err
	}

	found := resp.GetSessions()
	sessions := make([]*PortForwardSession, 0, len(found))
	for _, s := range found {
		sessions = append(sessions, NewPortForwardSessionFromProto(s))
	}
	return sessions, nil
}

func (p *PluginClient) StartPortForwardSession(
	ctx *types.PluginContext,
	opts PortForwardSessionOptions,
) (*PortForwardSession, error) {
	resp, err := p.client.StartPortForwardSession(
		types.WithPluginContext(context.Background(), ctx),
		opts.ToProto(),
	)
	if err != nil {
		return nil, err
	}

	return NewPortForwardSessionFromProto(resp.GetSession()), nil
}

func (p *PluginClient) ClosePortForwardSession(
	ctx *types.PluginContext,
	sessionID string,
) (*PortForwardSession, error) {
	resp, err := p.client.ClosePortForwardSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.PortForwardSessionByIdRequest{Id: sessionID},
	)
	if err != nil {
		return nil, err
	}

	return NewPortForwardSessionFromProto(resp.GetSession()), nil
}
