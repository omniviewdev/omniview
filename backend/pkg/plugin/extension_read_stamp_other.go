//go:build !darwin && !linux

package plugin

import "os"

// No trusted change stamp on these platforms. Verify the bounded digest on
// the manager's open manifest descriptor without decoding the source again.
func manifestChangeTime(os.FileInfo) int64 { return 0 }
func manifestLocalStamp(*os.File) bool     { return false }
