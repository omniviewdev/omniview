package gateway

import "time"

// Instant is one reading of the two clocks an audit deadline is checked
// against.
type Instant struct {
	// Wall is the wall-clock time. It carries no monotonic reading, so every
	// comparison of it uses the wall clock alone.
	Wall time.Time
	// Mono counts from an arbitrary origin and never steps backward. It need
	// not advance while the machine sleeps: Go's monotonic clock stops in
	// system suspend on macOS and Linux.
	Mono time.Duration
}

// Clock supplies Instants. Production code uses [SystemClock]; tests inject a
// clock whose two readings move independently, which is how a suspend (the
// wall clock jumps, the monotonic clock does not) is exercised.
type Clock interface {
	Now() Instant
}

type systemClock struct {
	origin time.Time
}

// SystemClock returns the process clocks.
func SystemClock() Clock {
	return systemClock{origin: time.Now()}
}

func (c systemClock) Now() Instant {
	now := time.Now()
	// origin keeps its monotonic reading, so Sub measures monotonic time.
	return Instant{Wall: now.Round(0), Mono: now.Sub(c.origin)}
}

// deadline is a point in time given on both clocks. It is reached when either
// clock reaches it, so an audit lives for the earlier of its monotonic and its
// wall-clock lifetime.
type deadline struct {
	wall time.Time
	mono time.Duration
}

func deadlineAfter(now Instant, ttl time.Duration) deadline {
	return deadline{wall: now.Wall.Add(ttl), mono: now.Mono + ttl}
}

func (d deadline) reached(now Instant) bool {
	return !now.Wall.Before(d.wall) || now.Mono >= d.mono
}

// remaining is the time left on the nearer of the two clocks, never negative.
func (d deadline) remaining(now Instant) time.Duration {
	left := min(d.wall.Sub(now.Wall), d.mono-now.Mono)
	return max(left, 0)
}
