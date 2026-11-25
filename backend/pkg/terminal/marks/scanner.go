package marks

import (
	"bytes"
	"fmt"
	"sync/atomic"
	"time"
)

// Bytes of the stream that the tokenizer knows. They are the ones modes.go of package terminal knows by the same
// names.
const (
	escByte = 0x1b
	canByte = 0x18
	subByte = 0x1a
	belByte = 0x07
	delByte = 0x7f
	// c0Limit is the first byte that is not a C0 control.
	c0Limit = 0x20
	// highBit marks a byte that is not ASCII.
	highBit = 0x80
	// maxPayload is the most bytes of an OSC that are kept: the longest line (4 KiB, each byte escaped as four)
	// and its nonce, with room. A longer sequence of an OSC that is read is dropped and counted.
	maxPayload = 4*MaxCommandLine + 1024
	// maxPrefix is the length of the longest prefix that says an OSC is one that is read ("133;", "633;").
	maxPrefix = 4
)

type scanState uint8

const (
	stateGround scanState = iota
	// stateEscape is after ESC, stateEscapeIntermediate after ESC and an intermediate byte.
	stateEscape
	stateEscapeIntermediate
	// stateCSI is inside ESC [ and up to its final byte.
	stateCSI
	// stateOSC is inside an OSC, stateOSCEscape is an ESC inside it: the ST that ends it, or the start of a sequence
	// that ends it.
	stateOSC
	stateOSCEscape
	// stateString is inside a DCS, SOS, PM or APC, which end at ST only, stateStringEscape is an ESC inside one.
	stateString
	stateStringEscape
)

// Config makes a Scanner.
type Config struct {
	// Nonce is the secret of the session. The zero value trusts no mark.
	Nonce Nonce
	// Now is the producer's clock, read when a command starts and when it ends; nil is time.Now.
	Now func() time.Time
	// MaxRecords is how many commands the Log keeps; 0 is DefaultMaxRecords.
	MaxRecords int
	// StartOffset is the offset of the first byte fed: a scanner that is made when the session has output already.
	StartOffset uint64
}

// Scanner reads the output of one session, in the pieces it came in, and says which marks are in it. It never
// changes a byte and holds none of the bytes it was given. Feed is for one goroutine; the Log and the counters may be
// read from any.
type Scanner struct {
	state scanState
	// seqStart is the offset of the ESC that began the sequence being read, escAt the one of an ESC inside a
	// string, oscStart the one of the OSC being read.
	seqStart uint64
	escAt    uint64
	oscStart uint64
	// The OSC being read: its bytes up to maxPayload, whether it is one that is not read (skip) and whether it was
	// over the limit (over).
	buf  [maxPayload]byte
	n    int
	skip bool
	over bool

	nonce []byte
	now   func() time.Time
	log   *Log
	start uint64

	off       atomic.Uint64
	marks     atomic.Uint64
	forged    atomic.Uint64
	oversize  atomic.Uint64
	malformed atomic.Uint64
}

// New makes a Scanner.
func New(cfg Config) *Scanner {
	s := new(Scanner)
	s.nonce = []byte(cfg.Nonce.Reveal())
	s.now = cfg.Now
	if s.now == nil {
		s.now = time.Now
	}
	s.log = newLog(cfg.MaxRecords)
	s.start = cfg.StartOffset
	s.off.Store(cfg.StartOffset)
	return s
}

// Log is the record of the commands the marks described.
func (s *Scanner) Log() *Log { return s.log }

// Offset is the offset of the next byte to be fed: the start offset and every byte fed since.
func (s *Scanner) Offset() uint64 { return s.off.Load() }

// Stats says what the scanner saw.
func (s *Scanner) Stats() Stats {
	return Stats{
		Bytes: s.off.Load() - s.start, Marks: s.marks.Load(), Forged: s.forged.Load(),
		Oversize: s.oversize.Load(), Malformed: s.malformed.Load(),
	}
}

// Format prints the position of a scanner, whatever the verb: it holds the nonce and fmt would print it.
func (s *Scanner) Format(f fmt.State, _ rune) {
	_, _ = fmt.Fprintf(f, "marks.Scanner{offset=%d marks=%d}", s.off.Load(), s.marks.Load())
}

// Feed reads p, the next bytes of the output, and appends the marks in them to out, which it returns. A mark is
// returned by the Feed that reads the last byte of its sequence. p is neither changed nor kept. A read of n bytes
// gives at most n/4 marks, so a caller that reuses out (out[:0]) allocates nothing for them.
func (s *Scanner) Feed(p []byte, out []Mark) []Mark {
	base := s.off.Load()
	for i := 0; i < len(p); i++ {
		if s.state == stateGround {
			// Nothing but ESC leaves the ground state: skip to it.
			j := bytes.IndexByte(p[i:], escByte)
			if j < 0 {
				break
			}
			i += j
		}
		out = s.step(p[i], base+uint64(i), out)
	}
	s.off.Store(base + uint64(len(p)))
	return out
}

