//go:build unix

package linkresolve_test

import (
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/linkresolve"
)

func found(root, rel string, line, col int) linkresolve.Result {
	return linkresolve.Result{Kind: linkresolve.KindFile, Path: filepath.Join(root, rel), Line: line, Col: col}
}

func unknown(reason linkresolve.Reason) linkresolve.Result {
	return linkresolve.Result{Kind: linkresolve.KindUnknown, Reason: reason}
}

func TestAFileThatExistsIsALinkAndOneThatDoesNotIsNone(t *testing.T) {
	root := tree(t, "src/a.go", "docs/")
	r, _ := resolver(t, linkresolve.Config{})
	// the control: the file is there
	assert.Equal(t, found(root, "src/a.go", 12, 3), r.Resolve(linkresolve.Input{Dir: root, Text: "src/a.go:12:3"}))
	// the same text, the file is not
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(linkresolve.Input{Dir: root, Text: "src/b.go:12:3"}))
	// a directory is a link of kind dir
	assert.Equal(t, linkresolve.Result{Kind: linkresolve.KindDir, Path: filepath.Join(root, "docs")}, r.Resolve(linkresolve.Input{Dir: root, Text: "docs"}))
}

func TestTheLinkResolvesAgainstTheDirectoryOfTheRowAndNotAnother(t *testing.T) {
	a := tree(t, "src/a.go")
	b := tree(t, "other/")
	r, _ := resolver(t, linkresolve.Config{})
	assert.Equal(t, found(a, "src/a.go", 1, 0), r.Resolve(linkresolve.Input{Dir: a, Text: "src/a.go:1"}), "the control: the right directory")
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(linkresolve.Input{Dir: b, Text: "src/a.go:1"}), "the wrong directory")
}

func TestAnUnknownDirectoryIsNotHome(t *testing.T) {
	home := tree(t, "src/a.go")
	t.Setenv("HOME", home)
	t.Chdir(home)
	r, seen := resolver(t, linkresolve.Config{})
	assert.Equal(t, unknown(linkresolve.ReasonNoDirectory), r.Resolve(linkresolve.Input{Text: "src/a.go:1"}))
	assert.Zero(t, seen.count(), "nothing was looked at")
	// the control: the same text with the directory
	assert.Equal(t, found(home, "src/a.go", 1, 0), r.Resolve(linkresolve.Input{Dir: home, Text: "src/a.go:1"}))
}

func TestTheRowDirectoryComesFirstAndTheRootsAfterIt(t *testing.T) {
	row := tree(t, "both.go", "only-row.go")
	root := tree(t, "both.go", "only-root.go")
	r, _ := resolver(t, linkresolve.Config{})
	in := func(text string) linkresolve.Input {
		return linkresolve.Input{Dir: row, Roots: []string{root}, Text: text}
	}
	assert.Equal(t, found(row, "both.go", 0, 0), r.Resolve(in("both.go")), "the row's directory first")
	assert.Equal(t, found(root, "only-root.go", 0, 0), r.Resolve(in("only-root.go")), "then the roots")
	assert.Equal(t, found(row, "only-row.go", 0, 0), r.Resolve(in("only-row.go")))
	// roots alone are not a directory of the row: no row directory, no answer
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(linkresolve.Input{Dir: row, Roots: []string{root}, Text: "nowhere.go"}))
}

