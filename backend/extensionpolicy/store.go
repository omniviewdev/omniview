package extensionpolicy

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/omniviewdev/omniview/internal/devsession"
)

const (
	Event     = "ui-extensions:policy-invalidated"
	directory = "ui-extensions"
	filename  = "policy.v1.json"
)

var errUnsafe = errors.New("extension policy: private watched profile storage unavailable")

type role int

const (
	profileDirectory role = iota
	policyDirectory
	policyFile
)

// stamp binds validation to an open object, not just a pathname or mtime. A
// change to the same accepted file is not an atomic replacement.
type stamp struct {
	info    os.FileInfo
	changed int64 // kernel change time, including permission changes
}

func (s stamp) sameFile(t stamp) bool {
	return s.info != nil && t.info != nil && os.SameFile(s.info, t.info)
}

func inspect(f *os.File, kind role) (stamp, error) {
	info, err := f.Stat()
	if err != nil {
		return stamp{}, err
	}
	if kind == policyFile && (!info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxBytes) || kind != policyFile && !info.IsDir() {
		return stamp{}, errUnsafe
	}
	changed, err := inspectPermissions(f, info, kind)
	return stamp{info: info, changed: changed}, err
}

func openDirectory(path string, kind role) (*os.File, stamp, error) {
	entry, err := os.Lstat(path)
	if err != nil || !entry.IsDir() {
		return nil, stamp{}, errUnsafe
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, stamp{}, err
	}
	id, err := inspect(f, kind)
	if err != nil || !os.SameFile(entry, id.info) {
		f.Close()
		return nil, stamp{}, errUnsafe
	}
	return f, id, nil
}

type liveWatch struct {
	*policyWatcher
	lost atomic.Bool
}

// Store is the native operator boundary. Never register it as a Wails service.
// Policy reads and publication serialize; caller notifications run outside mu.
type Store struct {
	mu         sync.Mutex
	root       string
	dir        string
	parent     stamp
	dirID      stamp
	handle     *os.Root
	watch      *liveWatch
	workers    sync.WaitGroup
	closed     bool
	override   bool
	invalidate func(Change)

	held  *os.File // prevents Unix inode recycling across coalesced replacements
	last  stamp
	hash  string
	state Snapshot
}

// Open selects one already-resolved profile and subscribes before reading any
// consent. Absence of the file is an unknown policy, not a startup error.
func Open(stateRoot string, invalidate func(Change)) (*Store, error) {
	unobserved := stamp{info: nil, changed: 0}
	s := &Store{
		mu:         sync.Mutex{},
		root:       stateRoot,
		dir:        filepath.Join(stateRoot, directory),
		parent:     unobserved,
		dirID:      unobserved,
		handle:     nil,
		watch:      nil,
		workers:    sync.WaitGroup{},
		closed:     false,
		override:   false,
		invalidate: invalidate,
		held:       nil,
		last:       unobserved,
		hash:       "",
		state:      empty(),
	}
	s.state.Revision = rand.Text()
	if os.Getenv("OMNIVIEW_DISABLE_UI_EXTENSIONS") == "1" {
		s.override = true
		return s, nil
	}
	if !filepath.IsAbs(stateRoot) || invalidate == nil {
		return nil, errUnsafe
	}
	canonical, err := filepath.EvalSymlinks(stateRoot)
	if err != nil || canonical != stateRoot {
		return nil, errUnsafe
	}
	parent, id, err := openDirectory(stateRoot, profileDirectory)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	s.parent = id
	if _, statErr := os.Lstat(s.dir); errors.Is(statErr, os.ErrNotExist) {
		created, createErr := devsession.CreatePrivateDirectoryAt(parent, directory)
		if createErr == nil {
			created.Close()
		} else if !errors.Is(createErr, os.ErrExist) {
			return nil, createErr
		}
	}
	s.mu.Lock()
	err = s.attachLocked()
	if err == nil {
		s.refreshLocked(nil)
	}
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return s, nil
}

