package terminal

import (
	"slices"
	"sort"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/marks"
)

const (
	// maxMarksKept is how many marks a ring keeps at least (the newest); the list is cut back to it when it grows to twice that, so that a mark costs
	// no copy of the list. Whatever a program prints, a terminal holds at most twice this many.
	maxMarksKept = 1024
	// maxMarksPerFrame is the most marks one frame carries: marks that were due together, which only a page that was behind has.
	maxMarksPerFrame = 64
)

// markStore is the marks one terminal's output holds, oldest first, and the scanner that reads them. It is the replay ring's, and is ordered by the
// session's output lock: the ring's write feeds it, and a stream reads it under the same lock.
type markStore struct {
	// scanner is nil in a frozen store (a terminal that ended reads no more output).
	scanner *marks.Scanner
	items   []marks.Mark
	scratch []marks.Mark
}

func newMarkStore(nonce marks.Nonce) *markStore {
	return &markStore{
		scanner: marks.New(marks.Config{Nonce: nonce, Now: nil, MaxRecords: 0, StartOffset: 0}),
		items:   nil, scratch: nil,
	}
}

// feed reads the next bytes of the output: the marks in them join the list, and the ones that no nonce vouches for and that a page would believe
// as a fact (a directory) are dropped.
func (st *markStore) feed(p []byte) {
	st.scratch = st.scanner.Feed(p, st.scratch[:0])
	for _, m := range st.scratch {
		if m.Kind == marks.KindCwd && m.Trust != marks.TrustNonce {
			continue
		}
		st.items = append(st.items, m)
	}
	if len(st.items) >= 2*maxMarksKept {
		st.items = slices.Delete(st.items, 0, len(st.items)-maxMarksKept)
	}
	clear(st.scratch)
}

// log is the record of the commands: the scanner's.
func (st *markStore) log() *marks.Log { return st.scanner.Log() }

// plan says what a stream that stands at pos and wants the marks that end at or after minEnd is owed next: the marks that are due (they end at or
// before pos, at most maxMarksPerFrame), or, when none is, how long the next frame of output may be so that it ends where the next mark's sequence
// ends. The list is read in the caller's lock.
func (st *markStore) plan(minEnd, pos uint64, limit int) ([]marks.Mark, int) {
	i := sort.Search(len(st.items), func(i int) bool { return st.items[i].EndOffset >= minEnd })
	if i == len(st.items) {
		return nil, limit
	}
	if st.items[i].EndOffset > pos {
		return nil, int(min(uint64(limit), st.items[i].EndOffset-pos)) //nolint:gosec // The result is at most limit.
	}
	j := i
	for j < len(st.items) && j-i < maxMarksPerFrame && st.items[j].EndOffset <= pos {
		j++
	}
	return slices.Clone(st.items[i:j]), limit
}

// clone is a copy that nothing feeds: the marks of a terminal that ended.
func (st *markStore) clone() *markStore {
	return &markStore{scanner: nil, items: slices.Clone(st.items), scratch: nil}
}
