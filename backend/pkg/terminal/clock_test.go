//go:build !windows

package terminal

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// fakeClock is a clock that moves only when a test moves it. A test that waits for a lease in real time and asserts
// what it finds meanwhile is decided by how busy the machine is (the lease runs out while the test is not
// scheduled, or the test is not scheduled until the lease has run out); with this, what happens before and after the
// end of a lease is what the test says, in no time.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

type fakeTimer struct {
	clock *fakeClock
	at    time.Time
	f     func()
	live  bool
}

func newFakeClock() *fakeClock {
	return &fakeClock{mu: sync.Mutex{}, now: time.Date(2030, time.January, 1, 0, 0, 0, 0, time.UTC), timers: nil}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) timer {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{clock: c, at: c.now.Add(d), f: f, live: true}
	c.timers = append(c.timers, t)
	return t
}

func (t *fakeTimer) Stop() bool {
	t.clock.mu.Lock()
	defer t.clock.mu.Unlock()
	was := t.live
	t.live = false
	return was
}

// Advance moves the clock forward by d. The function of every timer that falls due runs, in the order of their
// instants and one at a time, to its end, in the caller's goroutine and with no lock of the clock held (the function
// may arm a timer, and one that falls due within d runs as well). Whatever the function leaves to another goroutine
// is not waited for.
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	target := c.now.Add(d)
	c.mu.Unlock()
	for {
		c.mu.Lock()
		var next *fakeTimer
		for _, t := range c.timers {
			if t.live && !t.at.After(target) && (next == nil || t.at.Before(next.at)) {
				next = t
			}
		}
		if next == nil {
			c.now = target
			c.mu.Unlock()
			return
		}
		next.live = false
		if next.at.After(c.now) {
			c.now = next.at
		}
		f := next.f
		c.mu.Unlock()
		f()
	}
}

// pending is how many timers have neither run nor been stopped.
func (c *fakeClock) pending() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, t := range c.timers {
		if t.live {
			n++
		}
	}
	return n
}

// withFakeClock puts the manager on a clock that stands still, before any terminal is started.
func withFakeClock(m *Manager) *fakeClock {
	c := newFakeClock()
	m.clock = c
	return c
}

func TestTheFakeClockRunsTheTimersThatFallDueInOrderAndNothingElse(t *testing.T) {
	c := newFakeClock()
	var order []string
	c.AfterFunc(3*time.Second, func() { order = append(order, "three") })
	stopped := c.AfterFunc(time.Second, func() { order = append(order, "stopped") })
	c.AfterFunc(2*time.Second, func() {
		order = append(order, "two")
		c.AfterFunc(500*time.Millisecond, func() { order = append(order, "armed by two") })
	})
	assert.True(t, stopped.Stop())
	assert.False(t, stopped.Stop(), "a timer is stopped once")
	assert.Equal(t, 2, c.pending())

	start := c.Now()
	c.Advance(2*time.Second - time.Millisecond)
	assert.Empty(t, order, "nothing falls due before its instant")
	c.Advance(time.Millisecond)
	assert.Equal(t, []string{"two"}, order)
	c.Advance(time.Second)
	assert.Equal(t, []string{"two", "armed by two", "three"}, order, "a timer that a function armed runs when it falls due, in its place")
	assert.Equal(t, start.Add(3*time.Second), c.Now())
	assert.Zero(t, c.pending())
}
