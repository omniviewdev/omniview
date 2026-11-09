package resourceauthoring

import (
	"unicode/utf8"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Three position units meet in authoring, and none of them is another's
// substitute:
//
//   - the wire unit, UTF-8 bytes (UnitUTF8Byte): what the host validates and
//     emits for the exact source of a document revision;
//   - Unicode scalars (code points): what the CEL parser reports;
//   - UTF-16 code units: what browser editors and LSP's default encoding count.
//
// An offset is valid only on a scalar boundary of the exact source: inside a
// multi-byte sequence there is no UTF-8 position, and between the two halves of
// a surrogate pair there is no UTF-16 position. Conversions reject such offsets
// and never clamp. Combining marks are separate scalars; nothing is normalized.
//
// The sources passed here MUST be valid UTF-8. Request admission guarantees
// it; the functions reject invalid text rather than guess.

func offsetError(message string) error {
	return resourcev2.NewError("INVALID_REQUEST", message)
}

func checkSource(source string) error {
	if !utf8.ValidString(source) {
		return offsetError("Source is not valid UTF-8.")
	}
	return nil
}

// ValidateOffset reports whether offset is a scalar boundary of source.
func ValidateOffset(source string, offset int) error {
	if offset < 0 || offset > len(source) {
		return offsetError("Offset is outside the source.")
	}
	if offset < len(source) && !utf8.RuneStart(source[offset]) {
		return offsetError("Offset splits a UTF-8 sequence.")
	}
	return nil
}

// ByteToScalar converts a UTF-8 byte offset to a Unicode scalar offset.
func ByteToScalar(source string, offset int) (int, error) {
	if err := checkSource(source); err != nil {
		return 0, err
	}
	if err := ValidateOffset(source, offset); err != nil {
		return 0, err
	}
	return utf8.RuneCountInString(source[:offset]), nil
}

// ScalarToByte converts a Unicode scalar offset, such as the CEL parser's, to a
// UTF-8 byte offset.
func ScalarToByte(source string, scalar int) (int, error) {
	if err := checkSource(source); err != nil {
		return 0, err
	}
	if scalar < 0 {
		return 0, offsetError("Offset is outside the source.")
	}
	count := 0
	for index := range source {
		if count == scalar {
			return index, nil
		}
		count++
	}
	if count == scalar {
		return len(source), nil
	}
	return 0, offsetError("Offset is outside the source.")
}

func utf16Width(r rune) int {
	if r >= 0x10000 {
		return 2
	}
	return 1
}

// ByteToUTF16 converts a UTF-8 byte offset to a UTF-16 code unit offset.
func ByteToUTF16(source string, offset int) (int, error) {
	if err := checkSource(source); err != nil {
		return 0, err
	}
	if err := ValidateOffset(source, offset); err != nil {
		return 0, err
	}
	units := 0
	for _, r := range source[:offset] {
		units += utf16Width(r)
	}
	return units, nil
}

// UTF16ToByte converts a UTF-16 code unit offset to a UTF-8 byte offset. An
// offset between the two halves of a surrogate pair has no byte position.
func UTF16ToByte(source string, units int) (int, error) {
	if err := checkSource(source); err != nil {
		return 0, err
	}
	if units < 0 {
		return 0, offsetError("Offset is outside the source.")
	}
	seen := 0
	for index, r := range source {
		if seen == units {
			return index, nil
		}
		width := utf16Width(r)
		if seen+width > units {
			return 0, offsetError("Offset splits a UTF-16 surrogate pair.")
		}
		seen += width
	}
	if seen == units {
		return len(source), nil
	}
	return 0, offsetError("Offset is outside the source.")
}

// SpanToUTF16 converts a byte span to UTF-16 code unit offsets of the same
// source.
func SpanToUTF16(source string, start, end int) (int, int, error) {
	if start > end {
		return 0, 0, offsetError("Span start is after its end.")
	}
	first, err := ByteToUTF16(source, start)
	if err != nil {
		return 0, 0, err
	}
	last, err := ByteToUTF16(source, end)
	if err != nil {
		return 0, 0, err
	}
	return first, last, nil
}

// UTF16SpanToByte is the inverse of SpanToUTF16.
func UTF16SpanToByte(source string, start, end int) (int, int, error) {
	if start > end {
		return 0, 0, offsetError("Span start is after its end.")
	}
	first, err := UTF16ToByte(source, start)
	if err != nil {
		return 0, 0, err
	}
	last, err := UTF16ToByte(source, end)
	if err != nil {
		return 0, 0, err
	}
	return first, last, nil
}

// ApplyEdit returns source with the edit applied. The edit addresses UTF-8
// bytes of source and must lie on scalar boundaries.
func ApplyEdit(source string, edit Edit) (string, error) {
	if edit.Unit != UnitUTF8Byte {
		return "", offsetError("Edit unit is not utf8-byte.")
	}
	if err := ValidateOffset(source, edit.Start); err != nil {
		return "", err
	}
	if err := ValidateOffset(source, edit.End); err != nil {
		return "", err
	}
	if edit.Start > edit.End {
		return "", offsetError("Edit start is after its end.")
	}
	return source[:edit.Start] + edit.Text + source[edit.End:], nil
}
