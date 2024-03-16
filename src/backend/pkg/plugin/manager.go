package plugin

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/hashicorp/go-plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/controllers"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	rp "github.com/omniviewdev/plugin-sdk/pkg/resource/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.uber.org/zap"
	"gopkg.in/yaml.v2"
)

const (
	MaxPluginSize = 1024 * 1024 * 1024 // 1GB
)

// Manager manages the lifecycle and registration of plugins. It is responsible
// for registering and unregistering plugins, and communicating with the plugin
// controllers to handle the lifecycle of the plugins.
type Manager interface {
	// Initialize discovers and loads all plugins that are currently installed in the plugin directory,
	// and initializes them with the appropriate controllers.
	Initialize(ctx context.Context) error

	// InstallPluginFromPath installs a plugin from the given path. It will validate the plugin
	// and then load it into the manager.
	InstallPluginFromPath(path string) error

	// LoadPlugin loads a plugin at the given path. It will validate the plugin
	// and then load it into the manager.
	LoadPlugin(id string) error

	// UnloadPlugin unloads a plugin from the manager.
	UnloadPlugin(id string) error

	// GetPlugin returns the plugin with the given plugin ID.
	GetPlugin(id string) (types.Plugin, error)

	// ListPlugins returns a list of all plugins that are currently registered with the manager.
	ListPlugins() []types.Plugin

	// GetPluginMeta returns the plugin metadata for the given plugin ID.
	GetPluginMeta(id string) (config.PluginMeta, error)

	// ListPlugins returns a list of all plugins that are currently registered with the manager.
	ListPluginMetas() []config.PluginMeta
}

// NewManager returns a new plugin manager for the IDE to use to manager installed plugins.
func NewManager(
	logger *zap.SugaredLogger,
	resourceController resource.Controller,
) Manager {
	return &pluginManager{
		logger:              logger,
		plugins:             make(map[string]types.Plugin),
		connlessControllers: make(map[types.PluginType]controllers.Controller),
		connfullControllers: map[types.PluginType]controllers.ConnectedController{
			types.ResourcePlugin: resourceController,
		},
	}
}

// concrete implementation of the plugin manager.
type pluginManager struct {
	ctx                 context.Context
	logger              *zap.SugaredLogger
	plugins             map[string]types.Plugin
	connlessControllers map[types.PluginType]controllers.Controller
	connfullControllers map[types.PluginType]controllers.ConnectedController
}

func (pm *pluginManager) Initialize(ctx context.Context) error {
	// bind to Wails context
	pm.ctx = ctx

	// make sure our plugin dir is all set
	if err := auditPluginDir(); err != nil {
		return err
	}

	// load all the plugins in the plugin directory
	files, err := os.ReadDir(filepath.Join(os.Getenv("HOME"), ".omniview", "plugins"))
	if err != nil {
		return fmt.Errorf("error reading plugin directory: %w", err)
	}

	// load each plugin
	for _, file := range files {
		if file.IsDir() {
			if err = pm.LoadPlugin(file.Name()); err != nil {
				return fmt.Errorf("error loading plugin: %w", err)
			}
		}
	}

	return nil
}

// make sure our plugin dir is all set.
func auditPluginDir() error {
	plugindir := filepath.Join(os.Getenv("HOME"), ".omniview", "plugins")

	// make sure our plugin dir is all set
	if err := os.MkdirAll(plugindir, 0755); err != nil {
		return fmt.Errorf("error creating plugin directory: %w", err)
	}

	return nil
}

func getPluginLocation(id string) string {
	// TODO - do we want to make this dynamic?
	return filepath.Join(os.Getenv("HOME"), ".omniview", "plugins", id)
}

func checkTarball(filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	// our tarball should be gzipped
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)

	hasBinPlugin := false
	hasPluginYaml := false

	for {
		var header *tar.Header
		header, err = tarReader.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				// end of archive
				break
			}

			return err
		}

		// check for required files and executable
		switch header.Name {
		case "bin/plugin":
			hasBinPlugin = true
			if header.FileInfo().Mode()&0111 == 0 {
				return errors.New("bin/plugin is not executable")
			}
		case "plugin.yaml":
			hasPluginYaml = true
		}
	}

	// Ensure required files were found
	if !hasBinPlugin || !hasPluginYaml {
		if !hasBinPlugin {
			return errors.New("missing required binary")
		}
		if !hasPluginYaml {
			return errors.New("missing required plugin.yaml")
		}
	}

	return nil
}

// sanitize archive file pathing from G305.
func sanitizeArchivePath(destination, target string) (string, error) {
	v := filepath.Join(destination, target)
	if strings.HasPrefix(v, filepath.Clean(destination)) {
		return v, nil
	}

	return "", fmt.Errorf("%s: %s", "content filepath is tainted", target)
}

