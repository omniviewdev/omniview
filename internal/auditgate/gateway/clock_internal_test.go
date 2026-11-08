package gateway

import (
	"testing"
	"time"
)

func TestDeadlineIsReachedByEitherClock(t *testing.T) {
	start := Instant{Wall: time.Date(2026, time.November, 8, 12, 0, 0, 0, time.UTC), Mono: time.Hour}
	d := deadlineAfter(start, time.Hour)

	cases := []struct {
		name string
		now  Instant
		want bool
	}{
		{"just started", start, false},
		{"both clocks nearly there", Instant{Wall: start.Wall.Add(59 * time.Minute), Mono: start.Mono + 59*time.Minute}, false},
		{"both clocks there", Instant{Wall: start.Wall.Add(time.Hour), Mono: start.Mono + time.Hour}, true},
		{"suspend: wall there, monotonic not", Instant{Wall: start.Wall.Add(3 * time.Hour), Mono: start.Mono}, true},
		{"wall set back: monotonic there, wall not", Instant{Wall: start.Wall.Add(-time.Hour), Mono: start.Mono + time.Hour}, true},
		{"wall exactly at the deadline", Instant{Wall: start.Wall.Add(time.Hour), Mono: start.Mono}, true},
		{"monotonic exactly at the deadline", Instant{Wall: start.Wall, Mono: start.Mono + time.Hour}, true},
		{"one nanosecond short on both", Instant{Wall: start.Wall.Add(time.Hour - 1), Mono: start.Mono + time.Hour - 1}, false},
	}
	for _, tc := range cases {
		if got := d.reached(tc.now); got != tc.want {
			t.Errorf("%s: reached = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestRemainingIsTheNearerClocksAndNeverNegative(t *testing.T) {
	start := Instant{Wall: time.Date(2026, time.November, 8, 12, 0, 0, 0, time.UTC), Mono: time.Hour}
	d := deadlineAfter(start, time.Hour)
	if got := d.remaining(start); got != time.Hour {
		t.Fatalf("remaining at the start = %v", got)
	}
	suspended := Instant{Wall: start.Wall.Add(40 * time.Minute), Mono: start.Mono}
	if got := d.remaining(suspended); got != 20*time.Minute {
		t.Fatalf("remaining after a 40 minute suspend = %v, want 20m (the wall clock's)", got)
	}
	setBack := Instant{Wall: start.Wall.Add(-time.Hour), Mono: start.Mono + 50*time.Minute}
	if got := d.remaining(setBack); got != 10*time.Minute {
		t.Fatalf("remaining with the wall clock set back = %v, want 10m (the monotonic clock's)", got)
	}
	past := Instant{Wall: start.Wall.Add(5 * time.Hour), Mono: start.Mono + 5*time.Hour}
	if got := d.remaining(past); got != 0 {
		t.Fatalf("remaining after the deadline = %v, want 0", got)
	}
}

func TestSystemClockReadsBothClocks(t *testing.T) {
	clock := SystemClock()
	a := clock.Now()
	time.Sleep(5 * time.Millisecond)
	b := clock.Now()
	if !b.Wall.After(a.Wall) || b.Mono <= a.Mono {
		t.Fatalf("clock did not advance: %v -> %v", a, b)
	}
	if b.Wall.Round(0) != b.Wall {
		t.Fatal("the wall reading carries a monotonic reading, so comparisons would silently use it")
	}
}
