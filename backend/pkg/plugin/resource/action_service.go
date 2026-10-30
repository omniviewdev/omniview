package resource

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// StreamAction commits a public handle only after concrete native provider ready.
// The producer owns its lifetime before it starts; request cancellation is bridged
// through the commit, never reparented after a request-bound producer has started.
func (c *controller) StreamAction(ctx context.Context, pluginID string, input resource.ActionRequest) (id string, retErr error) {
	ctx, err := c.admit(ctx, "resource.StreamAction", actionTarget(pluginID, input))
	if err != nil {
		return "", err
	}
	defer func() {
		// Committed handles own the producer independently of the open request.
		if retErr != nil {
			finishResource(ctx, &retErr)
		}
	}()
	if err := resource.ValidateActionRequest(input); err != nil {
		return "", err
	}
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, input.Route)
	if err != nil {
		return "", err
	}
	defer cleanup()
	streamer, ok := provider.(resource.StreamingActioner)
	if !ok {
		return "", ancillaryUnsupported()
	}
	authority, canonicalProvider := actionIdentity(input)
	sessionCtx, _, err = c.admitOperationCatalog(sessionCtx, pluginID, provider, generation, input.Route, authority, canonicalProvider, input)
	if err != nil {
		return "", err
	}
	actionDescriptor, err := resource.ResolveActionDescriptor(sessionCtx, provider, input, true)
	if err != nil {
		return "", err
	}
	input.ExpectedDescriptor = actionDescriptor
	if err := c.currentGeneration(sessionCtx, pluginID, generation); err != nil {
		return "", err
	}
	producerCtx, cancelCause := context.WithCancelCause(context.WithoutCancel(sessionCtx))
	stopGeneration := context.AfterFunc(generation.ctx, func() { cancelCause(context.Canceled) })
	cancel := func() {
		stopGeneration()
		cancelCause(context.Canceled)
	}
	request, _ := invocation.FromContext(ctx)
	reservation, err := c.actions.reserve(request, cancel)
	if err != nil {
		cancel()
		return "", err
	}
	var establishment sync.Mutex
	committed := false
	startupDeadline := time.Now().Add(actionStartupTimeout)
	stopOpen := context.AfterFunc(ctx, func() {
		establishment.Lock()
		if !committed {
			cancelCause(ctx.Err())
		}
		establishment.Unlock()
	})
	startup := time.AfterFunc(actionStartupTimeout, func() {
		establishment.Lock()
		if !committed {
			cancelCause(context.DeadlineExceeded)
		}
		establishment.Unlock()
	})
	transferred := false
	defer func() {
		stopOpen()
		startup.Stop()
		c.actions.release(reservation)
		if !transferred {
			cancel()
		}
	}()
	events := make(chan resource.ActionEvent, streamChannelBuffer)
	result := make(chan error, 1)
	go func() {
		if err := c.currentGeneration(sessionCtx, pluginID, generation); err != nil {
			result <- err
			return
		}
		result <- streamer.StreamAction(producerCtx, input, events)
	}()
	var completed bool
	var resultErr error
	for {
		if completed && len(events) == 0 {
			if resultErr != nil {
				return "", resultErr
			}
			return "", actionProtocolError("The provider ended before accepting the action.")
		}
		select {
		case <-producerCtx.Done():
			return "", context.Cause(producerCtx)
		case resultErr = <-result:
			completed = true
			result = nil
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			if event.Type == "error" {
				if event.Error != nil {
					return "", event.Error
				}
				return "", actionProtocolError("The provider rejected action establishment.")
			}
			if event.Type != "ready" || event.Error != nil {
				return "", actionProtocolError("The provider did not establish the action protocol.")
			}
			establishment.Lock()
			if err = ctx.Err(); err == nil {
				err = context.Cause(producerCtx)
			}
			if err == nil && !time.Now().Before(startupDeadline) {
				err = context.DeadlineExceeded
			}
			if err == nil {
				err = c.currentGeneration(sessionCtx, pluginID, generation)
			}
			var handle *actionHandle
			if err == nil {
				handle, err = c.actions.commit(reservation, producerCtx)
				committed = err == nil
			}
			establishment.Unlock()
			if err != nil {
				return "", err
			}
			stopOpen()
			startup.Stop()
			transferred = true
			go c.runActionStream(producerCtx, handle, events, result, completed, resultErr, actionDescriptor)
			return handle.id, nil
		}
	}
}

