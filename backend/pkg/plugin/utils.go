package plugin

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v2"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// pluginMetaFile is the name of a plugin's metadata file.
const pluginMetaFile = "plugin.yaml"

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
	var metadata *config.PluginMeta

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
		case "./bin/plugin", "bin/plugin":
			hasBinPlugin = true
			if header.FileInfo().Mode()&0111 == 0 {
				return errors.New("bin/plugin is not executable")
			}
		case "./" + pluginMetaFile, pluginMetaFile:
			var meta config.PluginMeta
			if err = yaml.NewDecoder(tarReader).Decode(&meta); err != nil {
				return fmt.Errorf("invalid plugin.yaml: %w", err)
			}
			metadata = &meta
		}
	}

	if metadata == nil {
		return errors.New("missing required plugin.yaml")
	}

	// Only plugins with backend capabilities ship a binary; UI-only plugins
	// consist of plugin.yaml and their compiled assets.
	if metadata.HasBackendCapabilities() && !hasBinPlugin {
		return errors.New("missing required binary")
	}

	return nil
}

// sanitize archive file pathing from G305.
func sanitizeArchivePath(destination, target string) (string, error) {
	v := filepath.Join(destination, target)
	cleanDest := filepath.Clean(destination)
	// Allow the destination itself (e.g. "./") and any path inside it.
	if v == cleanDest || strings.HasPrefix(v, cleanDest+string(os.PathSeparator)) {
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

	var totalBytes int64

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
		if totalBytes, err = addExtractedSize(totalBytes, header.Size); err != nil {
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
			if err = extractRegularFile(path, header, tarReader); err != nil {
				return err
			}
		}
	}

	return nil
}

// addExtractedSize adds an archive entry's size to the running total, failing
// if the entry or the total exceeds MaxPluginSize.
func addExtractedSize(totalBytes, size int64) (int64, error) {
	if size > MaxPluginSize {
		return totalBytes, errors.New("file size exceeds maximum allowed size")
	}

	totalBytes += size
	if totalBytes > MaxPluginSize {
		return totalBytes, errors.New("cumulative extraction size exceeds maximum allowed size")
	}
	return totalBytes, nil
}

// extractRegularFile writes the current tar entry (header) from tarReader to path,
// replacing any existing file.
func extractRegularFile(path string, header *tar.Header, tarReader io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("error creating plugin directory: %w", err)
	}

	// if the file already exists, remove it
	if _, err := os.Stat(path); err == nil {
		if err = os.Remove(path); err != nil {
			return err
		}
	}

	outFile, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, os.FileMode(header.Mode))
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
	if closeErr := outFile.Close(); closeErr != nil {
		return fmt.Errorf("error closing extracted file: %w", closeErr)
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

		if header.Name == "./"+pluginMetaFile || header.Name == pluginMetaFile {
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
	file, err := os.Open(filepath.Join(path, pluginMetaFile))
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
			_ = os.MkdirAll(outpath, info.Mode())
			return nil // means recursive
		}

		// handle irregular files
		if !info.Mode().IsRegular() {
			if info.Mode().Type()&os.ModeType == os.ModeSymlink {
				return copySymlinkWithinTree(src, path, outpath)
			}
			return nil
		}

		// copy contents of regular file efficiently

		// open input
		in, err := os.Open(path)
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
		_ = fh.Chmod(info.Mode())

		// copy content
		_, err = io.Copy(fh, in)
		return err
	})
}

// copySymlinkWithinTree recreates the symlink at path as outpath, refusing
// links whose target resolves outside the source tree src.
func copySymlinkWithinTree(src, path, outpath string) error {
	link, err := os.Readlink(path)
	if err != nil {
		return err
	}
	// Resolve symlink target and verify it stays within the source tree.
	resolvedTarget := link
	if !filepath.IsAbs(link) {
		resolvedTarget = filepath.Join(filepath.Dir(path), link)
	}
	resolvedTarget = filepath.Clean(resolvedTarget)
	cleanSrc := filepath.Clean(src)
	if !strings.HasPrefix(resolvedTarget, cleanSrc+string(os.PathSeparator)) && resolvedTarget != cleanSrc {
		return fmt.Errorf("symlink %s points outside source tree: %s", path, link)
	}
	return os.Symlink(link, outpath)
}
