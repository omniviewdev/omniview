//go:build !windows

package terminal

import (
	"cmp"
	"crypto/subtle"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// A terminal that has a page key outlives the page that opened it. When its window goes away it is DETACHED:
// its owner is gone, its reader is held (the shell blocks in its own write and the host buffers nothing), and a
// lease runs. A page that comes back lists the terminals of its key, attaches (the lease ends, the terminal
// belongs to the new window, the reader is let go), and is handed, in one step that is ordered with the
// output, the bytes it lacks. A lease that runs out ends the terminal as a close does. The lock order is the
// session's emitMu, then Manager.mu, then the session's mu, then its outMu, then the flow's own.

// errEndingByItself says an attach found a terminal whose shell ended by itself: it is ending, and will leave
// its end for the page that is attaching.
var errEndingByItself = errors.New("the terminal is ending by itself")

// checkOwner refuses an owner that cannot be compared: the manager compares owners, and comparing two values
// that have no equality panics. The VALUE is asked, not its type: a struct with an interface field is a
// comparable type and panics when that field holds a slice.
func checkOwner(owner Owner) error {
	if owner != nil && !reflect.ValueOf(owner).Comparable() {
		return invalidError("the owner of a terminal must be comparable.")
	}
	return nil
}

// checkPageKey refuses a key that is too short to be a secret, or too long, or not made of visible ASCII.
func checkPageKey(key string) error {
	if key == "" {
		return nil
	}
	if len(key) < MinPageKeyBytes || len(key) > MaxPageKeyBytes {
		return invalidError(fmt.Sprintf("page_key must be %d to %d characters; got %d.", MinPageKeyBytes, MaxPageKeyBytes, len(key)))
	}
	for i := range len(key) {
		if c := key[i]; c <= ' ' || c > '~' {
			return invalidError("page_key must be visible ASCII characters, with no spaces.")
		}
	}
	return nil
}

// resolveKeep reads what keeps a terminal for its page: the key, and the lease, which is the default when the
// opener gave none. A terminal without a key has no lease. A lease without a key, one below zero and one over the
// most are refused, naming the field.
func resolveKeep(opts Options) (time.Duration, error) {
	if err := checkPageKey(opts.PageKey); err != nil {
		return 0, err
	}
	switch {
	case opts.LeaseMs < 0 || opts.LeaseMs > int(LeaseMax/time.Millisecond):
		return 0, invalidError(fmt.Sprintf("lease_ms must be from 0 to %d; got %d.", int(LeaseMax/time.Millisecond), opts.LeaseMs))
	case opts.PageKey == "" && opts.LeaseMs != 0:
		return 0, invalidError("lease_ms means something only with a page_key: a terminal without one ends with its window.")
	case opts.PageKey == "":
		return 0, nil
	case opts.LeaseMs == 0:
		return LeaseDefault, nil
	}
	return time.Duration(opts.LeaseMs) * time.Millisecond, nil
}

// leaseOf is the lease a detach asks for: the terminal's own when none is asked for, and never more than the
// most.
func leaseOf(own time.Duration, askedMs int) time.Duration {
	if askedMs <= 0 {
		return own
	}
	return min(LeaseMax, time.Duration(min(askedMs, int(LeaseMax/time.Millisecond)))*time.Millisecond)
}

// ---- the output ----

// record numbers a read of the shell's output: the offset it has is the number of bytes written before it. The
// offset, the replay ring and the credit counted for the read are one step under the output lock, so that an
// attach, which takes its snapshot under it, sees a read wholly or not at all.
func (s *session) record(data []byte) uint64 {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	offset := s.ring.end
	s.flow.sent(len(data))
	s.ring.write(data)
	return offset
}

// next is the offset of the next byte the shell will write: the length of its output so far.
func (s *session) next() uint64 {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	return s.ring.end
}

// retained is everything the ring keeps: what the legacy attach hands over.
func (s *session) retained() []byte {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	return s.ring.bytes()
}

// noteSize is told, by the pty device, of a size it applied, and logs it at the offset of the output written so
// far.
func (s *session) noteSize(rows, cols uint16) {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	s.ring.noteSize(Size{Cols: int(cols), Rows: int(rows)})
}

// deliver numbers a read of the shell's output and hands it to the sink. For a terminal that has a page key the
// two are one step with respect to an attach (emitMu): the attach comes either before the read, which then lies
// at or above the end of its replay, or after the sink has the event, so that no event the replay holds is
// handed to the sink once the attach has answered.
func (m *Manager) deliver(s *session, data []byte) {
	if s.pageKey != "" {
		s.emitMu.Lock()
		defer s.emitMu.Unlock()
	}
	m.emit(s, s.record(data), data)
}

// emit hands a read to the sink: with its offset when the terminal has a page key and the sink takes offsets,
// as it always was otherwise.
func (m *Manager) emit(s *session, offset uint64, data []byte) {
	if s.pageKey != "" && m.offsets != nil {
		m.offsets.OutputAt(s.id, offset, data)
		return
	}
	m.sink.Output(s.id, data)
}

// ---- who may act ----

// holdsKey reports whether key is the one the terminal was opened with. The key is the page's secret: the
// comparison takes the same time whatever the key says, and a terminal without a key is held by none.
func (s *session) holdsKey(key string) bool {
	return s.pageKey != "" && subtle.ConstantTimeCompare([]byte(s.pageKey), []byte(key)) == 1
}

// mayActLocked reports whether a caller may attach, detach or list the terminal: the key opens it, and so does
// the window that owns it. The caller holds s.mu.
func (s *session) mayActLocked(caller Owner, key string) bool {
	return s.holdsKey(key) || (caller != nil && s.owner != nil && s.owner == caller)
}

// mayAct is mayActLocked for a caller that does not hold s.mu.
func (s *session) mayAct(caller Owner, key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mayActLocked(caller, key)
}

// ---- the lease ----

// heldLocked says a window has the terminal: a page is attached, and a window's call attached it. The caller
// holds s.mu.
func (s *session) heldLocked() bool { return !s.detached && s.owner != nil }

// detachLocked leaves the terminal waiting for a page for lease: its owner goes, its reader is held, and the
// lease runs. A terminal that is already detached stays as it is. It returns when the lease ends and, when a
// window held the terminal, how that window lost it (by): the page that held it is to be told. The caller holds
// s.mu.
func (s *session) detachLocked(lease time.Duration, by DetachedBy) (time.Time, *Detachment) {
	if s.detached {
		return s.leaseEnd, nil
	}
	var left *Detachment
	if s.heldLocked() {
		left = &Detachment{By: by, Attachment: s.attachment}
	}
	s.detached = true
	s.attached = false
	s.owner = nil
	s.offerUntil = time.Time{}
	s.flow.hold()
	s.leaseGen++
	gen := s.leaseGen
	s.leaseLen = lease
	s.leaseEnd = s.clock.Now().Add(lease)
	s.leaseTimer = s.clock.AfterFunc(lease, func() { s.expire(gen) })
	return s.leaseEnd, left
}

// takeOverLocked makes owner the owner of the terminal, as its next attachment: a lease that is running is over
// (the timer is stopped, and one that fires anyway finds its number is no longer the lease's). It returns how
// the window that held the terminal lost it, when one did: the page that held it is to be told. The caller
// holds s.mu.
func (s *session) takeOverLocked(owner Owner) *Detachment {
	var replaced *Detachment
	if s.heldLocked() {
		replaced = &Detachment{By: DetachedByTakeover, Attachment: s.attachment}
	}
	s.attachment++
	s.leaseGen++
	if s.leaseTimer != nil {
		s.leaseTimer.Stop()
		s.leaseTimer = nil
	}
	s.detached = false
	s.attached = true
	s.owner = owner
	s.leaseEnd = time.Time{}
	s.leaseLen = 0
	s.offerUntil = time.Time{}
	return replaced
}

// expire is what a lease that ran out does: end the terminal the way a close does, unless the lease is no longer
// the one that applies (a page attached, or the terminal is already ending). Whether it still applies and
// whether the terminal is ended are decided in one step under s.mu, so that an attach and an expiry that come
// together have exactly one winner.
func (s *session) expire(gen uint64) {
	s.mu.Lock()
	if gen != s.leaseGen || !s.detached || s.fate.set || s.ending.Load() {
		s.mu.Unlock()
		return
	}
	s.fate = fate{set: true, closedBy: ClosedByDetachTimeout, failure: nil}
	s.mu.Unlock()
	s.startClose()
}

// stopLease ends whatever lease is running, for good: the terminal is gone.
func (s *session) stopLease() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.leaseGen++
	if s.leaseTimer != nil {
		s.leaseTimer.Stop()
		s.leaseTimer = nil
	}
}

