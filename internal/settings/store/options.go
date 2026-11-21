package store

import (
	"time"

	"github.com/omniviewdev/plugin-sdk/settings"
)

// config holds optional configuration for the Store.
type config struct {
	// credentials names, per core settings category, the settings whose values are
	// credentials. Plugin settings need no such list: the schema the host remembers
	// for each plugin classifies them (see RememberPluginSchema).
	credentials map[string]map[string]struct{}
	// now is the clock of corruption recovery and of the age of the copies it keeps.
	// Nil means time.Now.
	now func() time.Time
	// fault is called before each step of a scrub, or of the recovery of one, that
	// changes files, and may stop it there by returning an error. Tests use it to fail a step and to
	// capture the directory as a crash at that step would leave it.
	fault func(step string) error
	// flushes reports whether the file system of a directory can flush it to the
	// disk. Nil means directoryFlushes.
	flushes func(dir string) bool
}

// Option configures the Store.
type Option func(*config)

func newConfig(opts []Option) config {
	cfg := config{credentials: nil, now: nil, fault: nil, flushes: nil}
	for _, opt := range opts {
		opt(&cfg)
	}
	return cfg
}

// step runs the fault hook for a step about to change files.
func (c config) step(name string) error {
	if c.fault == nil {
		return nil
	}
	return c.fault(name)
}

// directoryFlushes reports whether dir can be flushed to the disk.
func (c config) directoryFlushes(dir string) bool {
	if c.flushes == nil {
		return directoryFlushes(dir)
	}
	return c.flushes(dir)
}

func (c config) clock() time.Time {
	if c.now == nil {
		return time.Now()
	}
	return c.now()
}

// WithCredentialSettings tells the store which of the host's own (core) settings
// are credentials: those declared Sensitive or of type Password. When such a
// value is cleared or replaced, the store scrubs the database file of the old
// one, as it does for a plugin's credential. Without the option the store cannot
// tell a core credential from a preference and scrubs for neither.
func WithCredentialSettings(categories []settings.Category) Option {
	return func(c *config) {
		credentials := make(map[string]map[string]struct{}, len(categories))
		for _, category := range categories {
			for id, setting := range category.Settings {
				if !setting.Sensitive && setting.Type != settings.Password {
					continue
				}
				if credentials[category.ID] == nil {
					credentials[category.ID] = make(map[string]struct{})
				}
				credentials[category.ID][id] = struct{}{}
			}
		}
		c.credentials = credentials
	}
}

// coreCredentials classifies the stored values of one core category.
func (c config) coreCredentials(category string) credentialClassifier {
	ids := c.credentials[category]
	return func(id string) bool {
		_, isCredential := ids[id]
		return isCredential
	}
}
