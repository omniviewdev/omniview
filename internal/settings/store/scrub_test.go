package store

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	bolt "go.etcd.io/bbolt"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

// The scrub replaces the database file with a compacted copy and overwrites the
// file it replaced. These tests stop it at each of its steps, fail each step, and
// take the directory as a crash at each step would leave it.

const scrubPlanted = "scrub-sentinel-b81f06d93c7a"

func openScrubStore(t *testing.T, plan *faultPlan, opts ...Option) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	all := append([]Option{withFault(plan.hook)}, opts...)
	s, err := Open(filepath.Join(dir, "settings.db"), all...)
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	return s, dir
}

// seedScrubStore stores a credential for "flux" whose bytes the test then looks
// for, and values that must survive any scrub: another plugin's, a core
// category's, the MCP document and a remembered schema.
func seedScrubStore(t *testing.T, s *Store) {
	t.Helper()
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.NoError(t, s.RememberPluginSchema("other", []string{"theme"}))
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": scrubPlanted, "theme": "dark"}))
	require.NoError(t, s.SavePluginSettings("other", map[string]any{"token": "other-secret", "theme": "light"}))
	require.NoError(t, s.SaveCategory("appearance", map[string]any{"theme": "dark"}))
	require.NoError(t, s.SaveMCPRelayConfig(map[string]any{"token": "relay-token", "port": 4000}))
}

// requireSeededData checks what seedScrubStore stored, after flux's credential
// was erased.
func requireSeededData(t *testing.T, s *Store) {
	t.Helper()
	all, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.Equal(t, map[string]map[string]any{
		"flux":  {"theme": "dark"},
		"other": {"token": "other-secret", "theme": "light"},
	}, all)
	appearance, err := s.LoadCategory("appearance")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark"}, appearance)
	var relay map[string]any
	found, err := s.LoadMCPRelayConfig(&relay)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, map[string]any{"token": "relay-token", "port": float64(4000)}, relay)
	ordinary, found, err := s.LoadPluginSchema("other")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, []string{"theme"}, ordinary)
}

// scrubLeftovers names what a scrub leaves beside the database while it works.
func scrubLeftovers(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	var names []string
	for _, entry := range entries {
		if name := entry.Name(); name == "settings.db.scrub-new" || name == "settings.db.scrub-old" {
			names = append(names, name)
		}
	}
	return names
}

// fileIdentity returns the identity of the file at path as it is now. Where os.Stat
// loads the identity only when os.SameFile asks (Windows), the path may name
// another file by then; the stat of an open handle does not.
func fileIdentity(t *testing.T, path string) os.FileInfo {
	t.Helper()
	file, err := os.Open(path)
	require.NoError(t, err)
	info, err := file.Stat()
	require.NoError(t, err)
	require.NoError(t, file.Close())
	return info
}

