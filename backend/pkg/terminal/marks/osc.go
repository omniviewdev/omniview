package marks

import (
	"bytes"
	"crypto/subtle"
	"math"
	"unicode/utf8"
)

// readPrompt reads the arguments of OSC 133 (and of the same letters of OSC 633): a letter, then options after ';'.
// The sequence is at s.oscStart and ends before offset end.
func (s *Scanner) readPrompt(args []byte, end uint64, out []Mark) []Mark {
	if len(args) == 0 {
		s.malformed.Add(1)
		return out
	}
	opts := args[1:]
	if len(opts) > 0 && opts[0] != ';' {
		// Not a one-letter command: nothing this package reads.
		return out
	}
	at := s.oscStart
	proven := s.ourPrompt
	s.ourPrompt = false
	switch args[0] {
	case 'A':
		if s.promptEnds && proven {
			s.log.interrupt(at, s.now())
		}
		id, redraw := s.log.prompt(at)
		m := newMark(KindPromptStart, at)
		m.CommandID, m.Redraw = id, redraw || hasOption(opts, "redraw=1")
		return s.emit(out, m)
	case 'B':
		m := newMark(KindInputStart, at)
		m.CommandID = s.log.input(at)
		return s.emit(out, m)
	case 'C':
		now := s.now()
		rec, started := s.log.start(at, end, now)
		m := newMark(KindCommandStart, at)
		m.Time = now
		m.CommandID = rec.CommandID
		if started {
			// Only the mark that started the command has its line: a second start is not the shell's.
			m.CommandLine, m.Trust = rec.CommandLine, rec.Trust
		}
		return s.emit(out, m)
	case 'D':
		code, has := exitCode(opts)
		now := s.now()
		id, duration := s.log.end(at, code, has, now)
		m := newMark(KindCommandEnd, at)
		m.Time = now
		m.CommandID, m.ExitCode, m.HasExitCode, m.DurationMS = id, code, has, duration
		return s.emit(out, m)
	}
	return out
}

// hasOption says whether opts (";a=1;b=2") holds the option want ("b=2").
func hasOption(opts []byte, want string) bool {
	for len(opts) > 0 {
		opts = opts[1:]
		field := opts
		if i := bytes.IndexByte(opts, ';'); i >= 0 {
			field, opts = opts[:i], opts[i:]
		} else {
			opts = nil
		}
		if string(field) == want {
			return true
		}
	}
	return false
}

// exitCode reads the first option of a command end as the exit status: digits, with a sign. pwsh sends none, and
// an option that is not a number ("aid=1") is no status.
func exitCode(opts []byte) (int32, bool) {
	if len(opts) == 0 {
		return 0, false
	}
	field := opts[1:]
	if i := bytes.IndexByte(field, ';'); i >= 0 {
		field = field[:i]
	}
	negative := len(field) > 0 && field[0] == '-'
	if negative {
		field = field[1:]
	}
	if len(field) == 0 {
		return 0, false
	}
	var n int64
	for _, c := range field {
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*decimalBase + int64(c-'0')
		if n > math.MaxInt32+1 {
			return 0, false
		}
	}
	if negative {
		n = -n
	}
	if n > math.MaxInt32 || n < math.MinInt32 {
		return 0, false
	}
	return int32(n), true
}

// readVSCode reads the arguments of OSC 633: the prompt letters, the command line (E) and the properties (P).
func (s *Scanner) readVSCode(args []byte, end uint64, out []Mark) []Mark {
	if len(args) == 0 {
		return out
	}
	rest := args[1:]
	if len(rest) > 0 && rest[0] != ';' {
		return out
	}
	switch args[0] {
	case 'A', 'B', 'C', 'D':
		return s.readPrompt(args, end, out)
	case 'E':
		s.readCommandLine(rest)
	case 'P':
		return s.readCwdProperty(rest, out)
	}
	return out
}

// verified says whether given is the nonce, in constant time. A scanner with no nonce verifies nothing: two empty
// strings are equal, and an empty nonce must not be a key.
func (s *Scanner) verified(given []byte) bool {
	return len(s.nonce) > 0 && subtle.ConstantTimeCompare(given, s.nonce) == 1
}

// readCommandLine reads 633;E;<escaped line>;<nonce>: the line goes to the command at its prompt when the nonce is
// the session's, and is dropped and counted when it is not or is missing. The nonce follows the last ';', so a line
// that has one is whole.
func (s *Scanner) readCommandLine(rest []byte) {
	if len(rest) == 0 {
		s.forged.Add(1)
		return
	}
	field := rest[1:]
	i := bytes.LastIndexByte(field, ';')
	if i < 0 || !s.verified(field[i+1:]) {
		s.forged.Add(1)
		return
	}
	s.log.setLine(string(clipLine(unescape(field[:i]))))
}

// clipLine cuts a command line at MaxCommandLine bytes, not inside a character.
func clipLine(line []byte) []byte {
	if len(line) <= MaxCommandLine {
		return line
	}
	cut := MaxCommandLine
	for cut > 0 && !utf8.RuneStart(line[cut]) {
		cut--
	}
	return line[:cut]
}

