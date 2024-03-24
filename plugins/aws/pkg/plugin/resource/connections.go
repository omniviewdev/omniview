package resource

import (
	"os"
	"strings"

	"gopkg.in/ini.v1"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// LoadConnectionsFunc is responsible for loading the available connections into the resource backend.
func LoadConnectionsFunc(_ *types.PluginContext) ([]types.Connection, error) {
	// For now, we're only supporting loading through profiles
	// TODO - eventually we'll want to support loading from other sources
	connections, _ := profileLoader()
	return connections, nil
}

// ParseConfig is responsible for parsing the configuration settings for the resource backend.
// profileLoader.
func profileLoader() ([]types.Connection, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	configPath := homeDir + "/.aws/config"

	var connections []types.Connection

	// Parse the config file
	cfg, err := ini.Load(configPath)
	if err != nil {
		return nil, err
	}

	for _, section := range cfg.Sections() {
		name := section.Name()
		if strings.HasPrefix(name, "profile ") {
			name = strings.TrimPrefix(name, "profile ")
			conn := types.Connection{
				ID:     name,
				Name:   name,
				Labels: make(map[string]interface{}),
				Data:   make(map[string]interface{}),
			}

			// check for sso
			if section.HasKey("sso_start_url") {
				conn.Labels["type"] = "sso"
				conn.Labels["account_id"] = section.Key("sso_account_id").String()
				conn.Labels["role"] = section.Key("sso_role_name").String()
				conn.Labels["region"] = section.Key("sso_region").String()
			} else {
				conn.Labels["type"] = "credentials"
				conn.Labels["region"] = section.Key("region").String()
			}

			connections = append(connections, conn)
		}
	}

	return connections, nil
}
