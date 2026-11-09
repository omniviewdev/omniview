package resourceauthoring

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// span is the byte span of needle's first occurrence in source.
func span(t *testing.T, source, needle string) (int, int) {
	t.Helper()
	index := strings.Index(source, needle)
	require.GreaterOrEqual(t, index, 0, "%q not in %q", needle, source)
	return index, index + len(needle)
}

// Incomplete quotes, operators and brackets are the normal state of a draft. The
// default edit replaces the token being typed, never more of the line than the
// word, and the result is valid text.
func TestReplacementRangesForIncompleteDrafts(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)
	cases := []struct {
		name    string
		marked  string
		replace string // the text the default range covers
		item    string // label of the item whose edit is applied
		want    string // the source after applying it
	}{
		{"unterminated double quote", `resource.state == "ru` + cursorMark, `"ru`, "running", `resource.state == "running"`},
		{"unterminated single quote", `resource.state == 'ru` + cursorMark, `'ru`, "running", `resource.state == "running"`},
		{"terminated quote cursor inside", `resource.state == "ru` + cursorMark + `nning"`, `"running"`, "running", `resource.state == "running"`},
		{"unterminated quote keeps the rest of the expression", `resource.state == "ru` + cursorMark + ` && resource.flag`, `"ru`, "running", `resource.state == "running" && resource.flag`},
		{"unterminated quote inside a list", `resource.state in ["pending", "ru` + cursorMark + `]`, `"ru`, "running", `resource.state in ["pending", "running"]`},
		{"empty quotes", `resource.state == "` + cursorMark + `"`, `""`, "pending", `resource.state == "pending"`},
		{"bare word as a value", `resource.state == ru` + cursorMark, `ru`, "running", `resource.state == "running"`},
		{"partial member", `resource.sta` + cursorMark, `sta`, "state", `resource.state`},
		{"cursor inside a member", `resource.st` + cursorMark + `ate == "running"`, `state`, "state", `resource.state == "running"`},
		{"cursor at the start of a member", `resource.` + cursorMark + `state == "running"`, `state`, "id", `resource.id == "running"`},
		{"partial operator", `resource.state =` + cursorMark, `=`, "==", `resource.state == ""`},
		{"index key on a typed object is rewritten", `resource.network["su` + cursorMark, `"su`, "subnets", `resource.network.subnets`},
		{"index key with closing bracket takes the bracket", `resource.network["su` + cursorMark + `"]`, `"su"`, "subnets", `resource.network.subnets`},
		{"index key on a dyn object keeps the index form", `resource.network.ipv6["ci` + cursorMark + `"]`, `"ci"`, "cidr", `resource.network.ipv6["cidr"]`},
		{"a name CEL cannot select goes through dyn", `resource.na` + cursorMark, `na`, "name-with-dash", `dyn(resource)["name-with-dash"]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source, _ := split(t, tc.marked)
			response := f.completeAt(tc.marked)
			start, end := span(t, source, tc.replace)
			if !strings.Contains(tc.name, "dot already") {
				assert.Equal(t, Range{Start: start, End: end, Unit: UnitUTF8Byte}, response.Context.Replace)
			}
			item, ok := byLabel(response.Items)[tc.item]
			require.True(t, ok, "%q not among %v", tc.item, labels(response.Items))
			assert.Equal(t, tc.want, mustApply(t, source, item.Edit))
			if strings.HasPrefix(tc.item, "==") || tc.item == "==" {
				assert.NotNil(t, item.Edit.Selection)
			}
		})
	}
}

func TestArrayAndMapAccessRanges(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)

	// An array element is addressed by an integer, never by a name.
	element := f.completeAt(`resource.volumes[0].si` + cursorMark)
	assert.Equal(t, []string{"sizeGiB"}, labels(element.Items))
	assert.Equal(t, Range{Start: 20, End: 22, Unit: UnitUTF8Byte}, element.Context.Replace)
	index := f.completeAt(`resource.volumes[0` + cursorMark)
	assert.Equal(t, ContextNone, index.Context.Kind, "an integer index is not completed")
	closed := f.completeAt(`resource.volumes[0]` + cursorMark)
	assert.Equal(t, ContextOperator, closed.Context.Kind)

	// A computed index addresses an element by the schema's type: the array's item.
	computed := f.completeAt(`resource.volumes[1 + 1].de` + cursorMark)
	assert.Equal(t, []string{"device"}, labels(computed.Items))
	byName := f.completeAt(`resource.volumes[resource.level].de` + cursorMark)
	assert.Equal(t, []string{"device"}, labels(byName.Items))

	// A map takes any key: the schema names none, so the position reports dynamic keys.
	key := f.completeAt(`resource.tags["en` + cursorMark)
	assert.Equal(t, ContextIndex, key.Context.Kind)
	assert.Equal(t, "dynamic", key.Context.Keys)
	assert.Equal(t, Range{Start: 14, End: 17, Unit: UnitUTF8Byte}, key.Context.Replace)
	assert.Empty(t, key.Items)
	value := f.completeAt(`resource.tags["en"].st` + cursorMark)
	assert.Equal(t, []string{"startsWith"}, labels(value.Items))
	assert.Equal(t, Range{Start: 20, End: 22, Unit: UnitUTF8Byte}, value.Context.Replace)

	// Nested index and member steps resolve through each tier.
	deep := f.completeAt(`resource.network.ipv6["cidr"].s` + cursorMark)
	assert.Equal(t, []string{"size", "startsWith"}, sorted(labels(deep.Items)))

	// Inside an index bracket a comparison operator is never offered.
	inside := f.completeAt(`resource.tags["env" ` + cursorMark + `]`)
	assert.Equal(t, ContextNone, inside.Context.Kind)
	afterBracket := f.completeAt(`resource.tags["env"]` + cursorMark)
	assert.Equal(t, ContextOperator, afterBracket.Context.Kind)
}

func TestMidExpressionEditsKeepTheRestOfTheText(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)
	cases := []struct {
		marked string
		label  string
		want   string
	}{
		{`resource.id == "a" && resource.fl` + cursorMark + ` || resource.id == "b"`, "flag", `resource.id == "a" && resource.flag || resource.id == "b"`},
		{`(resource.fl` + cursorMark + `ag && resource.id == "b")`, "flag", `(resource.flag && resource.id == "b")`},
		{`resource.fl` + cursorMark + `ag == true`, "flag", `resource.flag == true`},
		{`resource.tags.exists(t, t.k` + cursorMark + ` == "a") && resource.id == "b"`, "", ``},
		{`!resource.fl` + cursorMark, "flag", `!resource.flag`},
		{`has(resource.fl` + cursorMark + `)`, "flag", `has(resource.flag)`},
		{`resource.id.size() > 1 && resource.fl` + cursorMark, "flag", `resource.id.size() > 1 && resource.flag`},
	}
	for _, tc := range cases {
		t.Run(tc.marked, func(t *testing.T) {
			response := f.completeAt(tc.marked)
			if tc.label == "" {
				assert.Empty(t, response.Items, "a plain string tag has no named members")
				return
			}
			source, _ := split(t, tc.marked)
			item, ok := byLabel(response.Items)[tc.label]
			require.True(t, ok, labels(response.Items))
			assert.Equal(t, tc.want, mustApply(t, source, item.Edit))
		})
	}
	// Nothing outside the replaced token changes for any suggestion.
	source, cursor := split(t, `resource.id == "a" && resource.`+cursorMark+` || resource.id == "b"`)
	response, err := Complete(t.Context(), f.input(source, cursor))
	require.NoError(t, err)
	require.NotEmpty(t, response.Items)
	for _, item := range response.Items {
		applied := mustApply(t, source, item.Edit)
		assert.True(t, strings.HasPrefix(applied, `resource.id == "a" && resource.`[:item.Edit.Start]), item.Label)
		assert.True(t, strings.HasSuffix(applied, ` || resource.id == "b"`), item.Label)
	}
}

// Wire offsets are UTF-8 bytes. These cases put multi-byte and supplementary
// characters before, inside and after the cursor, and convert each wire range
// to the UTF-16 offsets an editor would use.
func TestUnicodeCursorsAndRanges(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)

	t.Run("emoji and CJK before the cursor", func(t *testing.T) {
		marked := `resource.tags["😀雪"].sta` + cursorMark
		source, cursor := split(t, marked)
		response := f.completeAt(marked)
		require.Equal(t, []string{"startsWith"}, labels(response.Items))
		start, end := span(t, source, "sta")
		assert.Equal(t, Range{Start: start, End: end, Unit: UnitUTF8Byte}, response.Context.Replace)
		assert.Equal(t, cursor, end)
		// 😀 is four bytes and two UTF-16 units, 雪 three bytes and one unit.
		assert.Equal(t, utf8.RuneCountInString(source[:start])+1, mustUTF16(t, source, start), "one extra unit for the supplementary character")
		assert.NotEqual(t, start, mustUTF16(t, source, start), "byte offsets are not editor offsets")
		units, unitsEnd, err := SpanToUTF16(source, start, end)
		require.NoError(t, err)
		assert.Equal(t, 3, unitsEnd-units)
		backStart, backEnd, err := UTF16SpanToByte(source, units, unitsEnd)
		require.NoError(t, err)
		assert.Equal(t, [2]int{start, end}, [2]int{backStart, backEnd})
		assert.Equal(t, `resource.tags["😀雪"].startsWith("")`, mustApply(t, source, response.Items[0].Edit))
	})

	t.Run("an editor offset reinterpreted as bytes lands elsewhere", func(t *testing.T) {
		source := `resource.tags["😀雪"].sta`
		utf16Cursor := len(utf16Encode(source))
		require.Less(t, utf16Cursor, len(source), "the editor's count is shorter than the byte length")
		// Sent as bytes, that offset is inside the source but not at its end.
		wrong, err := Complete(t.Context(), f.input(source, utf16Cursor))
		if err == nil {
			assert.NotEqual(t, []string{"startsWith"}, labels(wrong.Items), "the shortened offset must not look like the end of the draft")
		}
		// Converted first, it addresses the same position.
		cursor, err := UTF16ToByte(source, utf16Cursor)
		require.NoError(t, err)
		assert.Equal(t, len(source), cursor)
		right, err := Complete(t.Context(), f.input(source, cursor))
		require.NoError(t, err)
		assert.Equal(t, []string{"startsWith"}, labels(right.Items))
	})

	t.Run("a cursor inside a scalar is rejected", func(t *testing.T) {
		source := `resource.tags["雪"].sta`
		start := strings.Index(source, "雪")
		for _, offset := range []int{start + 1, start + 2} {
			_, err := Complete(t.Context(), f.input(source, offset))
			require.Error(t, err, "byte offset %d splits the CJK scalar", offset)
		}
		emoji := `resource.tags["😀"]`
		start = strings.Index(emoji, "😀")
		for _, offset := range []int{start + 1, start + 2, start + 3} {
			_, err := Complete(t.Context(), f.input(emoji, offset))
			require.Error(t, err, "byte offset %d splits the supplementary scalar", offset)
		}
		_, err := Complete(t.Context(), f.input(source, len(source)+1))
		require.Error(t, err, "past the end is rejected, never clamped")
		_, err = Complete(t.Context(), f.input(source, -1))
		require.Error(t, err)
	})

	t.Run("a field named with CJK", func(t *testing.T) {
		marked := `resource.id == "x" && resource.雪` + cursorMark
		source, _ := split(t, marked)
		response := f.completeAt(marked)
		require.Equal(t, []string{"雪"}, labels(response.Items))
		start, end := span(t, source, ".雪")
		operand := strings.LastIndex(source, "resource")
		assert.Equal(t, Edit{Start: operand, End: end, Unit: UnitUTF8Byte, Text: `dyn(resource)["雪"]`}, response.Items[0].Edit, "the whole access is rewritten: CEL cannot select a CJK name")
		assert.Equal(t, `resource.id == "x" && dyn(resource)["雪"]`, mustApply(t, source, response.Items[0].Edit))
		first, last, err := SpanToUTF16(source, start, end)
		require.NoError(t, err)
		assert.Equal(t, 2, last-first, "the dot and one CJK unit")
	})

	t.Run("combining marks stay in the word and separate scalars", func(t *testing.T) {
		marked := "resource.tags[\"e\u0301\"].sta" + cursorMark
		source, _ := split(t, marked)
		response := f.completeAt(marked)
		assert.Equal(t, []string{"startsWith"}, labels(response.Items))
		start, _ := span(t, source, `"e`)
		keyEnd := strings.Index(source, `"]`)
		bytesInKey := keyEnd - start - 1
		assert.Equal(t, 3, bytesInKey, "e is one byte and the combining acute two")
		assert.Equal(t, 2, utf8.RuneCountInString(source[start+1:keyEnd]), "two scalars")
		units, err := ByteToUTF16(source, keyEnd)
		require.NoError(t, err)
		scalars, err := ByteToScalar(source, keyEnd)
		require.NoError(t, err)
		assert.Equal(t, scalars, units, "both scalars are in the BMP")
	})

	t.Run("a supplementary character inside a typed value", func(t *testing.T) {
		marked := `resource.state == "😀` + cursorMark
		response := f.completeAt(marked)
		assert.Empty(t, response.Items, "no enum member starts with an emoji")
		assert.Equal(t, ContextValue, response.Context.Kind)
		assert.Equal(t, "😀", response.Context.Prefix)
		escaped := f.completeAt(`resource.state == "\U0001F600` + cursorMark)
		assert.Equal(t, "😀", escaped.Context.Prefix, "an escaped scalar decodes to the same prefix")
	})
}

func mustUTF16(t *testing.T, source string, offset int) int {
	t.Helper()
	units, err := ByteToUTF16(source, offset)
	require.NoError(t, err)
	return units
}

// utf16Encode returns the UTF-16 code units of s.
func utf16Encode(s string) []uint16 {
	var units []uint16
	for _, r := range s {
		if r >= 0x10000 {
			r -= 0x10000
			units = append(units, uint16(0xD800+(r>>10)), uint16(0xDC00+(r&0x3FF)))
			continue
		}
		units = append(units, uint16(r))
	}
	return units
}

func TestLexerRecoversEveryOffset(t *testing.T) {
	for _, source := range []string{
		``, `resource`, `resource.`, `resource.a.b.c`, `resource["a`, `resource['a`, `"""triple`, `"""t""" == 'x'`,
		`r"raw\" == b"bytes"`, `a // comment`, "a // c\nb", `((((`, `))))`, `[{`, `1.5e+3 == 0x1F`, `1u`, `x ? y : z`,
		`resource.雪😀.e` + "\u0301", "\t\r\n ", `@ # $ ~ ^ \`, `resource.a == "unterminated` + "\nresource.b",
	} {
		tokens := lex(source)
		position := 0
		for _, token := range tokens {
			require.GreaterOrEqual(t, token.start, position, "tokens do not overlap: %q", source)
			require.LessOrEqual(t, token.start, token.end)
			require.LessOrEqual(t, token.end, len(source))
			require.NoError(t, ValidateOffset(source, token.start), source)
			require.NoError(t, ValidateOffset(source, token.end), source)
			require.Equal(t, source[token.start:token.end], token.text)
			position = token.end
		}
	}
}

func TestLexerStrings(t *testing.T) {
	tokens := lex(`'a' "b\"c" """x"y""" r"\d" b'z' "open`)
	require.Len(t, tokens, 6)
	assert.True(t, tokens[0].terminated)
	assert.Equal(t, `"b\"c"`, tokens[1].text)
	assert.Equal(t, `"""x"y"""`, tokens[2].text)
	assert.True(t, tokens[2].triple)
	assert.True(t, tokens[3].raw)
	assert.Equal(t, "b'z'", tokens[4].text)
	assert.False(t, tokens[5].terminated)
	assert.Equal(t, tokens[5].end, tokens[5].contentEnd)

	assert.Equal(t, `a"b`, decodeString(`a\"b`, false))
	assert.Equal(t, "é", decodeString(`\u00e9`, false))
	assert.Equal(t, "😀", decodeString(`\U0001F600`, false))
	assert.Equal(t, "\n\t", decodeString(`\n\t`, false))
	assert.Equal(t, `\d`, decodeString(`\d`, true), "raw strings have no escapes")
	assert.Equal(t, "a", decodeString(`a\u12`, false), "a truncated escape ends decoding")
	assert.Equal(t, "A", decodeString(`\101`, false), "octal")
}

func TestQuotingAndIdentifiers(t *testing.T) {
	assert.Equal(t, `"a\"b\\c"`, celQuote(`a"b\c`))
	assert.Equal(t, `"line\nbreak\ttab"`, celQuote("line\nbreak\ttab"))
	assert.Equal(t, `"\u0001"`, celQuote("\x01"))
	assert.Equal(t, `"雪😀"`, celQuote("雪😀"))
	for _, name := range []string{"id", "_x", "a1", "camelCase", "namespace", "if", "var", "int", "size"} {
		assert.True(t, celIdentifier(name), name)
	}
	for _, name := range []string{"", "1a", "a-b", "a.b", "a b", "雪", "in", "true", "false", "null"} {
		assert.False(t, celIdentifier(name), name)
	}
}
