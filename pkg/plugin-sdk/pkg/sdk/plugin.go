package sdk

import (
	"os"
	"path/filepath"

	"github.com/hashicorp/go-hclog"
	"github.com/hashicorp/go-plugin"
	pkgsettings "github.com/omniviewdev/settings"
	"go.uber.org/zap"
	"google.golang.org/grpc"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/resource"
	rp "github.com/omniviewdev/plugin-sdk/pkg/resource/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/services"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/settings"
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
)

// PluginOpts is the options for creating a new plugin.
type PluginOpts struct {
	// ID is the unique identifier for the plugin
	ID string

	// Settings is a list of settings to be used by the plugin
	Settings []pkgsettings.Setting

	// Debug is the debug mode for the plugin
	Debug bool
}

type Plugin struct {
	// settingsProvider is the settings provider for the plugin.
	SettingsProvider pkgsettings.Provider
	// pluginMap is the map of plugins we can dispense. Each plugin entry in the map
	// is a plugin capability.
	pluginMap map[string]plugin.Plugin
	Logger    *zap.SugaredLogger
	HCLLogger hclog.Logger
	// meta holds metadata for the plugin, found inside of the plugin.yaml
	// file in the same directory as the plugin.
	meta config.PluginMeta
}

// NewPlugin creates a new plugin with the given configuration. This should be instantiated
// within your main function for your plugin and passed to the Register* functions to add
// capabilities to the plugin.
func NewPlugin(opts PluginOpts) *Plugin {
	if opts.ID == "" {
		panic("plugin ID cannot be empty")
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	path := filepath.Join(homeDir, ".omniview", "plugins", opts.ID)

	// plugin yaml will be in users home
	// create io reader from the file
	file, err := os.Open(filepath.Join(path, "plugin.yaml"))
	if err != nil {
		if os.IsNotExist(err) {
			panic("plugin.yaml not found")
		}
		panic(err)
	}

	// load in the plugin configuration
	meta := config.PluginMeta{}
	if err = meta.Load(file); err != nil {
		panic(err)
	}

	// convert the plugin settings to a map
	settings := make(map[string]pkgsettings.Setting)
	for _, setting := range opts.Settings {
		settings[setting.ID] = setting
	}

	logger := hclog.New(&hclog.LoggerOptions{
		Name:  meta.ID,
		Level: hclog.Debug,
	})

	// init the settings provider
	settingsProvider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{
		Logger:   zap.S(),
		PluginID: opts.ID,
		PluginSettings: []pkgsettings.Category{
			{
				ID:       "plugin",
				Settings: settings,
			},
		},
	})

	// setup the settings plugin by default
	plugins := map[string]plugin.Plugin{
		"settings": &sdksettings.SettingsPlugin{
			Impl: sdksettings.NewProviderWrapper(settingsProvider),
		},
	}

	return &Plugin{
		Logger:           zap.S().Named("plugin"),
		HCLLogger:        logger,
		meta:             meta,
		pluginMap:        plugins,
		SettingsProvider: settingsProvider,
	}
}

// registerCapability registers a plugin capability with the plugin system.
func (p *Plugin) RegisterCapability(capability string, registration plugin.Plugin) {
	if p == nil {
		panic("plugin cannot be nil when registering capability")
	}
	if capability == "" {
		panic("capability cannot be empty when registering capability")
	}
	// just to be safe, not really necessary
	if p.pluginMap == nil {
		p.pluginMap = make(map[string]plugin.Plugin)
	}

	p.pluginMap[capability] = registration
}

// GetPluginMap returns the plugin map for the plugin based on the capabilities that have been
// registered.
func (p *Plugin) GetPluginMap() map[string]plugin.Plugin {
	return p.pluginMap
}

func (p *Plugin) GetMeta() config.PluginMeta {
	return p.meta
}

func (p *Plugin) GetPluginID() string {
	return p.meta.ID
}

func GRPCServerFactory(opts []grpc.ServerOption) *grpc.Server {
	return grpc.NewServer(utils.RegisterServerOpts(opts)...)
}

func GRPCDialOptions() []grpc.DialOption {
	return withClientOpts(nil)
}

// Serve begins serving the plugin over the given RPC server. This should be called
// after all capabilities have been registered.
func (p *Plugin) Serve() {
	plugin.Serve(&plugin.ServeConfig{
		HandshakeConfig: p.meta.GenerateHandshakeConfig(),
		Plugins:         p.pluginMap,
		GRPCServer:      GRPCServerFactory,
		Logger: hclog.New(&hclog.LoggerOptions{
			Name:  "plugin",
			Level: hclog.Debug,
		}),
	})
}

// RegisterResourcePlugin registers a resource plugin with the given options. Resource plugins are
// plugins that manage resources, such as clouds, Kubernetes clusters, etc.
func RegisterResourcePlugin[ClientT, DiscoveryT, InformerT any](
	p *Plugin,
	opts IResourcePluginOpts[ClientT, DiscoveryT, InformerT],
) {
	if p == nil {
		// improper use of plugin
		panic("plugin cannot be nil")
	}

	resourcers := opts.GetResourcers()
	metas := make([]types.ResourceMeta, 0, len(opts.GetResourcers()))
	for meta := range resourcers {
		metas = append(metas, meta)
	}

	// check for discovery
	var typeManager services.ResourceTypeManager
	hasDiscovery, err := opts.HasDiscovery()
	if err != nil {
		panic(err)
	}
	if hasDiscovery {
		// dynamic resource plugin
		typeManager = services.NewDynamicResourceTypeManager(
			metas,
			opts.GetResourceGroups(),
			opts.GetResourceDefinitions(),
			opts.GetDefaultResourceDefinition(),
			opts.GetDiscoveryClientFactory(),
			opts.GetDiscoveryFunc(),
		)
	} else {
		// static resource plugin
		typeManager = services.NewStaticResourceTypeManager(
			metas,
			opts.GetResourceGroups(),
			opts.GetResourceDefinitions(),
			opts.GetDefaultResourceDefinition(),
		)
	}

	// create the layouts
	layoutOpts := opts.GetLayoutOpts()
	layoutManager := services.NewLayoutManager(layoutOpts)
	if layoutOpts != nil {
		// generate from the metas
		layoutManager.GenerateLayoutFromMetas(metas)
	}

	// create the resourcer
	resourcer := services.NewResourcerManager[ClientT]()
	if err = resourcer.RegisterResourcersFromMap(resourcers); err != nil {
		panic(err)
	}

	if opts.HasDynamicResourcers() {
		dynamicResourcers := opts.GetDynamicResourcers()
		if err = resourcer.RegisterDynamicResourcersFromMap(dynamicResourcers); err != nil {
			panic(err)
		}
	}

	controller := resource.NewResourceController(
		resourcer,
		services.NewConnectionManager(
			opts.GetClientFactory(),
			opts.GetLoadConnectionFunc(),
			opts.GetCheckConnectionFunc(),
			opts.GetLoadConnectionNamespacesFunc(),
		),
		typeManager,
		layoutManager,
		opts.GetInformerOpts(),
		p.SettingsProvider,
	)

	// Register the resource plugin with the plugin system.
	p.RegisterCapability("resource", &rp.ResourcePlugin{Impl: controller})
}
