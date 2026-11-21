package resource

import (
	"context"
	"slices"
	"sync"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// connectionCallKey names the connection of one plugin that a start or stop
// call works on. It deliberately does not name a provider generation: a call
// that outlives its generation keeps its connection until its plugin call
// returns, as it did while it held profilesMu.
type connectionCallKey struct {
	plugin     string
	connection string
}

// transactionWait is the place in line of one profile transaction that waits
// for a plugin.
type transactionWait struct {
	plugin string
}

// verdict is what the registry decides for a start, a stop or a transaction.
type verdict uint8

const (
	// verdictProceed means the call is registered, or the transaction may run.
	verdictProceed verdict = iota
	// verdictWait means the caller has to wait for the returned channel, and
	// then ask again.
	verdictWait
	// verdictReentry means the caller is inside the very call it would wait for.
	verdictReentry
)

// connectionCalls registers the connection start and stop calls that run
// without profilesMu, and orders them against the profile transactions of the
// same plugin. Its mutex is a leaf: nothing else is acquired while it is held.
//
// Ordering. Starts and stops of different connections of a plugin overlap
// freely. A profile transaction (load, watch refresh, replay or profile change)
// waits until its plugin has no registered call. From the moment it has to wait,
// a new start or stop of that plugin waits behind it, until it has run. Calls
// already in flight finish normally, other plugins are not held back, and the
// waits for calls and for a place in line end with the context of their caller
// (the plain profile lock below does not). There is no ageing and no timer:
// this plain priority is what keeps starts that overlap one another from
// keeping a transaction waiting for ever. Transactions that wait for one plugin
// run one at a time, in the order in which they began to wait, and before the
// calls that queued behind them.
//
// A start or stop made from inside a registered call of the same plugin, with
// the mark of that call (see WithinConnectionCall), is part of the call and is
// not held back: the transaction waits for the call, so holding back the call's
// own work would make both wait for ever. Without the mark such a start or stop
// cannot be told from a new one and queues like it.
//
// Rule for code that runs inside a provider's start or stop of plugin P, which
// means the provider's callbacks into the host (made in process with the
// context the provider was given, or served from the plugin process for this
// call): use plain-lock reads only.
//
//   - Safe, because they never wait for a registered call: every exported
//     controller path not listed below, ListConnectionProfiles among them (it
//     takes profilesMu only to read), and the start or stop of a connection of
//     another plugin.
//   - Safe with the mark of the call, because a profile transaction of P that
//     waits for the call holds back the new calls of P that have no mark: the
//     start or stop of another connection of P.
//   - Self-waiting, because they wait for the registered calls of P and so for
//     the one they are inside: LoadConnections(P), SaveConnectionProfile(P),
//     ImportConnectionProfile(P), ResetConnectionProfile(P),
//     RemoveConnection(P) and the connection watch refresh of P
//     (lockProfilesQuiescent), StartConnection or StopConnection of the same
//     connection (beginConnectionCall), and OnPluginStart(P), which loads the
//     connections with a context of its own.
//
// A self-waiting path returns INVALID_REQUEST at once when its context is marked
// with the call it would wait for (see WithinConnectionCall). Without the mark,
// and always for OnPluginStart, it waits for the registered calls until its own
// context ends.
//
// What ends with the caller's context, and what does not. The wait for a
// registered call holds no lock and ends with the context. The plain
// profilesMu.Lock that every start, stop and profile transaction takes first,
// and takes again after each wake-up, does not: sync.Mutex cannot be waited on
// with a context, so a caller whose context has ended keeps waiting there until
// the holder unlocks. The holders that matter keep profilesMu across their own
// plugin calls: a profile transaction, discovery (LoadConnections and the watch
// refresh) and ListConnectionProfiles (its NativeConnections call). A start or
// stop whose context was cancelled returns only after such a plugin call
// returns, as it did before the registry existed.
type connectionCalls struct {
	mu     sync.Mutex
	active map[connectionCallKey]struct{}
	// waiting lists, for each plugin, the profile transactions that wait for it
	// to go quiet, in the order in which they began to wait.
	waiting map[string][]*transactionWait
	// ended is closed, then replaced on demand, whenever a call ends or a line
	// changes. A waiter keeps the channel it was given, so a change that happens
	// before the waiter selects still wakes it.
	ended chan struct{}
}

// begin registers key, unless a call holds it, or a transaction of its plugin
// waits and inside, the mark of the caller's context (nil if it has none), does
// not name a registered call of that plugin. In those cases it registers nothing
// and returns verdictWait with a channel that closes when a call ends or a line
// changes. If inside names the call that holds key, it returns verdictReentry.
func (calls *connectionCalls) begin(key connectionCallKey, inside *connectionCallKey) (<-chan struct{}, verdict) {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	if _, held := calls.active[key]; held {
		if inside != nil && *inside == key {
			return nil, verdictReentry
		}
		return calls.endedLocked(), verdictWait
	}
	if len(calls.waiting[key.plugin]) != 0 && !calls.insideLocked(inside, key.plugin) {
		return calls.endedLocked(), verdictWait
	}
	if calls.active == nil {
		calls.active = make(map[connectionCallKey]struct{})
	}
	calls.active[key] = struct{}{}
	return nil, verdictProceed
}

// quiesce lets the transaction of wait.plugin run once the plugin has no
// registered call and every transaction that began to wait before it has run. A
// transaction that has to wait takes its place in line the first time it asks
// and keeps it until it runs or gives up (see leave). It gets verdictReentry,
// and no place in line, if inside, the mark of its context (nil if it has none),
// names a registered call of the plugin: it would wait for that call.
func (calls *connectionCalls) quiesce(wait *transactionWait, inside *connectionCallKey) (<-chan struct{}, verdict) {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	line := calls.waiting[wait.plugin]
	busy := calls.busyLocked(wait.plugin)
	switch {
	case busy && calls.insideLocked(inside, wait.plugin):
		return nil, verdictReentry
	case slices.Contains(line, wait):
		if busy || line[0] != wait {
			return calls.endedLocked(), verdictWait
		}
		calls.leaveLocked(wait)
		return nil, verdictProceed
	case busy || len(line) != 0:
		calls.enterLocked(wait)
		return calls.endedLocked(), verdictWait
	default:
		return nil, verdictProceed
	}
}

// leave gives up the place in line of wait. It does nothing if wait has none.
func (calls *connectionCalls) leave(wait *transactionWait) {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	calls.leaveLocked(wait)
}

// registered reports whether a call is registered for key.
func (calls *connectionCalls) registered(key connectionCallKey) bool {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	_, held := calls.active[key]
	return held
}

func (calls *connectionCalls) end(key connectionCallKey) {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	delete(calls.active, key)
	calls.broadcastLocked()
}

// busyLocked reports whether any call of the plugin is registered.
func (calls *connectionCalls) busyLocked(plugin string) bool {
	for key := range calls.active {
		if key.plugin == plugin {
			return true
		}
	}
	return false
}

// insideLocked reports whether mark names a registered call of the plugin.
func (calls *connectionCalls) insideLocked(mark *connectionCallKey, plugin string) bool {
	if mark == nil || mark.plugin != plugin {
		return false
	}
	_, registered := calls.active[*mark]
	return registered
}

// enterLocked puts wait last in the line of its plugin.
func (calls *connectionCalls) enterLocked(wait *transactionWait) {
	if calls.waiting == nil {
		calls.waiting = make(map[string][]*transactionWait)
	}
	calls.waiting[wait.plugin] = append(calls.waiting[wait.plugin], wait)
	calls.broadcastLocked()
}

// leaveLocked takes wait out of the line of its plugin, if it is in it, and
// wakes every waiter: the calls queued behind it may go on, and the next
// transaction is first in line.
func (calls *connectionCalls) leaveLocked(wait *transactionWait) {
	line := calls.waiting[wait.plugin]
	i := slices.Index(line, wait)
	if i < 0 {
		return
	}
	if len(line) == 1 {
		delete(calls.waiting, wait.plugin)
	} else {
		calls.waiting[wait.plugin] = slices.Delete(line, i, i+1)
	}
	calls.broadcastLocked()
}

// broadcastLocked wakes every waiter that holds the current channel.
func (calls *connectionCalls) broadcastLocked() {
	if calls.ended != nil {
		close(calls.ended)
		calls.ended = nil
	}
}

func (calls *connectionCalls) endedLocked() <-chan struct{} {
	if calls.ended == nil {
		calls.ended = make(chan struct{})
	}
	return calls.ended
}

type connectionCallContextKey struct{}

// WithinConnectionCall marks ctx as belonging to the start or stop of
// connectionID of pluginID. A host path that would wait for that very call (see
// connectionCalls) then fails at once with INVALID_REQUEST, instead of waiting
// for a call that is itself waiting for the answer. The mark has a second
// effect: a start or stop of another connection of the same plugin that is made
// with it is not held back by the profile transactions that wait for the plugin,
// because they wait for the call the mark names.
//
// The host marks the context it hands to a provider's start and stop itself, so
// a provider that calls back in process with the context it was given needs
// nothing. A callback served from the plugin process arrives on a goroutine with
// a context of its own, which carries no mark. The server that handles it must
// call WithinConnectionCall with the plugin it serves and the connection the
// callback was made for, before it calls into the controller; without the mark
// the path waits for the registered calls until its own context ends.
//
// Only the innermost mark of a context is consulted, a mark for a call that is
// not in flight changes nothing, and nothing else a callback may wait on is
// detected: the mark is not a deadlock detector. It cannot tell work that the
// call waits for from work it does not wait for either: a goroutine that runs
// beside the call, that the call never waits for, would have run once the call
// ended, but fails while the call is in flight. Mark only work the call waits for.
func WithinConnectionCall(ctx context.Context, pluginID, connectionID string) context.Context {
	key := connectionCallKey{plugin: pluginID, connection: connectionID}
	return context.WithValue(ctx, connectionCallContextKey{}, key)
}

// insideConnectionCall returns the call that ctx is marked with, or nil.
func insideConnectionCall(ctx context.Context) *connectionCallKey {
	key, ok := ctx.Value(connectionCallContextKey{}).(connectionCallKey)
	if !ok {
		return nil
	}
	return &key
}

// connectionCallReentry is what a path returns instead of waiting for the start
// or stop its context is marked with. The text is public, so it names no plugin
// or connection.
func connectionCallReentry() error {
	return resourcev2.NewError("INVALID_REQUEST",
		"This operation waits for the start or stop of a connection that it was called from, "+
			"so it can never finish. Call it from outside the start or stop, or use a read operation instead.")
}

// connectionCall is one connection start or stop. It holds profilesMu from
// beginConnectionCall until releaseProfiles, and its connection until end.
type connectionCall struct {
	ctrl    *controller
	key     connectionCallKey
	holding bool
}

// beginConnectionCall registers a start or stop of one connection. It waits for
// an earlier call on the same connection and, unless ctx is marked with a
// registered call of the same plugin, for the profile transactions that wait for
// the plugin (see connectionCalls). It returns with profilesMu held so the
// caller can run its pre-call checks and fences atomically with respect to
// profile transactions. The waits for calls and transactions hold no lock and
// end with ctx. The plain profilesMu.Lock before them does not end with ctx (see
// connectionCalls). A ctx marked with the call it would wait for gets
// connectionCallReentry instead.
// The returned context is marked with the new call and is the one to hand to the
// provider. The caller must run end, and should run releaseProfiles before its
// first plugin call so that the lock is not held across it.
func (c *controller) beginConnectionCall(
	ctx context.Context, pluginID, connectionID string,
) (context.Context, *connectionCall, error) {
	key := connectionCallKey{plugin: pluginID, connection: connectionID}
	inside := insideConnectionCall(ctx)
	for {
		c.profilesMu.Lock()
		wake, answer := c.calls.begin(key, inside)
		if answer == verdictProceed {
			return WithinConnectionCall(ctx, pluginID, connectionID), &connectionCall{ctrl: c, key: key, holding: true}, nil
		}
		c.profilesMu.Unlock()
		if answer == verdictReentry {
			return ctx, nil, connectionCallReentry()
		}
		select {
		case <-wake:
		case <-ctx.Done():
			return ctx, nil, ctx.Err()
		}
	}
}

// releaseProfiles releases profilesMu. It is safe to call more than once.
func (call *connectionCall) releaseProfiles() {
	if call.holding {
		call.holding = false
		call.ctrl.profilesMu.Unlock()
	}
}

// end releases profilesMu if it is still held, then the connection. Run it
// after the call's other cleanup so that the next call on the connection starts
// from a fully released state.
func (call *connectionCall) end() {
	call.releaseProfiles()
	call.ctrl.calls.end(call.key)
}

// lockProfilesQuiescent takes profilesMu once no start or stop of the plugin is
// registered, and returns with the lock held. Profile transactions use it
// because a start or stop runs its plugin calls without profilesMu: the
// transaction must not overlap them. A transaction that has to wait takes its
// place in line: new starts and stops of the plugin wait behind it, and the
// transactions of the plugin run in the order in which they began to wait (see
// connectionCalls). The wait for the registered calls holds no lock and ends
// with ctx, in which case profilesMu is not held and the place in line is given
// up. The plain profilesMu.Lock before and after it does not end with ctx (see
// connectionCalls). A ctx marked with a registered call of the plugin gets
// connectionCallReentry instead of a wait for that call.
func (c *controller) lockProfilesQuiescent(ctx context.Context, pluginID string) error {
	inside := insideConnectionCall(ctx)
	wait := &transactionWait{plugin: pluginID}
	defer c.calls.leave(wait)
	for {
		c.profilesMu.Lock()
		wake, answer := c.calls.quiesce(wait, inside)
		if answer == verdictProceed {
			return nil
		}
		c.profilesMu.Unlock()
		if answer == verdictReentry {
			return connectionCallReentry()
		}
		select {
		case <-wake:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
