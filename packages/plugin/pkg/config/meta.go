package config

import (
	"fmt"
	"io"
	"os"

	"github.com/hashicorp/go-plugin"
	"gopkg.in/yaml.v3"
)

type PluginMetaFormat int

const (
	// PluginMetaFormatYAML is the YAML format for a plugin config.
	PluginMetaFormatYAML PluginMetaFormat = iota
	// PluginMetaFormatJSON is the JSON format for a plugin config.
	PluginMetaFormatJSON
)

// PluginMeta is the plugin description file located at the root of a plugin.
type PluginMeta struct {
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

func (c *PluginMeta) Load(reader io.Reader) error {
	return yaml.NewDecoder(reader).Decode(c)
}

// LoadMarkdown loads a plugin Markdown file from a given path (if it exists)
// into the plugin config.
func (c *PluginMeta) LoadMarkdown(path string) error {
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
func (c *PluginMeta) GenerateHandshakeConfig() plugin.HandshakeConfig {
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
