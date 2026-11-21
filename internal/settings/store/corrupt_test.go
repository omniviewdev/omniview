package store

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The retention rule for the copies corruption recovery keeps, run against a
// clock the test sets, so that "older than a week" is exact.

// corruptNow is the fixed time of these tests.
func corruptNow() time.Time {
	return time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
}

func clockAt(now time.Time) Option {
	return withClock(func() time.Time { return now })
}

func TestParseCorruptCopyName(t *testing.T) {
	made := time.Unix(1760000000, 0)
	got, ok := parseCorruptCopyName("settings.db", "settings.db.corrupt.1760000000")
	assert.True(t, ok)
	assert.True(t, got.Equal(made))

	for _, name := range []string{
		"settings.db.corrupt.",
		"settings.db.corrupt",
		"settings.db.corrupt.0",
		"settings.db.corrupt.-1760000000",
		"settings.db.corrupt.+1760000000",
		"settings.db.corrupt.01760000000",
		"settings.db.corrupt.1760000000.bak",
		"settings.db.corrupt.1760000000 ",
		"settings.db.corrupt. 1760000000",
		"settings.db.corrupt.1.76e9",
		"settings.db.corrupt.0x6a0b1c00",
		"settings.db.corrupt.99999999999999999999",
		"settings.db.corrupt.1760000000/..",
		"settings.db.corrupt.١٧٦٠٠٠٠٠٠٠",
		"SETTINGS.DB.CORRUPT.1760000000",
		"other.db.corrupt.1760000000",
		"xsettings.db.corrupt.1760000000",
		"settings.db.1760000000",
		"settings.db.scrub-old",
	} {
		_, ok = parseCorruptCopyName("settings.db", name)
		assert.False(t, ok, name)
	}
}

func TestCopiesToPrune(t *testing.T) {
	day := 24 * time.Hour
	copyMade := func(name string, age time.Duration) corruptCopy {
		made := corruptNow().Add(-age)
		return corruptCopy{name: name, made: made, modified: made}
	}
	cases := []struct {
		name    string
		copies  []corruptCopy
		current string
		want    []string
	}{
		{"no copies", nil, "", nil},
		{"a copy inside its week stays", []corruptCopy{copyMade("a", day)}, "", nil},
		{"a copy of exactly a week stays", []corruptCopy{copyMade("a", 7*day)}, "", nil},
		{"a copy one second over a week goes", []corruptCopy{copyMade("a", 7*day+time.Second)}, "", []string{"a"}},
		{"only the newest of several stays",
			[]corruptCopy{copyMade("old", 5*day), copyMade("new", day), copyMade("mid", 3*day)}, "", []string{"old", "mid"}},
		{"the newest goes too when it is over a week old",
			[]corruptCopy{copyMade("a", 9*day), copyMade("b", 8*day)}, "", []string{"a", "b"}},
		{"the copy of this run stays and every other goes",
			[]corruptCopy{copyMade("this-run", 0), copyMade("older", day), copyMade("oldest", 3*day)}, "this-run", []string{"older", "oldest"}},
		{"the copy of this run stays when the clock calls it old",
			[]corruptCopy{copyMade("this-run", 30*day), copyMade("other", day)}, "this-run", []string{"other"}},
		{"the copy of this run is not in the listing",
			[]corruptCopy{copyMade("older", day)}, "this-run", []string{"older"}},
		{"a name dated in the future falls back to the file time: old",
			[]corruptCopy{
				{name: "future", made: corruptNow().Add(10 * day), modified: corruptNow().Add(-20 * day)},
				copyMade("real", 2*day),
			}, "", []string{"future"}},
		{"a name dated in the future falls back to the file time: recent",
			[]corruptCopy{
				{name: "future", made: corruptNow().Add(10 * day), modified: corruptNow().Add(-day)},
				copyMade("real", 2*day),
			}, "", []string{"real"}},
		{"a name and a file time both in the future make the newest",
			[]corruptCopy{
				{name: "future", made: corruptNow().Add(10 * day), modified: corruptNow().Add(5 * day)},
				copyMade("real", 2*day),
			}, "", []string{"real"}},
		{"a future-dated copy alone is not an old copy",
			[]corruptCopy{{name: "future", made: corruptNow().Add(10 * day), modified: corruptNow().Add(-day)}}, "", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got []string
			for _, c := range copiesToPrune(tc.copies, tc.current, corruptNow()) {
				got = append(got, c.name)
			}
			assert.ElementsMatch(t, tc.want, got)
		})
	}
}

func TestListCorruptCopiesTakesOnlyRegularFilesOfTheExactShape(t *testing.T) {
	stamp := strconv.FormatInt(corruptNow().Add(-48*time.Hour).Unix(), 10)
	listing := fstest.MapFS{
		"settings.db.corrupt." + stamp:           {Data: []byte("copy"), Mode: 0o600},
		"settings.db.corrupt." + stamp + ".bak":  {Data: []byte("no"), Mode: 0o600},
		"settings.db.corrupt.0" + stamp:          {Data: []byte("no"), Mode: 0o600},
		"other.db.corrupt." + stamp:              {Data: []byte("no"), Mode: 0o600},
		"settings.db.corrupt.1700000000":         {Mode: fs.ModeDir | 0o700},
		"settings.db.corrupt.1700000001":         {Data: []byte("a link"), Mode: fs.ModeSymlink | 0o777},
		"settings.db":                            {Data: []byte("db"), Mode: 0o600},
		"settings.db.corrupt.1700000002/nested":  {Data: []byte("inside"), Mode: 0o600},
		"settings.db.corrupt.1700000002.scrubby": {Data: []byte("no"), Mode: 0o600},
	}
	entries, err := fs.ReadDir(listing, ".")
	require.NoError(t, err)

	copies := listCorruptCopies(entries, "settings.db")

	require.Len(t, copies, 1)
	assert.Equal(t, "settings.db.corrupt."+stamp, copies[0].name)
	assert.True(t, copies[0].made.Equal(corruptNow().Add(-48*time.Hour)))
}

