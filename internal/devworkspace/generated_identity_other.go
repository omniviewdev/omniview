//go:build !darwin && !linux && !windows

package devworkspace

import (
	"os"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func generatedDirectoryIdentity(*os.File) (generatedFileIdentity, error) {
	return generatedFileIdentity{}, devsession.ErrUnsupportedIdentity
}
