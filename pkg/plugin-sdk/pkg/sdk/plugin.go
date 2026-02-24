package sdk

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

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
//
// When the OMNIVIEW_DEV environment variable is set to "1", the function will:
//   - Intercept the go-plugin handshake line from stdout to capture the listen address
//   - Write a .devinfo file so the IDE can connect via ReattachConfig
//   - Register a signal handler to clean up .devinfo on graceful shutdown
func (p *Plugin) Serve() {
	isDev := os.Getenv("OMNIVIEW_DEV") == "1"
	if !isDev {
		p.serveNormal()
		return
	}

	// Register cleanup handler for graceful shutdown.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		_ = CleanupDevInfo(p.meta.ID)
		os.Exit(0)
	}()

	// Intercept stdout to capture the go-plugin handshake line.
	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		p.Logger.Errorw("failed to create pipe for dev info capture", "error", err)
		p.serveNormal()
		return
	}

	os.Stdout = w

	// Start serving in a goroutine.
	done := make(chan struct{})
	go func() {
		plugin.Serve(&plugin.ServeConfig{
			HandshakeConfig: p.meta.GenerateHandshakeConfig(),
			Plugins:         p.pluginMap,
			GRPCServer:      GRPCServerFactory,
			Logger: hclog.New(&hclog.LoggerOptions{
				Name:  "plugin",
				Level: hclog.Debug,
			}),
		})
		close(done)
	}()

	// Read the handshake line from the pipe.
	buf := make([]byte, 4096)
	n, readErr := r.Read(buf)

	// Restore stdout immediately.
	os.Stdout = origStdout

	if readErr != nil {
		p.Logger.Errorw("failed to read handshake line", "error", readErr)
	} else {
		handshakeLine := string(buf[:n])
		// Write it to real stdout so go-plugin host can read it.
		fmt.Print(handshakeLine)

		// Parse vite port from env (set by CLI tool or manually).
		vitePort := 0
		if vp := os.Getenv("OMNIVIEW_VITE_PORT"); vp != "" {
			vitePort, _ = strconv.Atoi(vp)
		}

		if err := WriteDevInfo(p.meta.ID, p.meta.Version, strings.TrimSpace(handshakeLine), vitePort); err != nil {
			p.Logger.Errorw("failed to write devinfo", "error", err)
		} else {
			p.Logger.Infow("wrote .devinfo file",
				"pluginID", p.meta.ID,
				"handshake", strings.TrimSpace(handshakeLine),
			)
		}
	}

	// Wait for serve to complete.
	<-done
	_ = CleanupDevInfo(p.meta.ID)
}

func (p *Plugin) serveNormal() {
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
func RegisterResourcePlugin[ClientT any](
	p *Plugin,
	opts ResourcePluginOpts[ClientT],
) {
	if p == nil {
		// improper use of plugin
		panic("plugin cannot be nil")
	}

	metas := make([]types.ResourceMeta, 0, len(opts.Resourcers))
	for meta := range opts.Resourcers {
		metas = append(metas, meta)
	}

	// check for discovery
	var typeManager services.ResourceTypeManager
	if opts.DiscoveryProvider != nil {
		// dynamic resource plugin
		typeManager = services.NewDynamicResourceTypeManager(
			metas,
			opts.ResourceGroups,
			opts.ResourceDefinitions,
			opts.DefaultResourceDefinition,
			opts.DiscoveryProvider,
		)
	} else {
		// static resource plugin
		typeManager = services.NewStaticResourceTypeManager(
			metas,
			opts.ResourceGroups,
			opts.ResourceDefinitions,
			opts.DefaultResourceDefinition,
		)
	}

	// create the layouts
	layoutManager := services.NewLayoutManager(opts.LayoutOpts)
	if opts.LayoutOpts != nil {
		// generate from the metas
		layoutManager.GenerateLayoutFromMetas(metas)
	}

	// create the resourcer
	resourcer := services.NewResourcerManager[ClientT]()
	if err := resourcer.RegisterResourcersFromMap(opts.Resourcers); err != nil {
		panic(err)
	}

	if len(opts.PatternResourcers) > 0 {
		if err := resourcer.RegisterPatternResourcersFromMap(opts.PatternResourcers); err != nil {
			panic(err)
		}
	}

	controller := resource.NewResourceController(
		resourcer,
		services.NewConnectionManager(
			opts.CreateClient,
			opts.RefreshClient,
			opts.StartClient,
			opts.StopClient,
			opts.LoadConnectionFunc,
			opts.WatchConnectionsFunc,
			opts.CheckConnectionFunc,
			opts.LoadConnectionNamespacesFunc,
		),
		typeManager,
		layoutManager,
		opts.CreateInformerFunc,
		opts.SyncPolicies,
		opts.SchemaFunc,
		opts.ErrorClassifier,
	)

	// Register the resource plugin with the plugin system.
	p.RegisterCapability("resource", &rp.ResourcePlugin{
		Impl:            controller,
		SettingsProvider: p.SettingsProvider,
	})
}