type releaseResult int

const (
	releaseNone releaseResult = iota
	releaseDetached
	releaseEnd
)

// release is what a window going away does to a terminal it owns: a terminal with a page key is detached (and
// the page that held it is to be told: the second result), any other is to be ended.
func (s *session) release(owner Owner) (releaseResult, *Detachment) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.owner == nil || s.owner != owner || s.fate.set || s.ending.Load() {
		return releaseNone, nil
	}
	if s.pageKey == "" {
		return releaseEnd, nil
	}
	_, left := s.detachLocked(s.lease, DetachedByWindow)
	return releaseDetached, left
}

// told tells the sink that a page lost the terminal, when one did. No lock is held.
func (m *Manager) told(s *session, left *Detachment) {
	if left != nil && m.detachments != nil {
		m.detachments.Detached(s.id, *left)
	}
}

// ReleaseOwned is what a window going away does to its terminals: those that have a page key are detached and
// kept for their lease, any other is ended, with by as the reason. When it returns the ended ones are gone.
func (m *Manager) ReleaseOwned(owner Owner, by ClosedBy) Released {
	var done Released
	if owner == nil || checkOwner(owner) != nil {
		return done
	}
	var ending []*session
	for _, s := range m.sessionList() {
		switch result, left := s.release(owner); result {
		case releaseDetached:
			m.told(s, left)
			done.Detached++
		case releaseEnd:
			s.beginClose(by)
			ending = append(ending, s)
			done.Ended++
		case releaseNone:
		}
	}
	m.awaitGone(ending)
	return done
}

