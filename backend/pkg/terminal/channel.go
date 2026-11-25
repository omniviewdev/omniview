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
//
// The secret is held behind a pointer on purpose. fmt does not call the methods of a field that is not exported, it prints what
// the field holds: a struct with a capability in a field of its own would print the secret, whatever the methods below say. A
// pointer is printed as an address.
type capability struct{ secret *string }

func (capability) String() string   { return redacted }
func (capability) GoString() string { return redacted }

// Format hides the capability from every verb, %v and %+v and %q and %x included.
func (capability) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(redacted)) }

// none says there is no capability: the terminal is not a channel terminal.
func (c capability) none() bool { return c.secret == nil }

// reveal is the secret, for the one answer that gives it and for a lookup that takes it back.
func (c capability) reveal() string {
	if c.secret == nil {
		return ""
	}
	return *c.secret
}

// matches compares the capability with what a page presented, in constant time.
func (c capability) matches(want []byte) bool {
	return c.secret != nil && subtle.ConstantTimeCompare([]byte(*c.secret), want) == 1
}

// mintCapability makes the capability of a channel terminal, and none for any other terminal.
func mintCapability(channel bool) (capability, error) {
	if !channel {
		return capability{secret: nil}, nil
	}
	var raw [capabilityBytes]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return capability{secret: nil}, fmt.Errorf("the host could not make a capability: %w", err)
	}
	secret := base64.RawURLEncoding.EncodeToString(raw[:])
	return capability{secret: &secret}, nil
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
	// firstFrame is how long a stream may be open before its first frame.
	firstFrame time.Duration
}

// channelFirstFrameWait is how long a stream may stay open before it shows a capability: a stream that has said nothing by then is
// closed, so that an idle connection holds no slot of the transport and no goroutine of the host.
const channelFirstFrameWait = 10 * time.Second

func defaultChannelLimits() channelLimits {
	return channelLimits{
		ring: ChannelRingBytes, high: ChannelHighBytes, low: ChannelLowBytes, inflight: ChannelInflightBytes, frame: ChannelFrameBytes, stall: ChannelStall,
		firstFrame: channelFirstFrameWait,
	}
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
	// roomWaits counts the times an input of the stream that holds the terminal waited for room in the queue.
	roomWaits atomic.Uint64
	// writers are the last channelWriters feeds that typed into this terminal, oldest first: each has its own count of input. Guarded
	// by the session's mu.
	writers []*writerCount
	// watchers are the streams that were displaced and wait to be told that the terminal is free or ended, oldest first, at most
	// channelWatchers of them. Guarded by the session's mu.
	watchers []*channelConn
}

// channelWatchers is how many displaced streams may watch one terminal: the stream that has watched longest is closed when it would
// be one more.
const channelWatchers = 4

func newChannelState(channel bool, secret capability) *channelState {
	if !channel {
		return nil
	}
	return &channelState{
		capability: secret, holder: nil, holderPtr: atomic.Pointer[channelConn]{}, ended: atomic.Pointer[End]{}, wake: make(chan struct{}, 1),
		paused: false, stalled: false, waits: atomic.Uint64{}, stallReleases: atomic.Uint64{}, noHolderReleases: atomic.Uint64{},
		admitted: atomic.Uint64{}, refused: atomic.Uint64{}, roomWaits: atomic.Uint64{},
		writers: nil, watchers: nil,
	}
}

// channelWriters is how many feeds the host remembers a count of input for, for one terminal: the one that has typed least recently
// is forgotten when a new one comes, and a feed that is not remembered starts at 0.
const channelWriters = 8

// writerCount is what one feed (one writer: the opaque id the page makes for it and states in its attach) has typed into a terminal.
// admitted is the bytes the queue holds from it, written or waiting, counted under the session's mu in the step that admits them, less
// what a write that failed part of the way did not write; applied is the bytes the device took, counted when each write returns. The
// first is what a ready states for the writer (what it has been applied and what it must not send again), so it is never less than the
// second, and neither decreases but by the unwritten rest of a write that failed.
type writerCount struct {
	id                string
	admitted, applied atomic.Uint64
}

// done is what a write of the writer does when it returns: the bytes the device took are applied, and the bytes it did not are not
// the writer's input any more.
func (w *writerCount) done(took, given int) {
	w.applied.Add(uint64(took)) //nolint:gosec // took is not negative.
	if given > took {
		w.admitted.Add(^uint64(given-took) + 1) //nolint:gosec // subtracts the unwritten rest.
	}
}

