//go:build !darwin || server

package main

import (
	"fmt"
	"os"
)

func handleNativeProfileRemoval(args []string) (bool, int) {
	if len(args) == 0 || args[0] != "--remove-native-profile" {
		return false, 0
	}
	fmt.Fprintln(os.Stderr, "native UUID datastore removal requires the patched macOS native host; no datastore was removed")
	return true, 2
}
