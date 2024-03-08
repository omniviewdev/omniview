package types

import (
	"io"
	"os"
)

type PluginConfigFormat int

const (
	// PluginConfigFormatYAML is the YAML format for a plugin config.
	PluginConfigFormatYAML PluginConfigFormat = iota
	// PluginConfigFormatJSON is the JSON format for a plugin config.
	PluginConfigFormatJSON
)

type PluginConfig struct {
	ID          string `json:"id"          yaml:"id"`
	Version     string `json:"version"     yaml:"version"`
	Name        string `yaml:"name" json: "name"`
	Icon        string `json:"icon"        yaml:"icon"`
	Description string `json:"description" yaml:"description"`
	Repository  string `json:"repository"  yaml:"repository"`
	Website     string `json:"website"     yaml:"website"`
	Maintainers []struct {
		Name  string `json:"name"  yaml:"name"`
		Email string `json:"email" yaml:"email"`
	} `json:"maintainers"  yaml:"maintainers"`
	Tags         []string `json:"tags"         yaml:"tags"`
	Dependencies []string `json:"dependencies" yaml:"dependencies"`
	Capabilities []string `json:"capabilities" yaml:"capabilities"`
	Markdown     string   `json:"-"            yaml:"-"`
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

// PluginSystemConfig is the configuration for the core plugin system.
type PluginSystemConfig struct {
	// pluginsPath is the path on the filesystem to where plugins are stored
	pluginsPath string
}

// PluginsPath returns the path on the filesystem to where plugins are stored.
func (c *PluginSystemConfig) PluginsPath() string {
	return c.pluginsPath
}
