package linkresolve

import (
	"context"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"
)

const (
	defaultBudget      = 400 * time.Millisecond
	defaultMaxOps      = 256
	defaultMaxInFlight = 16
	defaultScanEntries = 2000
	defaultScanDepth   = 4
	defaultCacheTTL    = 10 * time.Second
	defaultCacheSize   = 256
	// maxLinks is how many links one path may run through before it is a loop (Linux allows 40).
	maxLinks = 40
	// scanBatch is the most entries one directory read of the scan asks for.
	scanBatch = 512
)

// Resolver resolves links. It is safe for concurrent use.
type Resolver struct {
	fs          FS
	budget      time.Duration
	maxOps      int
	scanEntries int
	scanDepth   int
	// slots holds one token for each file system operation that is running, whether or not a call still waits for it: an operation stuck on a
	// hung mount keeps its token (and its goroutine, which the system will not let go of) until the system returns it, and when they are all
	// taken a call answers timeout at once, so a hung mount costs a bounded number of goroutines and no more.
	slots chan struct{}
	cache *cache
}

// New makes a resolver.
func New(cfg Config) *Resolver {
	files := cfg.FS
	if files == nil {
		files = OSFS{}
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Resolver{
		fs: files, budget: orDefault(cfg.Budget, defaultBudget), maxOps: orDefault(cfg.MaxOps, defaultMaxOps),
		scanEntries: orDefault(cfg.ScanEntries, defaultScanEntries), scanDepth: orDefault(cfg.ScanDepth, defaultScanDepth),
		slots: make(chan struct{}, orDefault(cfg.MaxInFlight, defaultMaxInFlight)),
		cache: newCache(orDefault(cfg.CacheSize, defaultCacheSize), orDefault(cfg.CacheTTL, defaultCacheTTL), now),
	}
}

// NewDefault makes a resolver with every bound at its default.
func NewDefault() *Resolver {
	return New(Config{FS: nil, Budget: 0, MaxOps: 0, MaxInFlight: 0, ScanEntries: 0, ScanDepth: 0, CacheTTL: 0, CacheSize: 0, Now: nil})
}

func orDefault[T int | time.Duration](v, d T) T {
	if v <= 0 {
		return d
	}
	return v
}

// InFlight is how many file system operations are running now, stuck ones included.
func (r *Resolver) InFlight() int { return len(r.slots) }

// CacheLen is how many answers the cache holds.
func (r *Resolver) CacheLen() int { return r.cache.len() }

// OSFS is the host's file system.
type OSFS struct{}

// Lstat is os.Lstat.
func (OSFS) Lstat(p string) (fs.FileInfo, error) { return os.Lstat(p) }

// Readlink is os.Readlink.
func (OSFS) Readlink(p string) (string, error) { return os.Readlink(p) }

// ReadDir reads at most n entries of a directory it opens, which the caller knows to be a directory (it was an entry's type or an lstat).
func (OSFS) ReadDir(p string, n int) ([]fs.DirEntry, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	return f.ReadDir(n)
}

// Resolve says what the text names, looked for in the row's directory, then in the roots, then by a bounded scan for a file whose path ends
// with the text. The answer is Kind file or dir with the real path, or unknown with a Reason.
//
// Policies, each tested:
//   - A path is answered only when, with every link followed, it is inside the row's directory or a root: a link out of them, an absolute path
//     outside them and a `..` that climbs above them are all ReasonOutside.
//   - /dev, /proc and /sys are never looked at, as a path, as a directory to resolve in, or as the target of a link.
//   - A pipe, a socket or a device is ReasonSpecial, found by lstat and never opened. A loop of links is ReasonLoop.
//   - `..` is taken lexically (as VS Code does), and what the links then lead to is checked.
//   - A name is looked for as printed, then in the other Unicode normal form (NFC, NFD): the answer is the spelling the disk has.
//   - A leading `a/` or `b/` (a git diff's) is tried as a prefix to strip when the text as printed names nothing.
//   - The scan answers only when exactly one file matches; two are ReasonAmbiguous (a wrong file is worse than none).
//   - An empty Dir is ReasonNoDirectory, never the home directory or the process's own.
func (r *Resolver) Resolve(in Input) Result {
	t, reason := parse(in.Text)
	if reason != "" {
		return unknown(reason)
	}
	if in.Dir == "" || !filepath.IsAbs(in.Dir) {
		return unknown(ReasonNoDirectory)
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.budget)
	defer cancel()
	c := newCall(ctx, r)

	key := in.Dir + "\x00" + strings.Join(in.Roots, "\x00") + "\x00" + in.Text
	if cached, ok := r.cache.get(key); ok {
		switch c.stillThere(cached) {
		case stillThere:
			return cached
		case timedOut:
			return unknown(ReasonTimeout)
		case gone:
			r.cache.drop(key)
			return unknown(ReasonGone)
		case changed:
			r.cache.drop(key)
		}
	}

	out := c.resolve(in, t)
	if out.Kind != KindUnknown {
		r.cache.put(key, out)
	}
	return out
}

// unknown is the answer of no link.
func unknown(reason Reason) Result {
	return Result{Kind: KindUnknown, Path: "", Line: 0, Col: 0, Reason: reason}
}

// hit is the answer of a file or a directory.
func hit(kind Kind, p string) Result { return Result{Kind: kind, Path: p, Line: 0, Col: 0, Reason: ""} }

// call is the state of one Resolve: its deadline, its operations counted, and what it has already asked the file system.
type call struct {
	r       *Resolver
	ctx     context.Context
	ops     int
	lstats  map[string]lstatMemo
	links   map[string]string
	scanned int
	stuck   bool
}

func newCall(ctx context.Context, r *Resolver) *call {
	return &call{r: r, ctx: ctx, ops: 0, lstats: map[string]lstatMemo{}, links: map[string]string{}, scanned: 0, stuck: false}
}

type lstatMemo struct {
	info fs.FileInfo
	err  error
}

// outcome is what a guarded operation gave: its value and error, and whether the call waited for it.
type outcome[T any] struct {
	v    T
	err  error
	done bool
}

// guarded runs one file system operation under the call's deadline and operation count, in a goroutine that holds a slot until the operation
// returns. It is not done when the call may not wait for it: the deadline passed, the call used its operations, or every slot is taken.
func guarded[T any](c *call, op func() (T, error)) outcome[T] {
	var none outcome[T]
	if c.stuck || c.ops >= c.r.maxOps {
		c.stuck = true
		return none
	}
	select {
	case <-c.ctx.Done():
		c.stuck = true
		return none
	case c.r.slots <- struct{}{}:
	default:
		c.stuck = true
		return none
	}
	c.ops++
	answer := make(chan outcome[T], 1)
	go func() {
		v, err := op()
		<-c.r.slots
		answer <- outcome[T]{v: v, err: err, done: true}
	}()
	select {
	case got := <-answer:
		return got
	case <-c.ctx.Done():
		c.stuck = true
		return none
	}
}

// lstat is os.Lstat through the guard, asked once for a path in one call. The reason is empty when the path exists.
func (c *call) lstat(p string) (fs.FileInfo, Reason) {
	m, ok := c.lstats[p]
	if !ok {
		got := guarded(c, func() (fs.FileInfo, error) { return c.r.fs.Lstat(p) })
		if !got.done {
			return nil, ReasonTimeout
		}
		m = lstatMemo{info: got.v, err: got.err}
		c.lstats[p] = m
	}
	if m.err != nil {
		return nil, ReasonNotFound
	}
	return m.info, ""
}

func (c *call) readlink(p string) (string, Reason) {
	if t, ok := c.links[p]; ok {
		return t, ""
	}
	got := guarded(c, func() (string, error) { return c.r.fs.Readlink(p) })
	switch {
	case !got.done:
		return "", ReasonTimeout
	case got.err != nil:
		return "", ReasonNotFound
	}
	c.links[p] = got.v
	return got.v, ""
}

// denied is whether a path is one that is never looked at.
func denied(p string) bool {
	for _, root := range [...]string{"/dev", "/proc", "/sys"} {
		if p == root || strings.HasPrefix(p, root+"/") {
			return true
		}
	}
	return false
}

// real follows every link of an absolute, cleaned path, one component at a time with lstat and readlink, so that nothing is looked at that
// was not named: a link into /dev is read, and /dev is not looked at. It answers the real path and what lstat said of it.
func (c *call) real(p string) (string, fs.FileInfo, Reason) {
	if denied(p) {
		return "", nil, ReasonDenied
	}
	queue := strings.Split(p, "/")
	resolved, links := "/", 0
	var info fs.FileInfo
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		switch name {
		case "", ".":
			continue
		case "..":
			resolved, info = path.Dir(resolved), nil
			continue
		}
		next := path.Join(resolved, name)
		if denied(next) {
			return "", nil, ReasonDenied
		}
		fi, reason := c.lstat(next)
		if reason != "" {
			return "", nil, reason
		}
		if fi.Mode()&fs.ModeSymlink == 0 {
			resolved, info = next, fi
			continue
		}
		if links++; links > maxLinks {
			return "", nil, ReasonLoop
		}
		target, reason := c.readlink(next)
		if reason != "" {
			return "", nil, reason
		}
		if strings.HasPrefix(target, "/") {
			resolved = "/"
		}
		queue = append(strings.Split(target, "/"), queue...)
	}
	if info == nil {
		var reason Reason
		if info, reason = c.lstat(resolved); reason != "" {
			return "", nil, reason
		}
	}
	return resolved, info, ""
}

