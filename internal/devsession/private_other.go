//go:build !darwin && !linux && !windows

package devsession

import "os"

func restrictPrivatePath(string, bool) error       { return ErrUnsupportedIdentity }
func checkPrivatePath(string, os.FileInfo) error   { return ErrUnsupportedIdentity }
func replacePrivateFile(string, string) error      { return ErrUnsupportedIdentity }
func syncPrivateDirectory(string) error            { return ErrUnsupportedIdentity }
func openPrivateLockFile(string) (*os.File, error) { return nil, ErrUnsupportedIdentity }
func restrictPrivateLockFile(*os.File) error       { return ErrUnsupportedIdentity }
