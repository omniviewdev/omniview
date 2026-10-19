//go:build !darwin && !linux && !windows

package devworkspace

import (
	"os/exec"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func detachSupervisor(*exec.Cmd)           {}
func prepareOwnedCommand(*exec.Cmd)        {}
func attachOwnedCommand(*ownedChild) error { return devsession.ErrUnsupportedIdentity }
func waitOwnedCommand(*ownedChild) error   { return devsession.ErrUnsupportedIdentity }
func discardUncapturedCommand(child *ownedChild) error {
	command := child.command
	_ = command.Process.Kill()
	_ = command.Wait()
	return devsession.ErrUnsupportedIdentity
}
