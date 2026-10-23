//go:build !darwin || server

package hostruntime

import (
	"fmt"
	"os"
)

// HandleNativeProfileRemoval refuses native datastore removal on unsupported hosts.
func HandleNativeProfileRemoval(args []string) (bool, int) {
	if len(args) == 0 || args[0] != "--remove-native-profile" {
		return false, 0
	}
	fmt.Fprintln(os.Stderr, "native UUID datastore removal requires the patched macOS native host; no datastore was removed")
	return true, 2
}
