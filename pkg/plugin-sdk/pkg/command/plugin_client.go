package command

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type PluginClient struct {
	client proto.CommandClient
}

var _ Provider = (*PluginClient)(nil)

// ============================== GENERAL COMMANDER ============================== //

func (p *PluginClient) Call(
	ctx *types.PluginContext,
	path string,
	body []byte,
) ([]byte, error) {
	req := &proto.CallCommandRequest{
		Path: path,
		Body: body,
	}

	resp, err := p.client.Call(types.WithPluginContext(context.Background(), ctx), req)
	if err != nil {
		return nil, err
	}

	return resp.Body, nil
}
