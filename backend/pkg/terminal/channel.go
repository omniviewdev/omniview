//go:build !windows

package terminal

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"slices"
	"sync/atomic"
	"time"
)

// A channel terminal (Launch.Channel) is reached by a capability and by one stream, and by nothing else
// (docs/ui-next/terminal-channel-protocol.md). This file is what the manager keeps for it and the calls that name it by its
// capability; channel_serve.go is the stream (the handshake, who holds the terminal, the frames) and channel_pace.go is the
// policy that never lets a page that sleeps block the shell.
//
// The lock order is the session's mu, then its outMu, then a stream's own atomics: the holder is decided under mu, the ring and
// the holder's cursor are read together under outMu, and a stream's counters are atomics so that the pump never waits for a stream.

// capabilityBytes is how many random bytes a capability is made of.
const capabilityBytes = 32

// redacted is what every formatting of a capability prints.
const redacted = "[capability]"

// capability is the secret of one channel terminal: 32 random bytes of the host's, base64url. It is a type of its own so that no
// verb can print it by accident: a struct, an error or a log field that holds one shows a placeholder. It is compared with
// crypto/subtle, never with ==.
type capability string

func (capability) String() string   { return redacted }
func (capability) GoString() string { return redacted }

// Format hides the capability from every verb, %v and %+v and %q and %x included.
func (capability) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(redacted)) }

// mintCapability makes the capability of a channel terminal, and none for any other terminal.
func mintCapability(channel bool) (capability, error) {
	if !channel {
		return "", nil
	}
	var raw [capabilityBytes]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("the host could not make a capability: %w", err)
	}
	return capability(base64.RawURLEncoding.EncodeToString(raw[:])), nil
}

// channelLimits are the numbers of a channel terminal's ring and its pacing, the manager's copy of the Channel constants of
// types.go: a test states smaller ones.
type channelLimits struct {
	ring     int
	high     int
	low      int
	inflight int
	frame    int
	stall    time.Duration
}

func defaultChannelLimits() channelLimits {
	return channelLimits{ring: ChannelRingBytes, high: ChannelHighBytes, low: ChannelLowBytes, inflight: ChannelInflightBytes, frame: ChannelFrameBytes, stall: ChannelStall}
}

// limits is what a new session says of the bounds that hold it: the constants of types.go and the manager's channel numbers.
func (m *Manager) limits() Limits {
	l := defaultLimits()
	l.ChannelRingBytes = m.channel.ring
	l.ChannelHighBytes = m.channel.high
	l.ChannelLowBytes = m.channel.low
	l.ChannelStallMs = int(m.channel.stall / time.Millisecond)
	l.ChannelInflightBytes = m.channel.inflight
	l.ChannelFrameBytes = m.channel.frame
	return l
}

// ringLimit is how much output the ring of a new terminal keeps: a channel terminal's own, and the replay's for the others.
func (m *Manager) ringLimit(opts Options) int {
	if opts.Channel {
		return m.channel.ring
	}
	return m.replayBytes
}

// channelState is what a channel terminal has besides what every terminal has. The capability, the ended pointer and the
// counters are set once or atomic; the holder is guarded by the session's mu, and holderPtr is the same value as the pump reads
// it, without the lock.
type channelState struct {
	capability capability
	holder     *channelConn
	holderPtr  atomic.Pointer[channelConn]
	// ended is set once, by finish, to how the terminal ended, after the last byte of its output is in the ring: the stream that
	// holds the terminal sends it after the last output and closes.
	ended atomic.Pointer[End]
	// wake is how a stream's progress, an acknowledgement, a change of holder and the clock reach the pump while it waits.
	wake chan struct{}
	// paused and stalled are the pump's own and only its goroutine reads or writes them: paused is the pause between the marks,
	// stalled is that it was let go by the stall and has not waited since.
	paused, stalled bool
	// waits counts the times the pump decided to wait for a page, stallReleases the times it was let go for a page that made no
	// progress, noHolderReleases the times it was let go because nobody held the terminal, admitted the inputs the stream that
	// holds the terminal had taken in and refused those of a stream that does not.
	waits, stallReleases, noHolderReleases, admitted, refused atomic.Uint64
}