// bases are the directories a path is resolved in and may lie in: the real path of the row's directory first, then those of the roots. A root
// that is not a directory here is left out; a row directory that is not one, or is in /dev, /proc or /sys, is the answer.
func (c *call) bases(in Input) ([]string, Reason) {
	var out []string
	for i, dir := range append([]string{in.Dir}, in.Roots...) {
		if !filepath.IsAbs(dir) {
			continue
		}
		resolved, info, reason := c.real(filepath.Clean(dir))
		if reason == ReasonTimeout || (reason == ReasonDenied && i == 0) {
			return nil, reason
		}
		if reason != "" || !info.IsDir() {
			if i == 0 {
				return nil, ReasonNoDirectory
			}
			continue
		}
		out = append(out, resolved)
	}
	return out, ""
}

// worse is the answer to keep of two misses: the first that is not a plain not-found.
func worse(kept, got Result) Result {
	if kept.Reason == ReasonNotFound {
		return got
	}
	return kept
}

func (c *call) resolve(in Input, t target) Result {
	bases, reason := c.bases(in)
	if reason != "" {
		return unknown(reason)
	}
	cleaned := path.Clean(filepath.ToSlash(t.path))
	miss := unknown(ReasonNotFound)
	for _, name := range names(cleaned) {
		for _, lex := range joined(name, bases) {
			got := c.attempt(lex, bases)
			if got.Kind != KindUnknown {
				return at(got, t)
			}
			if got.Reason == ReasonTimeout {
				return got
			}
			miss = worse(miss, got)
		}
	}
	if miss.Reason == ReasonNotFound && scannable(cleaned) {
		if got := c.scan(bases, cleaned); got.Kind != KindUnknown {
			return at(got, t)
		} else if got.Reason != ReasonNotFound {
			miss = got
		}
	}
	if c.stuck {
		return unknown(ReasonTimeout)
	}
	return miss
}

