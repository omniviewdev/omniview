package appstate

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gofrs/flock"
)

// validatePluginID rejects empty, traversal, or path-separator-containing IDs.
func validatePluginID(id string) error {
	if id == "" {
		return errors.New("appstate: empty plugin ID")
	}
	if strings.ContainsAny(id, "/\\") {
		return fmt.Errorf("appstate: plugin ID contains path separator: %q", id)
	}
	if id == "." || id == ".." {
		return fmt.Errorf("appstate: invalid plugin ID: %q", id)
	}
	return nil
}

// Service is the central authority for all application state filesystem access.
// Create once at startup via New() and inject into subsystems.
type Service struct {
	root   string
	lock   *flock.Flock
	osRoot *os.Root

	// Cached scoped roots for top-level directories.
	plugins *ScopedRoot
	logs    *ScopedRoot
	rootDir *ScopedRoot

	// Cached per-plugin scoped roots. A root stays cached, and a holder may keep
	// it for as long as it likes, until ReleasePluginRoots: no lookup closes or
	// replaces one.
	pluginRootsMu    sync.Mutex
	pluginDataRoots  map[string]*ScopedRoot
	pluginStoreRoots map[string]*ScopedRoot
	// released holds the IDs whose roots the plugin manager released after an
	// uninstall. Until the plugin directory exists again, a lookup for such an ID
	// creates nothing: a late caller must not resurrect an uninstalled plugin's
	// directory, which would make the next installation of the ID refuse to
	// proceed. The entry is dropped by the first lookup that finds the plugin
	// directory.
	released map[string]struct{}

	closeOnce sync.Once
	closeErr  error
}

type config struct {
	root    string
	flockOn bool
}

// Option configures the Service constructor.
type Option func(*config)

// WithRoot sets the root directory for the state service.
func WithRoot(path string) Option {
	return func(c *config) { c.root = path }
}

// WithFlock enables or disables file locking.
func WithFlock(enabled bool) Option {
	return func(c *config) { c.flockOn = enabled }
}

// New creates a new Service with the given options.
func New(opts ...Option) (*Service, error) {
	cfg := config{root: "", flockOn: true}
	for _, o := range opts {
		o(&cfg)
	}

	root := cfg.root
	if root == "" {
		var err error
		root, err = ResolveRoot()
		if err != nil {
			return nil, err
		}
	}
	// Validate programmatic selections just like environment/ldflags roots.
	var err error
	root, err = ValidateRoot(root)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, fmt.Errorf("appstate: create root %q: %w", root, err)
	}

	svc := &Service{
		root:             root,
		pluginDataRoots:  make(map[string]*ScopedRoot),
		pluginStoreRoots: make(map[string]*ScopedRoot),
		released:         make(map[string]struct{}),
		lock:             nil,
		osRoot:           nil,
		plugins:          nil,
		logs:             nil,
		rootDir:          nil,
		pluginRootsMu:    sync.Mutex{},
		closeOnce:        sync.Once{},
		closeErr:         nil,
	}

	if cfg.flockOn {
		lockPath := filepath.Join(root, ".lock")
		fl, err := acquireLock(lockPath)
		if err != nil {
			return nil, err
		}
		svc.lock = fl
	}

	osRoot, err := os.OpenRoot(root)
	if err != nil {
		releaseLock(svc.lock)
		return nil, fmt.Errorf("appstate: open root %q: %w", root, err)
	}
	svc.osRoot = osRoot

	svc.plugins, err = newScopedRoot(filepath.Join(root, "plugins"))
	if err != nil {
		svc.closePartial()
		return nil, err
	}
	svc.logs, err = newScopedRoot(filepath.Join(root, "logs"))
	if err != nil {
		svc.closePartial()
		return nil, err
	}
	svc.rootDir, err = newScopedRoot(root)
	if err != nil {
		svc.closePartial()
		return nil, err
	}

	return svc, nil
}

func (s *Service) closePartial() {
	if s.plugins != nil {
		s.plugins.Close()
	}
	if s.logs != nil {
		s.logs.Close()
	}
	if s.rootDir != nil {
		s.rootDir.Close()
	}
	if s.osRoot != nil {
		s.osRoot.Close()
	}
	releaseLock(s.lock)
}

// Close releases all resources held by the Service.
// Errors from individual close operations are aggregated and returned together.
// Close is idempotent; subsequent calls return the result of the first call.
func (s *Service) Close() error {
	s.closeOnce.Do(func() {
		allErrors := s.closePluginRoots()

		if err := s.plugins.Close(); err != nil {
			allErrors = append(allErrors, fmt.Errorf("close plugins root: %w", err))
		}
		if err := s.logs.Close(); err != nil {
			allErrors = append(allErrors, fmt.Errorf("close logs root: %w", err))
		}
		if err := s.rootDir.Close(); err != nil {
			allErrors = append(allErrors, fmt.Errorf("close root dir: %w", err))
		}
		if s.osRoot != nil {
			if err := s.osRoot.Close(); err != nil {
				allErrors = append(allErrors, fmt.Errorf("close os root: %w", err))
			}
		}
		releaseLock(s.lock)

		s.closeErr = errors.Join(allErrors...)
	})
	return s.closeErr
}

// closePluginRoots closes and forgets all cached per-plugin scoped roots,
// returning any close errors.
func (s *Service) closePluginRoots() []error {
	var allErrors []error

	s.pluginRootsMu.Lock()
	for id, r := range s.pluginDataRoots {
		if err := r.Close(); err != nil {
			allErrors = append(allErrors, fmt.Errorf("close plugin data root %q: %w", id, err))
		}
	}
	for id, r := range s.pluginStoreRoots {
		if err := r.Close(); err != nil {
			allErrors = append(allErrors, fmt.Errorf("close plugin store root %q: %w", id, err))
		}
	}
	s.pluginDataRoots = nil
	s.pluginStoreRoots = nil
	s.pluginRootsMu.Unlock()

	return allErrors
}

