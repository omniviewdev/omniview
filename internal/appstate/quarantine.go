package appstate

import (
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"time"
)

var quarantineSuffix = regexp.MustCompile(`\.invalid\.[0-9]+(\.[0-9]+)?$`)

// IsQuarantineName reports whether name is a file Quarantine produced, so that
// startup scans that match files by prefix can skip them.
func IsQuarantineName(name string) bool {
	return quarantineSuffix.MatchString(name)
}

// Quarantine renames name to "<name>.invalid.<unix seconds>" in the same
// directory and returns the new name. The file keeps its mode, content and
// location: a state file can hold sensitive text, so it is never copied
// elsewhere. An existing quarantine file is never replaced; a numeric suffix
// is added until the name is free. Startup is single-threaded, so the
// check-then-rename window is not guarded further.
func (s *ScopedRoot) Quarantine(name string) (string, error) {
	if err := validate(name); err != nil {
		return "", err
	}
	root, done := s.acquire()
	defer done()
	base := fmt.Sprintf("%s.invalid.%d", name, time.Now().Unix())
	for attempt := range 1000 {
		candidate := base
		if attempt > 0 {
			candidate = fmt.Sprintf("%s.%d", base, attempt)
		}
		if _, err := root.Lstat(candidate); err == nil {
			continue
		} else if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		if err := root.Rename(name, candidate); err != nil {
			return "", err
		}
		return candidate, nil
	}
	return "", fmt.Errorf("appstate: no free quarantine name for %q", name)
}