func unpackPluginArchive(source string, destination string) error {
	// Open the .tar.gz file
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)

	// iterate through the files in the tarball
	for {
		var header *tar.Header
		header, err = tarReader.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				// end of archive
				break
			}

			return err
		}

		// Check file size against MaxPluginSize before extraction
		if header.Size > MaxPluginSize {
			return errors.New("file size exceeds maximum allowed size")
		}

		// sanitize the file path
		path, sanitizeErr := sanitizeArchivePath(destination, header.Name)
		if sanitizeErr != nil {
			return sanitizeErr
		}

		switch header.Typeflag {
		case tar.TypeDir: // If it's a directory, create it
			basePath := filepath.Dir(destination)

			if err = os.MkdirAll(filepath.Join(basePath, path), 0755); err != nil {
				return err
			}
		case tar.TypeReg: // If it's a file, create it
			var outFile *os.File

			if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				return fmt.Errorf("error creating plugin directory: %w", err)
			}

			// if the file already exists, remove it
			if _, err = os.Stat(path); err == nil {
				if err = os.Remove(path); err != nil {
					return err
				}
			}

			outFile, err = os.OpenFile(path, os.O_CREATE|os.O_RDWR, os.FileMode(header.Mode))
			if err != nil {
				return err
			}

			// prevent DoS from huge files
			if _, err = io.CopyN(outFile, tarReader, MaxPluginSize); err != nil {
				if !errors.Is(err, io.EOF) {
					err = fmt.Errorf("error copying file: %w", err)
					outFile.Close()
					return err
				}
			}
			outFile.Close()
		}
	}

	// cleanup the original tarball
	if err = os.Remove(source); err != nil {
		return err
	}

	return nil
}

func parseMetadataFromArchive(path string) (*config.PluginMeta, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	for {
		var header *tar.Header
		header, err = tr.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				// end of archive
				break
			}

			return nil, err
		}

		if header.Name == "plugin.yaml" {
			var metadata config.PluginMeta
			if err = yaml.NewDecoder(tr).Decode(&metadata); err != nil {
				return nil, err
			}
			return &metadata, nil
		}
	}

	return nil, errors.New("'plugin.yaml' not found in download file")
}

// isGzippedTarball attempts to read the file as a gzipped tarball. If it succeeds in reading at least one
// header from the tar archive, it assumes the file is a valid gzipped tarball.
func isGzippedTarball(filePath string) bool {
	// Open the file for reading
	file, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer file.Close()

	// Create a gzip reader
	gzr, err := gzip.NewReader(file)
	if err != nil {
		return false
	}
	defer gzr.Close()

	// Create a tar reader from the gzip reader
	tr := tar.NewReader(gzr)

	// Attempt to read the first header from the tar archive
	_, err = tr.Next()
	if errors.Is(
		err,
		tar.ErrHeader,
	) { // Found a header, but it's invalid; still likely a tar archive
		return true
	}
	if err != nil {
		return false
	}

	// Successfully read at least one header, so it's likely a gzipped tarball
	return true
}

func (pm *pluginManager) InstallPluginFromPath(path string) error {
	// make sure the plugin dir is all set
	if err := auditPluginDir(); err != nil {
		return err
	}

	// plugins should be a valid tar.gz file
	if !isGzippedTarball(path) {
		return fmt.Errorf("plugin is not a tar.gz file: %s", path)
	}

	if err := checkTarball(path); err != nil {
		return fmt.Errorf("plugin package is corrupt: %w", err)
	}

	// all good - unpack to the plugin directory
	metadata, err := parseMetadataFromArchive(path)
	if err != nil {
		return fmt.Errorf("error parsing plugin metadata: %w", err)
	}

	// ensure the plugin directory exists
	location := getPluginLocation(metadata.ID)
	if err = os.MkdirAll(location, 0755); err != nil {
		return fmt.Errorf("error creating plugin directory: %w", err)
	}

	if err = unpackPluginArchive(path, location); err != nil {
		return fmt.Errorf("error unpacking plugin download: %w", err)
	}

	return nil
}

