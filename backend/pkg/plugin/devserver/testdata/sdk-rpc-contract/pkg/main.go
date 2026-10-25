package main

import (
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/settings"
)

func main() {
	sdk.NewPlugin(sdk.PluginOpts{
		ID: "sdk-rpc-contract",
		Settings: []settings.Setting{
			(settings.Setting{ID: "counter", Type: settings.Integer, Default: 0}).WithContractLabel("plugin"),
		},
	}).Serve()
}
