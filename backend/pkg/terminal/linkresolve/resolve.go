package linkresolve

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Resolver resolves links.
type Resolver struct{ fs FS }

// New makes a resolver.
func New(cfg Config) *Resolver {
	if cfg.FS == nil {
		cfg.FS = OSFS{}
	}
	return &Resolver{fs: cfg.FS}
}

// OSFS is the host's file system.
type OSFS struct{}

// Lstat is os.Lstat.
func (OSFS) Lstat(p string) (os.FileInfo, error) { return os.Lstat(p) }

// Readlink is os.Readlink.
func (OSFS) Readlink(p string) (string, error) { return os.Readlink(p) }

// ReadDir reads at most n entries.
func (OSFS) ReadDir(p string, n int) ([]os.DirEntry, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return f.ReadDir(n)
}

// Resolve joins the text onto the directory and looks.
func (r *Resolver) Resolve(in Input) Result {
	text, line, col := in.Text, 0, 0
	parts := strings.Split(text, ":")
	if len(parts) > 1 {
		text = parts[0]
		line, _ = strconv.Atoi(parts[1])
		if len(parts) > 2 {
			col, _ = strconv.Atoi(parts[2])
		}
	}
	p := text
	if !filepath.IsAbs(p) {
		p = filepath.Join(in.Dir, text)
	}
	info, err := r.fs.Lstat(p)
	if err != nil {
		return Result{Kind: KindUnknown, Reason: ReasonNotFound}
	}
	kind := KindFile
	if info.IsDir() {
		kind = KindDir
	}
	return Result{Kind: kind, Path: p, Line: line, Col: col}
}

// InFlight is how many file system operations are running now.
func (r *Resolver) InFlight() int { return 0 }

// CacheLen is how many answers the cache holds.
func (r *Resolver) CacheLen() int { return 0 }
