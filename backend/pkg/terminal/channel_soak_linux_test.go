package terminal

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE SOAK OF THE HIDDEN-PAGE POLICY, ON A REAL CLOCK AND A REAL MINUTE.
//
// It runs only where TERMINAL_CHANNEL_SOAK_SECONDS is set, and that is only ever inside a Docker container started with
// `--cpus 2` (docs/ui-next/status/T3-channel.md has the command and the numbers): a flood that runs for a minute is a CPU burner,
// and the host's CPU is shared. Linux only: the process's own memory is read from /proc.
//
// The page never reads: the first frame of output parks in its transport for good. The stall passes in real time, two seconds,
// the shell is let go, and from then on the child writes as fast as the machine lets it for the whole run. What must hold at the
// end, whatever the time: the child was never blocked (its offset advanced in every second that was sampled, and it is alive), the
// process's resident memory did not grow (measured before and after, after the ring had filled twice), the host's heap did not
// grow by more than a constant, and the ring holds exactly the newest bytes of what the child wrote, with every byte it overwrote
// counted.

func soakSeconds(t *testing.T) int {
	t.Helper()
	raw := os.Getenv("TERMINAL_CHANNEL_SOAK_SECONDS")
	if raw == "" {
		t.Skip("set TERMINAL_CHANNEL_SOAK_SECONDS (60) inside a `docker run --cpus 2` container: a flood for a minute is a CPU burner (docs/ui-next/status/T3-channel.md)")
	}
	seconds, err := strconv.Atoi(raw)
	require.NoError(t, err)
	require.Positive(t, seconds)
	return seconds
}

// residentKiB is the resident set of a process, from /proc.
func residentKiB(t *testing.T, pid int) int {
	t.Helper()
	file, err := os.Open("/proc/" + strconv.Itoa(pid) + "/status")
	require.NoError(t, err)
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if rest, ok := strings.CutPrefix(scanner.Text(), "VmRSS:"); ok {
			fields := strings.Fields(rest)
			require.NotEmpty(t, fields)
			kib, convErr := strconv.Atoi(fields[0])
			require.NoError(t, convErr)
			return kib
		}
	}
	require.Fail(t, "no VmRSS in /proc status")
	return 0
}

// soak floods a terminal whose page never reads for the seconds asked, and checks what must hold at the end.
func soak(t *testing.T, script string, verify func(t *testing.T, s *session, got []byte)) {
	t.Helper()
	seconds := soakSeconds(t)
	m, _ := newChannelManager(t, nil) // the limits of the host: an 8 MiB ring, a stall of two seconds
	info := m.startChannel(t, script, Options{})
	s := m.chanOf(t, info)
	f := newFakeChannel(t)
	f.park(1)
	page := m.attachOn(t, f, info.Cap, nil, 0)
	page.waitReady()
	page.input("go\n")
	ring := uint64(m.channel.ring)
	require.Eventually(t, func() bool { return s.channelStats().end >= 2*ring+(1<<20) }, 60*time.Second, 50*time.Millisecond,
		"the ring never filled twice: the child is blocked at %d", s.channelStats().end)

	rssBefore, childBefore, heapBefore, endBefore := residentKiB(t, os.Getpid()), residentKiB(t, info.PID), heapInUse(), s.channelStats().end
	started := time.Now()
	last := endBefore
	for second := 1; time.Since(started) < time.Duration(seconds)*time.Second; second++ {
		time.Sleep(time.Second) // the soak's own cadence: nothing but its length is decided by it
		now := s.channelStats().end
		assert.Greater(t, now, last, "second %d: the child's offset advanced: it was not blocked", second)
		last = now
	}
	elapsed := time.Since(started)
	stats := s.channelStats()
	rssAfter, childAfter, heapAfter := residentKiB(t, os.Getpid()), residentKiB(t, info.PID), heapInUse()
	assert.False(t, s.hasExited())
	assert.False(t, gone(info.PID), "the child is alive")
	assert.Zero(t, stats.sent, "no frame of output was ever taken")
	assert.GreaterOrEqual(t, stats.stallReleases, uint64(1))
	assert.Less(t, rssAfter-rssBefore, 16<<10, "the resident memory of the process is flat: it grew by less than 16 MiB")
	assert.Less(t, int64(heapAfter)-int64(heapBefore), int64(4<<20), "and so is the heap")
	t.Logf("SOAK %d s (%.1f s measured): output %d -> %d = %.0f MiB written (%.1f MiB/s), rings written %.0f",
		seconds, elapsed.Seconds(), endBefore, stats.end, float64(stats.end-endBefore)/(1<<20), float64(stats.end-endBefore)/(1<<20)/elapsed.Seconds(),
		float64(stats.end)/float64(ring))
	t.Logf("SOAK host VmRSS %d kiB -> %d kiB (%+d), child VmRSS %d kiB -> %d kiB (%+d), heap %d -> %d bytes (%+d)",
		rssBefore, rssAfter, rssAfter-rssBefore, childBefore, childAfter, childAfter-childBefore, heapBefore, heapAfter, int64(heapAfter)-int64(heapBefore))

	require.NoError(t, m.CloseChannel(info.Cap))
	got := s.retained()
	final := s.channelStats()
	assert.Equal(t, final.end-uint64(len(got)), final.overwritten, "overwritten is the output less what the ring holds")
	assert.Equal(t, final.end-uint64(len(got)), final.start)
	t.Logf("SOAK ring: kept %d of a limit of %d, overwritten %d, output %d", len(got), m.channel.ring, final.overwritten, final.end)
	verify(t, s, got)
}

// The counting sequence, which tells every byte of the ring from its offset.
func TestSoakAChildWritingTheCountingSequenceForAMinuteWithNoReaderIsNeverBlockedAndTheHostIsFlat(t *testing.T) {
	soak(t, countingScript(-1, true), func(t *testing.T, s *session, got []byte) {
		t.Helper()
		start := s.channelStats().start
		assert.Equal(t, countingBytes(start, uint64(len(got))), got, "the ring holds the newest bytes of the sequence, byte for byte")
	})
}

// `yes`, the fastest flood there is: the same, and the ring is its newest bytes, which the offset tells (an even offset is a `y`).
func TestSoakYesForAMinuteWithNoReaderIsNeverBlockedAndTheHostIsFlat(t *testing.T) {
	soak(t, `stty -opost -echo; read go; exec yes`, func(t *testing.T, s *session, got []byte) {
		t.Helper()
		start := s.channelStats().start
		for i := range got {
			want := byte('y')
			if (start+uint64(i))%2 == 1 {
				want = '\n'
			}
			if got[i] != want {
				require.Equal(t, want, got[i], "the ring holds the newest bytes of `yes`: byte %d at offset %d", i, start+uint64(i))
			}
		}
	})
}
