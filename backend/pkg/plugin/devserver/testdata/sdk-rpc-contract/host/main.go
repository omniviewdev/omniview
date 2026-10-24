package main

import (
	"encoding/json"
	"io"
	"os"

	"github.com/omniviewdev/plugin-sdk/settings"
)

func main() {
	provider := settings.NewProvider(settings.ProviderOpts{
		PluginSettings: []settings.Category{{
			ID: "host",
			Settings: map[string]settings.Setting{
				"counter": (settings.Setting{ID: "counter", Type: settings.Integer, Default: 0}).WithContractLabel("host"),
			},
		}},
	})
	if err := json.NewEncoder(os.Stdout).Encode(struct {
		PID    int                          `json:"pid"`
		Schema map[string]settings.Category `json:"schema"`
	}{PID: os.Getpid(), Schema: provider.ListSettings()}); err != nil {
		panic(err)
	}
	// Keep a real consumer process alive until its owning test closes stdin.
	if _, err := io.Copy(io.Discard, os.Stdin); err != nil {
		panic(err)
	}
}
