package resourceauthoring

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// The lexer is a display aid. It delimits tokens and operand chains in text
// that may not parse; it never decides what is valid at the cursor. Meaning
// comes from the CEL parser (operands) and the schema (suggestions).
//
// It is total: every byte offset of valid UTF-8 input falls inside or between
// tokens, an unterminated string is a token, and nothing panics.

type tokenKind uint8

const (
	tokIdent tokenKind = iota + 1
	tokNumber
	tokString
	tokPunct
	tokComment
	tokUnknown
)

type token struct {
	kind  tokenKind
	start int // byte offset
	end   int
	text  string

	// String tokens only.
	quote        byte
	triple       bool
	raw          bool
	terminated   bool
	contentStart int // after the opening quote(s)
	contentEnd   int // before the closing quote(s), or end when unterminated
}

func (t token) isPunct(text string) bool { return t.kind == tokPunct && t.text == text }

func (t token) isKeyword(text string) bool { return t.kind == tokIdent && t.text == text }

var twoCharPunct = map[string]bool{"&&": true, "||": true, "==": true, "!=": true, "<=": true, ">=": true}

const singleCharPunct = "&|=!<>+-*/%?:,.()[]{}@"

func isSpaceByte(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\f' || b == '\v'
}

func isIdentStartRune(r rune) bool { return r == '_' || unicode.IsLetter(r) }

// A combining mark belongs to the word it follows: it is a separate scalar for
// offsets but never a separate token.
func isIdentPartRune(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r)
}

func isStringPrefix(prefix string) bool {
	switch strings.ToLower(prefix) {
	case "r", "b", "rb", "br":
		return true
	}
	return false
}

func lex(source string) []token {
	var out []token
	n := len(source)
	i := 0
	for i < n {
		c := source[i]
		switch {
		case isSpaceByte(c):
			i++
		case c == '/' && i+1 < n && source[i+1] == '/':
			j := i + 2
			for j < n && source[j] != '\n' && source[j] != '\r' {
				j++
			}
			out = append(out, token{kind: tokComment, start: i, end: j, text: source[i:j]})
			i = j
		case c == '"' || c == '\'':
			tok := lexString(source, i, i)
			out = append(out, tok)
			i = tok.end
		case c >= '0' && c <= '9':
			j := lexNumber(source, i)
			out = append(out, token{kind: tokNumber, start: i, end: j, text: source[i:j]})
			i = j
		default:
			r, width := utf8.DecodeRuneInString(source[i:])
			if isIdentStartRune(r) {
				j := i + width
				for j < n {
					next, nextWidth := utf8.DecodeRuneInString(source[j:])
					if !isIdentPartRune(next) {
						break
					}
					j += nextWidth
				}
				if j < n && (source[j] == '"' || source[j] == '\'') && isStringPrefix(source[i:j]) {
					tok := lexString(source, i, j)
					out = append(out, tok)
					i = tok.end
					continue
				}
				out = append(out, token{kind: tokIdent, start: i, end: j, text: source[i:j]})
				i = j
				continue
			}
			if i+1 < n && twoCharPunct[source[i:i+2]] {
				out = append(out, token{kind: tokPunct, start: i, end: i + 2, text: source[i : i+2]})
				i += 2
				continue
			}
			if width == 1 && strings.IndexByte(singleCharPunct, c) >= 0 {
				out = append(out, token{kind: tokPunct, start: i, end: i + 1, text: source[i : i+1]})
				i++
				continue
			}
			out = append(out, token{kind: tokUnknown, start: i, end: i + width, text: source[i : i+width]})
			i += width
		}
	}
	return out
}

func lexNumber(source string, start int) int {
	n := len(source)
	i := start
	if source[i] == '0' && i+1 < n && (source[i+1] == 'x' || source[i+1] == 'X') {
		i += 2
		for i < n && isHexByte(source[i]) {
			i++
		}
	} else {
		for i < n && source[i] >= '0' && source[i] <= '9' {
			i++
		}
		if i+1 < n && source[i] == '.' && source[i+1] >= '0' && source[i+1] <= '9' {
			i++
			for i < n && source[i] >= '0' && source[i] <= '9' {
				i++
			}
		}
		if i < n && (source[i] == 'e' || source[i] == 'E') {
			j := i + 1
			if j < n && (source[j] == '+' || source[j] == '-') {
				j++
			}
			if j < n && source[j] >= '0' && source[j] <= '9' {
				for j < n && source[j] >= '0' && source[j] <= '9' {
					j++
				}
				i = j
			}
		}
	}
	if i < n && (source[i] == 'u' || source[i] == 'U') {
		i++
	}
	return i
}

func isHexByte(b byte) bool {
	return b >= '0' && b <= '9' || b >= 'a' && b <= 'f' || b >= 'A' && b <= 'F'
}