// readCwdProperty reads 633;P;Cwd=<escaped path>;<nonce>. Other properties are not read. A directory without the
// session's nonce is dropped and counted: OSC 7 is the mark that anything may print.
func (s *Scanner) readCwdProperty(rest []byte, out []Mark) []Mark {
	if len(rest) == 0 {
		return out
	}
	field := rest[1:]
	const key = "Cwd="
	if !hasPrefix(field, key) {
		return out
	}
	i := bytes.LastIndexByte(field, ';')
	if i < 0 || !s.verified(field[i+1:]) {
		s.forged.Add(1)
		return out
	}
	s.ourPrompt = true
	dir := unescape(field[len(key):i])
	if hasControl(dir) {
		return s.unknownCwd(out)
	}
	return s.emitCwd(dir, true, out)
}

// readCwdURL reads OSC 7: file://host/path with the path percent-encoded. The host is not checked (a mark that
// says another host's path is not what a new terminal here may use, and that is for the nonce to settle).
func (s *Scanner) readCwdURL(url []byte, out []Mark) []Mark {
	const scheme = "file://"
	if !hasPrefix(url, scheme) {
		s.malformed.Add(1)
		return out
	}
	rest := url[len(scheme):]
	i := bytes.IndexByte(rest, '/')
	if i < 0 {
		s.malformed.Add(1)
		return out
	}
	dir, clean := decodePercent(rest[i:])
	if !clean {
		return s.unknownCwd(out)
	}
	return s.emitCwd(dir, false, out)
}

// unknownCwd is a directory whose name holds a control byte (a directory can be named with an ESC): stripping the byte would
// name another directory, or none, and a terminal must not be made to read it. The mark is dropped and counted, and what the log
// knows of the directory becomes unknown, so that neither a wrong path nor the one from before the `cd` is believed. The next
// sound directory sets it again.
func (s *Scanner) unknownCwd(out []Mark) []Mark {
	s.malformed.Add(1)
	s.log.forgetCwd()
	return out
}

// emitCwd makes the mark of a directory read from the sequence being finished.
func (s *Scanner) emitCwd(dir []byte, trusted bool, out []Mark) []Mark {
	switch {
	case len(dir) == 0:
		s.malformed.Add(1)
		return out
	case len(dir) > MaxCwd:
		s.oversize.Add(1)
		return out
	}
	m := newMark(KindCwd, s.oscStart)
	m.Cwd = s.log.noteCwd(dir, trusted)
	if trusted {
		m.Trust = TrustNonce
	}
	return s.emit(out, m)
}

// unescape reverses VS Code's escaping of a value (\\ and \xHH) in place. Anything else after a backslash is left as
// it is.
func unescape(b []byte) []byte {
	w := 0
	for r := 0; r < len(b); r++ {
		if b[r] == '\\' && r+1 < len(b) {
			if b[r+1] == '\\' {
				b[w] = '\\'
				w++
				r++
				continue
			}
			if v, ok := hexByte(b, r+1); ok {
				b[w] = v
				w++
				r += hexEscapeLen - 1
				continue
			}
		}
		b[w] = b[r]
		w++
	}
	return b[:w]
}

// hexEscapeLen is the length of \xHH, nibbleBits the bits of a hex digit.
const (
	hexEscapeLen = 4
	nibbleBits   = 4
)

// hexByte reads xHH at b[i:] (the 'x' and two hex digits).
func hexByte(b []byte, i int) (byte, bool) {
	if i+2 >= len(b) || b[i] != 'x' {
		return 0, false
	}
	hi, okHi := hexDigit(b[i+1])
	lo, okLo := hexDigit(b[i+2])
	if !okHi || !okLo {
		return 0, false
	}
	return hi<<nibbleBits | lo, true
}

func hexDigit(c byte) (byte, bool) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', true
	case c >= 'a' && c <= 'f':
		return c - 'a' + decimalBase, true
	case c >= 'A' && c <= 'F':
		return c - 'A' + decimalBase, true
	}
	return 0, false
}

// decodePercent decodes %HH in place. clean is false when the path holds a control byte, the encoded ones too: no
// directory is believed that a terminal could be made to read as a sequence. A '%' that is no escape is kept.
func decodePercent(b []byte) (path []byte, clean bool) {
	w := 0
	clean = true
	for r := 0; r < len(b); r++ {
		c := b[r]
		if c == '%' && r+2 < len(b) {
			hi, okHi := hexDigit(b[r+1])
			lo, okLo := hexDigit(b[r+2])
			if okHi && okLo {
				c = hi<<nibbleBits | lo
				r += 2
			}
		}
		if c < c0Limit || c == delByte {
			clean = false
		}
		b[w] = c
		w++
	}
	return b[:w], clean
}

// hasControl says whether b holds a control byte.
func hasControl(b []byte) bool {
	for _, c := range b {
		if c < c0Limit || c == delByte {
			return true
		}
	}
	return false
}
