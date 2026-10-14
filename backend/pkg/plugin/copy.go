package plugin

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// copiedDirPerm is the permission CopyDirectory creates directories with.
const copiedDirPerm os.FileMode = 0o755

func CopyDirectory(scrDir, dest string) error {
	entries, err := os.ReadDir(scrDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		sourcePath := filepath.Join(scrDir, entry.Name())
		destPath := filepath.Join(dest, entry.Name())

		if err = copyEntry(sourcePath, destPath); err != nil {
			return err
		}

		fInfo, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}

		isSymlink := fInfo.Mode()&os.ModeSymlink != 0
		if !isSymlink {
			if err = os.Chmod(destPath, fInfo.Mode()); err != nil {
				return err
			}
		}
	}
	return nil
}

// copyEntry copies a single directory entry (recursively for directories,
// as a link for symlinks, by content otherwise) from sourcePath to destPath.
func copyEntry(sourcePath, destPath string) error {
	fileInfo, err := os.Stat(sourcePath)
	if err != nil {
		return err
	}

	mode := fileInfo.Mode() & os.ModeType
	if mode == os.ModeDir {
		if err = CreateIfNotExists(destPath, copiedDirPerm); err != nil {
			return err
		}
		return CopyDirectory(sourcePath, destPath)
	}
	if mode == os.ModeSymlink {
		return CopySymLink(sourcePath, destPath)
	}
	return Copy(sourcePath, destPath)
}

func Copy(srcFile, dstFile string) error {
	out, err := os.Create(dstFile)
	if err != nil {
		return err
	}

	defer out.Close()

	in, err := os.Open(srcFile)
	if err != nil {
		return err
	}

	defer in.Close()

	_, err = io.Copy(out, in)
	if err != nil {
		return err
	}

	return nil
}

func Exists(filePath string) bool {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return false
	}

	return true
}

func CreateIfNotExists(dir string, perm os.FileMode) error {
	if Exists(dir) {
		return nil
	}

	if err := os.MkdirAll(dir, perm); err != nil {
		return fmt.Errorf("failed to create directory: '%s', error: '%s'", dir, err.Error())
	}

	return nil
}

func CopySymLink(source, dest string) error {
	link, err := os.Readlink(source)
	if err != nil {
		return err
	}
	return os.Symlink(link, dest)
}