func TestAScrubIsOwedOnlyAfterACredentialIsDestroyed(t *testing.T) {
	cases := []struct {
		name   string
		change func(s *Store) error
		owed   bool
		// reports is set when the call tells its caller about a scrub that failed: an
		// erase does, because its caller retries it; a plain write that overwrote a
		// credential does not, because the write itself worked.
		reports bool
	}{
		{"erase of a credential", func(s *Store) error { _, err := s.ErasePluginSettings("flux", nil); return err }, true, true},
		{"delete of the settings", func(s *Store) error { return s.DeletePluginSettings("flux") }, true, true},
		{"clearing a password", func(s *Store) error {
			return s.PatchPluginSettings("flux", map[string]any{"token": ""})
		}, true, false},
		{"replacing a credential", func(s *Store) error {
			return s.PatchPluginSettings("flux", map[string]any{"token": "rotated"})
		}, true, false},
		{"saving without the credential", func(s *Store) error {
			return s.SavePluginSettings("flux", map[string]any{"theme": "dark"})
		}, true, false},
		{"changing an ordinary value", func(s *Store) error {
			return s.PatchPluginSettings("flux", map[string]any{"theme": "light"})
		}, false, false},
		{"saving the same values again", func(s *Store) error {
			return s.SavePluginSettings("flux", map[string]any{"token": scrubPlanted, "theme": "dark"})
		}, false, false},
		{"adding a credential", func(s *Store) error {
			return s.PatchPluginSettings("flux", map[string]any{"password": "new"})
		}, false, false},
		{"setting a credential that was empty", func(s *Store) error {
			if err := s.PatchPluginSettings("flux", map[string]any{"password": ""}); err != nil {
				return err
			}
			return s.PatchPluginSettings("flux", map[string]any{"password": "first"})
		}, false, false},
		{"erasing a plugin with only ordinary values", func(s *Store) error {
			_, err := s.ErasePluginSettings("calm", declaring("theme"))
			return err
		}, false, false},
		{"erasing a plugin that has nothing stored", func(s *Store) error {
			_, err := s.ErasePluginSettings("nobody", nil)
			return err
		}, false, false},
		{"saving a core category", func(s *Store) error {
			return s.SaveCategory("appearance", map[string]any{"theme": "light"})
		}, false, false},
		{"rotating the MCP token", func(s *Store) error {
			return s.SaveMCPRelayConfig(map[string]any{"token": "rotated", "port": 4000})
		}, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan := &faultPlan{}
			s, _ := openScrubStore(t, plan)
			seedScrubStore(t, s)
			require.NoError(t, s.RememberPluginSchema("calm", []string{"theme"}))
			require.NoError(t, s.SavePluginSettings("calm", map[string]any{"theme": "dark"}))
			require.Empty(t, plan.steps(), "seeding destroys no credential")
			// The scrub itself fails at once, so that the marker stays where a test can see it.
			plan.failing(stepBuild)

			err := tc.change(s)

			if tc.reports {
				require.ErrorIs(t, err, ErrScrubFailed)
			} else {
				require.NoError(t, err, "a write that worked is not reported as failed because its scrub did")
			}

			assert.Equal(t, tc.owed, slices.Contains(plan.steps(), stepBuild), "a scrub was tried")
			owed, owedErr := s.scrubOwed()
			require.NoError(t, owedErr)
			assert.Equal(t, tc.owed, owed, "the marker")
		})
	}
}

func TestAnEraseReportsAScrubThatFailsAndKeepsTheErasedResult(t *testing.T) {
	plan := &faultPlan{}
	s, _ := openScrubStore(t, plan)
	seedScrubStore(t, s)
	plan.failing(stepBuild)

	result, err := s.ErasePluginSettings("flux", nil)

	require.ErrorIs(t, err, ErrScrubFailed)
	require.ErrorIs(t, err, errInjected)
	assert.Equal(t, EraseResult{Erased: 1, Kept: 1, Basis: EraseBasisRemembered, Unreadable: false}, result,
		"the values are erased, and the caller is told so with the error")
	requireSeededData(t, s)
}

func TestAScrubReplacesTheFileAndKeepsEveryValue(t *testing.T) {
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	seedScrubStore(t, s)
	path := filepath.Join(dir, "settings.db")
	before := fileIdentity(t, path)

	_, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.Equal(t, []string{stepBuild, stepVerify, stepParkOld, stepInstallNew, stepReopen, stepZeroOld}, plan.steps())
	after := fileIdentity(t, path)
	assert.False(t, os.SameFile(before, after), "the database is a new file")
	if runtime.GOOS != "windows" {
		assert.Equal(t, os.FileMode(0o600), after.Mode().Perm())
	}
	assert.Empty(t, scrubLeftovers(t, dir))
	assert.Empty(t, filesContaining(t, dir, scrubPlanted))
	owed, err := s.scrubOwed()
	require.NoError(t, err)
	assert.False(t, owed, "the copy does not carry the marker")
	requireSeededData(t, s)
	// The store keeps working on the new file.
	require.NoError(t, s.PatchPluginSettings("other", map[string]any{"theme": "dark"}))
	other, err := s.LoadPluginSettings("other")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"token": "other-secret", "theme": "dark"}, other)
}

