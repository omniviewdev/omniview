package exec

import (
	"context"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
)

// A session belongs to the window that opened it, and every call that names a session by its id alone asks
// whether the window that makes the call holds it. One that does not is told what is told of an id that never was:
// not found, whether the session is there, whose it is or that it exists. That is the boundary between windows: a
// window cannot read, type into, resize or end the session of another, and cannot learn that it is there (the
// window's id is the one the host's realm issued: no page can name another's).
//
// A local terminal is held by the terminal manager (terminal.Manager.Authorize): the window that opened it, or the
// page that attached it with its key. A session of a plugin is held by the window that created it, as recorded in
// the session index. It outlives its window, and then belongs to none: any window may list it and attach it, which
// makes that window its owner (the page that reloaded finds the sessions it had). A window that moves a tab to
// another offers the session first (OfferSession): the next window to attach it within terminal.OfferTTL holds it,
// once.
//
// What this is not: a boundary against the code of the page. A plugin's UI runs in the page of the window and
// makes its calls with that window's identity, so it holds what the page holds (docs/ui-next/status/T2c-go.md).

// sessionOwner is owner when it can be taken for a window, and none otherwise.
func (*controller) sessionOwner(owner terminal.Owner) terminal.Owner {
	if terminal.ValidOwner(owner) {
		return owner
	}
	return nil
}

// holds says whether owner holds the session the index describes.
func (c *controller) holds(index sessionIndex, sessionID string, owner terminal.Owner) bool {
	if !terminal.ValidOwner(owner) {
		return false
	}
	if index.local {
		return c.terminalManager != nil && c.terminalManager.Authorize(sessionID, owner) == nil
	}
	return index.owner != nil && index.owner == owner
}

// claimable says whether the session is one that no window holds and owner is a window: any window may list it, read
// its facts, adopt it with one call (attach) and end it. Nothing else of it is open to a window that does not hold it, and
// a session whose end the host has decided (commitClose) is open to none: it is going, and claimSession refuses it.
func (*controller) claimable(index sessionIndex, owner terminal.Owner) bool {
	return !index.local && index.owner == nil && !index.closing && terminal.ValidOwner(owner)
}

// visible says whether owner may read the facts of the session (GetSession): it holds it, or it is a session of a
// plugin that no window holds, which any window may list.
func (c *controller) visible(index sessionIndex, sessionID string, owner terminal.Owner) bool {
	return c.holds(index, sessionID, owner) || c.claimable(index, owner)
}

// listable says whether a session of a plugin that the plugin lists is listed to owner.
func (c *controller) listable(sessionID string, owner terminal.Owner) bool {
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	return ok && !index.local && !index.ended && c.visible(index, sessionID, owner)
}

// claimSession decides the attach of a session of a plugin: the window that holds it attaches it; so does any
// window when none holds it, or when its owner offered it and the offer is open, and that window holds it from
// then on (the offer is used once). Any other is told what is told of an id that never was, and so is every window
// that does not hold a session whose end the host has decided (commitClose): it is going, and taking it would hand
// the window a session that is about to be gone.
func (c *controller) claimSession(sessionID string, owner terminal.Owner) error {
	if !terminal.ValidOwner(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	now := c.clock()
	c.mu.Lock()
	defer c.mu.Unlock()
	index, ok := c.sessionIndex[sessionID]
	switch {
	case !ok:
		return apperror.SessionNotFound(sessionID)
	case index.owner != nil && index.owner == owner:
		return nil
	case index.closing:
		return apperror.SessionNotFound(sessionID)
	case index.owner == nil || (!index.offerUntil.IsZero() && now.Before(index.offerUntil)):
		index.owner, index.offerUntil = owner, time.Time{}
		c.sessionIndex[sessionID] = index
		return nil
	}
	return apperror.SessionNotFound(sessionID)
}

// OfferSession lets the next window that attaches the session take it over, for terminal.OfferTTL, once: the move of
// a tab to another window. Only the window that holds the session offers it, and the offer gives no other window
// access: it is a right to attach.
func (c *controller) OfferSession(owner terminal.Owner, sessionID string) error {
	index, _, ok := c.lookupSession(sessionID)
	if !ok || !c.holds(index, sessionID, owner) {
		return apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.Offer(sessionID, owner, terminal.OfferTTL)
	}
	now := c.clock()
	c.mu.Lock()
	defer c.mu.Unlock()
	index, ok = c.sessionIndex[sessionID]
	if !ok || index.owner == nil || index.owner != owner {
		return apperror.SessionNotFound(sessionID)
	}
	index.offerUntil = now.Add(terminal.OfferTTL)
	c.sessionIndex[sessionID] = index
	return nil
}

// commitClose is where the end of a session of a plugin is decided, for the window that asks for it. CloseSession
// checks the window early, on a copy of the record that any other call changes at any moment, and the plugin is
// asked after that (and after a lookup of the connection that takes as long as it takes): a window that took the
// session in between, by adopting what no window held or by using an offer, would have it ended by a window that no
// longer holds it. So the right of the window is read again here, from the record as it is now, and the decision
// (the record says the host is closing the session, which claimSession then refuses to hand to anyone else) is
// written in the same step. It holds c.mu and no more: the plugin is asked after it returns.
//
// It says true when there is nothing left for the plugin to do: the session ended by itself meanwhile, or the record
// was one that only kept the output of a session that had ended.
func (c *controller) commitClose(sessionID string, owner terminal.Owner) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	index, found := c.sessionIndex[sessionID]
	switch {
	case !found:
		return true, nil
	case index.local || !c.visible(index, sessionID, owner):
		return false, apperror.SessionNotFound(sessionID)
	case index.ended:
		delete(c.sessionIndex, sessionID)
		return true, nil
	}
	index.closing = true
	c.sessionIndex[sessionID] = index
	return false, nil
}