// step reads one byte, which is at offset at.
func (s *Scanner) step(b byte, at uint64, out []Mark) []Mark {
	switch b {
	case canByte, subByte:
		// CAN and SUB cancel a sequence, an OSC with it: nothing is read of it.
		s.state = stateGround
		return out
	case escByte:
		return s.escape(at, out)
	}
	switch s.state {
	case stateGround, stateString:
		// Only ESC leaves the ground state (Feed skips to it), and a string runs on to its terminator.
	case stateEscape:
		return s.afterEscape(b, out)
	case stateEscapeIntermediate:
		if b >= '0' && b <= '~' || b >= highBit {
			s.state = stateGround
		}
	case stateCSI:
		if b >= '@' && b <= '~' {
			s.state = stateGround
		}
	case stateOSC:
		return s.inOSC(b, at, out)
	case stateOSCEscape:
		return s.afterOSCEscape(b, at, out)
	case stateStringEscape:
		if b == '\\' {
			s.state = stateGround
			return out
		}
		// The ESC did not start an ST: it ended the string and began a sequence of its own.
		s.seqStart = s.escAt
		return s.afterEscape(b, out)
	}
	return out
}

// escape reads an ESC at offset at.
func (s *Scanner) escape(at uint64, out []Mark) []Mark {
	switch s.state {
	case stateOSC:
		s.state, s.escAt = stateOSCEscape, at
		return out
	case stateString:
		s.state, s.escAt = stateStringEscape, at
		return out
	case stateOSCEscape:
		// ESC ESC inside an OSC: the first ended it, and the second begins a sequence.
		out = s.finishOSC(s.escAt, out)
	case stateGround, stateEscape, stateEscapeIntermediate, stateCSI, stateStringEscape:
		// ESC begins a sequence wherever it comes (a sequence it interrupts is cancelled).
	}
	s.state, s.seqStart = stateEscape, at
	return out
}

// afterEscape reads the byte after ESC.
func (s *Scanner) afterEscape(b byte, out []Mark) []Mark {
	switch {
	case b == '[':
		s.state = stateCSI
	case b == ']':
		s.state, s.oscStart = stateOSC, s.seqStart
		s.n, s.skip, s.over = 0, false, false
	case b == 'P' || b == 'X' || b == '^' || b == '_':
		s.state = stateString
	case b >= ' ' && b <= '/':
		s.state = stateEscapeIntermediate
	case b >= '0' && b <= '~' || b >= highBit:
		s.state = stateGround
	default:
		// Any other control character is carried out inside the sequence, which goes on.
		s.state = stateEscape
	}
	return out
}

// inOSC reads a byte of an OSC: BEL ends it, a control byte is ignored, anything else is its text.
func (s *Scanner) inOSC(b byte, at uint64, out []Mark) []Mark {
	switch {
	case b == belByte:
		return s.finishOSC(at+1, out)
	case b < c0Limit || b == delByte:
		// The emulator ignores them, and so does a path that has them.
	default:
		s.collect(b)
	}
	return out
}

// afterOSCEscape reads the byte after an ESC inside an OSC: ST ends the OSC, anything else ends it too and begins
// the sequence the ESC started.
func (s *Scanner) afterOSCEscape(b byte, at uint64, out []Mark) []Mark {
	if b == '\\' {
		return s.finishOSC(at+1, out)
	}
	out = s.finishOSC(s.escAt, out)
	s.seqStart = s.escAt
	return s.afterEscape(b, out)
}

// collect keeps a byte of an OSC that is read, and drops it for one that is not or is too long.
func (s *Scanner) collect(b byte) {
	if s.skip || s.over {
		return
	}
	if s.n == len(s.buf) {
		s.over = true
		s.oversize.Add(1)
		return
	}
	s.buf[s.n] = b
	s.n++
	if s.n <= maxPrefix && !readPrefix(s.buf[:s.n]) {
		s.skip = true
	}
}

// readPrefix says whether b can still become the start of an OSC that is read: 7;, 133; or 633;.
func readPrefix(b []byte) bool {
	return couldStart(b, "7;") || couldStart(b, "133;") || couldStart(b, "633;")
}

// couldStart says whether b is a prefix of word, or word is a prefix of b.
func couldStart(b []byte, word string) bool {
	for i := range min(len(b), len(word)) {
		if b[i] != word[i] {
			return false
		}
	}
	return true
}

// finishOSC ends the OSC being read, whose sequence ends before offset end, and reads it.
func (s *Scanner) finishOSC(end uint64, out []Mark) []Mark {
	s.state = stateGround
	if s.skip || s.over {
		return out
	}
	body := s.buf[:s.n]
	switch {
	case hasPrefix(body, "7;"):
		return s.readCwdURL(body[len("7;"):], out)
	case hasPrefix(body, "133;"):
		return s.readPrompt(body[len("133;"):], end, out)
	case hasPrefix(body, "633;"):
		return s.readVSCode(body[len("633;"):], end, out)
	}
	return out
}

func hasPrefix(b []byte, prefix string) bool {
	return len(b) >= len(prefix) && string(b[:len(prefix)]) == prefix
}

// emit adds a mark to out.
func (s *Scanner) emit(out []Mark, m Mark) []Mark {
	s.marks.Add(1)
	return append(out, m)
}