func TestAScrubOverwritesTheFileItReplaces(t *testing.T) {
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	seedScrubStore(t, s)
	// A second name for the live file keeps the replaced file's blocks reachable
	// after the scrub removes its own name, so the test can read what is left in them.
	link := filepath.Join(dir, "witness")
	if err := os.Link(filepath.Join(dir, "settings.db"), link); err != nil {
		t.Skipf("hard links are not available here: %v", err)
	}
	witness, err := os.ReadFile(link)
	require.NoError(t, err)
	require.Contains(t, string(witness), scrubPlanted)

	_, err = s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	replaced, err := os.ReadFile(link)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(replaced), len(witness))
	assert.Equal(t, make([]byte, len(replaced)), replaced, "every byte of the replaced file is zero, not only unlinked")
}

// snapshotDirectory copies the regular files of from into to.
func snapshotDirectory(t *testing.T, from, to string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(to, 0o700))
	entries, err := os.ReadDir(from)
	require.NoError(t, err)
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(from, entry.Name()))
		require.NoError(t, readErr)
		require.NoError(t, os.WriteFile(filepath.Join(to, entry.Name()), data, 0o600))
	}
}

// databaseWithPlugin reports whether any of the database files in dir opens and
// holds the plugin: whether a crash left a good database to start from.
func databaseWithPlugin(t *testing.T, dir, pluginID string) bool {
	t.Helper()
	for _, name := range []string{"settings.db", "settings.db.scrub-new", "settings.db.scrub-old"} {
		source := filepath.Join(dir, name)
		if !exists(t, source) {
			continue
		}
		probe := filepath.Join(t.TempDir(), "probe.db")
		data, err := os.ReadFile(source)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(probe, data, 0o600))
		db, err := bolt.Open(probe, 0o600, &bolt.Options{ReadOnly: true})
		if err != nil {
			continue
		}
		found := false
		viewErr := db.View(func(tx *bolt.Tx) error {
			if bucket := tx.Bucket(pluginsBucket); bucket != nil {
				found = bucket.Get([]byte(pluginID)) != nil
			}
			return nil
		})
		require.NoError(t, db.Close())
		if viewErr == nil && found {
			return true
		}
	}
	return false
}

func TestACrashAtAnyStepOfAScrubLeavesAGoodDatabaseAndTheNextStartFinishesIt(t *testing.T) {
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	seedScrubStore(t, s)
	snapshots := t.TempDir()
	var taken []string
	plan.capture = func(step string) {
		taken = append(taken, step)
		snapshotDirectory(t, dir, filepath.Join(snapshots, step))
	}

	_, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	taken = append(taken, "done")
	snapshotDirectory(t, dir, filepath.Join(snapshots, "done"))
	require.Equal(t, []string{stepBuild, stepVerify, stepParkOld, stepInstallNew, stepReopen, stepZeroOld, "done"}, taken)
	for _, step := range taken {
		t.Run(step, func(t *testing.T) {
			crashed := filepath.Join(snapshots, step)
			assert.True(t, databaseWithPlugin(t, crashed, "other"), "the crash left a database that opens, whole")

			restarted, openErr := Open(filepath.Join(crashed, "settings.db"))

			require.NoError(t, openErr)
			t.Cleanup(func() { _ = restarted.Close() })
			requireSeededData(t, restarted)
			assert.Empty(t, filesContaining(t, crashed, scrubPlanted), "no file still holds the erased credential")
			assert.Empty(t, scrubLeftovers(t, crashed))
			owed, scrubErr := restarted.scrubOwed()
			require.NoError(t, scrubErr)
			assert.False(t, owed)
		})
	}
}

