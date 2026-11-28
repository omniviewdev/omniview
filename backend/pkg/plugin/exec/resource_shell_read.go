package exec

import (
	"context"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

const (
	resourceShellPendingLimit = 256 << 10
	resourceShellLimit        = 128
	shellRunning              = "running"
	shellEnded                = "ended"
	shellFailed               = "failed"
	shellDetached             = "detached"
)

// ResourceShellRead is one ordered piece of the private exec stream. Data is always base64 text,
// including an empty final frame. A final state may accompany the last bytes: consume the bytes first.
type ResourceShellRead struct {
	Data  []byte `json:"data"`
	State string `json:"state"`
}

// Protected by controller.mu. No fanout, polling, unbounded channel, or per-keystroke provider read.
// A stalled window cannot block the shared provider mux. Overflow fails this session explicitly.
type shellOutput struct {
	wake      chan struct{}
	pending   []byte
	reading   bool
	accepting bool
	final     string
	expiry    *time.Timer
}

func (o *shellOutput) notify() {
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

// enqueue takes the immutable frame from the provider stream. The common case (one frame, one
// waiting reader) does not copy its bytes. Batch a burst, keeping the backing allocation bounded.
func (o *shellOutput) enqueue(data []byte) bool {
	if len(data) == 0 {
		return true
	}
	if len(data) > resourceShellPendingLimit-len(o.pending) {
		return false
	}
	if o.pending == nil && cap(data) <= resourceShellPendingLimit {
		o.pending = data[:len(data):len(data)]
	} else {
		if size := len(o.pending) + len(data); size > cap(o.pending) {
			const growthFactor = 2
			next := make([]byte, len(o.pending), min(resourceShellPendingLimit, max(size, growthFactor*len(o.pending))))
			copy(next, o.pending)
			o.pending = next
		}
		o.pending = append(o.pending, data...)
	}
	o.notify()
	return true
}

func shellRead(data []byte, state string) *ResourceShellRead {
	if data == nil {
		data = []byte{}
	}
	return &ResourceShellRead{Data: data, State: state}
}

func (c *controller) readResourceShell(ctx context.Context, owner shellOwner, id, attachment string) (*ResourceShellRead, error) {
	c.mu.Lock()
	s := c.resourceShells[id]
	if s == nil || s.owner != owner || s.attachment != attachment || s.created.IsZero() {
		c.mu.Unlock()
		return shellRead(nil, shellDetached), nil
	}
	if s.output.reading {
		c.mu.Unlock()
		return nil, resourcev2.NewError("INVALID_REQUEST", "A resource shell read is already pending.")
	}
	s.output.reading = true
	defer func() { s.output.reading = false; c.mu.Unlock() }()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if c.resourceShells[id] != s {
			return shellRead(nil, shellDetached), nil
		}
		if data, final := s.output.pending, s.output.final; data != nil || final != "" {
			s.output.pending = nil
			if final == "" {
				return shellRead(data, shellRunning), nil
			}
			c.forgetResourceShellLocked(s)
			return shellRead(data, final), nil
		}
		c.mu.Unlock()
		select {
		case <-ctx.Done():
		case <-s.output.wake:
		}
		c.mu.Lock()
	}
}

// The SDK removes an exited process from GetSession before sending its last ordered frames.
// Fence commands now, but let the reader drain the stream. A broken provider that never sends
// CLOSE eventually yields an explicit failure instead of retaining a blocked read forever.
func (c *controller) resourceProcessGone(s *resourceShell) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.resourceShells[s.id] != s || s.output.final != "" || s.output.expiry != nil {
		return
	}
	s.cancel()
	s.output.expiry = time.AfterFunc(endedSessionTTL, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.resourceShells[s.id] == s && s.output.final == "" {
			c.finishResourceShellLocked(s, shellFailed)
		}
	})
}

// finishResourceShellLocked fences input/origin immediately, but keeps the final bytes for one
// authenticated read. A window that never reads them holds at most one bounded buffer for the TTL.
func (c *controller) finishResourceShellLocked(s *resourceShell, state string) {
	if s.output.final != "" {
		return
	}
	s.output.final = state
	s.cancel()
	s.output.notify()
	if !s.created.IsZero() {
		if s.output.expiry != nil {
			s.output.expiry.Stop()
		}
		s.output.expiry = time.AfterFunc(endedSessionTTL, func() { c.dropResourceShell(s) })
	}
}

func (c *controller) forgetResourceShellLocked(s *resourceShell) {
	delete(c.resourceShells, s.id)
	s.cancel()
	s.output.pending = nil
	if s.output.expiry != nil {
		s.output.expiry.Stop()
		s.output.expiry = nil
	}
	s.output.notify()
}

// Private IDs never go through Wails' broadcast bus. The existing provider stream already orders
// stdout, stderr, error and final close. The SDK emits data only after its first attach cut; do not
// accept any data while create is still pending. Stream replacement and enqueue share controller.mu.
func (c *controller) dispatchResourceOutput(output execProviderOutput, id string) {
	c.mu.Lock()
	s := c.resourceShells[id]
	if s == nil || s.stream.done != output.done || c.streams[output.pluginID].done != output.done || s.stream.ctx.Err() != nil ||
		s.plugin != output.pluginID || s.process != output.SessionID || s.output.final != "" {
		c.mu.Unlock()
		return
	}
	var overflow bool
	switch output.Signal {
	case sdkexec.StreamSignalNone:
		if s.output.accepting && !s.output.enqueue(output.Data) {
			overflow = true
			c.finishResourceShellLocked(s, shellFailed)
		}
	case sdkexec.StreamSignalError:
		if s.output.accepting {
			// Preserve the provider's diagnostic in private stderr if it fits. The stream is
			// explicitly failed either way, never reported as a successful truncated read.
			s.output.enqueue(output.Data)
		}
		c.finishResourceShellLocked(s, shellFailed)
	case sdkexec.StreamSignalClose:
		c.finishResourceShellLocked(s, shellEnded)
	case sdkexec.StreamSignalSigint, sdkexec.StreamSignalSigquit, sdkexec.StreamSignalSigterm,
		sdkexec.StreamSignalSigkill, sdkexec.StreamSignalSighup, sdkexec.StreamSignalSigusr1,
		sdkexec.StreamSignalSigusr2, sdkexec.StreamSignalSigwinch:
		// Process-control signals are neither shell output nor a terminal read state.
		c.mu.Unlock()
		return
	}
	created := s.created
	c.mu.Unlock()
	if overflow && !created.IsZero() {
		// Closing can wait for this mux to take CLOSE. Never block the mux or another window's IO.
		go c.cleanupResourceProcess(s, created)
	}
}