func newChannelState(channel bool, secret capability) *channelState {
	if !channel {
		return nil
	}
	return &channelState{
		capability: secret, holder: nil, holderPtr: atomic.Pointer[channelConn]{}, ended: atomic.Pointer[End]{}, wake: make(chan struct{}, 1),
		paused: false, stalled: false, waits: atomic.Uint64{}, stallReleases: atomic.Uint64{}, noHolderReleases: atomic.Uint64{},
		admitted: atomic.Uint64{}, refused: atomic.Uint64{},
	}
}

// signalPump wakes the pump if it waits, without waiting itself.
func (c *channelState) signalPump() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

// capabilityOf is the capability of a channel terminal, and none for any other.
func (s *session) capabilityOf() capability {
	if s.channel == nil {
		return ""
	}
	return s.channel.capability
}

// beginLease puts a channel terminal that no stream holds yet on its lease, from the moment it is made.
func (s *session) beginLease() {
	if s.channel == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.armLeaseLocked(s.lease)
}

// endLeaseLocked is what a stream that takes the terminal does to the lease: it is over, the timer is stopped, and one that fires
// anyway finds its number is no longer the lease's. The caller holds s.mu.
func (s *session) endLeaseLocked() {
	s.leaseGen++
	if s.leaseTimer != nil {
		s.leaseTimer.Stop()
		s.leaseTimer = nil
	}
	s.detached = false
	s.leaseEnd = time.Time{}
	s.leaseLen = 0
}

// channelStats is what the manager counted for one channel terminal, read in one step: the ring's bounds and the holder's cursor
// are read together under the output lock, so that end is never less than sent.
type channelStats struct {
	start, end, kept, overwritten uint64
	held                          bool
	sent, sentBytes, acked, lost  uint64
	waits, stallReleases          uint64
	noHolderReleases              uint64
	admitted, refused             uint64
}

func (s *session) channelStats() channelStats {
	var st channelStats
	ch := s.channel
	if ch == nil {
		return st
	}
	holder := ch.holderPtr.Load()
	s.outMu.Lock()
	st.start, st.end, st.kept, st.overwritten = s.ring.start(), s.ring.end, offset(s.ring.kept), s.ring.overwritten
	if holder != nil {
		st.sent = holder.sent.Load()
	}
	s.outMu.Unlock()
	if holder != nil {
		st.held = true
		st.sentBytes, st.acked, st.lost = holder.sentBytes.Load(), holder.acked.Load(), holder.lost.Load()
	}
	st.waits, st.stallReleases, st.noHolderReleases = ch.waits.Load(), ch.stallReleases.Load(), ch.noHolderReleases.Load()
	st.admitted, st.refused = ch.admitted.Load(), ch.refused.Load()
	return st
}

// channelNudge wakes the pump, which looks again at what it waits for.
func (s *session) channelNudge() { s.channel.signalPump() }

// ---- the calls that name a channel terminal by its capability ----

// lookupCap finds the terminal, or the kept end of one, that a capability names. It compares the capability with every one the
// manager holds, in constant time each, and does not stop at the first that matches, so that how long it takes says nothing about
// whether any matched, or which.
func (m *Manager) lookupCap(presented string) (*session, *tombstone) {
	want := []byte(presented)
	now := m.clock.Now()
	var found *session
	var kept *tombstone
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, s := range m.sessions {
		if s.channel != nil && subtle.ConstantTimeCompare([]byte(s.channel.capability), want) == 1 {
			found = s
		}
	}
	for _, t := range m.tombs {
		if t.capability != "" && subtle.ConstantTimeCompare([]byte(t.capability), want) == 1 && now.Before(t.until) {
			kept = t
		}
	}
	return found, kept
}

// liveByCapability is the terminal a capability names while it is running: one that is closing opens nothing.
func (m *Manager) liveByCapability(presented string) (*session, error) {
	s, _ := m.lookupCap(presented)
	if s == nil || s.ending.Load() {
		return nil, ChannelNotFound()
	}
	return s, nil
}

