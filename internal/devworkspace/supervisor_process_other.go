//go:build !darwin && !linux && !windows

package devworkspace

import (
	"github.com/omniviewdev/omniview/internal/devsession"
	"os/exec"
)

func detachSupervisor(*exec.Cmd)           {}
func prepareOwnedCommand(*exec.Cmd)        {}
func attachOwnedCommand(*ownedChild) error { return devsession.ErrUnsupportedIdentity }
func waitOwnedCommand(*ownedChild) error   { return devsession.ErrUnsupportedIdentity }
func discardUncapturedCommand(command *exec.Cmd) error {
	_ = command.Process.Kill()
	_ = command.Wait()
	return devsession.ErrUnsupportedIdentity
}
