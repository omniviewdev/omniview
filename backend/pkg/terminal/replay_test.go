package terminal

import (
	"bytes"
	"math/rand/v2"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// escapedStream is n bytes of what terminals write, the same for the same seed; it may end inside a sequence.
func escapedStream(seed uint64, n int) []byte {
	rng := rand.New(rand.NewPCG(seed, seed+1))
	var out strings.Builder
	for out.Len() < n {
		out.WriteString(randomStream(rng, 8))
	}
	return []byte(out.String()[:n])
}

// feedReads writes stream into the ring in reads of between 1 and most bytes, the way a shell's output arrives.
func feedReads(r *replayRing, stream []byte, rng *rand.Rand, most int) {
	for len(stream) > 0 {
		n := min(1+rng.IntN(most), len(stream))
		r.write(stream[:n])
		stream = stream[n:]
	}
}

// replayOf takes the replay of a ring the way the session does: a view, then the copy.
func replayOf(t *testing.T, r *replayRing, from *uint64) Replay {
	t.Helper()
	v, err := r.view(from)
	require.NoError(t, err)
	return v.replay()
}

func capacity(r *replayRing) int {
	total := 0
	for _, chunk := range r.chunks {
		total += cap(chunk.data)
	}
	return total
}

// Every byte has an offset, the ring keeps the newest bytes in whole chunks, and what it replays is exactly
// the bytes of the stream between the offsets it says.
func TestTheRingNumbersEveryByteAndKeepsTheNewestWholeChunks(t *testing.T) {
	limit := 4 * chunkBytes
	r := newReplayRing(limit, Size{Cols: 80, Rows: 24})
	stream := escapedStream(1, 3<<20)
	rng := rand.New(rand.NewPCG(3, 4))
	for len(stream) > 0 {
		n := min(1+rng.IntN(20<<10), len(stream))
		r.write(stream[:n])
		stream = stream[n:]
		require.LessOrEqual(t, r.kept, limit)
	}
	whole := escapedStream(1, 3<<20)
	assert.Equal(t, uint64(len(whole)), r.end, "the offset of the next byte is the number of bytes written")
	assert.Greater(t, r.kept, limit-2*chunkBytes, "only whole chunks beyond the bound are dropped, never more")
	assert.LessOrEqual(t, len(r.chunks), limit/chunkBytes+3)

	rep := replayOf(t, r, nil)
	assert.Equal(t, r.start(), rep.Start)
	assert.Equal(t, r.end, rep.End)
	assert.Equal(t, whole[rep.Start:rep.End], rep.Data, "exactly the bytes of the stream between the offsets")
	assert.Equal(t, whole[rep.Start:], r.bytes(), "the legacy attach gets everything that is kept")
}

// The start of what is kept is a place an emulator may start: a replay never begins inside an escape sequence
// or a UTF-8 sequence, and says the modes in force there, whatever the cut of the reads.
func TestTheRingStartsWhereTheOutputIsAtABoundaryAndSaysTheModesThere(t *testing.T) {
	for seed := uint64(1); seed <= 40; seed++ {
		stream := escapedStream(seed, 700<<10)
		r := newReplayRing(3*chunkBytes, Size{Cols: 80, Rows: 24})
		feedReads(r, stream, rand.New(rand.NewPCG(seed, 9)), 20<<10)
		rep := replayOf(t, r, nil)
		require.Positive(t, rep.Start, "seed %d: the stream is longer than the ring", seed)

		before := read(string(stream[:rep.Start]), 1<<30)
		require.True(t, before.atBoundary(), "seed %d: the replay starts at %d, inside a sequence", seed, rep.Start)
		require.Equal(t, before.modes(), rep.StartModes, "seed %d: the modes in force at the start of the replay", seed)
		require.Equal(t, read(string(stream), 1<<30).modes(), rep.Modes, "seed %d: the modes after the last byte", seed)
		require.Equal(t, stream[rep.Start:], rep.Data, "seed %d", seed)
	}
}

// A title longer than two chunks forces chunks that begin inside the string: the ring does not keep one of them
// as the start of what it holds while it has anything newer to start at, so a replay still begins at a boundary.
// (Only the last chunk can be left as it is: the ring keeps the output it has.)
func TestTheRingStartsAtABoundaryAlsoWhenATitleIsLongerThanAChunk(t *testing.T) {
	insideAString := 0
	for seed := uint64(1); seed <= 60; seed++ {
		rng := rand.New(rand.NewPCG(seed, 21))
		var stream bytes.Buffer
		for stream.Len() < 900<<10 {
			if rng.IntN(4) == 0 {
				stream.WriteString("\x1b]0;")
				stream.Write(bytes.Repeat([]byte("t"), 20<<10+rng.IntN(300<<10)))
				stream.WriteString("\x07")
				continue
			}
			stream.WriteString(randomStream(rng, 200))
		}
		r := newReplayRing(3*chunkBytes, Size{Cols: 80, Rows: 24})
		feedReads(r, stream.Bytes(), rng, 20<<10)
		rep := replayOf(t, r, nil)
		for _, chunk := range r.chunks {
			if !chunk.ground {
				insideAString++
			}
		}
		if len(r.chunks) > 1 {
			before := read(string(stream.Bytes()[:rep.Start]), 1<<30)
			require.True(t, before.atBoundary(), "seed %d: the replay starts at %d, inside a string, with %d chunks kept", seed, rep.Start, len(r.chunks))
		}
	}
	assert.Positive(t, insideAString, "the streams did make chunks that begin inside a string")
}

// A string that never ends cannot make a chunk grow without bound; the ring keeps the output it has.
func TestAStringThatNeverEndsDoesNotGrowAChunkWithoutBound(t *testing.T) {
	r := newReplayRing(4*chunkBytes, Size{Cols: 80, Rows: 24})
	r.write([]byte("\x1b]0;"))
	block := bytes.Repeat([]byte("a"), 20<<10)
	for range 100 {
		r.write(block)
	}
	for _, chunk := range r.chunks {
		assert.LessOrEqual(t, len(chunk.data), 2*chunkBytes+len(block), "a chunk is cut at twice the size even where no boundary comes")
	}
	assert.LessOrEqual(t, r.kept, 4*chunkBytes+2*chunkBytes+len(block))
	assert.Equal(t, uint64(4+100*len(block)), r.end)
}

// A page that has output up to an offset asks for the rest, and gets exactly that; one that is too far behind
// is told where the host's output starts, which is later than it asked; one that claims to be ahead is refused.
func TestTheRingReplaysFromTheOffsetThePageHasWhenTheHostStillHasIt(t *testing.T) {
	r := newReplayRing(6*chunkBytes, Size{Cols: 80, Rows: 24})
	stream := escapedStream(5, 300<<10)
	feedReads(r, stream, rand.New(rand.NewPCG(5, 6)), 10<<10)
	require.Zero(t, r.start(), "nothing has been dropped yet")

	for _, from := range []uint64{0, 1, 77, 64 << 10, 150001, uint64(len(stream)) - 1} {
		rep := replayOf(t, r, new(from))
		require.Equal(t, from, rep.Start, "from %d", from)
		require.Equal(t, stream[from:], rep.Data, "from %d", from)
		require.Equal(t, read(string(stream[:from]), 1<<30).modes(), rep.StartModes, "the modes at offset %d, even inside a sequence", from)
	}
	end := replayOf(t, r, new(uint64(len(stream))))
	assert.Equal(t, uint64(len(stream)), end.Start)
	assert.Empty(t, end.Data, "a page that has everything has nothing to replay")

	more := escapedStream(6, 2<<20)
	feedReads(r, more, rand.New(rand.NewPCG(5, 7)), 10<<10)
	require.Positive(t, r.start())
	old := replayOf(t, r, new(uint64(10)))
	assert.Equal(t, r.start(), old.Start, "the host starts later than the page asked: the gap is visible, never hidden")
	assert.Greater(t, old.Start, uint64(10))
	assert.Equal(t, r.end, old.End)

	_, err := r.view(new(r.end + 1))
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	assert.Equal(t, "INVALID_REQUEST", app.Code)
	assert.Contains(t, app.Detail, "from_offset")
}

// A replay says the size each of its bytes was written for: the size at its start and the size now.
func TestTheRingSaysTheSizeTheOutputWasWrittenFor(t *testing.T) {
	r := newReplayRing(2*chunkBytes, Size{Cols: 80, Rows: 24})
	r.write(bytes.Repeat([]byte("a"), 100))
	r.noteSize(Size{Cols: 100, Rows: 30})
	r.write(bytes.Repeat([]byte("b"), 100))
	r.noteSize(Size{Cols: 100, Rows: 30})
	r.noteSize(Size{Cols: 120, Rows: 40})
	r.noteSize(Size{Cols: 120, Rows: 41})
	r.write(bytes.Repeat([]byte("c"), 100))

	rep := replayOf(t, r, nil)
	assert.Equal(t, Size{Cols: 80, Rows: 24}, rep.StartSize)
	assert.Equal(t, Size{Cols: 120, Rows: 41}, rep.Size, "two sizes with no output between: the first never applied to any output")
	assert.Equal(t, Size{Cols: 80, Rows: 24}, replayOf(t, r, new(uint64(99))).StartSize)
	assert.Equal(t, Size{Cols: 100, Rows: 30}, replayOf(t, r, new(uint64(100))).StartSize, "a size applies from the offset it was taken at")
	assert.Equal(t, Size{Cols: 100, Rows: 30}, replayOf(t, r, new(uint64(199))).StartSize)
	assert.Equal(t, Size{Cols: 120, Rows: 41}, replayOf(t, r, new(uint64(200))).StartSize)
	assert.Len(t, r.sizes, 3, "a size that did not change is not logged twice")

	// Before any output a resize is the size the output starts at.
	fresh := newReplayRing(2*chunkBytes, Size{Cols: 80, Rows: 24})
	fresh.noteSize(Size{Cols: 90, Rows: 20})
	fresh.write([]byte("x"))
	assert.Equal(t, Size{Cols: 90, Rows: 20}, replayOf(t, fresh, nil).StartSize)
	assert.Len(t, fresh.sizes, 1)

	// The log follows the ring: what the ring drops, it forgets, and keeps the size in force at its start.
	rng := rand.New(rand.NewPCG(8, 9))
	feedReads(r, escapedStream(9, 1<<20), rng, 20<<10)
	require.Positive(t, r.start())
	assert.Equal(t, Size{Cols: 120, Rows: 41}, replayOf(t, r, nil).StartSize, "the size in force at the new start")
	assert.Len(t, r.sizes, 1)

	// A storm of resizes with output between them is bounded.
	for i := range 3 * maxSizeLog {
		r.write([]byte("x"))
		r.noteSize(Size{Cols: 10 + i%500, Rows: 10 + i%7})
	}
	assert.LessOrEqual(t, len(r.sizes), maxSizeLog)
}

// What the ring holds is bounded whatever the shape of the reads: one byte at a time costs no more than reads
// of the largest size, in bytes and in chunks.
func TestTheRingHoldsItsBoundWhateverTheShapeOfTheReads(t *testing.T) {
	limit := 8 * chunkBytes
	shapes := map[string]func(r *replayRing){
		"one byte at a time": func(r *replayRing) {
			for i := range 3 << 20 {
				r.write([]byte{byte('a' + i%26)})
			}
		},
		"reads of the largest size": func(r *replayRing) {
			block := bytes.Repeat([]byte("0123456789abcdef"), (20<<10)/16)
			for range 200 {
				r.write(block)
			}
		},
		"reads of random sizes": func(r *replayRing) {
			feedReads(r, escapedStream(2, 4<<20), rand.New(rand.NewPCG(1, 2)), 20<<10)
		},
	}
	for name, shape := range shapes {
		r := newReplayRing(limit, Size{Cols: 80, Rows: 24})
		shape(r)
		assert.LessOrEqual(t, r.kept, limit, name)
		assert.LessOrEqual(t, len(r.chunks), limit/chunkBytes+4, "%s: the chunks are bounded, not the reads", name)
		assert.LessOrEqual(t, capacity(r), limit+4*chunkBytes, "%s: the memory behind the bytes is bounded too", name)
	}
}

// A view is a snapshot: the bytes it covers never change while the reader goes on writing and the ring drops
// what the view covers. (Run under the race detector, this is also where a view that shares memory it must not
// would be found.)
func TestAViewOutlivesTheLockAndItsBytesNeverChange(t *testing.T) {
	r := newReplayRing(3*chunkBytes, Size{Cols: 80, Rows: 24})
	var mu sync.Mutex
	byteAt := func(i uint64) byte { return byte(i*31 + i>>7) }
	done := make(chan struct{})
	var written uint64
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		rng := rand.New(rand.NewPCG(1, 1))
		for {
			select {
			case <-done:
				return
			default:
			}
			n := 1 + rng.IntN(20<<10)
			buf := make([]byte, n)
			mu.Lock()
			for i := range buf {
				buf[i] = byteAt(written + uint64(i))
			}
			written += uint64(n)
			r.write(buf)
			mu.Unlock()
		}
	}()
	for range 300 {
		mu.Lock()
		v, err := r.view(nil)
		mu.Unlock()
		require.NoError(t, err)
		rep := v.replay()
		for j, b := range rep.Data {
			if b != byteAt(rep.Start+uint64(j)) {
				close(done)
				wg.Wait()
				require.Failf(t, "a byte of a view changed", "offset %d", rep.Start+uint64(j))
			}
		}
		require.Equal(t, rep.End-rep.Start, uint64(len(rep.Data)))
	}
	close(done)
	wg.Wait()
}