func TestOpenAppliesTheRetentionRuleByTheClock(t *testing.T) {
	day := 24 * time.Hour
	dir := t.TempDir()
	week := writeCorruptCopy(t, dir, corruptNow().Add(-7*day), "exactly a week")
	over := writeCorruptCopy(t, dir, corruptNow().Add(-7*day-time.Second), "a second over")
	older := writeCorruptCopy(t, dir, corruptNow().Add(-10*day), "ten days")

	s, err := Open(filepath.Join(dir, "settings.db"), clockAt(corruptNow()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	assert.True(t, exists(t, filepath.Join(dir, week)), "the newest copy, of exactly a week, stays")
	assert.False(t, exists(t, filepath.Join(dir, over)))
	assert.False(t, exists(t, filepath.Join(dir, older)))

	// A second later the same copy is over its week.
	require.NoError(t, s.Close())
	later, err := Open(filepath.Join(dir, "settings.db"), clockAt(corruptNow().Add(time.Second)))
	require.NoError(t, err)
	t.Cleanup(func() { _ = later.Close() })
	assert.False(t, exists(t, filepath.Join(dir, week)), "the copy goes once it is older than a week")
}

func TestCorruptionRecoveryNamesTheCopyByTheClockAndKeepsItWhateverItsAge(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")
	require.NoError(t, os.WriteFile(path, []byte("this is not a valid bbolt database"), 0o600))
	older := writeCorruptCopy(t, dir, corruptNow().Add(-24*time.Hour), "older copy")

	s, err := Open(path, clockAt(corruptNow()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	madeNow := filepath.Join(dir, corruptName("settings.db", corruptNow()))
	data, err := os.ReadFile(madeNow)
	require.NoError(t, err)
	assert.Equal(t, "this is not a valid bbolt database", string(data))
	assert.False(t, exists(t, filepath.Join(dir, older)), "every other copy goes when this run made one")

	// Years on, still the same run: the copy it made is not pruned by this Open,
	// and the next Open prunes by age as for any other.
	require.NoError(t, s.Close())
	again, err := Open(path, clockAt(corruptNow().AddDate(3, 0, 0)))
	require.NoError(t, err)
	t.Cleanup(func() { _ = again.Close() })
	assert.False(t, exists(t, madeNow), "three years later it is long over its week")
}

func TestAPrunedCopyIsOverwrittenBeforeItIsRemoved(t *testing.T) {
	dir := t.TempDir()
	name := writeCorruptCopy(t, dir, corruptNow().Add(-8*24*time.Hour), "corrupt-copy-sentinel-5d3b "+scrubPlanted)
	witness := filepath.Join(dir, "witness")
	if err := os.Link(filepath.Join(dir, name), witness); err != nil {
		t.Skipf("hard links are not available here: %v", err)
	}
	before, err := os.ReadFile(witness)
	require.NoError(t, err)

	s, err := Open(filepath.Join(dir, "settings.db"), clockAt(corruptNow()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	assert.False(t, exists(t, filepath.Join(dir, name)))
	after, err := os.ReadFile(witness)
	require.NoError(t, err)
	assert.Equal(t, make([]byte, len(before)), after, "the blocks of the removed copy hold zeros, not the old bytes")
}

func TestOpenDoesNotWriteThroughALinkNamedLikeACopy(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(t.TempDir(), "precious")
	require.NoError(t, os.WriteFile(target, []byte("not a copy of anything"), 0o600))
	link := filepath.Join(dir, corruptName("settings.db", corruptNow().Add(-30*24*time.Hour)))
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symbolic links are not available here: %v", err)
	}

	s, err := Open(filepath.Join(dir, "settings.db"), clockAt(corruptNow()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	data, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "not a copy of anything", string(data), "the file the link points at is untouched")
	_, err = os.Lstat(link)
	require.NoError(t, err, "and so is the link")
}

func TestOpenPrunesOnlyTheCopiesBesideTheDatabase(t *testing.T) {
	dir := t.TempDir()
	other := filepath.Join(dir, "other")
	require.NoError(t, os.Mkdir(other, 0o700))
	farAway := writeCorruptCopy(t, other, corruptNow().Add(-30*24*time.Hour), "another directory")
	beside := writeCorruptCopy(t, dir, corruptNow().Add(-30*24*time.Hour), "beside the database")

	s, err := Open(filepath.Join(dir, "settings.db"), clockAt(corruptNow()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	assert.False(t, exists(t, filepath.Join(dir, beside)))
	assert.True(t, exists(t, filepath.Join(other, farAway)))
}

func TestACopyThatCannotBeRemovedDoesNotStopTheStoreFromOpening(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("directory permissions cannot be used to refuse the removal here")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")
	s, err := Open(path, clockAt(corruptNow()))
	require.NoError(t, err)
	require.NoError(t, s.Close())
	stuck := writeCorruptCopy(t, dir, corruptNow().Add(-30*24*time.Hour), "stuck")
	require.NoError(t, os.Chmod(dir, 0o500))
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
	if probe, probeErr := os.Create(filepath.Join(dir, "probe")); probeErr == nil {
		_ = probe.Close()
		t.Skip("this file system does not enforce directory permissions")
	}

	reopened, err := Open(path, clockAt(corruptNow()))

	require.NoError(t, err, "housekeeping never fails the open")
	t.Cleanup(func() { _ = reopened.Close() })
	assert.True(t, exists(t, filepath.Join(dir, stuck)), "the copy that could not be removed is left for the next start")
}
