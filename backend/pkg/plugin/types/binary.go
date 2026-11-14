package types

import "runtime"

// BinaryName is the executable name used by installed and development plugins.
func BinaryName() string {
	if runtime.GOOS == "windows" {
		return "plugin.exe"
	}
	return "plugin"
}
