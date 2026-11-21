// Package pluginmeta reads a plugin's manifest from its directory and closes the
// file before it returns.
//
// The plugin SDK's types.LoadPluginMetadata does the same read but never closes
// the file (fixed in the SDK after v0.20.0). Until the SDK that closes it is
// pinned, the file stays open until the garbage collector finalizes it, and
// Windows refuses to rename or remove a directory that holds an open file: an
// uninstall, an update or a reinstall of a plugin whose manifest the host had
// read failed with "Access is denied" and left the plugin staged. The host reads
// every manifest through Load, and TestNoHostCodeCallsTheLeakingSDKLoaders keeps
// it that way. TestPinnedSDKStillLeavesTheManifestOpen fails on the day the pin
// reaches the fixed SDK; that is the day to delete this package and call
// types.LoadPluginMetadata again.
package pluginmeta

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// Load reads and decodes dir/plugin.yaml. It returns what the SDK's
// types.LoadPluginMetadata returns, error text included, and closes the file
// before it returns on every path.
func Load(dir string) (config.PluginMeta, error) {
	file, err := os.Open(dir + "/plugin.yaml")
	if err != nil {
		return config.PluginMeta{}, fmt.Errorf("error loading plugin config file: %w", err)
	}
	// The file is only read, so a failure to close it loses nothing.
	defer file.Close()

	var meta config.PluginMeta
	if err = yaml.NewDecoder(file).Decode(&meta); err != nil {
		return config.PluginMeta{}, fmt.Errorf("error parsing plugin config file: %w", err)
	}

	return meta, nil
}