// writerLocked is the count of the writer an attach names, and whether the host remembered the writer: a remembered one, moved to the
// newest place, or a new one at 0 that makes the oldest forgotten when there are too many. An attach that names no writer gets a count
// of its own that nothing remembers (and is not known). The caller holds the session's mu.
func (c *channelState) writerLocked(id string) (*writerCount, bool) {
	if id == "" {
		return &writerCount{id: "", admitted: atomic.Uint64{}, applied: atomic.Uint64{}}, false
	}
	for i, w := range c.writers {
		if w.id == id {
			c.writers = append(slices.Delete(c.writers, i, i+1), w)
			return w, true
		}
	}
	w := &writerCount{id: id, admitted: atomic.Uint64{}, applied: atomic.Uint64{}}
	c.writers = append(c.writers, w)
	if len(c.writers) > channelWriters {
		c.writers = slices.Delete(c.writers, 0, 1)
	}
	return w, false
}

// signalHolder wakes the sender of the stream that holds the terminal: a write returned, and it may owe the page an applied frame.
func (c *channelState) signalHolder() {
	if holder := c.holderPtr.Load(); holder != nil {
		holder.signal()
	}
}

// watchLocked makes a stream that was displaced a watcher, and closes the one that has watched longest when there are too many. The
// caller holds the session's mu.
func (c *channelState) watchLocked(w *channelConn) {
	c.watchers = append(c.watchers, w)
	if len(c.watchers) > channelWatchers {
		oldest := c.watchers[0]
		c.watchers = slices.Delete(c.watchers, 0, 1)
		oldest.evicted.Store(true)
		oldest.signal()
	}
}

// unwatchLocked forgets a watcher whose stream ended. The caller holds the session's mu.
func (c *channelState) unwatchLocked(w *channelConn) {
	c.watchers = slices.DeleteFunc(c.watchers, func(other *channelConn) bool { return other == w })
}

// freeLocked tells every watcher that the terminal is free, once: they are not watchers any more. The caller holds the session's mu.
func (c *channelState) freeLocked() {
	for _, w := range c.watchers {
		w.released.Store(true)
		w.signal()
	}
	c.watchers = nil
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
		return capability{secret: nil}
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
	roomWaits                     uint64
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
	st.roomWaits = ch.roomWaits.Load()
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
		if s.channel != nil && s.channel.capability.matches(want) {
			found = s
		}
	}
	for _, t := range m.tombs {
		if t.capability.matches(want) && now.Before(t.until) {
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
	if err := checkListedCaps(len(presented)); err != nil {
		return nil, err
	}
	out := make([]ChannelListed, 0, len(presented))
	for _, one := range presented {
		s, kept := m.lookupCap(one)
		switch {
		case s != nil && !s.ending.Load():
			if listed, ok := s.channelListed(); ok {
				out = append(out, listed)
				continue
			}
			if _, kept = m.lookupCap(one); kept != nil {
				out = append(out, kept.channelListed())
			}
		case kept != nil:
			out = append(out, kept.channelListed())
		}
	}
	return out, nil
}

// channelListed is the terminal as the page that holds its capability sees it in a list, and whether it was still running when the
// snapshot was taken: the test that the terminal is running is made again after the snapshot, so that a shell that ended between the
// first test and the snapshot is not listed as running with the offset it wrote last.
func (s *session) channelListed() (ChannelListed, bool) {
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
	}, !s.ending.Load()
}

// channelListed is the kept end of a channel terminal as a list shows it.
func (t *tombstone) channelListed() ChannelListed {
	return ChannelListed{
		ID: t.id, CreatedAt: t.info.CreatedAt, PID: t.info.PID, Shell: t.info.Shell, Labels: nonNil(t.labels), Params: nonNil(t.params),
		Size: t.ring.size(t.ring.end), Attached: false, NextOffset: t.ring.end, ReplayStart: t.ring.start(),
		LeaseExpiresUnixMs: t.until.UnixMilli(), Ended: t.endCopy(),
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
		if !t.capability.matches(want) {
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

// HoldsID says the manager holds a terminal with the id, running or being started: an id that no other lane may take. A channel
// terminal has no record in the controller's index, so the controller asks the manager.
func (m *Manager) HoldsID(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, held := m.sessions[id]; held {
		return true
	}
	_, starting := m.starting[id]
	return starting
}