func actionProtocolError(detail string) error {
	return &resource.ResourceOperationError{Code: "PROVIDER_ERROR", Title: "Provider operation failed", Message: detail}
}
func actionEvent(event resource.ActionEvent, requestID string) (ActionEventDTO, error) {
	if event.Type == "error" {
		err := error(event.Error)
		if event.Error == nil {
			err = actionProtocolError("The provider reported an action failure.")
		}
		return ActionEventDTO{Type: "error", Error: apperror.ForResource(err, requestID)}, nil
	}
	if event.Type != "progress" && event.Type != "output" && event.Type != "complete" {
		return ActionEventDTO{}, actionProtocolError("The provider sent an invalid action event.")
	}
	data := event.Data
	if data == nil && event.Type != "complete" {
		return ActionEventDTO{}, actionProtocolError("The provider omitted action data.")
	}
	encoded, err := json.Marshal(ActionSnapshot{Sequence: 9007199254740991, Event: ActionEventDTO{Type: event.Type, Data: data}, Terminal: true})
	if err != nil {
		return ActionEventDTO{}, actionProtocolError("The provider sent invalid action data.")
	}
	if len(encoded) > actionSnapshotBudget {
		return ActionEventDTO{}, apperror.New(apperror.TypeResourceLimit, 429, "Resource limit", "The action snapshot exceeds the host budget.")
	}
	var snapshot ActionSnapshot
	if err := json.Unmarshal(encoded, &snapshot); err != nil {
		return ActionEventDTO{}, err
	}
	return snapshot.Event, nil
}
func (c *controller) runActionStream(ctx context.Context, handle *actionHandle, events <-chan resource.ActionEvent, result <-chan error, completed bool, resultErr error, descriptor *resource.ActionDescriptor) {
	for {
		if completed && len(events) == 0 {
			if resultErr != nil {
				c.actions.update(handle, ActionEventDTO{Type: "error", Error: apperror.ForResource(resultErr, handle.request.ID())}, true)
			} else {
				c.actions.update(handle, ActionEventDTO{Type: "complete"}, true)
			}
			return
		}
		select {
		case <-ctx.Done():
			c.actions.update(handle, ActionEventDTO{Type: "error", Error: apperror.ForResource(context.Cause(ctx), handle.request.ID())}, true)
			return
		case resultErr = <-result:
			completed = true
			result = nil
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			safe, err := actionEvent(event, handle.request.ID())
			if err == nil && descriptor != nil && event.Type == "output" && event.Data != nil {
				err = resource.ValidateActionOutput(*descriptor, *event.Data)
			}
			if err != nil {
				safe = ActionEventDTO{Type: "error", Error: apperror.ForResource(err, handle.request.ID())}
			}
			terminal := safe.Type == "error" || safe.Type == "complete"
			c.actions.update(handle, safe, terminal)
			if terminal {
				return
			}
		}
	}
}

func (c *controller) actionInvocation(ctx context.Context, id, operation string) (context.Context, error) {
	handle, err := c.actions.owned(ctx, id)
	if err != nil {
		return ctx, apperror.ForResource(err, uuid.NewString())
	}
	return c.admit(ctx, operation, handle.request.Target())
}
func (c *controller) AttachStreamAction(ctx context.Context, id string) (snapshot ActionSnapshot, retErr error) {
	ctx, err := c.actionInvocation(ctx, id, "resource.AttachStreamAction")
	if err != nil {
		return ActionSnapshot{}, err
	}
	defer finishResource(ctx, &retErr)
	return c.actions.attach(ctx, id)
}
func (c *controller) CancelStreamAction(ctx context.Context, id string) (retErr error) {
	ctx, err := c.actionInvocation(ctx, id, "resource.CancelStreamAction")
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	return c.actions.cancelOwned(ctx, id)
}