func TestAFailedScrubStepLeavesTheStoreWorkingAndTheNextEraseFinishesIt(t *testing.T) {
	for _, step := range []string{stepBuild, stepVerify, stepParkOld, stepInstallNew, stepReopen, stepZeroOld} {
		t.Run(step, func(t *testing.T) {
			plan := &faultPlan{}
			s, dir := openScrubStore(t, plan)
			seedScrubStore(t, s)
			plan.failing(step)

			_, err := s.ErasePluginSettings("flux", nil)

			require.ErrorIs(t, err, ErrScrubFailed)
			require.ErrorIs(t, err, errInjected)
			requireSeededData(t, s)
			require.NoError(t, s.SaveCategory("appearance", map[string]any{"theme": "dark"}), "the store still takes writes")
			owed, err := s.scrubOwed()
			require.NoError(t, err)
			assert.True(t, owed, "the scrub is still owed")
			if step != stepZeroOld {
				assert.Empty(t, scrubLeftovers(t, dir), "a failure before the swap leaves nothing beside the database")
			}

			plan.failing()
			_, err = s.ErasePluginSettings("flux", nil)

			require.NoError(t, err, "erasing again finishes the scrub")
			assert.Empty(t, filesContaining(t, dir, scrubPlanted))
			assert.Empty(t, scrubLeftovers(t, dir))
			requireSeededData(t, s)
			owed, err = s.scrubOwed()
			require.NoError(t, err)
			assert.False(t, owed)
		})
	}
}

func TestAScrubRefusesACopyThatDiffersFromTheDatabase(t *testing.T) {
	for name, tamper := range map[string]func(*bolt.Tx) error{
		"a value changed": func(tx *bolt.Tx) error {
			return tx.Bucket(pluginsBucket).Put([]byte("other"), []byte(`{"token":"changed"}`))
		},
		"a key missing": func(tx *bolt.Tx) error {
			return tx.Bucket(pluginsBucket).Delete([]byte("other"))
		},
		"a key added": func(tx *bolt.Tx) error {
			return tx.Bucket(coreBucket).Put([]byte("extra"), []byte(`{}`))
		},
		"a bucket missing": func(tx *bolt.Tx) error {
			return tx.DeleteBucket(mcpBucket)
		},
		"a bucket added": func(tx *bolt.Tx) error {
			_, err := tx.CreateBucket([]byte("stray"))
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			plan := &faultPlan{}
			s, dir := openScrubStore(t, plan)
			seedScrubStore(t, s)
			path := filepath.Join(dir, "settings.db")
			before := fileIdentity(t, path)
			plan.capture = func(step string) {
				if step != stepVerify {
					return
				}
				db, openErr := bolt.Open(path+scrubNewSuffix, 0o600, nil)
				require.NoError(t, openErr)
				require.NoError(t, db.Update(tamper))
				require.NoError(t, db.Close())
			}

			_, err := s.ErasePluginSettings("flux", nil)

			require.ErrorIs(t, err, ErrScrubFailed)
			assert.Equal(t, []string{stepBuild, stepVerify}, plan.steps(), "it stopped before touching the live file")
			after := fileIdentity(t, path)
			assert.True(t, os.SameFile(before, after), "the live database was not replaced")
			assert.Empty(t, scrubLeftovers(t, dir), "the bad copy is gone")
			requireSeededData(t, s)
		})
	}
}

func TestAnOwedScrubIsDoneWhenTheStoreOpens(t *testing.T) {
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	seedScrubStore(t, s)
	plan.failing(stepBuild)
	_, err := s.ErasePluginSettings("flux", nil)
	require.ErrorIs(t, err, ErrScrubFailed)
	require.NotEmpty(t, filesContaining(t, dir, scrubPlanted), "the credential is still in the file after the failed scrub")
	require.NoError(t, s.Close())

	restarted, err := Open(filepath.Join(dir, "settings.db"))

	require.NoError(t, err)
	t.Cleanup(func() { _ = restarted.Close() })
	assert.Empty(t, filesContaining(t, dir, scrubPlanted))
	requireSeededData(t, restarted)
}

func TestOpenDoesNothingWhenNothingIsOwed(t *testing.T) {
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	seedScrubStore(t, s)
	require.NoError(t, s.Close())
	path := filepath.Join(dir, "settings.db")
	before := fileIdentity(t, path)

	reopened, err := Open(path, withFault(plan.hook))

	require.NoError(t, err)
	t.Cleanup(func() { _ = reopened.Close() })
	after := fileIdentity(t, path)
	assert.True(t, os.SameFile(before, after), "the file is not replaced")
	assert.Empty(t, plan.steps(), "no scrub ran")
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	assert.Len(t, entries, 1, "nothing but the database is in the directory")
}

