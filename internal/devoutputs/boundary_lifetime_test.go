package devoutputs

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRedirectedOutputMetadataCannotTouchStateOrForeignDirectory(t *testing.T) {
	for _, level := range []string{"metadata-root", "outputs-parent", "uuid-leaf"} {
		t.Run(level, func(t *testing.T) {
			w, consumer := outputFixture(t)
			s, err := newScope(w)
			if err != nil {
				t.Fatal(err)
			}
			outside, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err = os.Chmod(outside, 0755); err != nil {
				t.Fatal(err)
			}
			writeOutput(t, filepath.Join(outside, "canary"), "foreign state must not change")
			before, err := os.Stat(outside)
			if err != nil {
				t.Fatal(err)
			}
			redirect := s.directory
			if level == "outputs-parent" {
				redirect = filepath.Dir(redirect)
			}
			if level == "metadata-root" {
				redirect = filepath.Dir(filepath.Dir(redirect))
			}
			if err = os.MkdirAll(filepath.Dir(redirect), 0700); err != nil {
				t.Fatal(err)
			}
			if err = os.Symlink(outside, redirect); err != nil {
				t.Skipf("directory symlink unavailable: %v", err)
			}
			w.StateRoot = outside
			if err = locked(context.Background(), s, func(*journal) error { t.Error("redirected stale scope entered journal action"); return nil }); err == nil {
				t.Fatal("captured metadata scope followed a later redirect")
			}
			if _, err = BeginInstall(context.Background(), w, consumer); err == nil {
				t.Fatal("redirected metadata was accepted")
			}
			after, err := os.Stat(outside)
			if err != nil {
				t.Fatal(err)
			}
			if before.Mode().Perm() != after.Mode().Perm() {
				t.Fatal("redirected state/foreign directory permissions were repaired")
			}
			entries, err := os.ReadDir(outside)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 1 || entries[0].Name() != "canary" {
				t.Fatalf("journal/lock directories appeared outside boundary: %v", entries)
			}
			raw, err := os.ReadFile(filepath.Join(outside, "canary"))
			if err != nil || string(raw) != "foreign state must not change" {
				t.Fatalf("foreign state changed: %v", err)
			}
		})
	}
}

func TestOutputMetadataDoesNotRepairPreexistingPublicDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix permission-bit fixture; Windows uses the shared private-directory ACL policy")
	}
	w, consumer := outputFixture(t)
	s, err := newScope(w)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(s.directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(s.directory, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err = BeginInstall(context.Background(), w, consumer); err == nil {
		t.Fatal("public metadata directory was adopted")
	}
	info, err := os.Stat(s.directory)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0755 {
		t.Fatal("foreign/public directory permissions changed")
	}
	entries, err := os.ReadDir(s.directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("metadata was written before ownership validation: %v", entries)
	}
}

func liveCacheFixture(t *testing.T) (scope, string, *Writer, string) {
	t.Helper()
	w, consumer := outputFixture(t)
	install, err := BeginInstall(context.Background(), w, consumer)
	if err != nil {
		t.Fatal(err)
	}
	if err = install.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	first, err := BeginVite(context.Background(), w, consumer)
	if err != nil {
		t.Fatal(err)
	}
	var cache string
	for _, entry := range first.Environment {
		if strings.HasPrefix(entry, "OMNIVIEW_VITE_CACHE_DIRECTORY=") {
			cache = strings.TrimPrefix(entry, "OMNIVIEW_VITE_CACHE_DIRECTORY=")
		}
	}
	if cache == "" {
		t.Fatal("missing actual cache capability")
	}
	s, err := newScope(w)
	if err != nil {
		t.Fatal(err)
	}
	return s, consumer, first, cache
}

func TestSharedCacheAdmissionAndFinishDoNotReadOtherLiveWriterPayload(t *testing.T) {
	for _, kind := range []Producer{loaderCache, typeCache, viteCache, loaderFiles} {
		t.Run(string(kind), func(t *testing.T) {
			s, consumer, first, _ := liveCacheFixture(t)
			spec, err := s.spec(consumer, kind)
			if err != nil {
				t.Fatal(err)
			}
			payload := filepath.Join(spec.Target, "incomplete-cache-output")
			if kind == loaderFiles {
				payload = filepath.Join(spec.Target, "vite.config.ts.timestamp-123-abcdef.mjs")
			}
			// A deliberately incomplete intermediate is deterministic: content traversal
			// rejects this link, independently of scheduling or root-user read privileges.
			if err = os.Symlink(filepath.Join(t.TempDir(), "not-yet-produced"), payload); err != nil {
				t.Skipf("cache intermediate symlink unavailable: %v", err)
			}
			second, err := BeginVite(context.Background(), s.workspace, consumer)
			if err != nil {
				t.Fatalf("live cache content was read during admission: %v", err)
			}
			if err = first.Finish(context.Background()); err != nil {
				t.Fatalf("stopped writer traversed another live writer's incomplete payload: %v", err)
			}
			if err = Validate(context.Background(), s.workspace); err == nil {
				t.Fatal("remaining writer lifetime was lost")
			}
			if err = second.Finish(context.Background()); err == nil {
				t.Fatal("last stopped writer skipped final payload validation")
			}
			if err = os.Remove(payload); err != nil {
				t.Fatal(err)
			}
			writeOutput(t, payload, "completed cache output")
			if err = second.Finish(context.Background()); err != nil {
				t.Fatal(err)
			}
			if err = Validate(context.Background(), s.workspace); err != nil {
				t.Fatalf("stopped token stranded after last actual writer: %v", err)
			}
			if err = Restore(context.Background(), s.workspace); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSharedCacheStillRejectsReplacedRootWhileOtherWriterIsLive(t *testing.T) {
	s, consumer, first, cache := liveCacheFixture(t)
	second, err := BeginVite(context.Background(), s.workspace, consumer)
	if err != nil {
		t.Fatal(err)
	}
	moved := cache + "-retained-owned"
	if err = os.Rename(cache, moved); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(cache, 0700); err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(cache, "foreign")
	writeOutput(t, foreign, "preserve foreign root")
	if err = first.Finish(context.Background()); err == nil {
		t.Fatal("shared finish accepted replaced cache root")
	}
	if _, err = BeginVite(context.Background(), s.workspace, consumer); err == nil {
		t.Fatal("shared admission accepted replaced cache root")
	}
	raw, err := os.ReadFile(foreign)
	if err != nil || string(raw) != "preserve foreign root" {
		t.Fatalf("foreign cache data changed: %v", err)
	}
	// Restore the fixture's original exact directory identity, not an adopted hash.
	if err = os.Remove(foreign); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(cache); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(moved, cache); err != nil {
		t.Fatal(err)
	}
	if err = first.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = second.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = Validate(context.Background(), s.workspace); err != nil {
		t.Fatal(err)
	}
}
