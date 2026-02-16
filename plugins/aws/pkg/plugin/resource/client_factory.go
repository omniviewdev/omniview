package resource

import (
	"errors"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// CreateClient creates a new client for interacting with the AWS resource backend.
func CreateClient(ctx *types.PluginContext) (*Client, error) {
	if ctx.Connection == nil {
		return nil, errors.New("connection context is required")
	}
	var client Client
	return &client, nil
}
