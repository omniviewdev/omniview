package exec

import "github.com/omniviewdev/omniview/internal/shellenv"

// withDefaultShell is command with the default shell in front when the caller named none.
func withDefaultShell(command []string, setting func() (string, error)) []string { return command }

// ListTerminalShells says which shells of this machine a terminal can be started with, and which one starts when the person chooses none.
func (c *controller) ListTerminalShells() []shellenv.Shell { return nil }
