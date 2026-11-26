package terminal

import (
	"fmt"
	"slices"
	"sort"
)

const (
	// chunkBytes is how much one chunk of the replay ring holds before it is ended at the next boundary, and
	// chunkSlack is the room a chunk is made with beyond that for the few bytes that take. The ring drops whole
	// chunks, oldest first.
	chunkBytes = 64 << 10
	chunkSlack = 1 << 10
	// maxSizeLog bounds the log of the sizes the terminal had: past it the oldest is forgotten.
	maxSizeLog = 256
)

// replayRing is the output of one terminal that the host keeps to replay, addressed by OFFSET: the number of
// bytes the terminal wrote before the byte. It holds the newest limit bytes or a little less, in whole chunks,
// and a chunk is dropped only when the next one begins at a BOUNDARY (modeTracker.atBoundary): the start of
// what is kept is never inside an escape sequence, a string or a UTF-8 sequence, so that an emulator that
// starts there starts clean. (A single sequence longer than two chunks cannot be honoured: the chunk that
// follows it begins inside it, and is kept as it is.)
//
// It also follows the modes the programs of the terminal switched on (live is the tracker at the end,
// front is the tracker at the start of what is kept: it is fed what is dropped), and the sizes the terminal
// had, each with the offset it applied at (sizes), so that a replay says the size and the modes its first byte
// was written under as well as the ones now.
//
// It is not safe for concurrent use: the session's output lock orders every call, and orders them with the
// events (that is what makes an attach atomic with the stream). A view is a snapshot that outlives the lock:
// the bytes of a chunk, once written, never change.
type replayRing struct {
	limit  int
	chunks []replayChunk
	kept   int
	end    uint64
	live   modeTracker
	front  modeTracker
	sizes  []sizeAt
	// overwritten counts the bytes the ring dropped for room, oldest first: the output less what it holds, always.
	overwritten uint64
	// marks is what the shell's integration marked in the output, read in write: nil for a terminal that has no integration (channel_marks.go).
	marks *markStore
	// title is the title a program set, read in write: nil for a terminal that has no channel (channel_title.go).
	title *titleTracker
}

// replayChunk is a run of whole reads.
type replayChunk struct {
	start uint64
	data  []byte
	// ground says the output was at a boundary where the chunk starts.
	ground bool
}

// sizeAt is a size the terminal took, and the offset of the output it applied at.
type sizeAt struct {
	at   uint64
	size Size
}

// newReplayRing makes the ring of a terminal that starts at size and keeps limit bytes.
func newReplayRing(limit int, size Size) *replayRing {
	r := new(replayRing)
	r.limit = limit
	r.sizes = []sizeAt{{at: 0, size: size}}
	return r
}

// offset is a length as an offset: a length is never negative.
func offset(n int) uint64 { return uint64(n) } //nolint:gosec // A length is never negative.

// write appends the terminal's next output, which it copies: the caller's slice belongs to the event. A chunk
// takes bytes up to chunkBytes, and then up to the first boundary, wherever in a read that is: the next chunk
// begins there. (A chunk that no boundary has ended at twice the size is ended anyway.)
func (r *replayRing) write(p []byte) {
	if r.marks != nil {
		r.marks.feed(p)
	}
	if r.title != nil {
		r.title.feed(p)
	}
	for len(p) > 0 {
		if len(r.chunks) == 0 {
			r.openChunk()
		}
		tail := &r.chunks[len(r.chunks)-1]
		var n int
		if room := chunkBytes - len(tail.data); room > 0 {
			n = min(room, len(p))
			r.live.feed(p[:n])
		} else {
			n = r.live.feedToBoundary(p)
		}
		tail.data = append(tail.data, p[:n]...)
		p = p[n:]
		r.end += offset(n)
		r.kept += n
		if len(tail.data) >= chunkBytes && (r.live.atBoundary() || len(tail.data) >= 2*chunkBytes) {
			r.openChunk()
		}
	}
	r.trim()
}

// openChunk begins a chunk at the end of the output.
func (r *replayRing) openChunk() {
	r.chunks = append(r.chunks, replayChunk{start: r.end, data: make([]byte, 0, chunkBytes+chunkSlack), ground: r.live.atBoundary()})
}

// trim drops the oldest chunks while more than limit is kept, and while what is left would begin away from a
// boundary, but never the last chunk.
func (r *replayRing) trim() {
	for len(r.chunks) > 1 && (r.kept > r.limit || !r.chunks[0].ground) {
		head := r.chunks[0]
		r.front.feed(head.data)
		r.kept -= len(head.data)
		r.overwritten += offset(len(head.data))
		r.chunks[0] = replayChunk{start: 0, data: nil, ground: false}
		r.chunks = r.chunks[1:]
	}
	r.trimSizes()
}

// trimSizes forgets the sizes older than the one in force at the start of what is kept.
func (r *replayRing) trimSizes() {
	i := len(r.sizes) - 1
	for i > 0 && r.sizes[i].at > r.chunks[0].start {
		i--
	}
	if i > 0 {
		r.sizes = slices.Delete(r.sizes, 0, i)
	}
}