func TestOpenResolvesWhatAnInterruptedScrubLeft(t *testing.T) {
	// which names the database a file in the directory holds.
	makeDatabase := func(t *testing.T, path, which string) {
		t.Helper()
		db, err := bolt.Open(path, 0o600, nil)
		require.NoError(t, err)
		require.NoError(t, db.Update(func(tx *bolt.Tx) error {
			core, bucketErr := tx.CreateBucket(coreBucket)
			if bucketErr != nil {
				return bucketErr
			}
			return core.Put([]byte("which"), []byte(`{"database":"`+which+`"}`))
		}))
		require.NoError(t, db.Close())
	}
	garbage := func(t *testing.T, path, _ string) {
		t.Helper()
		require.NoError(t, os.WriteFile(path, []byte("half a copy "+scrubPlanted), 0o600))
	}
	cases := []struct {
		name      string
		live      func(*testing.T, string, string)
		copied    func(*testing.T, string, string)
		old       func(*testing.T, string, string)
		wantFound string
	}{
		{"the crash came before the swap", makeDatabase, garbage, nil, "live"},
		{"a copy and an old file beside a live one", makeDatabase, garbage, garbage, "live"},
		{"the old file beside a live one", makeDatabase, nil, garbage, "live"},
		{"between the two renames", nil, makeDatabase, makeDatabase, "copy"},
		{"only the copy is left", nil, makeDatabase, nil, "copy"},
		{"only the old file is left", nil, nil, makeDatabase, "old"},
		{"nothing is there", nil, nil, nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "settings.db")
			for _, file := range []struct {
				build  func(*testing.T, string, string)
				suffix string
				which  string
			}{{tc.live, "", "live"}, {tc.copied, scrubNewSuffix, "copy"}, {tc.old, scrubOldSuffix, "old"}} {
				if file.build != nil {
					file.build(t, path+file.suffix, file.which)
				}
			}

			s, err := Open(path)

			require.NoError(t, err)
			t.Cleanup(func() { _ = s.Close() })
			which, err := s.LoadCategory("which")
			require.NoError(t, err)
			if tc.wantFound == "" {
				assert.Empty(t, which)
			} else {
				assert.Equal(t, map[string]any{"database": tc.wantFound}, which)
			}
			assert.Empty(t, scrubLeftovers(t, dir))
			assert.Empty(t, filesContaining(t, dir, scrubPlanted), "a half-written copy is not left behind")
		})
	}
}

func TestOpenDoesNotCreateAnEmptyDatabaseWhereTheOnlyFileLeftHoldsTheData(t *testing.T) {
	for name, suffix := range map[string]string{"the old file": scrubOldSuffix, "the copy": scrubNewSuffix} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "settings.db")
			left, err := bolt.Open(path+suffix, 0o600, nil)
			require.NoError(t, err)
			require.NoError(t, left.Update(func(tx *bolt.Tx) error {
				_, bucketErr := tx.CreateBucket(coreBucket)
				return bucketErr
			}))
			require.NoError(t, left.Close())
			plan := &faultPlan{}
			plan.failing(stepRecover)

			_, err = Open(path, withFault(plan.hook))

			require.ErrorIs(t, err, errInjected, "the store does not start over an empty database while the data is in the other file")
			assert.Equal(t, []string{stepRecover}, plan.steps())
			assert.False(t, exists(t, path))
			assert.True(t, exists(t, path+suffix), "the file is untouched")
		})
	}
}

