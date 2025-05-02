package plugin

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v2"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

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
		case types.UIPlugin.String():
			return validateHasUiPackage(path)
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

// validateHasUiPackage checks if the plugin has a UI package, which is signified by the
// existence of a `/assets` folder in the ui plugin directory.
func validateHasUiPackage(path string) error {
	_, err := os.Stat(filepath.Join(path, "assets"))
	if os.IsNotExist(err) {
		return fmt.Errorf("expected compiled ui at path but none found: %s", path)
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
		log.Println("has inside tarball", header.Name)

		// check for required files and executable
		switch header.Name {
		case "./bin/plugin":
			hasBinPlugin = true
			if header.FileInfo().Mode()&0111 == 0 {
				return errors.New("bin/plugin is not executable")
			}
		case "./plugin.yaml":
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

		if header.Name == "./plugin.yaml" {
			var metadata config.PluginMeta
			if err = yaml.NewDecoder(tr).Decode(&metadata); err != nil {
				return nil, err
			}
			return &metadata, nil
		}
	}

	return nil, errors.New("'plugin.yaml' not found in download file")
}

func parseMetadataFromPluginPath(path string) (*config.PluginMeta, error) {
	// Open the plugin.yaml file
	file, err := os.Open(filepath.Join(path, "plugin.yaml"))
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var metadata config.PluginMeta
	if err = yaml.NewDecoder(file).Decode(&metadata); err != nil {
		return nil, err
	}
	return &metadata, nil
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

// CopyDir copies the content of src to dst. src should be a full path.
func CopyDir(dst, src string) error {
	return filepath.Walk(src, func(path string, info fs.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// copy to this path
		outpath := filepath.Join(dst, strings.TrimPrefix(path, src))

		if info.IsDir() {
			os.MkdirAll(outpath, info.Mode())
			return nil // means recursive
		}

		// handle irregular files
		if !info.Mode().IsRegular() {
			switch info.Mode().Type() & os.ModeType {
			case os.ModeSymlink:
				link, err := os.Readlink(path)
				if err != nil {
					return err
				}
				return os.Symlink(link, outpath)
			}
			return nil
		}

		// copy contents of regular file efficiently

		// open input
		in, _ := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()

		// create output
		fh, err := os.Create(outpath)
		if err != nil {
			return err
		}
		defer fh.Close()

		// make it the same
		fh.Chmod(info.Mode())

		// copy content
		_, err = io.Copy(fh, in)
		return err
	})
}