// CloseUnlessTakenOver ends a terminal that a call failed to hand to owner's window (the window was retired
// while the call ran), unless another window took it over meanwhile: a terminal that has been attached stays as
// it is, whether that window still has it or has let it go again (it waits for its lease). The window that made
// the terminal held attachment 0, so one that nobody attached is ended the way a close ends it, whether it still
// belongs to owner or the retirement of the failed window detached it. It says whether it ended the terminal.
// The ownership is read and the terminal is ended in one step under the session's lock, so that an attach that
// comes together with it has exactly one winner.
func (m *Manager) CloseUnlessTakenOver(sessionID string, owner Owner) bool {
	s, err := m.live(sessionID)
	if err != nil || checkOwner(owner) != nil {
		return false
	}
	s.mu.Lock()
	if (s.owner != nil && s.owner != owner) || s.attachment != 0 || s.fate.set || s.ending.Load() {
		s.mu.Unlock()
		return false
	}
	s.fate = fate{set: true, closedBy: ClosedByWindow, failure: nil}
	s.mu.Unlock()
	s.startClose()
	m.awaitGone([]*session{s})
	return true
}

func (m *Manager) sessionList() []*session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

// Detach leaves a terminal waiting for a page for a lease, as a window going away does, without ending the
// window: the page says it is leaving. Zero is the terminal's own lease, and more than LeaseMax is cut to it;
// the answer says the lease that applies. A terminal that is detached stays as it is. The window that owns the
// terminal detaches it, and the key detaches only a terminal that no window owns: a page that was displaced (a
// duplicated tab shares the key) cannot detach what the page that took the terminal over shows.
func (m *Manager) Detach(sessionID string, caller Owner, req DetachRequest) (Detached, error) {
	var none Detached
	if err := checkOwner(caller); err != nil {
		return none, err
	}
	if req.LeaseMs < 0 {
		return none, invalidError("lease_ms must not be negative.")
	}
	s, err := m.live(sessionID)
	if err != nil {
		return none, err
	}
	detached, left, err := s.detach(caller, req)
	if err != nil {
		return none, err
	}
	m.told(s, left)
	return detached, nil
}