func TestStoreOperationsRunWhileScrubsReplaceTheFile(t *testing.T) {
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	for i := range 8 {
		require.NoError(t, s.RememberPluginSchema("plugin-"+strconv.Itoa(i), []string{"note"}))
	}
	var wg sync.WaitGroup
	// Each plugin's writer sets ordinary values; one rotates a credential at every
	// step, and each rotation scrubs.
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id := "plugin-" + strconv.Itoa(i)
			for n := range 20 {
				assert.NoError(t, s.PatchPluginSettings(id, map[string]any{"note": n, "k" + strconv.Itoa(n): n}))
				_, err := s.LoadPluginSettings(id)
				assert.NoError(t, err)
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for n := range 12 {
			assert.NoError(t, s.PatchPluginSettings("flux", map[string]any{"token": "rotation-" + strconv.Itoa(n) + "-" + scrubPlanted}))
		}
	}()
	wg.Wait()

	for i := range 8 {
		saved, err := s.LoadPluginSettings("plugin-" + strconv.Itoa(i))
		require.NoError(t, err)
		assert.Len(t, saved, 21, "every ordinary value of plugin-%d survived the scrubs", i)
	}
	flux, err := s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.Equal(t, "rotation-11-"+scrubPlanted, flux["token"])
	// Every earlier credential is gone from the file; the live one is not.
	for n := range 11 {
		assert.Empty(t, filesContaining(t, dir, "rotation-"+strconv.Itoa(n)+"-"+scrubPlanted), "rotation "+strconv.Itoa(n))
	}
	assert.NotEmpty(t, filesContaining(t, dir, "rotation-11-"+scrubPlanted))
}

func TestAScrubLogsClassesAndCountsNeverValues(t *testing.T) {
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
	})
	plan := &faultPlan{}
	s, _ := openScrubStore(t, plan)
	s.SetLogger(logger)
	seedScrubStore(t, s)

	// A scrub that works, then one that fails.
	_, err := s.ErasePluginSettings("flux", nil)
	require.NoError(t, err)
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": scrubPlanted + "-second"}))
	plan.failing(stepBuild)
	_, err = s.ErasePluginSettings("flux", nil)
	require.ErrorIs(t, err, ErrScrubFailed)

	scrubbed, failed := 0, 0
	for _, rec := range sink.Records() {
		assert.NotContains(t, rec.Message, scrubPlanted)
		assert.NotContains(t, rec.Message, errInjected.Error(), "the cause is logged by class, not as text")
		for _, f := range rec.Fields {
			text := fmt.Sprint(f.Value)
			assert.NotContains(t, text, scrubPlanted, f.Key)
			assert.NotContains(t, text, errInjected.Error(), f.Key)
		}
		switch rec.Message {
		case "settings database scrubbed of deleted values":
			scrubbed++
		case "settings persist failed":
			failed++
		}
	}
	assert.Equal(t, 1, scrubbed, "one scrub worked and said so")
	assert.Equal(t, 1, failed, "one scrub failed and said so, once")
}

func TestAScrubReplacesTheFileASymbolicLinkPointsToAndLeavesTheLink(t *testing.T) {
	dir := t.TempDir()
	pointedTo := filepath.Join(dir, "pointed-to")
	require.NoError(t, os.Mkdir(pointedTo, 0o700))
	link := filepath.Join(dir, "settings.db")
	if err := os.Symlink(filepath.Join(pointedTo, "settings.db"), link); err != nil {
		t.Skipf("symbolic links are not available here: %v", err)
	}
	s, err := Open(link)
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	seedScrubStore(t, s)

	_, err = s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	info, err := os.Lstat(link)
	require.NoError(t, err)
	assert.NotZero(t, info.Mode()&os.ModeSymlink, "the link is still a link")
	assert.Empty(t, filesContaining(t, pointedTo, scrubPlanted))
	assert.Empty(t, scrubLeftovers(t, pointedTo))
	requireSeededData(t, s)
}

// newWhichDatabase makes a database at path whose core bucket says which it is.
func newWhichDatabase(t *testing.T, path, which string) {
	t.Helper()
	db, err := bolt.Open(path, 0o600, nil)
	require.NoError(t, err)
	require.NoError(t, db.Update(func(tx *bolt.Tx) error {
		core, bucketErr := tx.CreateBucket(coreBucket)
		if bucketErr != nil {
			return bucketErr
		}
		return core.Put([]byte("which"), []byte(`{"database":"`+which+`"}`))
	}))
	require.NoError(t, db.Close())
}

