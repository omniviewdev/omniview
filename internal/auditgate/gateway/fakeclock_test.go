package gateway_test

import (
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// fakeClock has two readings that move independently, the way a suspended
// laptop's do: the wall clock keeps going while the monotonic clock stands still.
type fakeClock struct {
	mu   sync.Mutex
	wall time.Time
	mono time.Duration
}

func newFakeClock() *fakeClock {
	return &fakeClock{wall: time.Date(2026, time.November, 8, 12, 0, 0, 0, time.UTC), mono: time.Hour}
}

func (c *fakeClock) Now() gateway.Instant {
	c.mu.Lock()
	defer c.mu.Unlock()
	return gateway.Instant{Wall: c.wall, Mono: c.mono}
}

// Advance is ordinary elapsed time: both clocks move.
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.wall = c.wall.Add(d)
	c.mono += d
}

// Suspend is time the monotonic clock did not see: only the wall clock moves.
func (c *fakeClock) Suspend(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.wall = c.wall.Add(d)
}

// StepWall sets the wall clock forward or, with a negative d, back, as a manual
// change or a time sync would. The monotonic clock does not move.
func (c *fakeClock) StepWall(d time.Duration) {
	c.Suspend(d)
}