// lexString lexes the string literal whose prefix starts at start and whose
// opening quote is at quotePos. An unterminated string extends to the end of
// the line (the end of input for triple-quoted strings).
func lexString(source string, start, quotePos int) token {
	n := len(source)
	quote := source[quotePos]
	raw := false
	for _, b := range []byte(source[start:quotePos]) {
		if b == 'r' || b == 'R' {
			raw = true
		}
	}
	triple := quotePos+2 < n && source[quotePos+1] == quote && source[quotePos+2] == quote
	tok := token{kind: tokString, start: start, quote: quote, triple: triple, raw: raw}
	i := quotePos + 1
	if triple {
		i = quotePos + 3
	}
	tok.contentStart = i
	for i < n {
		ch := source[i]
		if triple {
			if !raw && ch == '\\' && i+1 < n {
				i += 2
				continue
			}
			if ch == quote && i+2 < n && source[i+1] == quote && source[i+2] == quote {
				tok.contentEnd, tok.end, tok.terminated = i, i+3, true
				tok.text = source[start:tok.end]
				return tok
			}
			i++
			continue
		}
		if ch == '\n' || ch == '\r' {
			break
		}
		if !raw && ch == '\\' && i+1 < n && source[i+1] != '\n' && source[i+1] != '\r' {
			i += 2
			continue
		}
		if ch == quote {
			tok.contentEnd, tok.end, tok.terminated = i, i+1, true
			tok.text = source[start:tok.end]
			return tok
		}
		i++
	}
	if i > n {
		i = n
	}
	tok.contentEnd, tok.end = i, i
	tok.text = source[start:tok.end]
	return tok
}

// decodeString decodes the CEL escapes of a string's text. A dangling or
// malformed escape ends decoding, so a cursor placed inside an escape yields
// the text before it. Raw strings have no escapes.
func decodeString(content string, raw bool) string {
	if raw || !strings.Contains(content, `\`) {
		return content
	}
	var out strings.Builder
	for i := 0; i < len(content); {
		c := content[i]
		if c != '\\' {
			out.WriteByte(c)
			i++
			continue
		}
		if i+1 >= len(content) {
			break
		}
		switch e := content[i+1]; e {
		case 'a':
			out.WriteByte('\a')
		case 'b':
			out.WriteByte('\b')
		case 'f':
			out.WriteByte('\f')
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case 't':
			out.WriteByte('\t')
		case 'v':
			out.WriteByte('\v')
		case '\\', '\'', '"', '`', '?':
			out.WriteByte(e)
		case 'x', 'X', 'u', 'U':
			digits := map[byte]int{'x': 2, 'X': 2, 'u': 4, 'U': 8}[e]
			if i+2+digits > len(content) {
				return out.String()
			}
			value, err := strconv.ParseUint(content[i+2:i+2+digits], 16, 32)
			if err != nil {
				return out.String()
			}
			if e == 'x' || e == 'X' {
				out.WriteByte(byte(value))
			} else {
				out.WriteRune(rune(value))
			}
			i += 2 + digits
			continue
		case '0', '1', '2', '3':
			if i+4 > len(content) {
				return out.String()
			}
			value, err := strconv.ParseUint(content[i+1:i+4], 8, 8)
			if err != nil {
				return out.String()
			}
			out.WriteByte(byte(value))
			i += 4
			continue
		default:
			return out.String()
		}
		i += 2
	}
	return out.String()
}

// celQuote renders s as a double-quoted CEL string literal.
func celQuote(s string) string {
	var out strings.Builder
	out.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			out.WriteString(`\"`)
		case '\\':
			out.WriteString(`\\`)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		default:
			switch {
			case r < 0x20 || r == 0x7f:
				out.WriteString(`\u00`)
				out.WriteString(strings.ToUpper(strconv.FormatInt(int64(r)+0x100, 16)[1:]))
			case r == utf8.RuneError:
				out.WriteString(`\ufffd`)
			default:
				out.WriteRune(r)
			}
		}
	}
	out.WriteByte('"')
	return out.String()
}

// celIdentifier reports whether name can follow "." as a CEL field selector.
// Names outside the ASCII identifier grammar and the four keyword tokens (true,
// false, null, in) cannot. CEL's other reserved words parse as selectors, so
// resource.metadata.namespace is valid; the reserved-identifier rule applies
// only to a bare identifier.
func celIdentifier(name string) bool {
	if name == "" || celReserved[name] {
		return false
	}
	for i := range len(name) {
		c := name[i]
		letter := c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
		if !letter && (i == 0 || c < '0' || c > '9') {
			return false
		}
	}
	return true
}

var celReserved = map[string]bool{"true": true, "false": true, "null": true, "in": true}
