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
	r := &Resolver{fs: cfg.FS, budget: cfg.Budget, maxOps: cfg.MaxOps, scanEntries: cfg.ScanEntries, scanDepth: cfg.ScanDepth}
	if r.fs == nil {
		r.fs = OSFS{}
	}
	r.budget = orDefault(r.budget, defaultBudget)
	r.maxOps = orDefault(r.maxOps, defaultMaxOps)
	r.scanEntries = orDefault(r.scanEntries, defaultScanEntries)
	r.scanDepth = orDefault(r.scanDepth, defaultScanDepth)
	r.slots = make(chan struct{}, orDefault(cfg.MaxInFlight, defaultMaxInFlight))
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	r.cache = newCache(orDefault(cfg.CacheSize, defaultCacheSize), orDefault(cfg.CacheTTL, defaultCacheTTL), now)
	return r
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
	c := &call{r: r, ctx: ctx, lstats: map[string]lstatMemo{}, links: map[string]string{}}

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

func unknown(reason Reason) Result { return Result{Kind: KindUnknown, Reason: reason} }

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

type lstatMemo struct {
	info fs.FileInfo
	err  error
}

// guarded runs one file system operation under the call's deadline and operation count, in a goroutine that holds a slot until the operation
// returns. It reports false when the call may not wait for it: the deadline passed, the call used its operations, or every slot is taken.
func guarded[T any](c *call, op func() (T, error)) (T, error, bool) { //nolint:revive // the value, the error and whether it was waited for
	var zero T
	if c.stuck || c.ctx.Err() != nil || c.ops >= c.r.maxOps {
		c.stuck = true
		return zero, nil, false
	}
	select {
	case c.r.slots <- struct{}{}:
	default:
		c.stuck = true
		return zero, nil, false
	}
	c.ops++
	type answer struct {
		v   T
		err error
	}
	done := make(chan answer, 1)
	go func() {
		v, err := op()
		<-c.r.slots
		done <- answer{v, err}
	}()
	select {
	case a := <-done:
		return a.v, a.err, true
	case <-c.ctx.Done():
		c.stuck = true
		return zero, nil, false
	}
}

func (c *call) lstat(p string) (fs.FileInfo, error, bool) { //nolint:revive // as guarded
	if m, ok := c.lstats[p]; ok {
		return m.info, m.err, true
	}
	info, err, ok := guarded(c, func() (fs.FileInfo, error) { return c.r.fs.Lstat(p) })
	if ok {
		c.lstats[p] = lstatMemo{info, err}
	}
	return info, err, ok
}

func (c *call) readlink(p string) (string, error, bool) { //nolint:revive // as guarded
	if t, ok := c.links[p]; ok {
		return t, nil, true
	}
	t, err, ok := guarded(c, func() (string, error) { return c.r.fs.Readlink(p) })
	if ok && err == nil {
		c.links[p] = t
	}
	return t, err, ok
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
	queue := splitPath(p)
	resolved, links := "/", 0
	var info fs.FileInfo
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		switch name {
		case "", ".":
			continue
		case "..":
			resolved = path.Dir(resolved)
			info = nil
			continue
		}
		next := path.Join(resolved, name)
		if denied(next) {
			return "", nil, ReasonDenied
		}
		fi, err, ok := c.lstat(next)
		if !ok {
			return "", nil, ReasonTimeout
		}
		if err != nil {
			return "", nil, ReasonNotFound
		}
		if fi.Mode()&fs.ModeSymlink == 0 {
			resolved, info = next, fi
			continue
		}
		if links++; links > maxLinks {
			return "", nil, ReasonLoop
		}
		target, err, ok := c.readlink(next)
		if !ok {
			return "", nil, ReasonTimeout
		}
		if err != nil {
			return "", nil, ReasonNotFound
		}
		if strings.HasPrefix(target, "/") {
			resolved = "/"
		}
		queue = append(splitPath(target), queue...)
	}
	if info == nil {
		fi, err, ok := c.lstat(resolved)
		switch {
		case !ok:
			return "", nil, ReasonTimeout
		case err != nil:
			return "", nil, ReasonNotFound
		}
		info = fi
	}
	return resolved, info, ""
}

func splitPath(p string) []string { return strings.Split(p, "/") }

// bases are the directories a path is resolved in and may lie in: the real path of the row's directory first, then those of the roots. A root
// that is not a directory here is left out; a row directory that is not one, or is in /dev, /proc or /sys, is the answer.
func (c *call) bases(in Input) ([]string, Reason) {
	var out []string
	for i, dir := range append([]string{in.Dir}, in.Roots...) {
		if !filepath.IsAbs(dir) {
			continue
		}
		real, info, reason := c.real(filepath.Clean(dir))
		if reason == ReasonTimeout || (reason == ReasonDenied && i == 0) {
			return nil, reason
		}
		if reason != "" || !info.IsDir() {
			if i == 0 {
				return nil, ReasonNoDirectory
			}
			continue
		}
		out = append(out, real)
	}
	return out, ""
}