// CloseChannel ends the channel terminal that the capability names, as a close does (the hangup, then the kill at the end of
// the grace), and returns when it is gone. The decision to end it is taken under the terminal's lock, so that a stream that
// takes the terminal in the same instant either never held it or is told how it ended. A terminal that is already ending, or
// ended, opens nothing.
func (m *Manager) CloseChannel(presented string) error {
	s, _ := m.lookupCap(presented)
	if s == nil || !s.decide(fate{set: true, closedBy: ClosedByRequest, failure: nil}) {
		return ChannelNotFound()
	}
	s.startClose()
	m.awaitGone([]*session{s})
	return nil
}

// ChannelBusy says whether a program other than the shell holds the foreground of a channel terminal.
func (m *Manager) ChannelBusy(presented string) (Foreground, error) {
	s, err := m.liveByCapability(presented)
	if err != nil {
		return Foreground{}, err
	}
	shell, group, known := s.groups()
	if s.ending.Load() {
		return Foreground{}, ChannelNotFound()
	}
	if !known {
		return UnknownForeground(ReasonQueryFailed), nil
	}
	return foregroundOf(shell, group), nil
}

// ChannelCwd says which directory the shell of a channel terminal is in now.
func (m *Manager) ChannelCwd(presented string) (Directory, error) {
	s, err := m.liveByCapability(presented)
	if err != nil {
		return Directory{}, err
	}
	path, reason := s.directory()
	if s.ending.Load() {
		return Directory{}, ChannelNotFound()
	}
	return Directory{Path: path, Reason: reason}, nil
}

// ListChannels says what the capabilities it is given open: one entry for each that opens a terminal, or the kept end of one, in the
// order given, and none for a capability that opens nothing. It answers for the capabilities it is given and no other: nothing
// enumerates. At most MaxListedCaps are taken.
func (m *Manager) ListChannels(presented []string) ([]ChannelListed, error) {
	if len(presented) > MaxListedCaps {
		return nil, invalidError(fmt.Sprintf("capabilities holds at most %d entries; got %d.", MaxListedCaps, len(presented)))
	}
	out := make([]ChannelListed, 0, len(presented))
	for _, one := range presented {
		s, kept := m.lookupCap(one)
		switch {
		case s != nil && !s.ending.Load():
			out = append(out, s.channelListed())
		case kept != nil:
			out = append(out, kept.channelListed())
		}
	}
	return out, nil
}

// channelListed is the terminal as the page that holds its capability sees it in a list.
func (s *session) channelListed() ChannelListed {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.outMu.Lock()
	next, first, size := s.ring.end, s.ring.start(), s.ring.size(s.ring.end)
	s.outMu.Unlock()
	var expires int64
	if s.detached {
		expires = s.leaseEnd.UnixMilli()
	}
	return ChannelListed{
		ID: s.id, CreatedAt: s.info.CreatedAt, PID: s.info.PID, Shell: s.info.Shell, Labels: nonNil(s.labels), Params: nonNil(s.params),
		Size: size, Attached: s.channel.holder != nil, NextOffset: next, ReplayStart: first, LeaseExpiresUnixMs: expires, Ended: nil,
	}
}

// channelListed is the kept end of a channel terminal as a list shows it.
func (t *tombstone) channelListed() ChannelListed {
	return ChannelListed{
		ID: t.id, CreatedAt: t.info.CreatedAt, PID: t.info.PID, Shell: t.info.Shell, Labels: nonNil(t.labels), Params: nonNil(t.params),
		Size: t.ring.size(t.ring.end), Attached: false, NextOffset: t.ring.end, ReplayStart: t.ring.start(),
		LeaseExpiresUnixMs: t.until.UnixMilli(), Ended: new(t.end),
	}
}

// DismissChannel forgets the end that a channel terminal left, which the host keeps until it is dismissed or the lease it was kept
// under would have run out. A terminal that is alive is not dismissed (it is closed), and a capability that opens no kept end,
// whatever the reason, gets the one not-found. It looks at every kept end, so that how long it takes says nothing about which.
func (m *Manager) DismissChannel(presented string) error {
	want := []byte(presented)
	now := m.clock.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	dismissed := false
	m.tombs = slices.DeleteFunc(m.tombs, func(t *tombstone) bool {
		if t.capability == "" || subtle.ConstantTimeCompare([]byte(t.capability), want) != 1 {
			return false
		}
		dismissed = dismissed || now.Before(t.until)
		return true
	})
	if !dismissed {
		return ChannelNotFound()
	}
	return nil
}
