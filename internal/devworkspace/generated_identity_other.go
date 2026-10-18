//go:build !darwin && !linux && !windows

package devworkspace

import (
	"github.com/omniviewdev/omniview/internal/devsession"
	"os"
)

func generatedDirectoryIdentity(*os.File) (generatedFileIdentity, error) {
	return generatedFileIdentity{}, devsession.ErrUnsupportedIdentity
}