func TestARestoreThatFailsNeitherCreatesAnEmptyDatabaseNorLosesTheCopy(t *testing.T) {
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	seedScrubStore(t, s)
	path := filepath.Join(dir, "settings.db")
	// The copy cannot be put in place, and the old file cannot be put back.
	plan.failing(stepInstallNew, stepRestore)

	_, err := s.ErasePluginSettings("flux", nil)

	require.ErrorIs(t, err, ErrScrubFailed)
	assert.False(t, exists(t, path), "no empty database was created where the settings were")
	assert.True(t, exists(t, path+scrubOldSuffix), "the old file is kept")
	assert.True(t, exists(t, path+scrubNewSuffix), "and so is the verified copy")
	_, err = s.LoadPluginSettings("other")
	require.Error(t, err, "the store stays closed instead of serving an empty database")

	restarted, err := Open(path)

	require.NoError(t, err, "the next start resolves it")
	t.Cleanup(func() { _ = restarted.Close() })
	requireSeededData(t, restarted)
	assert.Empty(t, filesContaining(t, dir, scrubPlanted))
	assert.Empty(t, scrubLeftovers(t, dir))
}

func TestAnUnreadableCopyBesideTheOldFileDoesNotCostTheSettings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")
	// Between the two renames, and the copy is not a database.
	require.NoError(t, os.WriteFile(path+scrubNewSuffix, []byte("not a database "+scrubPlanted), 0o600))
	newWhichDatabase(t, path+scrubOldSuffix, "old")

	s, err := Open(path)

	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	which, err := s.LoadCategory("which")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"database": "old"}, which, "the intact old file is what opens, not an empty database")
	assert.Empty(t, scrubLeftovers(t, dir))
}

func TestRecoveryDoesNotNeedToListTheDirectory(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("directory permissions cannot be used to refuse a listing here")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")
	// Between the two renames, with an old file that holds a credential.
	newWhichDatabase(t, path+scrubNewSuffix, "copy")
	require.NoError(t, os.WriteFile(path+scrubOldSuffix, []byte("old file "+scrubPlanted), 0o600))
	// Searchable and writable, not readable: Lstat of a name works, a listing does not.
	require.NoError(t, os.Chmod(dir, 0o300))
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
	if _, listErr := os.ReadDir(dir); listErr == nil {
		t.Skip("this file system does not enforce directory permissions")
	}

	s, err := Open(path)
	require.NoError(t, err)
	require.NoError(t, os.Chmod(dir, 0o700))
	t.Cleanup(func() { _ = s.Close() })

	which, err := s.LoadCategory("which")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"database": "copy"}, which, "the copy was installed, not an empty database made")
	assert.Empty(t, filesContaining(t, dir, scrubPlanted), "the old file was overwritten though the directory could not be listed")
	assert.Empty(t, scrubLeftovers(t, dir))
}

func TestAScrubOnAFileSystemThatCannotFlushADirectoryLeavesTheOldFileForTheNextStart(t *testing.T) {
	plan := &faultPlan{}
	cannotFlush := func(c *config) { c.flushes = func(string) bool { return false } }
	s, dir := openScrubStore(t, plan, cannotFlush)
	seedScrubStore(t, s)
	path := filepath.Join(dir, "settings.db")

	_, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.NotContains(t, plan.steps(), stepZeroOld, "nothing proves the renames are on the disk, so the old file is not overwritten yet")
	assert.True(t, exists(t, path+scrubOldSuffix))
	requireSeededData(t, s)
	owed, err := s.scrubOwed()
	require.NoError(t, err)
	assert.True(t, owed, "the leftover keeps the scrub owed")
	require.NoError(t, s.Close())

	restarted, err := Open(path)

	require.NoError(t, err)
	t.Cleanup(func() { _ = restarted.Close() })
	assert.Empty(t, filesContaining(t, dir, scrubPlanted), "the next start overwrites it")
	assert.Empty(t, scrubLeftovers(t, dir))
	requireSeededData(t, restarted)
}

func TestReopenNeverCreatesTheFile(t *testing.T) {
	plan := &faultPlan{}
	s, dir := openScrubStore(t, plan)
	path := filepath.Join(dir, "settings.db")
	require.NoError(t, s.db.inner.Close())
	require.NoError(t, os.Remove(path))

	err := s.reopen()

	require.Error(t, err)
	assert.False(t, exists(t, path), "bolt.Open would have made an empty database here")
}
