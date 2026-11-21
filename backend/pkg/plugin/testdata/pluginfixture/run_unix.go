//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

// run replaces this process with the command, as the shell's exec did: the host
// that started the fixture holds the command's own process.
func run(args []string) int {
	path, err := exec.LookPath(args[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, "pluginfixture:", err)
		return 127
	}
	err = syscall.Exec(path, args, os.Environ())
	fmt.Fprintln(os.Stderr, "pluginfixture:", err)
	return 126
}
