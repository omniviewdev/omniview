//go:build darwin || linux

package devworkspace

import (
	"fmt"
	"os"
	"syscall"
)

func generatedDirectoryIdentity(file *os.File) (generatedFileIdentity, error) {
	info, err := file.Stat()
	if err != nil {
		return generatedFileIdentity{}, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.IsDir() {
		return generatedFileIdentity{}, fmt.Errorf("generated staging has no supported directory identity")
	}
	return generatedFileIdentity{Device: fmt.Sprint(stat.Dev), FileID: fmt.Sprint(stat.Ino)}, nil
}
