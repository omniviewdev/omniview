package resourceauthoring

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"cel.dev/cel-go/cel"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type unitVector struct {
	Name       string   `json:"name"`
	Source     string   `json:"source"`
	Boundaries [][3]int `json:"boundaries"`
}

func loadUnitVectors(t testing.TB) []unitVector {
	t.Helper()
	raw, err := os.ReadFile("testdata/units.json")
	require.NoError(t, err)
	var file struct {
		Cases []unitVector `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(raw, &file))
	require.NotEmpty(t, file.Cases)
	return file.Cases
}

// The vectors are written by hand, so these tests compare the conversions with
// independent expectations rather than with the algorithm under test.
func TestUnitVectorsConvertBothWays(t *testing.T) {
	for _, vector := range loadUnitVectors(t) {
		t.Run(vector.Name, func(t *testing.T) {
			bytes, scalars, units := map[int]int{}, map[int]int{}, map[int]int{}
			for _, boundary := range vector.Boundaries {
				byteOffset, scalar, unit := boundary[0], boundary[1], boundary[2]
				bytes[byteOffset], scalars[scalar], units[unit] = byteOffset, byteOffset, byteOffset

				gotScalar, err := ByteToScalar(vector.Source, byteOffset)
				require.NoError(t, err)
				assert.Equal(t, scalar, gotScalar, "byte %d to scalar", byteOffset)
				gotUnit, err := ByteToUTF16(vector.Source, byteOffset)
				require.NoError(t, err)
				assert.Equal(t, unit, gotUnit, "byte %d to utf16", byteOffset)
				gotByte, err := ScalarToByte(vector.Source, scalar)
				require.NoError(t, err)
				assert.Equal(t, byteOffset, gotByte, "scalar %d to byte", scalar)
				gotByte, err = UTF16ToByte(vector.Source, unit)
				require.NoError(t, err)
				assert.Equal(t, byteOffset, gotByte, "utf16 %d to byte", unit)
				require.NoError(t, ValidateOffset(vector.Source, byteOffset))
			}
			// Every byte offset that is not a boundary splits a UTF-8 sequence.
			for offset := 0; offset <= len(vector.Source); offset++ {
				if _, ok := bytes[offset]; ok {
					continue
				}
				assert.Error(t, ValidateOffset(vector.Source, offset), "byte %d splits a sequence", offset)
				_, err := ByteToUTF16(vector.Source, offset)
				assert.Error(t, err, "byte %d has no utf16 position", offset)
			}
			// Every UTF-16 offset that is not a boundary lies between surrogate halves.
			total := 0
			for _, r := range vector.Source {
				total += utf16Width(r)
			}
			for offset := 0; offset <= total; offset++ {
				if _, ok := units[offset]; ok {
					continue
				}
				_, err := UTF16ToByte(vector.Source, offset)
				assert.Error(t, err, "utf16 %d splits a surrogate pair", offset)
			}
			// Outside the source is rejected in every unit, never clamped.
			_, err := ByteToScalar(vector.Source, len(vector.Source)+1)
			assert.Error(t, err)
			_, err = ByteToScalar(vector.Source, -1)
			assert.Error(t, err)
			_, err = ScalarToByte(vector.Source, utf8.RuneCountInString(vector.Source)+1)
			assert.Error(t, err)
			_, err = UTF16ToByte(vector.Source, total+1)
			assert.Error(t, err)
			_, err = UTF16ToByte(vector.Source, -1)
			assert.Error(t, err)
		})
	}
}

func TestSpanConversionsRoundTrip(t *testing.T) {
	source := "resource.labels[\"\u96ea\U0001F600x\"] == 1"
	start := strings.Index(source, "\u96ea")
	end := strings.Index(source, "x\"]")
	first, last, err := SpanToUTF16(source, start, end)
	require.NoError(t, err)
	assert.Equal(t, [2]int{17, 20}, [2]int{first, last}, "CJK is one unit, the supplementary scalar two")
	gotStart, gotEnd, err := UTF16SpanToByte(source, first, last)
	require.NoError(t, err)
	assert.Equal(t, [2]int{start, end}, [2]int{gotStart, gotEnd})

	_, _, err = SpanToUTF16(source, end, start)
	assert.Error(t, err, "reversed span")
	_, _, err = SpanToUTF16(source, start+1, end)
	assert.Error(t, err, "span starting inside the CJK scalar")
	_, _, err = UTF16SpanToByte(source, 18, 19)
	assert.Error(t, err, "span ending between surrogate halves")
}

func TestUnitsRejectInvalidUTF8(t *testing.T) {
	broken := "a\xffb"
	_, err := ByteToScalar(broken, 1)
	assert.Error(t, err)
	_, err = ByteToUTF16(broken, 1)
	assert.Error(t, err)
	_, err = ScalarToByte(broken, 1)
	assert.Error(t, err)
	_, err = UTF16ToByte(broken, 1)
	assert.Error(t, err)
}

// The CEL parser reports Unicode scalar offsets. P01 §4: translate them against
// the exact source into the byte offsets the wire carries.
func TestNativeCELScalarOffsetsConvertToWireBytes(t *testing.T) {
	env, err := cel.NewEnv()
	require.NoError(t, err)
	// Combining marks and supplementary characters before the syntax error make
	// scalar, byte and UTF-16 offsets all differ.
	source := "'e\u0301\U0001F600\u96ea' == )"
	_, issues := env.Parse(source)
	require.NotNil(t, issues)
	require.Error(t, issues.Err())
	errs := issues.Errors()
	require.NotEmpty(t, errs)
	scalar := errs[0].Location.Column()
	byteOffset, err := ScalarToByte(source, scalar)
	require.NoError(t, err)
	assert.Equal(t, strings.Index(source, ")"), byteOffset, "CEL points at the unexpected token in scalars")
	assert.NotEqual(t, scalar, byteOffset, "scalar offsets are not byte offsets")
	units, err := ByteToUTF16(source, byteOffset)
	require.NoError(t, err)
	assert.NotEqual(t, byteOffset, units)
	assert.NotEqual(t, scalar, units, "the supplementary character makes UTF-16 differ from scalars")
}

func TestApplyEditUsesBytes(t *testing.T) {
	source := "resource.\u96ea == 1"
	got, err := ApplyEdit(source, Edit{Start: 9, End: 12, Unit: UnitUTF8Byte, Text: "id"})
	require.NoError(t, err)
	assert.Equal(t, "resource.id == 1", got)
	_, err = ApplyEdit(source, Edit{Start: 9, End: 11, Unit: UnitUTF8Byte, Text: "id"})
	assert.Error(t, err, "an edit ending inside a scalar is rejected")
	_, err = ApplyEdit(source, Edit{Start: 9, End: 12, Unit: "utf16", Text: "id"})
	assert.Error(t, err, "only the wire unit is applied")
	_, err = ApplyEdit(source, Edit{Start: 12, End: 9, Unit: UnitUTF8Byte})
	assert.Error(t, err)
}