// at puts the position of the text on an answer.
func at(res Result, t target) Result {
	res.Line, res.Col = t.line, t.col
	return res
}

// scannable is whether a cleaned text may be looked for by its suffix: a relative name that climbs nowhere.
func scannable(cleaned string) bool {
	return !path.IsAbs(cleaned) && cleaned != "." && cleaned != ".." && !strings.HasPrefix(cleaned, "../")
}

// names are the names to look for, in order: the text as printed, then without a leading `a/` or `b/` (a git diff's), each in the spellings a disk may have.
func names(cleaned string) []string {
	var out []string
	for _, name := range []string{cleaned, stripDiffPrefix(cleaned)} {
		if name == "" {
			continue
		}
		for _, spelled := range spellings(name) {
			if !slices.Contains(out, spelled) {
				out = append(out, spelled)
			}
		}
	}
	return out
}

func stripDiffPrefix(name string) string {
	if strings.HasPrefix(name, "a/") || strings.HasPrefix(name, "b/") {
		return name[2:]
	}
	return ""
}

// joined are the absolute paths a name may be: itself when it is absolute, else it under each base, the row's directory first.
func joined(name string, bases []string) []string {
	if path.IsAbs(name) {
		return []string{name}
	}
	out := make([]string, 0, len(bases))
	for _, base := range bases {
		out = append(out, path.Join(base, name))
	}
	return out
}

