package plugin

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/backend/internal/plugin/types"
	"github.com/omniviewdev/plugin/pkg/config"
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
	// InstallPluginFromPath installs a plugin from the given path. It will validate the plugin
	// and then load it into the manager.
	InstallPluginFromPath(path string) error
	// LoadPlugin loads a plugin at the given path. It will validate the plugin
	// and then load it into the manager.
	LoadPlugin(id string) error
	// UnloadPlugin unloads a plugin from the manager.
	UnloadPlugin(id string) error
	// GetPlugin
	GetPluginMeta(id string) (config.PluginMeta, error)
	// ListPlugins returns a list of all plugins that are currently registered with the manager.
	ListPluginMetas() []config.PluginMeta
}

// NewManager returns a new plugin manager for the IDE to use to manager installed plugins.
func NewManager(logger *zap.SugaredLogger) Manager {
	return &pluginManager{
		logger:  logger,
		plugins: make(map[string]types.Plugin),
	}
}

// concrete implementation of the plugin manager.
type pluginManager struct {
	logger  *zap.SugaredLogger
	plugins map[string]types.Plugin
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
		case "/bin/plugin":
			hasBinPlugin = true
			if header.FileInfo().Mode()&0111 == 0 {
				return errors.New("/bin/plugin is not executable")
			}
		case "plugin.yaml":
			hasPluginYaml = true
		}
	}

	// Ensure required files were found
	if !hasBinPlugin || !hasPluginYaml {
		return errors.New("missing required files")
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

		// sanitize the file path
		path, sanitizeErr := sanitizeArchivePath(destination, header.Name)
		if sanitizeErr != nil {
			return sanitizeErr
		}

		switch header.Typeflag {
		case tar.TypeDir: // If it's a directory, create it
			if err = os.MkdirAll(path, 0755); err != nil {
				return err
			}
		case tar.TypeReg: // If it's a file, create it
			var outFile *os.File

			outFile, err = os.OpenFile(path, os.O_CREATE|os.O_RDWR, os.FileMode(header.Mode))
			if err != nil {
				return err
			}

			// prevent DoS from huge files
			if _, err = io.CopyN(outFile, tarReader, MaxPluginSize); err != nil {
				outFile.Close()
				return err
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

func (pm *pluginManager) InstallPluginFromPath(path string) error {
	// make sure the plugin dir is all set
	if err := auditPluginDir(); err != nil {
		return err
	}

	// plugins should be a valid tar.gz file
	if filepath.Ext(path) != ".tar.gz" {
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

	if err = unpackPluginArchive(path, getPluginLocation(metadata.ID)); err != nil {
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

	// all good, add to the map
	pm.plugins[id] = types.Plugin{
		ID:       id,
		Metadata: metadata,
		Config:   *config.NewEmptyPluginConfig(), // TODO - load the plugin config
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

	// remove from the map
	delete(pm.plugins, id)
	return nil
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