// noteSize records a size the terminal took, at the offset of the output it has written so far.
func (r *replayRing) noteSize(size Size) {
	last := &r.sizes[len(r.sizes)-1]
	switch {
	case last.size == size:
		return
	case last.at == r.end:
		// No output since the one before: that one was never the size of any output.
		last.size = size
		if n := len(r.sizes); n > 1 && r.sizes[n-2].size == size {
			r.sizes = r.sizes[:n-1]
		}
		return
	}
	r.sizes = append(r.sizes, sizeAt{at: r.end, size: size})
	if len(r.sizes) > maxSizeLog {
		r.sizes = slices.Delete(r.sizes, 0, 1)
	}
}

// size is the size the terminal had at an offset of its output.
func (r *replayRing) size(at uint64) Size {
	for i := len(r.sizes) - 1; i > 0; i-- {
		if r.sizes[i].at <= at {
			return r.sizes[i].size
		}
	}
	return r.sizes[0].size
}

// start is the oldest offset still kept.
func (r *replayRing) start() uint64 {
	if len(r.chunks) == 0 {
		return r.end
	}
	return r.chunks[0].start
}

// slices returns the output from offset from, at most limit bytes of it, as slices of the chunks that hold it, and the offset
// where they end. The bytes of a chunk, once written, never change and a slice is cut to its length, so the slices stay good
// after the lock that ordered the call is let go, and nothing is copied: the caller copies what it needs. An offset below the
// start of what is kept, or at the end, has no bytes (the caller reads where the ring starts and ends).
func (r *replayRing) slices(from uint64, limit int) ([][]byte, uint64) {
	at := from
	var parts [][]byte
	first := sort.Search(len(r.chunks), func(i int) bool { return r.chunks[i].start+offset(len(r.chunks[i].data)) > from })
	for i := first; i < len(r.chunks) && limit > 0 && at >= r.chunks[i].start; i++ {
		chunk := r.chunks[i]
		lo := int(at - chunk.start) //nolint:gosec // A chunk is far below the size of an int.
		take := min(len(chunk.data)-lo, limit)
		parts = append(parts, chunk.data[lo:lo+take:lo+take])
		at += offset(take)
		limit -= take
	}
	return parts, at
}

// bytes is everything that is kept, as one slice.
func (r *replayRing) bytes() []byte {
	out := make([]byte, 0, r.kept)
	for _, chunk := range r.chunks {
		out = append(out, chunk.data...)
	}
	return out
}

// freeze is a copy of the ring that nothing writes: what a terminal that ended leaves for the page that comes
// back. It shares the bytes, which never change, and nothing else, so that a size the device applies late to the
// terminal cannot reach it.
func (r *replayRing) freeze() *replayRing {
	frozen := new(replayRing)
	frozen.limit = r.limit
	frozen.chunks = slices.Clone(r.chunks)
	frozen.kept = r.kept
	frozen.end = r.end
	frozen.overwritten = r.overwritten
	frozen.live = r.live.clone()
	frozen.front = r.front.clone()
	frozen.sizes = slices.Clone(r.sizes)
	if r.marks != nil {
		frozen.marks = r.marks.clone()
	}
	return frozen
}

// replayView is what a replay is made of, taken under the lock: no byte is copied yet.
type replayView struct {
	start, end uint64
	// parts are the chunks from the oldest kept, and skip is how many bytes of them come before start.
	parts [][]byte
	skip  uint64
	// front is a copy of the tracker at the start of the parts.
	front     modeTracker
	now       TerminalModes
	startSize Size
	size      Size
}

// view takes the replay from offset from, or from the start of what is kept when from is absent or older than
// that. An offset past the end of the output is no offset of this terminal: it is refused.
func (r *replayRing) view(from *uint64) (replayView, error) {
	first := r.start()
	start := first
	if from != nil {
		if *from > r.end {
			return replayView{}, invalidError(fmt.Sprintf("from_offset %d is past the end of the output, %d.", *from, r.end))
		}
		start = max(first, *from)
	}
	parts := make([][]byte, 0, len(r.chunks))
	for _, chunk := range r.chunks {
		// Capacity cut to length: nobody appends into the ring's chunk through the view.
		parts = append(parts, chunk.data[:len(chunk.data):len(chunk.data)])
	}
	return replayView{
		start: start, end: r.end, parts: parts, skip: start - first, front: r.front.clone(), now: r.live.modes(),
		startSize: r.size(start), size: r.size(r.end),
	}, nil
}

// startModes reads the modes the first byte of the replay was written under: the tracker at the start of the parts, brought
// forward over the bytes of the parts that come before the replay's start. It copies no byte.
func (v *replayView) startModes() TerminalModes {
	modes := v.front
	skip := v.skip
	for _, part := range v.parts {
		if skip == 0 {
			break
		}
		cut := min(skip, offset(len(part)))
		modes.feed(part[:cut])
		skip -= cut
	}
	return modes.modes()
}

// replay copies the bytes out, and reads the modes the first of them was written under.
func (v *replayView) replay() Replay {
	data := make([]byte, 0, v.end-v.start)
	modes := v.front
	skip := v.skip
	for _, part := range v.parts {
		if skip > 0 {
			cut := min(skip, offset(len(part)))
			modes.feed(part[:cut])
			part = part[cut:]
			skip -= cut
		}
		data = append(data, part...)
	}
	return Replay{
		Start: v.start, End: v.end, Data: data, StartSize: v.startSize, StartModes: modes.modes(), Size: v.size, Modes: v.now,
	}
}