func (s *session) detach(caller Owner, req DetachRequest) (Detached, *Detachment, error) {
	var none Detached
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case !s.mayActLocked(caller, req.PageKey):
		return none, nil, apperror.SessionNotFound(s.id)
	case s.owner != nil && s.owner != caller:
		// The key is held by every tab that was copied from the page, and the owner is the one that attached last.
		return none, nil, apperror.SessionNotFound(s.id)
	case s.pageKey == "":
		return none, nil, notReattachableError(s.id)
	case s.fate.set || s.ending.Load():
		return none, nil, apperror.SessionNotFound(s.id)
	}
	end, left := s.detachLocked(leaseOf(s.lease, req.LeaseMs), DetachedByRequest)
	return Detached{LeaseMs: int(s.leaseLen / time.Millisecond), LeaseExpiresUnixMs: end.UnixMilli()}, left, nil
}

// ---- the attach ----

// Attach hands a page the terminal it left, in one step that is ordered with the output: the replay is exactly
// the bytes from the offset the page has (or from the start of what the host kept) to the end, and the events
// that follow it start at that end, so that none at or above it is lost. An event whose bytes the replay holds
// was handed to the sink before the attach answered, and may still be on its way to the page, which the transport
// does not order with the answer: the page drops what it has. The terminal belongs to the caller from then on, as
// its next attachment, and the page that held it is told. Whoever has the key, or is the window that owns the
// terminal, may attach; any other is told what is told of a terminal that is not there.
func (m *Manager) Attach(sessionID string, caller Owner, req AttachRequest) (*Attached, error) {
	if err := checkOwner(caller); err != nil {
		return nil, err
	}
	s, tomb := m.find(sessionID)
	if s != nil {
		attached, err := m.attachLive(s, caller, req)
		if !errors.Is(err, errEndingByItself) {
			return attached, err
		}
		// The shell ended by itself: it leaves its end, and the page that is attaching is owed it.
		s.awaitDone(closeWait)
		_, tomb = m.find(sessionID)
	}
	if tomb == nil || !tomb.holdsKey(req.PageKey) {
		return nil, apperror.SessionNotFound(sessionID)
	}
	m.mu.Lock()
	tomb.owner = caller
	m.mu.Unlock()
	return tomb.attached(req.FromOffset)
}

func (m *Manager) attachLive(s *session, caller Owner, req AttachRequest) (*Attached, error) {
	hand, err := s.takeOver(caller, req)
	if err != nil {
		return nil, err
	}
	m.told(s, hand.replaced)
	// The directory and the foreground are read from the system, outside the locks.
	path, reason := s.directory()
	busy := UnknownForeground(ReasonQueryFailed)
	if shell, group, known := s.groups(); known {
		busy = foregroundOf(shell, group)
	}
	return &Attached{
		Session: s.info, Replay: hand.view.replay(), Cwd: Directory{Path: path, Reason: reason}, Busy: busy, Ended: nil,
		Attachment: hand.attachment, NextInputSeq: s.queue.expects(),
	}, nil
}

// handOver is what a takeover decided: the replay the page is owed, the number of its attachment, and how the
// window that held the terminal lost it, when one did.
type handOver struct {
	view       replayView
	attachment uint64
	replaced   *Detachment
}

// takeOver is the atomic part of an attach: the reader is waited for first (a read that is on its way to the
// sink is out before the snapshot, none is numbered during it), then under s.mu the caller is checked, the
// replay is taken under the output lock together with the reader's credit (what was in flight and the old
// client's acknowledgements are forgotten, and the hold is over), and the terminal is the caller's, with no lease
// running. Nothing is changed when anything is refused.
func (s *session) takeOver(caller Owner, req AttachRequest) (handOver, error) {
	var none handOver
	if s.pageKey != "" {
		// A caller that may not attach does not hold up the reader: the check is made again under the locks.
		if !s.mayAct(caller, req.PageKey) {
			return none, apperror.SessionNotFound(s.id)
		}
		s.emitMu.Lock()
		defer s.emitMu.Unlock()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case !s.mayActLocked(caller, req.PageKey):
		return none, apperror.SessionNotFound(s.id)
	case s.pageKey == "":
		return none, notReattachableError(s.id)
	case s.fate.set || s.ending.Load():
		if s.fate.closedBy == "" {
			return none, errEndingByItself
		}
		return none, apperror.SessionNotFound(s.id)
	}
	s.outMu.Lock()
	view, err := s.ring.view(req.FromOffset)
	if err == nil {
		s.flow.restart()
	}
	s.outMu.Unlock()
	if err != nil {
		return none, err
	}
	replaced := s.takeOverLocked(caller)
	return handOver{view: view, attachment: s.attachment, replaced: replaced}, nil
}

