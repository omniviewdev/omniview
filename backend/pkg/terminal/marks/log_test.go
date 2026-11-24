package marks

import (
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestTheLogKeepsTheNewestCommandsAndIdsGoOn(t *testing.T) {
	s := newTestScanner(t, newClock(), 3)
	for i := range 10 {
		feedAll(s, cycle("cmd"+strconv.Itoa(i), "out", "0"))
	}
	recs := s.Log().Records()
	if len(recs) != 3 {
		t.Fatalf("the log keeps %d commands, want 3", len(recs))
	}
	for i, want := range []string{"c8", "c9", "c10"} {
		if recs[i].CommandID != want || recs[i].CommandLine != "cmd"+strconv.Itoa(7+i) {
			t.Fatalf("command %d is %v, want %s", i, recs[i], want)
		}
	}
	if last, ok := s.Log().Last(); !ok || last.CommandID != "c10" {
		t.Fatalf("the last command is %v %v", last, ok)
	}
}

func TestTheLogDefaultIsBounded(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	for range DefaultMaxRecords + 100 {
		feedAll(s, osc("133;A")+osc("133;C")+osc("133;D;0"))
	}
	if got := len(s.Log().Records()); got != DefaultMaxRecords {
		t.Fatalf("the log keeps %d commands, want %d", got, DefaultMaxRecords)
	}
}

func TestACommandIsFoundByAnOffsetInIt(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	one, two := cycle("one", "first output", "0"), cycle("two", "second output", "1")
	data := one + two + osc("133;A") + "$ "
	feedAll(s, data)
	for _, c := range []struct {
		offset uint64
		want   string
	}{
		{0, "c1"},
		{at(t, data, "first output"), "c1"},
		{uint64(len(one)) - 1, "c1"},
		{uint64(len(one)), "c2"},
		{uint64(len(one)) + at(t, two, "second output"), "c2"},
		{uint64(len(one + two)), "c3"},
		{uint64(len(data)), "c3"},
	} {
		got, ok := s.Log().At(c.offset)
		if !ok || got.CommandID != c.want {
			t.Fatalf("offset %d is in %q %v, want %s", c.offset, got.CommandID, ok, c.want)
		}
	}
	// An offset before the oldest command kept is in none.
	s = newTestScanner(t, newClock(), 2)
	feedAll(s, one+two+one)
	if got, ok := s.Log().At(0); ok {
		t.Fatalf("an offset of a dropped command is in %v", got)
	}
}

func TestTheRunningCommandIsTheOneThatStartedAndDidNotEnd(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	if _, ok := s.Log().Running(); ok {
		t.Fatal("a log with nothing is running")
	}
	feedAll(s, osc("133;A")+osc("133;B"))
	if _, ok := s.Log().Running(); ok {
		t.Fatal("a prompt is running")
	}
	feedAll(s, osc("133;C"))
	if rec, ok := s.Log().Running(); !ok || rec.CommandID != "c1" || rec.State != StateRunning {
		t.Fatalf("the started command is %v %v", rec, ok)
	}
	feedAll(s, osc("133;D;0"))
	if _, ok := s.Log().Running(); ok {
		t.Fatal("an ended command is running")
	}
}

func TestTheRecordsOfALogAreACopy(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	feedAll(s, cycle("ls", "out", "0"))
	recs := s.Log().Records()
	if len(recs) != 1 {
		t.Fatalf("the log keeps %d commands, want 1", len(recs))
	}
	recs[0].CommandLine = "changed"
	recs[0].ExitCode = 99
	if got, _ := s.Log().Last(); got.CommandLine != "ls" || got.ExitCode != 0 {
		t.Fatalf("a caller changed the log: %v", got)
	}
}

func TestTheLogMayBeReadWhileTheScannerReads(t *testing.T) {
	clock := newClock()
	s := newTestScanner(t, clock, 8)
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					s.Log().Records()
					s.Log().Last()
					s.Log().Running()
					s.Log().At(100)
					s.Log().Cwd()
					s.Stats()
					s.Offset()
				}
			}
		}()
	}
	out := make([]Mark, 0, 16)
	for range 2000 {
		out = s.Feed([]byte(cycle("ls", "out", "0")+osc("7;file://h/x")), out[:0])
		clock.advance(time.Millisecond)
	}
	close(stop)
	wg.Wait()
	if last, ok := s.Log().Last(); !ok || last.CommandID != "c2000" {
		t.Fatalf("the last command is %v %v, want c2000", last, ok)
	}
}
