package types

import (
	"fmt"
	"io"
	"os"

	"github.com/hashicorp/go-plugin"
)

type PluginConfigFormat int

const (
	// PluginConfigFormatYAML is the YAML format for a plugin config.
	PluginConfigFormatYAML PluginConfigFormat = iota
	// PluginConfigFormatJSON is the JSON format for a plugin config.
	PluginConfigFormatJSON
)

type PluginConfig struct {
	ID           string             `json:"id"           yaml:"id"`
	Version      string             `json:"version"      yaml:"version"`
	Name         string             `json:"name"         yaml:"name"`
	Icon         string             `json:"icon"         yaml:"icon"`
	Description  string             `json:"description"  yaml:"description"`
	Repository   string             `json:"repository"   yaml:"repository"`
	Website      string             `json:"website"      yaml:"website"`
	Markdown     string             `json:"-"            yaml:"-"`
	Maintainers  []PluginMaintainer `json:"maintainers"  yaml:"maintainers"`
	Tags         []string           `json:"tags"         yaml:"tags"`
	Dependencies []string           `json:"dependencies" yaml:"dependencies"`
	Capabilities []string           `json:"capabilities" yaml:"capabilities"`
}

type PluginMaintainer struct {
	Name  string `json:"name"  yaml:"name"`
	Email string `json:"email" yaml:"email"`
}

// LoadMarkdown loads a plugin Markdown file from a given path (if it exists)
// into the plugin config.
func (c *PluginConfig) LoadMarkdown(path string) error {
	// load markdown file from path and set c.Markdown to the loaded markdown
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	// read markdown file
	markdown, err := io.ReadAll(file)
	if err != nil {
		return err
	}
	c.Markdown = string(markdown)
	return nil
}

// GenerateHandshakeConfig generates a handshake config for the plugin given the plugin config.
func (c *PluginConfig) GenerateHandshakeConfig() plugin.HandshakeConfig {
	if c.ID == "" {
		panic("plugin ID must be set")
	}
	if c.Version == "" {
		panic("plugin version must be set")
	}

	return plugin.HandshakeConfig{
		ProtocolVersion:  1,
		MagicCookieKey:   "OMNIVIEW",
		MagicCookieValue: fmt.Sprintf("%s-%s", c.ID, c.Version),
	}
}

// PluginSystemConfig is the configuration for the core plugin system.
type PluginSystemConfig struct {
	// pluginsPath is the path on the filesystem to where plugins are stored
	pluginsPath string
}

// PluginsPath returns the path on the filesystem to where plugins are stored.
func (c *PluginSystemConfig) PluginsPath() string {
	return c.pluginsPath
}
