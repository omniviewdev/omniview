package command

import "github.com/omniviewdev/plugin-sdk/pkg/types"

// PluginOpts contains the options for the command plugin.
type PluginOpts struct {
	Handlers map[string]Handler `json:"handlers"`
}

// Handler is a function that processes a command called from the frontend. It is
// expected to return the response body as a byte slice.
type Handler func(ctx *types.PluginContext, body []byte) ([]byte, error)
