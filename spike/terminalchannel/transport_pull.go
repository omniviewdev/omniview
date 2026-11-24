package main

import (
	"errors"
	"sync"
	"time"
)

// pullBuf is the pull transport's buffer of one terminal: the bytes the shell wrote that the page has not yet asked
// for past, with their offsets. A read from offset N says the page has everything below N (it is the acknowledgement),
// frees it, and returns what follows. The host stops reading the pty while window bytes wait: the buffer's bound is the
// credit, and there is no other.
type pullBuf struct {
	mu     sync.Mutex
	cond   *sync.Cond
	window int
	base   uint64 // offset of the first byte held
	end    uint64 // offset after the last byte written
	chunks [][]byte
	cursor uint64
	done   bool
}

func newPullBuf(window int) *pullBuf {
	b := &pullBuf{window: window}
	b.cond = sync.NewCond(&b.mu)
	return b
}

func (b *pullBuf) put(data []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for b.end-b.cursor >= uint64(b.window) && !b.done {
		b.cond.Wait()
	}
	b.chunks = append(b.chunks, data)
	b.end += uint64(len(data))
	b.cond.Broadcast()
}

func (b *pullBuf) finish() {
	b.mu.Lock()
	b.done = true
	b.cond.Broadcast()
	b.mu.Unlock()
}

type ReadResult struct {
	From uint64 `json:"from"`
	To   uint64 `json:"to"`
	Data []byte `json:"data"`
	EOF  bool   `json:"eof"`
}

var errGap = errors.New("gap")

func (b *pullBuf) read(from uint64, max int, wait time.Duration) (ReadResult, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if from > b.end || from < b.base {
		return ReadResult{}, errGap
	}
	if from > b.cursor {
		b.cursor = from
		// free whole chunks below the cursor
		for len(b.chunks) > 0 && b.base+uint64(len(b.chunks[0])) <= from {
			b.base += uint64(len(b.chunks[0]))
			b.chunks[0] = nil
			b.chunks = b.chunks[1:]
		}
		b.cond.Broadcast()
	}
	deadline := time.Now().Add(wait)
	for b.end <= from && !b.done {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		timer := time.AfterFunc(remaining, func() {
			b.mu.Lock()
			b.cond.Broadcast()
			b.mu.Unlock()
		})
		b.cond.Wait()
		timer.Stop()
	}
	out := make([]byte, 0, min(max, int(b.end-from)))
	pos := b.base
	for _, chunk := range b.chunks {
		next := pos + uint64(len(chunk))
		if next > from && len(out) < max {
			start := 0
			if from > pos {
				start = int(from - pos)
			}
			take := chunk[start:]
			if len(out)+len(take) > max {
				take = take[:max-len(out)]
			}
			out = append(out, take...)
		}
		pos = next
	}
	to := from + uint64(len(out))
	return ReadResult{From: from, To: to, Data: out, EOF: b.done && to == b.end}, nil
}

// Read is the bound call: the capability, the offset the page has everything below, the most to return and how long to
// wait for something to return.
func (s *Probe) Read(cap string, from uint64, max int, waitMs int) (ReadResult, error) {
	t := s.p.lookup(cap)
	if t == nil || t.pull == nil {
		return ReadResult{}, errNotFound
	}
	if max <= 0 || max > 4<<20 {
		max = 1 << 20
	}
	return t.pull.read(from, max, time.Duration(waitMs)*time.Millisecond)
}
