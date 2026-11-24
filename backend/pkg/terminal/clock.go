//go:build !windows

package terminal

import "time"

// timer is what a clock's AfterFunc returns: the part of *time.Timer that the manager uses.
type timer interface {
	// Stop prevents the function from running when it has not run yet, and says whether it did.
	Stop() bool
}

// clock is the time that the leases and the tombstones of the manager are kept in: the wall clock, and in a test
// that has to decide what happens before and after a lease ends, a clock that moves when the test says so. A test that
// waits for a real lease and asserts what it finds meanwhile is decided by how busy the machine is, because the lease
// runs out while the test is not scheduled. Nothing else of the manager is timed by it: the grace of a hangup, the
// flow control's stall and the input queue's gap are about processes and the kernel, and they stay on the wall clock.
type clock interface {
	Now() time.Time
	// AfterFunc runs f in its own goroutine once d has passed, as time.AfterFunc does.
	AfterFunc(d time.Duration, f func()) timer
}

// wallClock is the time of the host.
type wallClock struct{}

func (wallClock) Now() time.Time { return time.Now() }

func (wallClock) AfterFunc(d time.Duration, f func()) timer { return time.AfterFunc(d, f) }