// awaitDone waits, for at most wait, for the session to be gone.
func (s *session) awaitDone(wait time.Duration) {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-s.done:
	case <-timer.C:
	}
}

// ---- the list ----

// List says which terminals a page may attach: those whose key it holds, and those its window owns. A terminal
// without a key is never listed, and the key never is. A terminal that ended by itself while no page was
// attached is listed with how it ended, for what is left of its lease.
func (m *Manager) List(caller Owner, key string) []Listed {
	if checkOwner(caller) != nil {
		caller = nil
	}
	m.mu.RLock()
	sessions := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	tombs := slices.Clone(m.tombs)
	m.mu.RUnlock()

	out := make([]Listed, 0, len(sessions)+len(tombs))
	for _, s := range sessions {
		if listed, ok := s.listed(caller, key); ok {
			out = append(out, listed)
		}
	}
	now := m.clock.Now()
	for _, t := range tombs {
		if t.holdsKey(key) && now.Before(t.until) {
			out = append(out, t.listed())
		}
	}
	slices.SortFunc(out, func(a, b Listed) int {
		return cmp.Or(a.CreatedAt.Compare(b.CreatedAt), strings.Compare(a.ID, b.ID))
	})
	return out
}

// listed is the terminal as a page sees it in a list; it says false for a terminal the caller may not see. A
// terminal that is ending because the host ended it is not listed; one whose shell ended by itself is, until its
// end is kept.
func (s *session) listed(caller Owner, key string) (Listed, bool) {
	var none Listed
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pageKey == "" || (s.fate.set && s.fate.closedBy != "") || !s.mayActLocked(caller, key) {
		return none, false
	}
	s.outMu.Lock()
	next, first, size := s.ring.end, s.ring.start(), s.ring.size(s.ring.end)
	s.outMu.Unlock()
	var expires int64
	if s.detached {
		expires = s.leaseEnd.UnixMilli()
	}
	return Listed{
		ID: s.id, CreatedAt: s.info.CreatedAt, PID: s.info.PID, Shell: s.info.Shell, Labels: nonNil(s.labels), Params: nonNil(s.params),
		Size: size, Attached: !s.detached, NextOffset: next, ReplayStart: first, NextInputSeq: s.queue.expects(), LeaseExpiresUnixMs: expires, Ended: nil,
	}, true
}

// ---- what is left of a terminal that ended while no page was attached ----

// tombstone is the end of a terminal that has a page key and ended by itself, and what it wrote: the page that
// comes back reads how it ended, for what is left of the lease it was kept under.
type tombstone struct {
	id    string
	key   string
	info  Session
	ring  *replayRing
	end   End
	until time.Time
	// attachment is the number of the last attachment the terminal had.
	attachment uint64
	labels     map[string]string
	params     map[string]string
	// owner is the window that holds the end: the one the terminal belonged to when it ended, or the last that
	// attached it. Only that window may dismiss it. Manager.mu guards it.
	owner Owner
}

func (t *tombstone) holdsKey(key string) bool {
	return subtle.ConstantTimeCompare([]byte(t.key), []byte(key)) == 1
}

func (t *tombstone) attached(from *uint64) (*Attached, error) {
	view, err := t.ring.view(from)
	if err != nil {
		return nil, err
	}
	return &Attached{
		Session: t.info, Replay: view.replay(), Cwd: Directory{Path: "", Reason: ReasonEnded}, Busy: UnknownForeground(ReasonEnded), Ended: new(t.end),
		Attachment: t.attachment, NextInputSeq: 0,
	}, nil
}

