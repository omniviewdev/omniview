//go:build !windows

package terminal

import (
	"path/filepath"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/linkresolve"
)

// ChannelResolveLink says what a candidate link of a channel terminal's output names on this machine (issue #696 step 3). The terminal is named by its
// capability. The text is what a program printed; rowDirectory is the directory of the command that printed the row, or empty.
//
// Where it looks: the row's directory when the shell proved the terminal was there (a directory of its record that came with the nonce, or the one it
// is in now), else where the shell is now; then the directory the terminal started in, the only root the host knows (it has no workspace: the page
// has none either); then a bounded scan (package linkresolve states each bound and policy). A directory the host cannot name is `no-directory`: never
// home, never the host's own. A row directory that the shell did not prove is `unvouched`, so that a page cannot use the call to look at a disk it
// names. The call logs nothing and its span has no attribute: the text and the paths are the user's data.
func (m *Manager) ChannelResolveLink(presented, rowDirectory, text string) (LinkResolution, error) {
	s, err := m.liveByCapability(presented)
	if err != nil {
		return LinkResolution{}, err
	}
	out := s.resolveLink(m.links, m.linkSlots, s.directory, rowDirectory, text)
	if s.ending.Load() {
		return LinkResolution{}, ChannelNotFound()
	}
	return out, nil
}

func (s *session) resolveLink(links *linkresolve.Resolver, slots chan struct{}, where func() (string, UnknownReason), rowDirectory, text string) LinkResolution {
	dir, reason := s.linkDirectory(slots, where, rowDirectory)
	if dir == "" {
		return UnknownLink(reason)
	}
	in := linkresolve.Input{Dir: dir, Roots: nil, Text: text}
	if start := s.info.Cwd; filepath.IsAbs(start) {
		in.Roots = []string{start}
	}
	got := links.Resolve(in)
	return LinkResolution{Kind: LinkKind(got.Kind), Path: got.Path, Line: got.Line, Col: got.Col, Reason: LinkReason(got.Reason)}
}

// linkDirectory is the directory to resolve in: the row's when it is vouched for, else the shell's own.
func (s *session) linkDirectory(slots chan struct{}, where func() (string, UnknownReason), rowDirectory string) (string, LinkReason) {
	current, why, answered := askDirectory(slots, linkDirectoryBudget, where)
	if !answered {
		return "", LinkTimeout
	}
	if rowDirectory == "" {
		if current == "" {
			if why == ReasonRemote {
				return "", LinkRemote
			}
			return "", LinkNoDirectory
		}
		return current, ""
	}
	if vouches(s.commands(), current, rowDirectory) {
		return rowDirectory, ""
	}
	return "", LinkUnvouched
}

// vouches says whether a directory is one the terminal can answer for: the one the shell is in now, or one a command of its record came with the nonce.
// A directory that anything could have printed (an OSC 7, an unmarked line) is never in the record, so no text can make the host look elsewhere.
func vouches(record Commands, current, dir string) bool {
	if !filepath.IsAbs(dir) {
		return false
	}
	dir = filepath.Clean(dir)
	if current != "" && filepath.Clean(current) == dir {
		return true
	}
	if record.CwdTrust == "nonce" && record.Cwd != "" && filepath.Clean(record.Cwd) == dir {
		return true
	}
	for i := range record.Commands {
		c := &record.Commands[i]
		if c.CwdTrust == "nonce" && c.Cwd != "" && filepath.Clean(c.Cwd) == dir {
			return true
		}
	}
	return false
}

const (
	// linkDirectoryBudget and linkDirectorySlots bound the question of where the shell is, as the resolver bounds its own work.
	linkDirectoryBudget = 400 * time.Millisecond
	linkDirectorySlots  = 16
)

// askDirectory asks where the shell is, bounded like the resolver's own work: the question stats the shell's directory, which may sit on a stalled
// mount, so it runs in a goroutine that holds one of the slots until it returns, and a call that finds none free, or waits past the budget, is not
// answered (the last result is false).
func askDirectory(slots chan struct{}, budget time.Duration, ask func() (string, UnknownReason)) (string, UnknownReason, bool) {
	select {
	case slots <- struct{}{}:
	default:
		return "", "", false
	}
	type answer struct {
		path   string
		reason UnknownReason
	}
	done := make(chan answer, 1)
	go func() {
		path, reason := ask()
		<-slots
		done <- answer{path, reason}
	}()
	timer := time.NewTimer(budget)
	defer timer.Stop()
	select {
	case got := <-done:
		return got.path, got.reason, true
	case <-timer.C:
		return "", "", false
	}
}