func TestNothingUnderDevProcOrSysIsEverLookedAt(t *testing.T) {
	ws := tree(t, "ok.go")
	require.NoError(t, os.Symlink("/dev", filepath.Join(ws, "dev-link")))
	require.NoError(t, os.Symlink("/proc/self", filepath.Join(ws, "proc-link")))
	r, seen := resolver(t, linkresolve.Config{})
	for _, text := range []string{"/dev/null", "/dev/tty:1", "/proc/self/cwd", "/sys/kernel/", "dev-link/null", "proc-link/cwd", "../../../../../dev/null", "/dev/../dev/zero"} {
		got := r.Resolve(linkresolve.Input{Dir: ws, Roots: []string{"/dev"}, Text: text})
		assert.Equal(t, linkresolve.KindUnknown, got.Kind, text)
	}
	for _, dir := range []string{"/dev", "/proc/self", "/sys"} {
		assert.Equal(t, linkresolve.KindUnknown, r.Resolve(linkresolve.Input{Dir: dir, Text: "null"}).Kind, dir)
	}
	// the symlink to /dev is not looked at beyond itself, and /dev, /proc and /sys are never looked at
	p, bad := seen.touched("/dev", "/proc", "/sys")
	assert.False(t, bad, "looked at %s", p)
	// the control: the recorder sees what is looked at, and a file of the workspace links
	assert.Equal(t, found(ws, "ok.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "ok.go"}))
	assert.NotEmpty(t, seen.paths())
	assert.True(t, func() bool { _, ok := seen.touched(ws); return ok }())
}

func TestALinkOutOfTheDirectoriesIsRefusedAndOneInsideIsFollowed(t *testing.T) {
	ws := tree(t, "real.txt", "sub/inner.go")
	outside := tree(t, "secret.txt", "dir/x.go")
	require.NoError(t, os.Symlink(filepath.Join(ws, "real.txt"), filepath.Join(ws, "inside-link")))
	require.NoError(t, os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(ws, "out-link")))
	require.NoError(t, os.Symlink(filepath.Join(outside, "dir"), filepath.Join(ws, "out-dir")))
	require.NoError(t, os.Symlink("sub", filepath.Join(ws, "rel-dir")))
	r, _ := resolver(t, linkresolve.Config{})
	in := func(text string) linkresolve.Input { return linkresolve.Input{Dir: ws, Text: text} }
	assert.Equal(t, found(ws, "real.txt", 0, 0), r.Resolve(in("inside-link")), "the control: a link inside is followed, and the answer is the real path")
	assert.Equal(t, found(ws, "sub/inner.go", 2, 0), r.Resolve(in("rel-dir/inner.go:2")))
	assert.Equal(t, unknown(linkresolve.ReasonOutside), r.Resolve(in("out-link")))
	assert.Equal(t, unknown(linkresolve.ReasonOutside), r.Resolve(in("out-dir/x.go:3")))
	assert.Equal(t, unknown(linkresolve.ReasonOutside), r.Resolve(in(filepath.Join(outside, "secret.txt"))), "an absolute path outside")
	assert.Equal(t, found(ws, "real.txt", 0, 0), r.Resolve(in(filepath.Join(ws, "real.txt"))), "the control: an absolute path inside")
	// the roots are directories it may resolve in: the same link is fine when its target's directory is a root
	assert.Equal(t, linkresolve.KindFile, r.Resolve(linkresolve.Input{Dir: ws, Roots: []string{outside}, Text: "out-link"}).Kind)
}

func TestDotDotStaysInsideTheDirectories(t *testing.T) {
	parent := tree(t, "top.go", "ws/sub/")
	ws := filepath.Join(parent, "ws")
	require.NoError(t, os.WriteFile(filepath.Join(ws, "ws.go"), []byte("x"), 0o600))
	sub := filepath.Join(ws, "sub")
	r, _ := resolver(t, linkresolve.Config{})
	assert.Equal(t, found(ws, "ws.go", 0, 0), r.Resolve(linkresolve.Input{Dir: sub, Roots: []string{ws}, Text: "../ws.go"}), "the control: up to a root")
	assert.Equal(t, unknown(linkresolve.ReasonOutside), r.Resolve(linkresolve.Input{Dir: ws, Roots: []string{ws}, Text: "../top.go"}), "above every root")
	assert.Equal(t, unknown(linkresolve.ReasonOutside), r.Resolve(linkresolve.Input{Dir: sub, Roots: []string{ws}, Text: "../../top.go"}))
	assert.Equal(t, unknown(linkresolve.ReasonOutside), r.Resolve(linkresolve.Input{Dir: ws, Text: "sub/../../top.go"}))
}

func TestALoopOfLinksIsATypedAnswerAndNotAHang(t *testing.T) {
	ws := tree(t, "fine.go")
	require.NoError(t, os.Symlink("b", filepath.Join(ws, "a")))
	require.NoError(t, os.Symlink("a", filepath.Join(ws, "b")))
	require.NoError(t, os.Symlink(".", filepath.Join(ws, "self")))
	r, _ := resolver(t, linkresolve.Config{})
	assert.Equal(t, unknown(linkresolve.ReasonLoop), within(t, "loop", func() linkresolve.Result { return r.Resolve(linkresolve.Input{Dir: ws, Text: "a/x.go"}) }))
	assert.Equal(t, unknown(linkresolve.ReasonLoop), r.Resolve(linkresolve.Input{Dir: ws, Text: "b"}))
	// a link to its own directory is not a loop: it ends
	assert.Equal(t, found(ws, "fine.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "self/self/self/fine.go"}), "the control")
}

func TestUnicodeSpellingsOfOneNameFindTheFileUnderItsRealSpelling(t *testing.T) {
	nfd := "re\u0301sume\u0301.go"
	nfc := "r\u00e9sum\u00e9.go"
	ws := tree(t, nfd)
	r, _ := resolver(t, linkresolve.Config{})
	assert.Equal(t, found(ws, nfd, 4, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: nfc + ":4"}), "printed composed, on disk decomposed: the real spelling is answered")
	assert.Equal(t, found(ws, nfd, 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: nfd}), "the control: the same spelling")
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(linkresolve.Input{Dir: ws, Text: "r\u00e9sum\u00e9x.go"}))
}

