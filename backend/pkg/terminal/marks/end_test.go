package marks

import (
	"testing"
	"time"
)

// A mark says where its sequence ends, so that the host can deliver it exactly when the output has been read up to there, and a mark of a
// command start and end says when, on the producer's clock.
func TestAMarkSaysWhereItsSequenceEndsAndWhenAStartOrAnEndHappened(t *testing.T) {
	clock := newClock()
	s := newTestScanner(t, clock, 0)
	first := osc("133;A") + "$ " + osc("133;B") + "ls\r\n" + osc("633;E;ls;"+testNonce)
	ms := feedAll(s, first)
	clock.advance(3 * time.Second)
	started := clock.Now()
	ms = append(ms, feedAll(s, osc("133;C"))...)
	clock.advance(2 * time.Second)
	ended := clock.Now()
	ms = append(ms, feedAll(s, "out\r\n"+oscST("133;D;7")+osc("633;P;Cwd=/x;"+testNonce)+osc("7;file://h/y"))...)
	sameKinds(t, ms, KindPromptStart, KindInputStart, KindCommandStart, KindCommandEnd, KindCwd, KindCwd)

	stream := first + osc("133;C") + "out\r\n" + oscST("133;D;7") + osc("633;P;Cwd=/x;"+testNonce) + osc("7;file://h/y")
	lengths := []string{osc("133;A"), osc("133;B"), osc("133;C"), oscST("133;D;7"), osc("633;P;Cwd=/x;" + testNonce), osc("7;file://h/y")}
	for i, m := range ms {
		if got := m.EndOffset - m.AtOffset; got != uint64(len(lengths[i])) {
			t.Errorf("mark %d (%v) spans %d bytes, its sequence is %d", i, m.Kind, got, len(lengths[i]))
		}
		if m.EndOffset > uint64(len(stream)) || stream[m.AtOffset:m.EndOffset] != lengths[i] {
			t.Errorf("mark %d (%v) addresses %q, want %q", i, m.Kind, stream[min(m.AtOffset, uint64(len(stream))):min(m.EndOffset, uint64(len(stream)))], lengths[i])
		}
	}
	if !ms[2].Time.Equal(started) || !ms[3].Time.Equal(ended) {
		t.Errorf("the start is at %v and the end at %v, want %v and %v", ms[2].Time, ms[3].Time, started, ended)
	}
	if !ms[0].Time.IsZero() || !ms[1].Time.IsZero() || !ms[4].Time.IsZero() {
		t.Errorf("a mark that is no start or end has a time: %v %v %v", ms[0].Time, ms[1].Time, ms[4].Time)
	}
}

// A sequence cut across two reads is addressed whole, as it is when it is read at once.
func TestAMarkCutAcrossReadsHasTheSameEnd(t *testing.T) {
	data := osc("133;A") + "x" + oscST("133;D;0")
	whole := feedAll(newTestScanner(t, newClock(), 0), data)
	for _, m := range whole {
		if m.EndOffset <= m.AtOffset {
			t.Fatalf("a mark of %v ends at %d, not after its start at %d", m.Kind, m.EndOffset, m.AtOffset)
		}
	}
	for cut := 1; cut < len(data); cut++ {
		s := newTestScanner(t, newClock(), 0)
		got := append(s.Feed([]byte(data[:cut]), nil), s.Feed([]byte(data[cut:]), nil)...)
		if len(got) != len(whole) {
			t.Fatalf("cut %d gives %d marks, want %d", cut, len(got), len(whole))
		}
		for i := range got {
			if got[i].AtOffset != whole[i].AtOffset || got[i].EndOffset != whole[i].EndOffset {
				t.Fatalf("cut %d: mark %d is [%d,%d), want [%d,%d)", cut, i, got[i].AtOffset, got[i].EndOffset, whole[i].AtOffset, whole[i].EndOffset)
			}
		}
	}
}
