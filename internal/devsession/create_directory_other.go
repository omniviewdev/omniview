//go:build !darwin && !linux && !windows

package devsession

import "os"

func createPrivateDirectoryAt(*os.File, string) (*os.File, error) { return nil, ErrUnsupportedIdentity }
