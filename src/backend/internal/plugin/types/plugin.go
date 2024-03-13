package types

import (
	"fmt"
	"io"
	"os"

	"github.com/omniviewdev/plugin/pkg/config"
	"gopkg.in/yaml.v3"
)

type PluginType int

const (
	ExecutorPlugin PluginType = iota
	FilesystemPlugin
	LogPlugin
	MetricPlugin
	ReporterPlugin
	ResourcePlugin
)

func (pt PluginType) String() string {
	switch pt {
	case ExecutorPlugin:
		return "executor"
	case FilesystemPlugin:
		return "filesystem"
	case LogPlugin:
		return "log"
	case MetricPlugin:
		return "metric"
	case ReporterPlugin:
		return "reporter"
	case ResourcePlugin:
		return "resource"
	default:
		return "unknown"
	}
}

func (pt PluginType) MarshalText() ([]byte, error) {
	return []byte(pt.String()), nil
}

// Plugin represents a plugin that is installed and managed by the plugin manager.
type Plugin struct {
	ID           string
	Metadata     config.PluginMeta
	Config       config.PluginConfig
	Enabled      bool
	Running      bool
	Capabilities []PluginType
}

func (p *Plugin) HasCapability(capability PluginType) bool {
	for _, c := range p.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

func (p *Plugin) SetEnabled() {
	p.Enabled = true
}

func (p *Plugin) SetDisabled() {
	p.Enabled = false
}

func (p *Plugin) String() string {
	return p.ID
}

func (p *Plugin) IsRunning() bool {
	return p.Running
}

// LoadPluginMetadata loads the metadata for a plugin from the given path.
func LoadPluginMetadata(path string) (config.PluginMeta, error) {
	var settings config.PluginMeta

	// read in the yaml config
	configFile, err := os.Open(path + "/config.yaml")
	if err != nil {
		return config.PluginMeta{}, fmt.Errorf("error loading plugin config file: %w", err)
	}

	yamlParser := yaml.NewDecoder(configFile)
	if err = yamlParser.Decode(&settings); err != nil {
		return config.PluginMeta{}, fmt.Errorf("error parsing plugin config file: %w", err)
	}

	return settings, nil
}

// LoadPluginMarkdown loads the plugin markdown from the filesystem.
func LoadPluginMarkdown(path string) (string, error) {
	mdFile, err := os.Open(path + "/README.md")
	if err != nil {
		return "", fmt.Errorf("error loading plugin markdown file: %w", err)
	}
	md, err := io.ReadAll(mdFile)
	if err != nil {
		return "", fmt.Errorf("error reading plugin markdown file: %w", err)
	}
	return string(md), nil
}
