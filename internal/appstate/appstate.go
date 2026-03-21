package appstate

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gofrs/flock"
)

// validatePluginID rejects empty, traversal, or path-separator-containing IDs.
func validatePluginID(id string) error {
	if id == "" {
		return fmt.Errorf("appstate: empty plugin ID")
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

	// Cached per-plugin scoped roots.
	pluginRootsMu sync.Mutex
	pluginDataRoots  map[string]*ScopedRoot
	pluginStoreRoots map[string]*ScopedRoot

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
	cfg := config{flockOn: true}
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

	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, fmt.Errorf("appstate: create root %q: %w", root, err)
	}

	svc := &Service{
		root:             root,
		pluginDataRoots:  make(map[string]*ScopedRoot),
		pluginStoreRoots: make(map[string]*ScopedRoot),
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

// Root returns the absolute path to the state directory.
func (s *Service) Root() string { return s.root }

// Plugins returns the scoped root for the plugins directory.
func (s *Service) Plugins() *ScopedRoot { return s.plugins }

// Logs returns the scoped root for the logs directory.
func (s *Service) Logs() *ScopedRoot { return s.logs }

// RootDir returns the scoped root for the top-level state directory.
func (s *Service) RootDir() *ScopedRoot { return s.rootDir }

// PluginData returns a scoped root for a specific plugin's data directory.
// The result is cached; subsequent calls for the same id return the cached instance.
func (s *Service) PluginData(id string) (*ScopedRoot, error) {
	if err := validatePluginID(id); err != nil {
		return nil, fmt.Errorf("appstate: PluginData: %w", err)
	}

	s.pluginRootsMu.Lock()
	defer s.pluginRootsMu.Unlock()

	if r, ok := s.pluginDataRoots[id]; ok {
		return r, nil
	}

	dir := filepath.Join(s.root, "plugins", id, "data")
	r, err := newScopedRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("appstate: create plugin data root for %q: %w", id, err)
	}
	s.pluginDataRoots[id] = r
	return r, nil
}

// PluginStore returns a scoped root for a specific plugin's store directory.
// The result is cached; subsequent calls for the same id return the cached instance.
func (s *Service) PluginStore(id string) (*ScopedRoot, error) {
	if err := validatePluginID(id); err != nil {
		return nil, fmt.Errorf("appstate: PluginStore: %w", err)
	}

	s.pluginRootsMu.Lock()
	defer s.pluginRootsMu.Unlock()

	if r, ok := s.pluginStoreRoots[id]; ok {
		return r, nil
	}

	dir := filepath.Join(s.root, "plugins", id, "store")
	r, err := newScopedRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("appstate: create plugin store root for %q: %w", id, err)
	}
	s.pluginStoreRoots[id] = r
	return r, nil
}
