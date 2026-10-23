package devworkspace

import (
	"context"
	"errors"
	"os/exec"
	"time"

	"github.com/omniviewdev/omniview/internal/devsession"
)

// RunRepositoryCommand runs one finite command under the caller's real workspace
// and fresh generation. It joins disposal of the entire owned descendant tree,
// including on cancellation, before returning authority to restore its inputs.
// The command must not use exec.CommandContext's independent leader-only kill.
func RunRepositoryCommand(ctx context.Context, command *exec.Cmd, owner devsession.ProcessOwner) error {
	child, err := startOwnedChildCommand(ctx, command, owner, nil)
	if child == nil {
		return err
	}
	return joinRepositoryCommand(ctx, child)
}

func joinRepositoryCommand(ctx context.Context, child *ownedChild) error {
	<-child.done
	// A finite CLI has no persistent owner to hand this actual Cmd to. Keep this
	// caller joined, even after cancellation, until its retained disposal can be
	// proven. Returning uncertainty here would let process exit abandon the owner.
	for {
		if err := child.stop(context.Background()); err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	child.mu.Lock()
	err := errors.Join(child.startErr, child.err)
	child.mu.Unlock()
	// Cancellation is truthful even when the leader happened to exit successfully
	// while its actual owned descendants were being stopped.
	return errors.Join(ctx.Err(), err)
}
