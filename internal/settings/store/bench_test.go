package store

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// seedPluginEntries gives a store n plugins, each with a credential of about
// 300 bytes and a preference, the way a profile that has used n plugins looks.
func seedPluginEntries(b *testing.B, s *Store, n int) {
	b.Helper()
	seedPluginEntriesOfSize(b, s, n, 300)
}

// seedPluginEntriesOfSize is seedPluginEntries with a credential of the given size.
func seedPluginEntriesOfSize(b *testing.B, s *Store, n, size int) {
	b.Helper()
	padding := strings.Repeat("v", size)
	for i := range n {
		id := "plugin-" + strconv.Itoa(i)
		if err := s.RememberPluginSchema(id, []string{"theme"}); err != nil {
			b.Fatal(err)
		}
		if err := s.SavePluginSettings(id, map[string]any{"token": strconv.Itoa(i) + padding, "theme": "dark"}); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkOpenNothingToDo is what a start costs on a profile with nothing to
// scrub and nothing to prune: the open, with every housekeeping step looking and
// finding nothing.
func BenchmarkOpenNothingToDo(b *testing.B) {
	path := filepath.Join(b.TempDir(), "settings.db")
	s, err := Open(path)
	if err != nil {
		b.Fatal(err)
	}
	seedPluginEntries(b, s, 20)
	if err = s.Close(); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for range b.N {
		opened, openErr := Open(path)
		if openErr != nil {
			b.Fatal(openErr)
		}
		if closeErr := opened.Close(); closeErr != nil {
			b.Fatal(closeErr)
		}
	}
}

// BenchmarkHousekeepingNothingToDo is the part of that start this change added:
// listing the directory, looking for the leftovers of a scrub and for corrupt
// copies, and reading the marker.
func BenchmarkHousekeepingNothingToDo(b *testing.B) {
	dir := b.TempDir()
	path := filepath.Join(dir, "settings.db")
	// A state root holds a few dozen other files and directories.
	for i := range 40 {
		if err := os.WriteFile(filepath.Join(dir, "other-"+strconv.Itoa(i)+".json"), []byte("{}"), 0o600); err != nil {
			b.Fatal(err)
		}
	}
	s, err := Open(path)
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	b.ResetTimer()
	for range b.N {
		entries := readDirectory(dir)
		if recoverErr := recoverScrub(path, newConfig(nil)); recoverErr != nil {
			b.Fatal(recoverErr)
		}
		s.pruneCorruptCopies(entries, "")
		if _, owedErr := s.scrubOwed(); owedErr != nil {
			b.Fatal(owedErr)
		}
	}
}

// BenchmarkScrub is the cost of one scrub, after a credential was erased, for a
// profile of n plugins whose credentials are each of the given size.
func BenchmarkScrub(b *testing.B) {
	for _, profile := range []struct{ plugins, size int }{{10, 300}, {100, 300}, {1000, 300}, {1000, 4096}} {
		b.Run(strconv.Itoa(profile.plugins)+" plugins of "+strconv.Itoa(profile.size)+" bytes", func(b *testing.B) {
			s, err := Open(filepath.Join(b.TempDir(), "settings.db"))
			if err != nil {
				b.Fatal(err)
			}
			defer s.Close()
			seedPluginEntriesOfSize(b, s, profile.plugins, profile.size)
			b.ResetTimer()
			for range b.N {
				if updateErr := s.db.Update(markScrubPending); updateErr != nil {
					b.Fatal(updateErr)
				}
				if scrubErr := s.scrub(); scrubErr != nil {
					b.Fatal(scrubErr)
				}
			}
		})
	}
}

// BenchmarkWriteThatDestroysNothing is what a settings write costs that the scrub
// logic looks at and leaves alone: it must not cost more than the write.
func BenchmarkWriteThatDestroysNothing(b *testing.B) {
	s, err := Open(filepath.Join(b.TempDir(), "settings.db"))
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	seedPluginEntries(b, s, 20)
	b.ResetTimer()
	for i := range b.N {
		if patchErr := s.PatchPluginSettings("plugin-1", map[string]any{"theme": strconv.Itoa(i)}); patchErr != nil {
			b.Fatal(patchErr)
		}
	}
}
