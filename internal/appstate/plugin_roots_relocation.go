package appstate

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Windows refuses to rename or remove a directory that has anything open beneath
// it, whatever share mode the handle was opened with: a root held on a plugin's
// store directory stops the plugin manager from staging the plugin directory for
// an uninstall, from replacing it with an update, and from deleting what is left.
// Go cannot open a root that allows it (os.OpenRoot opens without
// FILE_SHARE_DELETE, and a root opened through another root, which does allow it,
// is still beneath the directory that moves).
//
// So the service lets go of a cached root for exactly as long as the plugins root
// moves or removes a directory above it, and the cure is the same on every OS:
//
//   - A move closes the roots beneath the directory, runs, and opens each one again
//     where its directory went, if it is the directory the root was open on. The
//     *ScopedRoot a holder has stays the same, so a long-lived holder, such as the
//     authority resolver, is never left with a root that went away. A move that
//     fails opens them where they were.
//   - A removal closes the roots beneath the directory for good. The service keeps
//     answering lookups with them until the plugin manager releases the plugin
//     (ReleasePluginRoots), and every use of one fails with os.ErrClosed.
//
// A lookup, and an operation on a root, that arrives while a move is in progress
// waits for it: the service holds its mutex across the move, and a moving root is
// write-locked. So nothing opens a handle that would block the move, and nothing
// creates a directory in its way.

// heldRoot is a cached root beneath a directory that is about to move or go.
type heldRoot struct {
	id   string
	kind string // "store" or "data"
	root *ScopedRoot
	// under is the root's directory relative to the directory that moves: empty
	// when it is the directory itself.
	under string
	// identity is the root's directory before the move, to recognize it after.
	identity os.FileInfo
}

// relocate implements relocator.
func (s *Service) relocate(oldname, newname string, move func() error) error {
	s.pluginRootsMu.Lock()
	defer s.pluginRootsMu.Unlock()

	held := s.heldBeneath(oldname)
	for i := range held {
		// Waits for the operations in flight, and holds new ones back until the move is over.
		held[i].root.mu.Lock()
	}
	defer func() {
		for i := range held {
			held[i].root.mu.Unlock()
		}
	}()
	for i := range held {
		held[i].identity, _ = held[i].root.root.Stat(".")
		_ = held[i].root.root.Close()
	}

	err := move()

	moved := err == nil
	for i := range held {
		where := filepath.Join(filepath.FromSlash(oldname), held[i].under)
		if moved {
			where = filepath.Join(filepath.FromSlash(newname), held[i].under)
		}
		s.reopenLocked(held[i], filepath.Join(s.plugins.path, where))
	}
	return err
}

// reopenLocked opens the root again at path and keeps it only if path is the
// directory it was open on. A root whose directory is not there, or is another
// directory, is not re-pointed at whatever is found: it stays closed, and is
// forgotten like a released one. The caller holds pluginRootsMu and the root's
// write lock.
func (s *Service) reopenLocked(held heldRoot, path string) {
	if held.identity != nil {
		if reopened, err := os.OpenRoot(path); err == nil {
			if now, statErr := reopened.Stat("."); statErr == nil && os.SameFile(held.identity, now) {
				held.root.root, held.root.path = reopened, path
				return
			}
			_ = reopened.Close()
		}
	}
	s.forgetLocked(held)
}

// remove implements relocator. It only closes the handles: whether a plugin's
// roots are forgotten is the plugin manager's call, made with ReleasePluginRoots
// once the uninstall is durable. Until then a lookup answers with the closed root,
// which fails every use with os.ErrClosed rather than writing into a directory
// that is going away.
func (s *Service) remove(name string, remove func() error) error {
	s.pluginRootsMu.Lock()
	for _, held := range s.heldBeneath(name) {
		held.root.mu.Lock()
		_ = held.root.root.Close()
		held.root.mu.Unlock()
	}
	s.pluginRootsMu.Unlock()

	return remove()
}

// forgetLocked drops a root that is closed for good from the cache and remembers
// the plugin as released, so that no lookup creates directories for it until its
// plugin directory exists again. The caller holds pluginRootsMu.
func (s *Service) forgetLocked(held heldRoot) {
	roots := s.pluginStoreRoots
	if held.kind == "data" {
		roots = s.pluginDataRoots
	}
	if roots[held.id] == held.root {
		delete(roots, held.id)
	}
	s.released[held.id] = struct{}{}
}

// heldBeneath returns the cached roots whose directory is name or is beneath it.
// name is relative to the plugins directory. The caller holds pluginRootsMu,
// which is also held whenever a root's path changes.
func (s *Service) heldBeneath(name string) []heldRoot {
	dir := filepath.Clean(filepath.FromSlash(name))
	var held []heldRoot
	collect := func(kind string, roots map[string]*ScopedRoot) {
		for id, root := range roots {
			relative, err := filepath.Rel(s.plugins.path, root.path)
			if err != nil {
				continue
			}
			if under, ok := beneath(relative, dir); ok {
				held = append(held, heldRoot{id: id, kind: kind, root: root, under: under, identity: nil})
			}
		}
	}
	collect("store", s.pluginStoreRoots)
	collect("data", s.pluginDataRoots)
	return held
}

// beneath reports whether path is dir or lies beneath it, and where beneath it:
// empty for dir itself. Windows compares names without regard to case.
func beneath(path, dir string) (string, bool) {
	if dir == "." {
		return path, true
	}
	if len(path) < len(dir) || !samePath(path[:len(dir)], dir) {
		return "", false
	}
	rest := path[len(dir):]
	if rest == "" {
		return "", true
	}
	if rest[0] != filepath.Separator {
		return "", false
	}
	return rest[1:], true
}

func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}