func (t *tombstone) listed() Listed {
	return Listed{
		ID: t.id, CreatedAt: t.info.CreatedAt, PID: t.info.PID, Shell: t.info.Shell, Labels: nonNil(t.labels), Params: nonNil(t.params),
		Size: t.ring.size(t.ring.end), Attached: false, NextOffset: t.ring.end, ReplayStart: t.ring.start(), NextInputSeq: 0,
		LeaseExpiresUnixMs: t.until.UnixMilli(), Ended: new(t.end),
	}
}

// keepTombstone remembers how a terminal ended, when a page may be waiting to read it: the terminal has a key and
// its shell ended by itself (a close of the host's has nothing to tell). The oldest tombstone goes when there
// are TombstoneLimit, and each is freed by a timer when its lease is over.
func (m *Manager) keepTombstone(s *session, end End) {
	if s.pageKey == "" || end.Reason == EndClosed {
		return
	}
	s.outMu.Lock()
	frozen := s.ring.freeze()
	s.outMu.Unlock()
	now := m.clock.Now()
	until, attachment := s.tombstoneTerms(now)
	t := &tombstone{
		id: s.id, key: s.pageKey, info: s.info, ring: frozen, end: end, until: until, attachment: attachment,
		labels: s.labels, params: s.params, owner: s.ownerNow(),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneTombstonesLocked(now)
	m.tombs = append(m.tombs, t)
	if len(m.tombs) > TombstoneLimit {
		m.tombs = slices.Delete(m.tombs, 0, len(m.tombs)-TombstoneLimit)
	}
	m.armTombstoneTimerLocked(now)
}

// tombstoneTerms are when the tombstone of the terminal is forgotten and the number of its last attachment. The
// tombstone is forgotten at the end of the lease in effect when the terminal ended, which is the lease a page
// detached it with when it was detached, and the terminal's own lease from now when it was attached.
func (s *session) tombstoneTerms(now time.Time) (time.Time, uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.detached {
		return s.leaseEnd, s.attachment
	}
	return now.Add(s.lease), s.attachment
}

// pruneTombstonesLocked forgets the tombstones whose lease has passed. The caller holds m.mu.
func (m *Manager) pruneTombstonesLocked(now time.Time) {
	m.tombs = slices.DeleteFunc(m.tombs, func(t *tombstone) bool { return !now.Before(t.until) })
}

// armTombstoneTimerLocked leaves one timer, waiting for the tombstone that expires first, or none when there is
// no tombstone to wait for or the host is shutting down. The caller holds m.mu.
func (m *Manager) armTombstoneTimerLocked(now time.Time) {
	if m.tombTimer != nil {
		m.tombTimer.Stop()
		m.tombTimer = nil
	}
	if m.closing.Load() || len(m.tombs) == 0 {
		return
	}
	first := m.tombs[0].until
	for _, t := range m.tombs[1:] {
		if t.until.Before(first) {
			first = t.until
		}
	}
	m.tombTimer = m.clock.AfterFunc(max(first.Sub(now), 0), m.expireTombstones)
}

// expireTombstones is what the timer does: free the tombstones whose lease is over, and wait for the next.
func (m *Manager) expireTombstones() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.clock.Now()
	m.pruneTombstonesLocked(now)
	m.armTombstoneTimerLocked(now)
}

// find is the session of an id, or the tombstone of one that ended and is kept.
func (m *Manager) find(id string) (*session, *tombstone) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s := m.sessions[id]; s != nil {
		return s, nil
	}
	now := m.clock.Now()
	for _, t := range m.tombs {
		if t.id == id && now.Before(t.until) {
			return nil, t
		}
	}
	return nil, nil
}

// dropTombstone forgets a tombstone, and says whether there was one.
func (m *Manager) dropTombstone(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.dropTombstoneLocked(id)
}

// dropTombstoneLocked is dropTombstone for a caller that holds m.mu.
func (m *Manager) dropTombstoneLocked(id string) bool {
	before := len(m.tombs)
	m.tombs = slices.DeleteFunc(m.tombs, func(t *tombstone) bool { return t.id == id })
	return len(m.tombs) != before
}