// orphanSessionsOf is what a window going away does to its sessions of plugins: they go on, and no window holds
// them. It says how many there were.
func (c *controller) orphanSessionsOf(owner terminal.Owner) int {
	if !terminal.ValidOwner(owner) {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for guard := range c.creating[owner] {
		guard.retired = true
	}
	orphaned := 0
	for id, index := range c.sessionIndex {
		if !index.local && index.owner != nil && index.owner == owner {
			index.owner, index.offerUntil = nil, time.Time{}
			c.sessionIndex[id] = index
			orphaned++
		}
	}
	return orphaned
}

// RevokeSession takes back the offer of a session: the next window that attaches it finds none. Only the window that
// holds the session revokes; an offer that is not open is nothing to take back, and no error.
func (c *controller) RevokeSession(owner terminal.Owner, sessionID string) error {
	index, _, ok := c.lookupSession(sessionID)
	if !ok || !c.holds(index, sessionID, owner) {
		return apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.Revoke(sessionID, owner)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	index, ok = c.sessionIndex[sessionID]
	if !ok || index.owner == nil || index.owner != owner {
		return apperror.SessionNotFound(sessionID)
	}
	index.offerUntil = time.Time{}
	c.sessionIndex[sessionID] = index
	return nil
}

// createGuard stands for a session of a plugin that is being made for a window. The window can retire while the plugin makes it
// (the plugin has no deadline), and the retirement, which came before the session was recorded, found nothing of the window's
// to orphan: the session would be recorded as the retired window's, and nobody could list it, claim it or end it. The retirement
// (orphanSessionsOf) marks every guard of the window, under c.mu, and the session is recorded as no window's when its guard was
// marked, whatever the realm remembers of the window by then: the realm forgets a closed window after a minute. The guard is
// registered before the window is admitted, so a retirement that comes after the admission, at any moment until the session is
// recorded, is seen here, and one before it is refused by the realm.
type createGuard struct {
	owner terminal.Owner
	// retired says the window retired while the session was being made. c.mu guards it.
	retired bool
}

type createGuardKey struct{}

// GuardSessionCreate notes that a session of a plugin is being made for owner, and returns the context to make it with and the
// function that ends the note (call it when the session is recorded or the call failed).
func (c *controller) GuardSessionCreate(ctx context.Context, owner terminal.Owner) (context.Context, func()) {
	guard := &createGuard{owner: owner, retired: false}
	if terminal.ValidOwner(owner) {
		c.mu.Lock()
		if c.creating[owner] == nil {
			c.creating[owner] = make(map[*createGuard]struct{})
		}
		c.creating[owner][guard] = struct{}{}
		c.mu.Unlock()
	}
	return context.WithValue(ctx, createGuardKey{}, guard), func() { c.endGuard(guard) }
}

func (c *controller) endGuard(guard *createGuard) {
	if !terminal.ValidOwner(guard.owner) {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.creating[guard.owner], guard)
	if len(c.creating[guard.owner]) == 0 {
		delete(c.creating, guard.owner)
	}
}

// publishedOwner is the window a session that has just been made is recorded for: owner, unless it retired meanwhile, and no
// window when it is no window. The caller holds c.mu.
func (c *controller) publishedOwner(owner terminal.Owner, guard *createGuard) terminal.Owner {
	if guard != nil && guard.retired {
		return nil
	}
	return c.sessionOwner(owner)
}