// spellings are the names a text may be spelled as on a disk: as printed, then the other normal forms.
func spellings(name string) []string {
	out := []string{name}
	for _, form := range [...]norm.Form{norm.NFC, norm.NFD} {
		if alt := form.String(name); !slices.Contains(out, alt) {
			out = append(out, alt)
		}
	}
	return out
}

// attempt looks for one absolute, lexically cleaned path: its real path must lie in a base, and be a file or a directory.
func (c *call) attempt(lex string, bases []string) Result {
	resolved, info, reason := c.real(lex)
	switch {
	case reason != "":
		return unknown(reason)
	case !within(resolved, bases):
		return unknown(ReasonOutside)
	case info.Mode().IsRegular():
		return hit(KindFile, resolved)
	case info.IsDir():
		return hit(KindDir, resolved)
	}
	return unknown(ReasonSpecial)
}

func within(p string, bases []string) bool {
	for _, base := range bases {
		if p == base || strings.HasPrefix(p, strings.TrimSuffix(base, "/")+"/") {
			return true
		}
	}
	return false
}

// scanState is the suffix scan in progress: the one match so far.
type scanState struct {
	suffix string
	match  string
}

type level struct {
	dir   string
	depth int
}

// scan looks for the one file under the bases whose path ends with name, never entering a link, a hidden directory or node_modules, and
// reading at most scanEntries entries to scanDepth directories deep.
func (c *call) scan(bases []string, name string) Result {
	st := &scanState{suffix: "/" + name, match: ""}
	for _, base := range bases {
		queue := []level{{dir: base, depth: 0}}
		for len(queue) > 0 && c.r.scanEntries-c.scanned > 0 {
			at := queue[0]
			queue = queue[1:]
			next, miss := c.scanDir(st, at)
			if miss != "" {
				return unknown(miss)
			}
			queue = append(queue, next...)
		}
	}
	if st.match == "" {
		return unknown(ReasonNotFound)
	}
	return c.attempt(st.match, bases)
}

// scanDir reads one directory of the scan: it notes a match, and answers the directories to read next. The reason is set when the scan ends.
func (c *call) scanDir(st *scanState, at level) ([]level, Reason) {
	n := min(c.r.scanEntries-c.scanned, scanBatch)
	got := guarded(c, func() ([]fs.DirEntry, error) { return c.r.fs.ReadDir(at.dir, n) })
	if !got.done {
		return nil, ReasonTimeout
	}
	if got.err != nil {
		return nil, ""
	}
	entries := got.v
	c.scanned += len(entries)
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	var next []level
	for _, e := range entries {
		full := path.Join(at.dir, e.Name())
		typ := e.Type()
		if (typ.IsRegular() || typ.IsDir()) && strings.HasSuffix(full, st.suffix) && full != st.match {
			if st.match != "" {
				return nil, ReasonAmbiguous
			}
			st.match = full
		}
		if typ.IsDir() && at.depth < c.r.scanDepth && !skipped(e.Name()) && !denied(full) {
			next = append(next, level{dir: full, depth: at.depth + 1})
		}
	}
	return next, ""
}

// skipped is whether the scan leaves a directory unread: hidden ones and node_modules.
func skipped(name string) bool { return strings.HasPrefix(name, ".") || name == "node_modules" }

type recheck int

const (
	stillThere recheck = iota
	gone
	changed
	timedOut
)

// stillThere asks the file system once whether an answer from the cache is still true: the file may have been deleted since.
func (c *call) stillThere(res Result) recheck {
	info, reason := c.lstat(res.Path)
	switch {
	case reason == ReasonTimeout:
		return timedOut
	case reason != "":
		return gone
	case res.Kind == KindFile && info.Mode().IsRegular(), res.Kind == KindDir && info.IsDir():
		return stillThere
	}
	return changed
}