// checkLayout also refuses an ancestor redirect or a different profile root.
// Never adopt a new root under an old profile handle after a path move.
func (s *Store) checkLayout(dirID stamp) error {
	if canonical, err := filepath.EvalSymlinks(s.dir); err != nil || canonical != s.dir {
		return errUnsafe
	}
	for _, entry := range [...]struct {
		path string
		kind role
		id   stamp
	}{{s.root, profileDirectory, s.parent}, {s.dir, policyDirectory, dirID}} {
		f, id, err := openDirectory(entry.path, entry.kind)
		if err != nil {
			return err
		}
		f.Close()
		if !id.sameFile(entry.id) {
			return errUnsafe
		}
	}
	return nil
}

func (s *Store) attachLocked() error {
	d, id, err := openDirectory(s.dir, policyDirectory)
	if err != nil {
		return err
	}
	d.Close()
	handle, err := os.OpenRoot(s.dir)
	if err != nil {
		return err
	}
	bound, err := handle.Stat(".")
	if err != nil || !os.SameFile(id.info, bound) {
		handle.Close()
		return errUnsafe
	}
	w, err := newPolicyWatcher(s.root, s.dir, filepath.Join(s.dir, filename))
	if err != nil {
		handle.Close()
		return err
	}
	if err = s.checkLayout(id); err != nil {
		handle.Close()
		w.close()
		return err
	}
	live := &liveWatch{policyWatcher: w, lost: atomic.Bool{}}
	s.dirID, s.handle, s.watch = id, handle, live
	s.workers.Add(1)
	go s.observe(live)
	return nil
}

func (s *Store) observe(w *liveWatch) {
	defer s.workers.Done()
	defer w.close()
	for {
		err := w.next()
		if err != nil {
			w.lost.Store(true) // fence readers before waiting for their lock
		}
		s.mu.Lock()
		if s.closed || s.watch != w {
			s.mu.Unlock()
			return
		}
		var change *Change
		if err != nil {
			s.watch = nil
			s.handle.Close()
			s.handle = nil
			s.forgetFileLocked()
			change = s.fenceLocked()
		} else {
			change = s.refreshLocked(nil)
		}
		s.mu.Unlock()
		s.notify(change)
		if err != nil {
			return
		}
	}
}

func (s *Store) notify(c *Change) {
	if c != nil {
		s.invalidate(*c)
	}
}

func (s *Store) denyLocked() *Change {
	if !s.state.Known {
		return nil
	}
	return s.fenceLocked()
}

func (s *Store) fenceLocked() *Change {
	s.hash = ""
	change := &Change{Previous: s.state.Revision, Revision: rand.Text(), Affected: nil}
	s.state = empty()
	s.state.Revision = change.Revision
	return change
}

func (s *Store) forgetFileLocked() {
	if s.held != nil {
		s.held.Close()
		s.held = nil
	}
	s.last = stamp{info: nil, changed: 0}
}

func (s *Store) rememberFileLocked(f *os.File, id stamp) {
	s.forgetFileLocked()
	if runtime.GOOS != "windows" {
		// POSIX can recycle inode numbers between coalesced replacements.
		// Windows operator replacements must not be blocked by retained opens.
		s.held = f
	}
	s.last = id
}

func (s *Store) openFileLocked(name string) (*os.File, stamp, error) {
	before, err := s.handle.Lstat(name)
	if err != nil {
		return nil, stamp{}, err
	}
	// A rejected entry still identifies the object that must be replaced.
	entry := stamp{info: before, changed: 0}
	if !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > maxBytes {
		return nil, entry, errUnsafe
	}
	f, err := s.handle.OpenFile(name, privateReadFlags, 0)
	if err != nil {
		return nil, entry, err
	}
	id, err := inspect(f, policyFile)
	if err != nil || !os.SameFile(before, id.info) {
		f.Close()
		return nil, entry, errUnsafe
	}
	return f, id, nil
}

// Recheck the handle, named entry, profile and watch after decoding, before
// publication. A complete but superseded read must not become a revision.
func (s *Store) currentLocked(f *os.File, id stamp) bool {
	end, err := inspect(f, policyFile)
	if err != nil || end.changed != id.changed || end.info.Size() != id.info.Size() {
		return false
	}
	current, err := s.handle.Lstat(filename)
	return err == nil && os.SameFile(current, id.info) && s.checkLayout(s.dirID) == nil && !s.watch.lost.Load()
}

type publication struct {
	file os.FileInfo // nil unless the exact displaced predecessor was witnessed
	sum  [sha256.Size]byte
}

