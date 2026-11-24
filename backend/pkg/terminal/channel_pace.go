//go:build !windows

package terminal

import "time"

// THE HIDDEN-PAGE POLICY (decided by Main from the native finding: a locked screen or a hidden window suspends the page, which
// then cannot read or acknowledge).
//
// A running shell is never stalled for ever at a credit limit, as VS Code's and JetBrains' pty hosts do not stall it. The pump
// reads the shell into the ring whatever the page does, advances the end, and the ring overwrites its oldest bytes and counts
// them. The pump waits for the page in exactly one case: the page that holds the terminal is ALIVE (a frame it was sent was taken,
// or it acknowledged, within the stall) and more than the high mark waits unsent. Then it waits until the sender has brought the
// backlog down to the low mark, so a page that is slow and alive gets every byte and the shell goes at its pace. When no progress
// came for the stall, or no stream holds the terminal, it does not wait: the shell is never blocked by a page that sleeps, and the
// stream says what it missed when the page comes back. The time is the manager's clock, so a test moves it and never sleeps.

// deliverChannel puts a read of the shell's output into the ring and tells the stream that holds the terminal, if one does.
func (m *Manager) deliverChannel(s *session, data []byte) {
	s.outMu.Lock()
	s.ring.write(data)
	s.outMu.Unlock()
	if holder := s.channel.holderPtr.Load(); holder != nil {
		holder.signal()
	}
}

// backlog is how much of the output the holder has not been sent: the end of the ring less its cursor, read together.
func (s *session) backlog(holder *channelConn) uint64 {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	return s.ring.end - holder.sent.Load()
}

// waitChannelRoom is the pump's pacing, before each read of the shell: it returns when the pump may read, and waits only for a page
// that is alive and behind.
func (m *Manager) waitChannelRoom(s *session) {
	ch := s.channel
	for {
		holder := ch.holderPtr.Load()
		if holder == nil {
			if ch.paused {
				ch.noHolderReleases.Add(1)
			}
			ch.paused, ch.stalled = false, false
			return
		}
		deadline, mustWait := m.mustWait(s, holder)
		if !mustWait || !s.sleepUntilProgress(deadline) {
			return
		}
	}
}

// mustWait decides, from how much waits unsent and how long ago the page last made progress, whether the pump waits, and says when
// the stall of that progress is over. A pump that paused at the high mark resumes at the low mark, so that it does not wait again
// for every frame; one whose page made no progress for the stall does not wait at all.
func (m *Manager) mustWait(s *session, holder *channelConn) (time.Time, bool) {
	ch := s.channel
	backlog := s.backlog(holder)
	if ch.paused {
		if backlog <= uint64(m.channel.low) { //nolint:gosec // The mark is a positive number of bytes.
			ch.paused, ch.stalled = false, false
			return time.Time{}, false
		}
	} else {
		if backlog <= uint64(m.channel.high) { //nolint:gosec // The mark is a positive number of bytes.
			return time.Time{}, false
		}
		ch.paused = true
	}
	// More than the mark waits unsent: the pump waits while the page makes progress, and no longer than the stall since it did.
	progress := time.Unix(0, holder.progressAt.Load())
	if idle := s.clock.Now().Sub(progress); idle >= m.channel.stall {
		if !ch.stalled {
			ch.stalled = true
			ch.stallReleases.Add(1)
		}
		return time.Time{}, false
	}
	ch.stalled = false
	ch.waits.Add(1)
	return progress.Add(m.channel.stall), true
}

// sleepUntilProgress waits for the sender to say that the page made progress, or for the deadline of the stall on the manager's
// clock, whichever is first. It says false if the shell ended meanwhile. The clock is looked at again once the timer is armed: a
// clock that moved between the reading the timer was armed from and its registration has put the timer after the deadline, and a
// deadline that is already behind is not waited for.
func (s *session) sleepUntilProgress(deadline time.Time) bool {
	timer := s.clock.AfterFunc(deadline.Sub(s.clock.Now()), s.channel.signalPump)
	defer timer.Stop()
	if !s.clock.Now().Before(deadline) {
		return true
	}
	select {
	case <-s.channel.wake:
		return true
	case <-s.exited:
		return false
	}
}