// Root returns the absolute path to the state directory.
func (s *Service) Root() string { return s.root }

// Plugins returns the scoped root for the plugins directory.
func (s *Service) Plugins() *ScopedRoot { return s.plugins }

// Logs returns the scoped root for the logs directory.
func (s *Service) Logs() *ScopedRoot { return s.logs }

// RootDir returns the scoped root for the top-level state directory.
func (s *Service) RootDir() *ScopedRoot { return s.rootDir }

// PluginData returns a scoped root for a specific plugin's data directory.
// The result is cached; subsequent calls for the same id return the cached
// instance. No lookup closes or replaces a cached root, because a holder may
// keep it for as long as it likes and an archive replacement moves the directory
// itself, with the plugin's data, into the new plugin directory. The roots of a
// plugin that is uninstalled end with ReleasePluginRoots; until the plugin
// directory exists again, PluginData then creates nothing and returns an error
// satisfying errors.Is(err, fs.ErrNotExist).
func (s *Service) PluginData(id string) (*ScopedRoot, error) {
	if err := validatePluginID(id); err != nil {
		return nil, fmt.Errorf("appstate: PluginData: %w", err)
	}

	s.pluginRootsMu.Lock()
	defer s.pluginRootsMu.Unlock()

	if r, ok := s.pluginDataRoots[id]; ok {
		return r, nil
	}
	if err := s.checkNotReleasedLocked(id); err != nil {
		return nil, err
	}

	dir := filepath.Join(s.root, "plugins", id, "data")
	r, err := newScopedRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("appstate: create plugin data root for %q: %w", id, err)
	}
	s.pluginDataRoots[id] = r
	return r, nil
}

// PluginDataIfExists returns the scoped root for a plugin's data directory
// only when that directory already exists. It never creates directories and
// never caches a root for a missing directory, so read-only callers cannot
// grow the disk or the descriptor table by probing novel plugin IDs. A cached
// root is returned as it is, as in PluginData.
// ok is false (with a nil error) when the directory does not exist.
func (s *Service) PluginDataIfExists(id string) (root *ScopedRoot, ok bool, err error) {
	if err := validatePluginID(id); err != nil {
		return nil, false, fmt.Errorf("appstate: PluginDataIfExists: %w", err)
	}

	s.pluginRootsMu.Lock()
	defer s.pluginRootsMu.Unlock()

	if r, cached := s.pluginDataRoots[id]; cached {
		return r, true, nil
	}

	dir := filepath.Join(s.root, "plugins", id, "data")
	r, err := openExistingScopedRoot(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("appstate: open plugin data root for %q: %w", id, err)
	}
	s.pluginDataRoots[id] = r
	return r, true, nil
}

// PluginStore returns a scoped root for a specific plugin's store directory.
// The result is cached; subsequent calls for the same id return the cached
// instance, which no lookup closes or replaces. See PluginData.
func (s *Service) PluginStore(id string) (*ScopedRoot, error) {
	if err := validatePluginID(id); err != nil {
		return nil, fmt.Errorf("appstate: PluginStore: %w", err)
	}

	s.pluginRootsMu.Lock()
	defer s.pluginRootsMu.Unlock()

	if r, ok := s.pluginStoreRoots[id]; ok {
		return r, nil
	}
	if err := s.checkNotReleasedLocked(id); err != nil {
		return nil, err
	}

	dir := filepath.Join(s.root, "plugins", id, "store")
	r, err := newScopedRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("appstate: create plugin store root for %q: %w", id, err)
	}
	s.pluginStoreRoots[id] = r
	return r, nil
}

// ReleasePluginRoots closes and forgets the cached store and data roots of a
// plugin whose installation the plugin manager has just disposed of, once the
// uninstall is durable, and remembers the ID: until the plugin directory exists
// again, PluginStore and PluginData create nothing for it. A holder that still
// has a root gets os.ErrClosed on its next use, and a plugin installed again
// under the same ID gets roots on its own new directories.
//
// Only this call ends a root's life. Archive replacement and its rollback move
// the state directories with their inodes, so roots held across an update stay
// valid, and a lookup that closed one because a directory looked missing for a
// moment would break the move.
func (s *Service) ReleasePluginRoots(id string) {
	if validatePluginID(id) != nil {
		return
	}

	s.pluginRootsMu.Lock()
	defer s.pluginRootsMu.Unlock()

	// After Close both maps are nil, there is nothing left to close, and the
	// deletes below are no-ops. os.Root.Close reports no error, and the root is
	// unreachable either way.
	if r := s.pluginDataRoots[id]; r != nil {
		_ = r.Close()
	}
	delete(s.pluginDataRoots, id)
	if r := s.pluginStoreRoots[id]; r != nil {
		_ = r.Close()
	}
	delete(s.pluginStoreRoots, id)
	s.released[id] = struct{}{}
}

// checkNotReleasedLocked refuses to create the directories of a plugin whose
// roots were released while its plugin directory is missing. The first call that
// finds the directory forgets the release. The caller holds pluginRootsMu.
func (s *Service) checkNotReleasedLocked(id string) error {
	if _, released := s.released[id]; !released {
		return nil
	}
	if _, err := os.Stat(filepath.Join(s.root, "plugins", id)); err != nil {
		return fmt.Errorf("appstate: plugin %q is not installed: %w", id, err)
	}
	delete(s.released, id)
	return nil
}