func (c *call) resolve(in Input, t target) Result {
	bases, reason := c.bases(in)
	if reason != "" {
		return unknown(reason)
	}
	var first Reason = ReasonNotFound
	note := func(got Reason) {
		if first == ReasonNotFound && got != ReasonNotFound {
			first = got
		}
	}
	cleaned := path.Clean(filepath.ToSlash(t.path))
	candidates := []string{cleaned}
	if strings.HasPrefix(cleaned, "a/") || strings.HasPrefix(cleaned, "b/") {
		candidates = append(candidates, cleaned[2:])
	}
	for _, cand := range candidates {
		for _, name := range spellings(cand) {
			tries := []string{name}
			if !path.IsAbs(name) {
				tries = tries[:0]
				for _, base := range bases {
					tries = append(tries, path.Join(base, name))
				}
			}
			for _, lex := range tries {
				res, got := c.attempt(lex, bases)
				if got == ReasonTimeout {
					return unknown(ReasonTimeout)
				}
				if got == "" {
					res.Line, res.Col = t.line, t.col
					return res
				}
				note(got)
			}
		}
	}
	if first == ReasonNotFound && !path.IsAbs(cleaned) && !strings.HasPrefix(cleaned, "../") && cleaned != ".." && cleaned != "." {
		res, got := c.scan(bases, cleaned)
		if got == "" {
			res.Line, res.Col = t.line, t.col
			return res
		}
		note(got)
	}
	if c.stuck {
		return unknown(ReasonTimeout)
	}
	return unknown(first)
}

// spellings are the names a text may be spelled as on a disk: as printed, then the other normal forms.
func spellings(name string) []string {
	out := []string{name}
	for _, form := range [...]norm.Form{norm.NFC, norm.NFD} {
		alt := form.String(name)
		if !slices.Contains(out, alt) {
			out = append(out, alt)
		}
	}
	return out
}

// attempt looks for one absolute, lexically cleaned path: its real path must lie in a base, and be a file or a directory.
func (c *call) attempt(lex string, bases []string) (Result, Reason) {
	real, info, reason := c.real(lex)
	if reason != "" {
		return Result{}, reason
	}
	if !within(real, bases) {
		return Result{}, ReasonOutside
	}
	switch {
	case info.Mode().IsRegular():
		return Result{Kind: KindFile, Path: real}, ""
	case info.IsDir():
		return Result{Kind: KindDir, Path: real}, ""
	}
	return Result{}, ReasonSpecial
}

func within(p string, bases []string) bool {
	for _, base := range bases {
		if p == base || strings.HasPrefix(p, strings.TrimSuffix(base, "/")+"/") {
			return true
		}
	}
	return false
}

// scan looks for the one file under the bases whose path ends with name, never entering a link, a hidden directory or node_modules, and
// reading at most scanEntries entries to scanDepth directories deep.
func (c *call) scan(bases []string, name string) (Result, Reason) {
	suffix := "/" + name
	var match string
	type level struct {
		dir   string
		depth int
	}
	for _, base := range bases {
		queue := []level{{base, 0}}
		for len(queue) > 0 {
			at := queue[0]
			queue = queue[1:]
			left := c.r.scanEntries - c.scanned
			if left <= 0 {
				break
			}
			entries, err, ok := guarded(c, func() ([]fs.DirEntry, error) { return c.r.fs.ReadDir(at.dir, min(left, scanBatch)) })
			if !ok {
				return Result{}, ReasonTimeout
			}
			if err != nil {
				continue
			}
			c.scanned += len(entries)
			sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
			for _, e := range entries {
				full := path.Join(at.dir, e.Name())
				typ := e.Type()
				if (typ.IsRegular() || typ.IsDir()) && strings.HasSuffix(full, suffix) && full != match {
					if match != "" {
						return Result{}, ReasonAmbiguous
					}
					match = full
				}
				if typ.IsDir() && at.depth < c.r.scanDepth && !strings.HasPrefix(e.Name(), ".") && e.Name() != "node_modules" && !denied(full) {
					queue = append(queue, level{full, at.depth + 1})
				}
			}
		}
	}
	if match == "" {
		return Result{}, ReasonNotFound
	}
	return c.attempt(match, bases)
}

type recheck int

const (
	stillThere recheck = iota
	gone
	changed
	timedOut
)

// stillThere asks the file system once whether an answer from the cache is still true: the file may have been deleted since.
func (c *call) stillThere(res Result) recheck {
	info, err, ok := c.lstat(res.Path)
	switch {
	case !ok:
		return timedOut
	case err != nil:
		return gone
	case res.Kind == KindFile && info.Mode().IsRegular(), res.Kind == KindDir && info.IsDir():
		return stillThere
	}
	return changed
}