func TestAPipeOrASocketIsNeverOpened(t *testing.T) {
	ws := tree(t, "plain.txt")
	require.NoError(t, syscall.Mkfifo(filepath.Join(ws, "pipe"), 0o600))
	sock, err := net.Listen("unix", filepath.Join(ws, "sock"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = sock.Close() })
	r, seen := resolver(t, linkresolve.Config{})
	for _, name := range []string{"pipe:1", "sock:1"} {
		assert.Equal(t, unknown(linkresolve.ReasonSpecial), within(t, name, func() linkresolve.Result { return r.Resolve(linkresolve.Input{Dir: ws, Text: name}) }), name)
	}
	assert.Equal(t, found(ws, "plain.txt", 1, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "plain.txt:1"}), "the control")
	assert.NotEmpty(t, seen.paths())
}

func TestAFileSystemThatHangsCostsTheBudgetAndNeverMore(t *testing.T) {
	ws := tree(t, "hang/x.go", "fine.go")
	gate := make(chan struct{})
	r, seen := resolver(t, linkresolve.Config{Budget: 50 * time.Millisecond, MaxInFlight: 2})
	seen.hold = func(p string) <-chan struct{} {
		if strings.HasSuffix(p, "hang") {
			return gate
		}
		return nil
	}
	start := time.Now()
	assert.Equal(t, unknown(linkresolve.ReasonTimeout), within(t, "hang", func() linkresolve.Result { return r.Resolve(linkresolve.Input{Dir: ws, Text: "hang/x.go"}) }))
	assert.Less(t, time.Since(start), 5*time.Second)
	assert.Equal(t, 1, r.InFlight(), "the stuck operation is the one in flight")
	assert.Equal(t, found(ws, "fine.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "fine.go"}), "the control: a path that does not hang resolves meanwhile")

	// stuck operations beyond the limit: the next call answers timeout at once, with no new goroutine
	assert.Equal(t, unknown(linkresolve.ReasonTimeout), r.Resolve(linkresolve.Input{Dir: ws, Text: "hang/y.go"}))
	before := runtime.NumGoroutine()
	for i := 0; i < 50; i++ {
		assert.Equal(t, unknown(linkresolve.ReasonTimeout), r.Resolve(linkresolve.Input{Dir: ws, Text: "hang/z" + strconv.Itoa(i)}))
	}
	assert.LessOrEqual(t, runtime.NumGoroutine(), before+1, "stuck calls do not pile up goroutines")
	close(gate)
	assert.Eventually(t, func() bool { return r.InFlight() == 0 }, 10*time.Second, time.Millisecond)
	assert.Equal(t, found(ws, "hang/x.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "hang/x.go"}), "the control: released, it resolves")
}

func TestAFileDeletedAfterTheAnswerIsNoLongerThereWhenAskedAgain(t *testing.T) {
	ws := tree(t, "a.go", "b.go")
	r, seen := resolver(t, linkresolve.Config{})
	in := linkresolve.Input{Dir: ws, Text: "a.go:3"}
	assert.Equal(t, found(ws, "a.go", 3, 0), r.Resolve(in))
	first := seen.count()
	assert.Equal(t, found(ws, "a.go", 3, 0), r.Resolve(in), "the control: still there, from the cache")
	assert.Equal(t, 1, seen.count()-first, "a cache hit asks the file system once, for the file")
	require.NoError(t, os.Remove(filepath.Join(ws, "a.go")))
	assert.Equal(t, unknown(linkresolve.ReasonGone), r.Resolve(in), "deleted: the typed answer")
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(in), "and then it is simply not there")
	assert.Equal(t, found(ws, "b.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "b.go"}))
}

func TestTheCacheExpiresAfterItsTTLAndIsBounded(t *testing.T) {
	names := make([]string, 0, 300)
	for i := 0; i < 300; i++ {
		names = append(names, "f"+strconv.Itoa(i)+".go")
	}
	ws := tree(t, names...)
	now := time.Unix(1_000_000, 0)
	var mu sync.Mutex
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	r, seen := resolver(t, linkresolve.Config{CacheSize: 32, CacheTTL: 10 * time.Second, Now: clock})

	in := linkresolve.Input{Dir: ws, Text: "f0.go"}
	r.Resolve(in)
	first := seen.count()
	r.Resolve(in)
	hit := seen.count() - first
	mu.Lock()
	now = now.Add(11 * time.Second)
	mu.Unlock()
	before := seen.count()
	r.Resolve(in)
	assert.Greater(t, seen.count()-before, hit, "past the TTL the answer is made again, not read from the cache")

	for _, name := range names {
		r.Resolve(linkresolve.Input{Dir: ws, Text: name})
		require.LessOrEqual(t, r.CacheLen(), 32)
	}
	assert.Equal(t, 32, r.CacheLen(), "the cache is full and bounded")
	// misses are not cached: a file made after a miss is found at once
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(linkresolve.Input{Dir: ws, Text: "late.go"}))
	require.NoError(t, os.WriteFile(filepath.Join(ws, "late.go"), []byte("x"), 0o600))
	assert.Equal(t, found(ws, "late.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "late.go"}))
}

func TestTheSuffixScanFindsOneFileAndRefusesTwo(t *testing.T) {
	ws := tree(t, "pkg/deep/only_here.go", "a/dup.go", "b/dup.go", ".hidden/skip.go", "node_modules/m/skip.go")
	r, _ := resolver(t, linkresolve.Config{})
	assert.Equal(t, found(ws, "pkg/deep/only_here.go", 7, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "deep/only_here.go:7"}), "the control: one file ends with the text")
	assert.Equal(t, unknown(linkresolve.ReasonAmbiguous), r.Resolve(linkresolve.Input{Dir: ws, Text: "dup.go"}), "two files: a wrong one is worse than none")
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(linkresolve.Input{Dir: ws, Text: "skip.go"}), "hidden and node_modules are not scanned")
}

func TestTheSuffixScanIsBounded(t *testing.T) {
	var names []string
	for i := 0; i < 60; i++ {
		names = append(names, "d"+strconv.Itoa(i)+"/f.txt")
	}
	names = append(names, "d0/d1/d2/d3/d4/d5/too_deep.go")
	ws := tree(t, names...)
	r, seen := resolver(t, linkresolve.Config{ScanEntries: 40, ScanDepth: 3})
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(linkresolve.Input{Dir: ws, Text: "nothing_like_this.go"}))
	assert.LessOrEqual(t, seen.entries, 40, "entries read")
	assert.Equal(t, unknown(linkresolve.ReasonNotFound), r.Resolve(linkresolve.Input{Dir: ws, Text: "too_deep.go"}), "deeper than the scan goes")
}

func TestTheTextIsRefusedBeforeAnythingIsLookedAt(t *testing.T) {
	ws := tree(t, "ok.go", "http:/localhost/x")
	r, seen := resolver(t, linkresolve.Config{})
	cases := map[string]linkresolve.Reason{
		"a\x1bb.go":                 linkresolve.ReasonInvalid,
		"a\nb.go":                   linkresolve.ReasonInvalid,
		"a\x00b.go":                 linkresolve.ReasonInvalid,
		"\xff\xfe.go":               linkresolve.ReasonInvalid,
		"":                          linkresolve.ReasonInvalid,
		":12":                       linkresolve.ReasonInvalid,
		"http://localhost:8080/x":   linkresolve.ReasonURL,
		"http://localhost":          linkresolve.ReasonURL,
		"file:///etc/passwd":        linkresolve.ReasonURL,
		strings.Repeat("a", 100000): linkresolve.ReasonTooLong,
		strings.Repeat("a/", 600):   linkresolve.ReasonTooLong,
	}
	for text, reason := range cases {
		assert.Equal(t, unknown(reason), r.Resolve(linkresolve.Input{Dir: ws, Text: text}), "%.20q", text)
	}
	assert.Zero(t, seen.count(), "nothing was looked at")
	assert.Equal(t, found(ws, "ok.go", 0, 0), r.Resolve(linkresolve.Input{Dir: ws, Text: "ok.go"}), "the control")
}

func TestTheShapesOfAPathAndItsPosition(t *testing.T) {
	ws := tree(t, "src/main.go", "my dir/file name.rs", "a/b.go", "lib.rb")
	r, _ := resolver(t, linkresolve.Config{})
	table := []struct {
		text      string
		rel       string
		line, col int
	}{
		{"src/main.go", "src/main.go", 0, 0},
		{"src/main.go:42", "src/main.go", 42, 0},
		{"src/main.go:42:7", "src/main.go", 42, 7},
		{"src/main.go:42:7:", "src/main.go", 42, 7},
		{"src/main.go:42.", "src/main.go", 42, 0},
		{"src/main.go(42,7)", "src/main.go", 42, 7},
		{"src/main.go(42)", "src/main.go", 42, 0},
		{"src/main.go#L42", "src/main.go", 42, 0},
		{`"src/main.go", line 42`, "src/main.go", 42, 0},
		{"src/main.go line 42", "src/main.go", 42, 0},
		{"src/main.go:42:in", "src/main.go", 42, 0},
		{"lib.rb:20:in `block'", "lib.rb", 20, 0},
		{"my dir/file name.rs:3:4", "my dir/file name.rs", 3, 4},
		{`"my dir/file name.rs"`, "my dir/file name.rs", 0, 0},
		{"a/src/main.go:5", "src/main.go", 5, 0},
		{"b/src/main.go:5", "src/main.go", 5, 0},
		{"./src/main.go:5", "src/main.go", 5, 0},
		{"src/main.go,", "src/main.go", 0, 0},
		{"(src/main.go:9)", "src/main.go", 9, 0},
	}
	for _, c := range table {
		assert.Equal(t, found(ws, c.rel, c.line, c.col), r.Resolve(linkresolve.Input{Dir: ws, Text: c.text}), c.text)
	}
}

func TestAThousandResolvesLeaveNoGoroutineDescriptorOrCacheGrowth(t *testing.T) {
	names := []string{"deep/er/target.go"}
	for i := 0; i < 50; i++ {
		names = append(names, "f"+strconv.Itoa(i)+".go")
	}
	ws := tree(t, names...)
	r, _ := resolver(t, linkresolve.Config{CacheSize: 16})
	fds := func() int {
		entries, err := os.ReadDir("/proc/self/fd")
		if err != nil {
			return -1
		}
		return len(entries)
	}
	settle := func() int {
		runtime.GC()
		return runtime.NumGoroutine()
	}
	r.Resolve(linkresolve.Input{Dir: ws, Text: "f1.go"})
	goroutines, descriptors := settle(), fds()
	for i := 0; i < 1000; i++ {
		var text string
		switch i % 4 {
		case 0:
			text = "f" + strconv.Itoa(i%50) + ".go:" + strconv.Itoa(i)
		case 1:
			text = "target.go" // the scan
		case 2:
			text = "missing" + strconv.Itoa(i) + ".go"
		default:
			text = "/dev/null"
		}
		r.Resolve(linkresolve.Input{Dir: ws, Text: text})
	}
	assert.Equal(t, 0, r.InFlight())
	assert.LessOrEqual(t, r.CacheLen(), 16)
	deadline := time.Now().Add(3 * time.Second)
	for settle() > goroutines && time.Now().Before(deadline) {
		runtime.Gosched()
	}
	assert.LessOrEqual(t, settle(), goroutines, "goroutines")
	if descriptors >= 0 {
		assert.Equal(t, descriptors, fds(), "descriptors")
	}
}

func BenchmarkTheCacheHitAgainstTheMiss(b *testing.B) {
	root, err := filepath.EvalSymlinks(b.TempDir())
	require.NoError(b, err)
	require.NoError(b, os.MkdirAll(filepath.Join(root, "a", "b", "c"), 0o750))
	require.NoError(b, os.WriteFile(filepath.Join(root, "a", "b", "c", "f.go"), []byte("x"), 0o600))
	in := linkresolve.Input{Dir: root, Text: "a/b/c/f.go:1"}
	b.Run("hit", func(b *testing.B) {
		r := linkresolve.New(linkresolve.Config{})
		r.Resolve(in)
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			r.Resolve(in)
		}
	})
	b.Run("miss", func(b *testing.B) {
		r := linkresolve.New(linkresolve.Config{CacheSize: 1})
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			r.Resolve(linkresolve.Input{Dir: root, Text: "a/b/c/f.go:" + strconv.Itoa(i%2)})
			r.Resolve(linkresolve.Input{Dir: root, Text: "other" + strconv.Itoa(i%2)})
		}
	})
}
