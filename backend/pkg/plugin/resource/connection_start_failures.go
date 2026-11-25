package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// A connection start that fails is announced to every window by a connection/status event that says
// why, and its reason is kept, so that GetAllConnectionStates reads it back when a window reads the
// list again on that event. A start fails in two ways: its provider call returns an error (the event
// says FAILED), or it ends without an error and answers a status that is a failure (the event says
// the status the provider answered). The reason is a public error, never the provider's own text: for
// an error it is what apperror.ForResource gives every provider error (the class's own words, and the
// provider's sentence only after apperror.PublicText has cleaned it), and for an answered status it is
// the error of the status's class alone, because a status's Error and Details are plugin text that no
// gate has cleaned. So nothing of a plugin's text reaches a window except through that gate.
//
// A reason is kept only for a connection that is in its plugin's list, and goes when a later start
// answers without failing, the connection is stopped, it leaves the list (a sync, a removal, a change
// of what it connects with) or its plugin is unloaded. A later start that fails replaces it. So the
// reasons kept never outnumber the connections listed, and none is kept for a connection that is
// gone. Every write of a plugin's list is followed by pruneStartFailuresLocked, which keeps that true.

// answeredFailureCode is the class of the public error of a start whose provider call ended without an
// error and answered status, or "" when the status is not a failure of the start. The window made a
// failure of every answer but CONNECTED (outcomeOfStatus in ui-next/plugins/host/connections/words.ts)
// and remembered its class itself; the host's list says it now:
//   - UNAUTHORIZED and FORBIDDEN are classes of their own: sign-in needed, access denied.
//   - FAILED, ERROR, BAD_REQUEST, NOT_FOUND, TIMEOUT, UNAVAILABLE and REQUEST_ENTITY_TOO_LARGE, the
//     SDK's other words for a connection that did not start, are INTERNAL: a failed start of no class
//     in particular. It is not PROVIDER_ERROR: that class is a 502, which the window reads as a
//     server that did not answer and not as the failed start it was told.
//   - CONNECTED is not a failure. PENDING is a start in progress, DISCONNECTED and UNKNOWN say only
//     that no client is registered, and a word this host does not know, or none, says nothing of a
//     failure: the start did not fail and is published as it always was.
func answeredFailureCode(status types.ConnectionStatusCode) string {
	switch status {
	case types.ConnectionStatusUnauthorized:
		return "UNAUTHORIZED"
	case types.ConnectionStatusForbidden:
		return "FORBIDDEN"
	case types.ConnectionStatusFailed, types.ConnectionStatusError, types.ConnectionStatusBadRequest, types.ConnectionStatusNotFound,
		types.ConnectionStatusTimeout, types.ConnectionStatusUnavailable, types.ConnectionStatusRequestEntityTooLarge:
		return "INTERNAL"
	case types.ConnectionStatusConnected, types.ConnectionStatusPending, types.ConnectionStatusDisconnected, types.ConnectionStatusUnknown:
		return ""
	default:
		return ""
	}
}

// publishStartFailure keeps and announces the failure of a start whose provider call returned
// startErr. The start is admitted once more first, as every other result of a start is, and a refusal
// publishes nothing (announceStartFailure); the caller is given the provider's error all the same.
func (c *controller) publishStartFailure(
	ctx context.Context, pluginID, connectionID string, generation *pluginState, epoch uint64, startErr error,
) {
	request, _ := invocation.FromContext(ctx)
	failure := apperror.ForResource(startErr, request.ID())
	// The public form only: the raw error stays with the caller's copy of it.
	failure.Err = nil
	_ = c.announceStartFailure(ctx, pluginID, connectionID, generation, epoch, types.ConnectionStatusFailed, failure, "")
}

// publishAnsweredFailure keeps and announces the failure of a start whose provider call ended without
// an error and answered a status that is a failure, of the class code (answeredFailureCode). The
// reason is the public error of that class and nothing of the status: its Error and Details are the
// plugin's text. The event keeps the status the provider answered and is named as the event of every
// answered start is: the connection the provider returned, else its id. The host's refusal is
// returned when the start is not admitted (announceStartFailure), and then nothing is published.
func (c *controller) publishAnsweredFailure(
	ctx context.Context, pluginID, connectionID string, generation *pluginState, epoch uint64, answer types.ConnectionStatus, code string,
) error {
	name := connectionID
	if answer.Connection != nil && answer.Connection.Name != "" {
		name = answer.Connection.Name
	}
	request, _ := invocation.FromContext(ctx)
	failure := apperror.ForResource(resource.NewError(code, ""), request.ID())
	failure.Err = nil
	return c.announceStartFailure(ctx, pluginID, connectionID, generation, epoch, answer.Status, failure, name)
}

