package linkresolve

import (
	"strings"
	"unicode/utf8"
)

const (
	// maxText is the longest text that is looked at, and maxPath the longest path in it: over either, nothing is resolved.
	maxText = 2048
	maxPath = 1024
	// maxDigits is the most digits a line or a column has: more is not a position.
	maxDigits = 7
)

// target is the text, taken apart: the path it names and the position it gives.
type target struct {
	path      string
	line, col int
}

// parse takes the text apart in one pass over each marker, with no regular expression and no backtracking: the time is linear in the
// length, and the length is capped before anything is done. The shapes are `path`, `path:line`, `path:line:col` (and what trails it, as
// in Ruby's `a.rb:20:in`), `path(line)`, `path(line,col)`, `path#Lline`, `path line N`, `"path", line N`, with a trailing `.`, `,` or `;`,
// and a wrapping quote or bracket, taken off.
func parse(text string) (target, Reason) {
	if len(text) > maxText {
		return target{}, ReasonTooLong
	}
	if !utf8.ValidString(text) {
		return target{}, ReasonInvalid
	}
	for _, r := range text {
		if r < 0x20 || r == 0x7f {
			return target{}, ReasonInvalid
		}
	}
	if strings.Contains(text, "://") {
		return target{}, ReasonURL
	}
	s := strings.TrimSpace(text)
	var tail string
	if s != "" && strings.IndexByte("\"'`", s[0]) >= 0 {
		quote := s[0]
		if end := strings.IndexByte(s[1:], quote); end >= 0 {
			s, tail = s[1:1+end], s[2+end:]
		} else {
			s = s[1:]
		}
	} else if s != "" && strings.IndexByte("([<", s[0]) >= 0 {
		s = s[1:]
		if strings.IndexByte(s, '(') < 0 {
			s = strings.TrimRight(s, ")]>")
		}
	}
	var out target
	if tail != "" {
		out.path = s
		out.line, out.col = position(tail)
	} else {
		out.path, out.line, out.col = split(s)
	}
	out.path = strings.TrimSpace(out.path)
	if out.path == "" {
		return target{}, ReasonInvalid
	}
	if len(out.path) > maxPath {
		return target{}, ReasonTooLong
	}
	return out, ""
}

// split cuts s at the first marker of a position and reads the position that follows it.
func split(s string) (path string, line, col int) {
	cut := len(s)
	for i := 0; i < len(s) && i < cut; i++ {
		var at bool
		switch s[i] {
		case ':':
			at = i+1 < len(s) && isDigit(s[i+1])
		case '(':
			at = i+1 < len(s) && isDigit(s[i+1]) && strings.HasSuffix(strings.TrimRight(s[i:], ".,;:"), ")")
		case '#':
			at = i+2 < len(s) && s[i+1] == 'L' && isDigit(s[i+2])
		case ' ', ',':
			at = lineWord(s[i:]) > 0
		}
		if at {
			if l, c := position(s[i:]); l > 0 {
				cut = i
				line, col = l, c
			}
			break
		}
	}
	return strings.TrimRight(s[:cut], ".,;:"), line, col
}

// lineWord is the length of a ", line " or " line " that opens s, case-insensitively, or 0.
func lineWord(s string) int {
	for _, word := range []string{", line ", " line "} {
		if len(s) > len(word) && strings.EqualFold(s[:len(word)], word) && isDigit(s[len(word)]) {
			return len(word)
		}
	}
	return 0
}

// position reads a line and a column from the front of s, which begins at a marker (`:`, `(`, `#L`, ` line `), as far as it goes.
func position(s string) (line, col int) {
	s = strings.TrimLeft(s, ", ")
	switch {
	case s == "":
		return 0, 0
	case s[0] == ':':
		line, rest := number(s[1:])
		if line == 0 {
			return 0, 0
		}
		if len(rest) > 1 && rest[0] == ':' {
			col, _ = number(rest[1:])
		}
		return line, col
	case s[0] == '(':
		line, rest := number(s[1:])
		if line == 0 {
			return 0, 0
		}
		if len(rest) > 1 && (rest[0] == ',' || rest[0] == ':') {
			col, _ = number(strings.TrimLeft(rest[1:], " "))
		}
		return line, col
	case strings.HasPrefix(s, "#L"):
		line, _ = number(s[2:])
		return line, 0
	default:
		if n := lineWord(" " + s); n > 0 {
			line, _ = number(s[n-1:])
			return line, 0
		}
	}
	return 0, 0
}

// number reads up to maxDigits digits from the front of s, and returns the rest. More digits than that is no number.
func number(s string) (int, string) {
	n, i := 0, 0
	for i < len(s) && isDigit(s[i]) {
		if i >= maxDigits {
			return 0, s
		}
		n = n*10 + int(s[i]-'0')
		i++
	}
	return n, s[i:]
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }
