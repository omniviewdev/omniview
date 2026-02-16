package types

import (
	plugin "github.com/omniviewdev/plugin-sdk/pkg/types"
)

type ConnectionControllerEvent struct {
	PluginID    string              `json:"plugin_id"`
	Connections []plugin.Connection `json:"connections"`
}