func (s *Store) refreshLocked(native *publication) *Change {
	if s.watch.lost.Load() {
		return s.denyLocked()
	}
	if s.checkLayout(s.dirID) != nil {
		s.watch.interrupt()
		s.watch = nil
		s.handle.Close()
		s.handle = nil
		s.forgetFileLocked()
		return s.denyLocked()
	}
	f, id, err := s.openFileLocked(filename)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			s.forgetFileLocked()
		} else if id.info != nil && !s.last.sameFile(id) {
			// Repair requires a new private object, never adoption by chmod.
			s.rememberFileLocked(nil, id)
		}
		return s.denyLocked()
	}
	defer func() {
		if s.held != f {
			f.Close()
		}
	}()
	if s.last.sameFile(id) {
		if s.state.Known && s.last.changed == id.changed && s.currentLocked(f, id) {
			return nil // no rebuffering or parsing for a second window or duplicate notification
		}
		return s.denyLocked() // mutated, exposed, or retired inode; require replacement
	}
	return s.readReplacementLocked(f, id, native)
}

func (s *Store) readReplacementLocked(f *os.File, id stamp, native *publication) *Change {
	data := make([]byte, id.info.Size())
	if _, err := io.ReadFull(f, data); err != nil {
		return s.denyLocked()
	}
	next, previous, err := decode(data)
	if err != nil {
		if s.currentLocked(f, id) {
			s.rememberFileLocked(f, id)
		}
		return s.denyLocked()
	}
	sum := sha256.Sum256(data)
	next.Revision = rand.Text()
	c := &Change{Previous: s.state.Revision, Revision: next.Revision, Affected: nil}
	// A file can claim any predecessor. Only our serialized native writer can
	// witness the actual displaced object and identify its exact replacement.
	linked := native != nil && native.file != nil && native.sum == sum && os.SameFile(native.file, id.info) &&
		s.state.Known && previous != "" && previous == s.hash && next.Disabled == s.state.Disabled
	if linked {
		affected := changedGrants(&s.state, &next)
		c.Affected = &affected
	} else {
		for i := range next.Grants {
			next.Grants[i].Continuity = next.Revision
		}
	}
	if !s.currentLocked(f, id) {
		return s.denyLocked()
	}
	s.rememberFileLocked(f, id)
	s.state, s.hash = next, hex.EncodeToString(sum[:])
	return c
}

// Merge two sorted edge lists only after proving an immediate predecessor.
// Include removal, reissue, read/field edits, and both ways of disabling a row.
func changedGrants(old, next *Snapshot) []AffectedBinding {
	affected := []AffectedBinding{}
	i := 0
	for j := range next.Grants {
		g := &next.Grants[j]
		b := g.binding()
		for i < len(old.Grants) && byBinding(old.Grants[i].binding(), b) < 0 {
			affected = append(affected, old.Grants[i].binding().affected())
			i++
		}
		row := b.affected()
		if i < len(old.Grants) && old.Grants[i].binding() == b {
			prior := &old.Grants[i]
			i++
			if prior.OwnerPin == g.OwnerPin && prior.ContributorPin == g.ContributorPin && prior.Contract == g.Contract && old.denies(b) == next.denies(b) {
				delta := fieldChanges(prior.Fields, g.Fields)
				switch {
				case prior.Read != g.Read:
					row.ReadOnly = len(delta) == 0
				case len(delta) == 0:
					g.Continuity = prior.Continuity
					continue
				default:
					row.Fields = delta
				}
			}
		}
		g.Continuity = next.Revision
		affected = append(affected, row)
	}
	for ; i < len(old.Grants); i++ {
		affected = append(affected, old.Grants[i].binding().affected())
	}
	return affected
}

// Both lists are sorted and unique. Do not disclose values or imply that an
// event granted a key. The reader compares names with its own verified request.
func fieldChanges(a, b []string) []string {
	var out []string
	for len(a) > 0 && len(b) > 0 {
		switch strings.Compare(a[0], b[0]) {
		case -1:
			out = append(out, a[0])
			a = a[1:]
		case 1:
			out = append(out, b[0])
			b = b[1:]
		default:
			a, b = a[1:], b[1:]
		}
	}
	out = append(out, a...)
	return append(out, b...)
}

