package exec

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// A session of a plugin that ends by itself while no window is attached (a command that prints and exits at
// once: echo hi, a failed kubectl exec) leaves its output with the plugin for the first attach to it (the
// exec manager of plugin-sdk v0.22.1: at most 32 sessions, a minute, nothing for a session the host closed
// or one that was attached when it ended). A window attaches after it has created the session, so for a
// short command the attach comes after the session has ended and sent its CLOSE, and the host, which used to
// forget the session at CLOSE, said "not found" before it asked the plugin.
//
// So the host remembers such a session, marked ended, as the plugin remembers its output: until the first
// attach, a close or a detach of it, the unload of its plugin, endedSessionTTL after the CLOSE, or until
// endedSessionLimit newer ones push it out. A session that was attached when it ended, or that the host
// closed, is over for everyone, and its record goes at CLOSE as it always did. Expiry is checked when a
// record is looked up and when another is made: there is no timer.
//
// An ended session is not a session a window can use. Every call except the three that have something to do
// with its end (attach, detach, close) finds it as it found a session after its CLOSE before: not found.

// sessionClosed is the host's answer to the CLOSE signal of a session of a plugin, the last thing it sends. It decides
// whose session the id is and acts on the record in one critical section: a plugin that records a session with this id
// after the frame was let through (dispatchProviderOutput) keeps it, and the answer is false: nothing was ended, and
// the windows are not told. A CLOSE that finds no record is remembered (endedFirst): the plugin's answer to the create of
// a short command can be read after the command has ended and said so, and that create then records the session ended.
func (c *controller) sessionClosed(sessionID, pluginID string) bool {
	now := c.clock()
	c.mu.Lock()
	record, recorded := c.sessionIndex[sessionID]
	if heldByAnother(record, recorded, pluginID, c.channelHoldsLocked(sessionID)) {
		c.mu.Unlock()
		return false
	}
	if !recorded {
		c.rememberEndedFirstLocked(sessionID, pluginID, now)
	}
	kept := c.recordCloseLocked(sessionID, now)
	c.mu.Unlock()
	if kept {
		c.logger.Debugw(context.Background(), "session ended with nobody attached; its output waits for the first attach",
			"sessionID", sessionID)
	}
	return true
}

// endedFirst is a CLOSE that came before the record of its session: the plugin that sent it, and when.
type endedFirst struct {
	pluginID string
	at       time.Time
}

// rememberEndedFirstLocked keeps the CLOSE of a session that has no record, for the create that records it, as the ended
// records are kept: for endedSessionTTL, and endedSessionLimit of them at most (a CLOSE no create follows, of a session the
// host has already forgotten, goes so). The caller holds c.mu.
func (c *controller) rememberEndedFirstLocked(sessionID, pluginID string, now time.Time) {
	for id, first := range c.endedFirst {
		if now.Sub(first.at) > endedSessionTTL {
			delete(c.endedFirst, id)
		}
	}
	for len(c.endedFirst) >= endedSessionLimit {
		oldest := ""
		for id, first := range c.endedFirst {
			if oldest == "" || first.at.Before(c.endedFirst[oldest].at) {
				oldest = id
			}
		}
		delete(c.endedFirst, oldest)
	}
	c.endedFirst[sessionID] = endedFirst{pluginID: pluginID, at: now}
}

// recordCloseLocked decides the record of a session that has sent its CLOSE, and says whether it stays, marked
// ended. The caller holds c.mu.
func (c *controller) recordCloseLocked(sessionID string, now time.Time) bool {
	record, found := c.sessionIndex[sessionID]
	if !found || record.ended {
		return false
	}
	if record.local || record.attached || record.closing {
		delete(c.sessionIndex, sessionID)
		return false
	}

	c.makeRoomForEndedLocked(now)
	record.ended = true
	record.endedAt = now
	record.endedSeq = c.endedCount
	c.endedCount++
	c.sessionIndex[sessionID] = record

	return true
}

// makeRoomForEndedLocked drops the ended records that have expired, and then the oldest, until there is
// room for one more. The caller holds c.mu.
func (c *controller) makeRoomForEndedLocked(now time.Time) {
	ended := 0
	for id, record := range c.sessionIndex {
		switch {
		case !record.ended:
		case now.Sub(record.endedAt) > endedSessionTTL:
			delete(c.sessionIndex, id)
		default:
			ended++
		}
	}

	for ; ended >= endedSessionLimit; ended-- {
		var (
			oldest string
			seq    uint64
			found  bool
		)
		for id, record := range c.sessionIndex {
			if record.ended && (!found || record.endedSeq < seq) {
				oldest, seq, found = id, record.endedSeq, true
			}
		}
		delete(c.sessionIndex, oldest)
	}
}

// lookupSessionOrEnded is lookupSession for the three calls that have something to do with a session that has
// ended: the attach that asks for its output, a detach and a close. A record that has outlived the plugin's
// keeping is gone.
func (c *controller) lookupSessionOrEnded(sessionID string) (sessionIndex, Provider, bool) {
	now := c.clock()
	c.mu.Lock()
	defer c.mu.Unlock()
	record, found := c.sessionIndex[sessionID]
	if !found {
		var none sessionIndex

		return none, nil, false
	}
	if record.ended && now.Sub(record.endedAt) > endedSessionTTL {
		delete(c.sessionIndex, sessionID)
		var none sessionIndex

		return none, nil, false
	}

	return record, c.clients[record.pluginID], true
}

// attachAnswered records what the plugin answered to an attach. The output of an ended session is for one
// attach, whatever the answer; a session the plugin does not know has nothing left to attach to; a window that
// attached is attached, and a session that ends while it is leaves no record.
func (c *controller) attachAnswered(sessionID string, answer error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	record, found := c.sessionIndex[sessionID]
	if !found || record.local {
		return
	}

	switch {
	case record.ended, sessionGone(answer):
		delete(c.sessionIndex, sessionID)
	case answer == nil:
		record.attached = true
		c.sessionIndex[sessionID] = record
	}
}

// detachStarted notes that the window is away, before the plugin is asked: a CLOSE that comes while the call
// is on its way finds a session whose window has gone, and the plugin keeps its output for the next attach.
func (c *controller) detachStarted(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if record, found := c.sessionIndex[sessionID]; found && !record.local {
		record.attached = false
		c.sessionIndex[sessionID] = record
	}
}

// closeStarted notes that the end of the session is the host's, before the plugin is asked: the plugin keeps
// no output of a session the host closed, so the CLOSE that follows is its end for everyone.
func (c *controller) closeStarted(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if record, found := c.sessionIndex[sessionID]; found && !record.local {
		record.closing = true
		c.sessionIndex[sessionID] = record
	}
}

// forgetSession drops the record of a session.
func (c *controller) forgetSession(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.sessionIndex, sessionID)
}

// sessionGone says whether a plugin's answer about a session is that it has no such session. Over gRPC that is
// the status NotFound (the SDK's server sends its SESSION_NOT_FOUND so); a provider in the host's process
// returns the SDK's own error, and a provider that classifies its errors says NOT_FOUND.
func sessionGone(err error) bool {
	if err == nil {
		return false
	}

	return status.Code(err) == codes.NotFound ||
		errors.Is(err, exec.ErrSessionNotFound) ||
		resourcev2.ErrorCode(err) == "NOT_FOUND"
}