func (pm *pluginManager) LoadPlugin(id string) error {
	if _, ok := pm.plugins[id]; ok {
		return fmt.Errorf("plugin with id '%s' already loaded", id)
	}

	location := getPluginLocation(id)

	// make sure it exists, and load the metadata file
	if _, err := os.Stat(location); os.IsNotExist(err) {
		return fmt.Errorf("plugin with id '%s' not found", id)
	}

	// load the metadata in so we can start validating
	metadata, err := types.LoadPluginMetadata(location)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("plugin with id '%s' is missing it's metadata file", id)
		}

		return fmt.Errorf("error loading plugin metadata for plugin '%s': %w", id, err)
	}

	if err = validateInstalledPlugin(metadata); err != nil {
		return fmt.Errorf("plugin with id '%s' failed validation during loading: %w", id, err)
	}

	// We're a host. Start by launching the plugin process.
	pluginClient := plugin.NewClient(&plugin.ClientConfig{
		HandshakeConfig: metadata.GenerateHandshakeConfig(),
		Plugins: map[string]plugin.Plugin{
			"resource": &rp.ResourcePlugin{},
		},
		Cmd:              exec.Command(filepath.Join(location, "bin", "plugin")),
		AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
	})

	// Connect via RPC
	rpcClient, err := pluginClient.Client()
	if err != nil {
		err = fmt.Errorf("error initializing plugin: %w", err)
		pm.logger.Error(err)
		return err
	}

	// all good, add to the map
	pm.plugins[id] = types.Plugin{
		ID:           id,
		Metadata:     metadata,
		Running:      true,
		Enabled:      true,
		Config:       *config.NewEmptyPluginConfig(),
		RPCClient:    rpcClient,
		PluginClient: pluginClient,
	}

	return nil
}

// UninstallPlugin uninstalls a plugin from the manager, and removes it from the filesystem.
func (pm *pluginManager) UninstallPlugin(id string) error {
	if err := pm.UnloadPlugin(id); err != nil {
		return fmt.Errorf("error unloading plugin during uninstall: %w", err)
	}

	// remove from the filesystem
	location := getPluginLocation(id)
	if err := os.RemoveAll(location); err != nil {
		return fmt.Errorf("error removing plugin from filesystem: %w", err)
	}
	return nil
}

// UnloadPlugin unloads a plugin from the manager.
func (pm *pluginManager) UnloadPlugin(id string) error {
	plugin, ok := pm.plugins[id]
	if !ok {
		return fmt.Errorf("plugin with id '%s' is not currently loaded", id)
	}

	if plugin.IsRunning() {
		return fmt.Errorf("plugin with id '%s' is currently running, cannot unload", id)
	}

	// stop the plugin client
	if err := plugin.RPCClient.Close(); err != nil {
		return fmt.Errorf("error stopping plugin client: %w", err)
	}

	// remove from the map
	delete(pm.plugins, id)
	return nil
}

// GetPlugin returns the plugin with the given plugin ID.
func (pm *pluginManager) GetPlugin(id string) (types.Plugin, error) {
	plugin, ok := pm.plugins[id]
	if !ok {
		return types.Plugin{}, fmt.Errorf("plugin not found: %s", id)
	}
	return plugin, nil
}

// ListPlugins returns a list of all plugins that are currently registered with the manager.
func (pm *pluginManager) ListPlugins() []types.Plugin {
	var plugins []types.Plugin
	for _, plugin := range pm.plugins {
		plugins = append(plugins, plugin)
	}
	return plugins
}

func validateInstalledPlugin(metadata config.PluginMeta) error {
	path := getPluginLocation(metadata.ID)

	// check capabilities are met
	for _, p := range metadata.Capabilities {
		switch p {
		case types.ResourcePlugin.String():
			return validateHasBinary(path)
		case types.ReporterPlugin.String():
			return validateHasBinary(path)
		case types.ExecutorPlugin.String():
			return validateHasBinary(path)
		case types.FilesystemPlugin.String():
			return validateHasBinary(path)
		case types.LogPlugin.String():
			return validateHasBinary(path)
		case types.MetricPlugin.String():
			return validateHasBinary(path)
		default:
			return fmt.Errorf("error validating plugin: unknown plugin capability type '%s'", p)
		}
	}

	return nil
}

func validateHasBinary(path string) error {
	// first, ensure the required files are present. there should, at minimum be a binary
	// at <path>/bin/resource
	plugin, err := os.Stat(filepath.Join(path, "bin", "plugin"))
	if os.IsNotExist(err) {
		return fmt.Errorf("resource plugin binary not found: %s", path)
	}

	// check that it's actually a compiled binary
	if plugin.Mode()&0111 == 0 {
		return fmt.Errorf("resource plugin binary is not executable: %s", path)
	}

	return nil
}

// GetPluginConfig returns the plugin configuration for the given plugin ID.
func (pm *pluginManager) GetPluginMeta(id string) (config.PluginMeta, error) {
	plugin, ok := pm.plugins[id]
	if !ok {
		return config.PluginMeta{}, fmt.Errorf("plugin not found: %s", id)
	}
	return plugin.Metadata, nil
}

// ListPluginMetas returns a list of all plugins that are currently registered with the manager.
func (pm *pluginManager) ListPluginMetas() []config.PluginMeta {
	var metas []config.PluginMeta
	for _, plugin := range pm.plugins {
		metas = append(metas, plugin.Metadata)
	}
	return metas
}
