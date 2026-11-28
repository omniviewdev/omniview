//go:build unix

package linkresolve_test

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/linkresolve"
)

func TestPunctuationAfterAWrapperOrAQuoteIsNotPartOfThePathOrHidesThePosition(t *testing.T) {
	ws := tree(t, "src/a.go")
	r, _ := resolver(t, linkresolve.Config{})
	for text, want := range map[string]linkresolve.Result{
		"[src/a.go],":         found(ws, "src/a.go", 0, 0),
		"(src/a.go).":         found(ws, "src/a.go", 0, 0),
		`"src/a.go:12:3",`:    found(ws, "src/a.go", 12, 3),
		`'src/a.go:12'.`:      found(ws, "src/a.go", 12, 0),
		"[src/a.go]":          found(ws, "src/a.go", 0, 0), // the controls
		`"src/a.go", line 12`: found(ws, "src/a.go", 12, 0),
		"(src/a.go:7)":        found(ws, "src/a.go", 7, 0),
		"(src/a.go(4,2))":     found(ws, "src/a.go", 4, 2),
	} {
		assert.Equal(t, want, r.Resolve(linkresolve.Input{Dir: ws, Text: text}), text)
	}
}

func TestALinkWhoseTargetEndsInASlashNamesADirectoryOnly(t *testing.T) {
	ws := tree(t, "file.go", "dir/")
	require.NoError(t, os.Symlink("file.go/", filepath.Join(ws, "slashed")))
	require.NoError(t, os.Symlink("file.go", filepath.Join(ws, "plain")))
	require.NoError(t, os.Symlink("dir/", filepath.Join(ws, "dirlink")))
	r, _ := resolver(t, linkresolve.Config{})
	in := func(text string) linkresolve.Input { return linkresolve.Input{Dir: ws, Text: text} }
	assert.Equal(t, found(ws, "file.go", 0, 0), r.Resolve(in("plain")), "the control: a link to a file")
	assert.Equal(t, linkresolve.Result{Kind: linkresolve.KindDir, Path: filepath.Join(ws, "dir")}, r.Resolve(in("dirlink")), "the control: a slash on a directory")
	assert.Equal(t, linkresolve.KindUnknown, r.Resolve(in("slashed")).Kind, "following it fails: file.go/ is not a directory")
}

func TestTheScanDoesNotAnswerWhenItEndedBeforeReadingEverything(t *testing.T) {
	ws := tree(t, "a/target.go", "z/target.go")
	// 2 entries at the base, 1 more for a: the budget is gone and z was never read
	r, _ := resolver(t, linkresolve.Config{ScanEntries: 3})
	assert.Equal(t, linkresolve.KindUnknown, r.Resolve(linkresolve.Input{Dir: ws, Text: "target.go"}).Kind, "one match seen, a directory unread: not an answer")
	// the control: with the budget, the two are told as ambiguous, and one alone is found
	full, _ := resolver(t, linkresolve.Config{})
	assert.Equal(t, unknown(linkresolve.ReasonAmbiguous), full.Resolve(linkresolve.Input{Dir: ws, Text: "target.go"}))
	one := tree(t, "a/target.go", "z/other.go")
	assert.Equal(t, found(one, "a/target.go", 0, 0), full.Resolve(linkresolve.Input{Dir: one, Text: "target.go"}))
}

func TestTheScanReadsAMatchBeyondTheFirstFiveHundredAndTwelveEntries(t *testing.T) {
	names := make([]string, 0, 700)
	for i := 0; i < 600; i++ {
		names = append(names, "f"+strconv.Itoa(i)+".txt")
	}
	names = append(names, "zzz_last.go")
	ws := tree(t, names...)
	r, seen := resolver(t, linkresolve.Config{})
	assert.Equal(t, found(ws, "zzz_last.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "zzz_last.go"}), "the control: named directly")
	// by suffix: the match is the 601st entry of the directory
	deep := tree(t, append([]string{}, prefixed("pkg/", names)...)...)
	assert.Equal(t, found(deep, "pkg/zzz_last.go", 0, 0), r.Resolve(linkresolve.Input{Dir: deep, Text: "pkg/zzz_last.go"}))
	assert.Equal(t, found(deep, "pkg/zzz_last.go", 0, 0), r.Resolve(linkresolve.Input{Dir: deep, Text: "zzz_last.go"}), "found by the scan past entry 512")
	assert.Greater(t, seen.entries, 600, "the whole directory was read, not its first 512 entries")
}

func prefixed(prefix string, names []string) []string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = prefix + n
	}
	return out
}

func TestADirectoryIsNotAScanMatchBesideAFile(t *testing.T) {
	ws := tree(t, "a/target.go/", "b/target.go")
	r, _ := resolver(t, linkresolve.Config{})
	assert.Equal(t, found(ws, "b/target.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "target.go"}), "one file; a directory of the same name is not a second")
	assert.Equal(t, linkresolve.Result{Kind: linkresolve.KindDir, Path: filepath.Join(ws, "a/target.go")}, r.Resolve(linkresolve.Input{Dir: ws, Text: "a/target.go"}), "the control: a directory named in full is a directory")
}

func TestACachedAnswerFollowsALinkThatWasRetargeted(t *testing.T) {
	ws := tree(t, "one.go", "two.go")
	require.NoError(t, os.Symlink("one.go", filepath.Join(ws, "cur")))
	r, _ := resolver(t, linkresolve.Config{})
	in := linkresolve.Input{Dir: ws, Text: "cur:3"}
	assert.Equal(t, found(ws, "one.go", 3, 0), r.Resolve(in))
	assert.Equal(t, found(ws, "one.go", 3, 0), r.Resolve(in), "the control: unchanged")
	require.NoError(t, os.Remove(filepath.Join(ws, "cur")))
	require.NoError(t, os.Symlink("two.go", filepath.Join(ws, "cur")))
	assert.Equal(t, found(ws, "two.go", 3, 0), r.Resolve(in), "the link now leads to another file")
}