// Snapshot resubscribes after a lost watch before reading current private bytes.
// It never returns slices shared with a prior response or with the store.
func (s *Store) Snapshot() Snapshot {
	s.mu.Lock()
	var change *Change
	if !s.closed && !s.override && (s.watch != nil || s.attachLocked() == nil) {
		change = s.refreshLocked(nil)
	}
	result := s.state.clone()
	s.mu.Unlock()
	s.notify(change)
	return result
}

func (s *Store) removeTemporaryLocked(name string) {
	// Rename may have consumed this name. A cleanup error cannot undo a commit.
	if err := s.handle.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("extension policy: failed to remove temporary policy file: %v", err)
	}
}

// Retain the object actually displaced by this atomic replacement. A second
// operator may replace the file after our preread but before the rename. Even
// an otherwise valid update cannot carry continuity across that race.
func (s *Store) replaceLinkedLocked(data []byte, native *publication) error {
	native.file = nil
	staged := ".policy-" + rand.Text()
	if err := devsession.WritePrivateFile(filepath.Join(s.dir, staged), data); err != nil {
		return err
	}
	defer s.removeTemporaryLocked(staged)
	stageFile, next, err := s.openFileLocked(staged)
	if err != nil {
		return err
	}
	// Capture identity from the open handle; a Windows Lstat may defer
	// resolving the file ID until after its temporary name has disappeared.
	stageFile.Close()
	displaced, err := exchangePolicy(s.handle, s.dir, staged)
	if err != nil {
		return err
	}
	if displaced == "" {
		return nil // filesystem supports replacement but not an atomic witness
	}
	if displaced != staged {
		defer s.removeTemporaryLocked(displaced)
	}
	if s.matchesDisplacedLocked(displaced) {
		native.file = next.info
	}
	return nil
}

func (s *Store) matchesDisplacedLocked(displaced string) bool {
	f, id, err := s.openFileLocked(displaced)
	if err != nil {
		return false // publication succeeded; identity cannot be proven
	}
	defer f.Close()
	if !s.last.sameFile(id) || id.info.Size() != s.last.info.Size() {
		return false
	}
	h := sha256.New()
	if _, err = io.CopyN(h, f, id.info.Size()); err != nil {
		return false
	}
	end, err := inspect(f, policyFile)
	return err == nil && id.changed == end.changed && hex.EncodeToString(h.Sum(nil)) == s.hash
}

// Replace validates before publishing a private, synced, atomic replacement.
// This is a native operator API, deliberately absent from Service. Check a
// supplied predecessor before writing; competing external writers are not
// transactionally serialized and cannot establish binding continuity.
func (s *Store) Replace(data []byte) error {
	_, previous, err := decode(data)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.closed || s.override || s.watch == nil || s.checkLayout(s.dirID) != nil {
		s.mu.Unlock()
		return errUnsafe
	}
	before := s.refreshLocked(nil)
	if s.watch == nil || s.watch.lost.Load() || previous != "" && previous != s.hash {
		s.mu.Unlock()
		s.notify(before)
		return errors.New("extension policy: predecessor no longer current")
	}
	native := publication{file: nil, sum: sha256.Sum256(data)}
	if previous != "" {
		err = s.replaceLinkedLocked(data, &native)
	} else {
		err = devsession.WritePrivateFile(filepath.Join(s.dir, filename), data)
	}
	after := s.refreshLocked(&native)
	if err == nil {
		if !s.state.Known || hex.EncodeToString(native.sum[:]) != s.hash {
			err = errUnsafe
		}
	}
	s.mu.Unlock()
	s.notify(before)
	s.notify(after)
	return err
}

// Close fences the profile and releases every watcher, including one in recovery.
func (s *Store) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	if s.watch != nil {
		s.watch.interrupt()
		s.watch = nil
		s.handle.Close()
		s.handle = nil
	}
	s.forgetFileLocked()
	c := s.denyLocked()
	s.mu.Unlock()
	s.workers.Wait()
	s.notify(c)
}

// Service is the entire renderer-facing API. No renderer controls the path,
// grants, watch, startup override, or event's claim of an affected binding.
type Service struct{ store *Store }

func NewService(store *Store) *Service { return &Service{store: store} }

func (s *Service) Read() Snapshot {
	if s.store == nil {
		return empty()
	}
	return s.store.Snapshot()
}
