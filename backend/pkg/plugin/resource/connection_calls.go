package resource

import (
	"context"
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

// connectionCalls registers the connection start and stop calls that run
// without profilesMu. Its mutex is a leaf: nothing else is acquired while it is
// held.
//
// Rule for code that runs inside a provider's start or stop of plugin P, which
// means the provider's callbacks into the host (made in process with the
// context the provider was given, or served from the plugin process for this
// call): use plain-lock reads only.
//
//   - Safe, because they never wait for a registered call: every exported
//     controller path not listed below, ListConnectionProfiles among them (it
//     takes profilesMu only to read), and the start or stop of another
//     connection or of another plugin.
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
	// ended is closed, then replaced on demand, whenever a call ends. A waiter
	// keeps the channel it was given, so a call that ends before the waiter
	// selects still wakes it.
	ended chan struct{}
}

// begin registers key. While another call holds key it registers nothing and
// returns false with a channel that closes when any call ends.
func (calls *connectionCalls) begin(key connectionCallKey) (<-chan struct{}, bool) {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	if _, held := calls.active[key]; held {
		return calls.endedLocked(), false
	}
	if calls.active == nil {
		calls.active = make(map[connectionCallKey]struct{})
	}
	calls.active[key] = struct{}{}
	return nil, true
}

// busy reports whether any call of the plugin is registered. If so, the
// channel closes when any call ends.
func (calls *connectionCalls) busy(plugin string) (<-chan struct{}, bool) {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	for key := range calls.active {
		if key.plugin == plugin {
			return calls.endedLocked(), true
		}
	}
	return nil, false
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
// for a call that is itself waiting for the answer.
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

func insideConnectionCall(ctx context.Context) (connectionCallKey, bool) {
	key, ok := ctx.Value(connectionCallContextKey{}).(connectionCallKey)
	return key, ok
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
// an earlier call on the same connection, and returns with profilesMu held so
// the caller can run its pre-call checks and fences atomically with respect to
// profile transactions. The wait for the earlier call holds no lock and ends with
// ctx. The plain profilesMu.Lock before it does not end with ctx (see
// connectionCalls). A ctx marked with the call it would wait for gets
// connectionCallReentry instead.
// The returned context is marked with the new call and is the one to hand to the
// provider. The caller must run end, and should run releaseProfiles before its
// first plugin call so that the lock is not held across it.
func (c *controller) beginConnectionCall(
	ctx context.Context, pluginID, connectionID string,
) (context.Context, *connectionCall, error) {
	key := connectionCallKey{plugin: pluginID, connection: connectionID}
	for {
		c.profilesMu.Lock()
		ended, registered := c.calls.begin(key)
		if registered {
			return WithinConnectionCall(ctx, pluginID, connectionID), &connectionCall{ctrl: c, key: key, holding: true}, nil
		}
		c.profilesMu.Unlock()
		if inside, marked := insideConnectionCall(ctx); marked && inside == key {
			return ctx, nil, connectionCallReentry()
		}
		select {
		case <-ended:
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
// transaction must not overlap them. The wait for a registered call holds no
// lock and ends with ctx, in which case profilesMu is not held. The plain
// profilesMu.Lock before and after it does not end with ctx (see
// connectionCalls). A ctx marked with a registered call of the plugin gets
// connectionCallReentry instead of a wait for that call.
func (c *controller) lockProfilesQuiescent(ctx context.Context, pluginID string) error {
	for {
		c.profilesMu.Lock()
		ended, busy := c.calls.busy(pluginID)
		if !busy {
			return nil
		}
		c.profilesMu.Unlock()
		if inside, marked := insideConnectionCall(ctx); marked && inside.plugin == pluginID && c.calls.registered(inside) {
			return connectionCallReentry()
		}
		select {
		case <-ended:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