// announceStartFailure admits the start once more, keeps failure and emits the event that says it. A
// caller that gave up, a generation of the plugin that was retired and a route whose configuration
// changed meanwhile are the host's own refusals and not a failure of the connection: nothing is kept
// or emitted, and the refusal is returned. The reason is kept before the event is emitted, so that a
// window that reads the list on the event finds it. name is the name of the event; "" is the name the
// windows know the connection by (keepStartFailure).
func (c *controller) announceStartFailure(
	ctx context.Context, pluginID, connectionID string, generation *pluginState, epoch uint64,
	status types.ConnectionStatusCode, failure *apperror.AppError, name string,
) error {
	// pluginsMu is held across the check and the keeping, so that the generation checked cannot
	// be retired between them: its unload clears the reasons after it took pluginsMu.
	c.pluginsMu.RLock()
	if refusal := c.checkBorrowableStartLocked(ctx, pluginID, connectionID, generation, epoch); refusal != nil {
		c.pluginsMu.RUnlock()
		return refusal
	}
	listedName := c.keepStartFailure(pluginID, connectionID, failure)
	c.pluginsMu.RUnlock()
	if name == "" {
		name = listedName
	}

	c.emitter.Emit(EventConnectionStatus, ConnectionStatusPayload{
		PluginID:     pluginID,
		ConnectionID: connectionID,
		Status:       string(status),
		Name:         name,
		Error:        failure,
	})
	return nil
}

// keepStartFailure keeps the failure of a connection that the plugin lists and answers the name
// the windows know the connection by: its listed name, else its id. A connection the plugin does
// not list is named by its id and is not kept, because nothing would ever remove its reason.
// The caller holds pluginsMu.
func (c *controller) keepStartFailure(pluginID, connectionID string, failure *apperror.AppError) string {
	c.connsMu.Lock()
	defer c.connsMu.Unlock()
	listed := c.connections[pluginID]
	for i := range listed {
		if listed[i].ID != connectionID {
			continue
		}
		if c.startFailures == nil {
			c.startFailures = make(map[string]map[string]*apperror.AppError)
		}
		if c.startFailures[pluginID] == nil {
			c.startFailures[pluginID] = make(map[string]*apperror.AppError)
		}
		c.startFailures[pluginID][connectionID] = failure
		if listed[i].Name != "" {
			return listed[i].Name
		}
		return connectionID
	}
	return connectionID
}

// forgetStartFailure drops the failure of a connection's last start: a later start answered, or
// the connection was stopped.
func (c *controller) forgetStartFailure(pluginID, connectionID string) {
	c.connsMu.RLock()
	_, kept := c.startFailures[pluginID][connectionID]
	c.connsMu.RUnlock()
	if !kept {
		return
	}
	c.connsMu.Lock()
	defer c.connsMu.Unlock()
	failures := c.startFailures[pluginID]
	delete(failures, connectionID)
	if len(failures) == 0 {
		delete(c.startFailures, pluginID)
	}
}

// pruneStartFailuresLocked drops the failure of every connection of the plugin that is not in its
// list any more. The caller holds connsMu and has just written c.connections[pluginID].
func (c *controller) pruneStartFailuresLocked(pluginID string) {
	failures := c.startFailures[pluginID]
	if len(failures) == 0 {
		return
	}
	stays := make(map[string]struct{}, len(failures))
	listed := c.connections[pluginID]
	for i := range listed {
		if _, failed := failures[listed[i].ID]; failed {
			stays[listed[i].ID] = struct{}{}
		}
	}
	for id := range failures {
		if _, listedStill := stays[id]; !listedStill {
			delete(failures, id)
		}
	}
	if len(failures) == 0 {
		delete(c.startFailures, pluginID)
	}
}

// withStartFailure says why a connection's last start failed where the plugin's own report cannot:
// a plugin reports no reason with FAILED, and reports DISCONNECTED or PENDING for a start that
// never registered a client. The connection then reads FAILED, with that reason. CONNECTED is the
// plugin's word that a client is registered, and then the connection is not failed.
func (c *controller) withStartFailure(pluginID string, state *ConnectionState) {
	if state.Readiness == types.ConnectionStatusConnected {
		return
	}
	c.connsMu.RLock()
	failure := c.startFailures[pluginID][state.Connection.ID]
	c.connsMu.RUnlock()
	if failure == nil {
		return
	}
	state.Readiness = types.ConnectionStatusFailed
	state.ReadinessError = failure
}
