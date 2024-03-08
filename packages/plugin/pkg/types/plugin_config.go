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
	ID          string `yaml:"id" json:"id"`
	Version     string `yaml:"version" json:"version"`
	Name        string `yaml:"name" json: "name"`
	Icon        string `yaml:"icon" json:"icon"`
	Description string `yaml:"description" json:"description"`
	Repository  string `yaml:"repository" json:"repository"`
	Website     string `yaml:"website" json:"website"`
	Maintainers []struct {
		Name  string `yaml:"name" json:"name"`
		Email string `yaml:"email" json:"email"`
	} `yaml:"maintainers" json:"maintainers"`
	Tags         []string `yaml:"tags" json:"tags"`
	Dependencies []string `yaml:"dependencies" json:"dependencies"`
	Capabilities []string `yaml:"capabilities" json:"capabilities"`
	Markdown     string   `yaml:"-" json:"-"`
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
