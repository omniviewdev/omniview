package resource

import (
	"context"
	"errors"
	"sync"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// PrepareActivityAction selects the execution lane from fresh admitted metadata.
// The returned start must be called only after the host has persisted its task.
// Streaming actions retain their native-ready establishment barrier; finite
// actions expose no cancellation capability because their protocol has none.
func (c *controller) PrepareActivityAction(ctx context.Context, pluginID string, input resourcev2.ActionRequest, observer func(ActionSnapshot)) (cancel func() error, start func(), retErr error) {
	ctx, diagnostic := c.beginActionDiagnostic(ctx, "resource.Action.Prepare", pluginID, input)
	defer func() { diagnostic.finish(ctx, "admission", retErr) }()
	ctx, err := c.admit(ctx, "resource.Action", actionTarget(pluginID, input))
	if err != nil {
		return nil, nil, err
	}
	defer finishResource(ctx, &retErr)
	if err := resourcev2.ValidateActionRequest(input); err != nil {
		return nil, nil, err
	}

	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, input.Route)
	if err != nil {
		return nil, nil, err
	}
	defer cleanup()
	authority, canonicalProvider := actionIdentity(input)
	sessionCtx, descriptor, err := c.admitOperationCatalog(sessionCtx, pluginID, provider, generation, input.Route, authority, canonicalProvider, input)
	if err != nil {
		return nil, nil, err
	}

	// The reviewed lane is a request hint, not authority. Resolve checks it
	// against the fresh provider descriptor before either lane can execute.
	streaming := input.ExpectedDescriptor != nil && input.ExpectedDescriptor.Streaming
	actionDescriptor, err := resourcev2.ResolveActionDescriptor(sessionCtx, provider, input, streaming)
	if input.ExpectedDescriptor == nil && resourcev2.ErrorCode(err) == "UNSUPPORTED" {
		actionDescriptor, err = resourcev2.ResolveActionDescriptor(sessionCtx, provider, input, true)
	}
	if err != nil {
		return nil, nil, err
	}
	if actionDescriptor == nil {
		return nil, nil, resourcev2.NewError("UNSUPPORTED", "Activity actions require an advertised descriptor.")
	}
	input.ExpectedDescriptor = actionDescriptor
	if actionDescriptor.Streaming {
		cancel, err := c.AdoptStreamAction(ctx, pluginID, input, observer)
		return cancel, nil, err
	}

	actioner, ok := provider.(resourcev2.Actioner)
	if !ok {
		return nil, nil, ancillaryUnsupported()
	}
	if err := c.currentGeneration(sessionCtx, pluginID, generation); err != nil {
		return nil, nil, err
	}

	// No RPC has begun. Preserve provenance, catalog admission and exact generation
	// while severing only the browser's cancellation/deadline ownership.
	request, _ := invocation.FromContext(ctx)
	var once sync.Once
	start = func() {
		once.Do(func() {
			go c.runPreparedActivityAction(sessionCtx, pluginID, input, generation, descriptor, actionDescriptor, actioner, request.ID(), observer)
		})
	}
	return nil, start, nil
}

func (c *controller) runPreparedActivityAction(
	sessionCtx context.Context,
	pluginID string,
	input resourcev2.ActionRequest,
	generation *pluginState,
	descriptor resourcev2.ResourceType,
	actionDescriptor *resourcev2.ActionDescriptor,
	actioner resourcev2.Actioner,
	requestID string,
	observer func(ActionSnapshot),
) {
	nativeCtx, stop := context.WithTimeout(context.WithoutCancel(sessionCtx), actionLifetime)
	nativeCtx, diagnostic := c.beginActionDiagnostic(nativeCtx, "resource.Action", pluginID, input)
	var diagnosticErr error
	defer func() { diagnostic.finish(nativeCtx, "completion", diagnosticErr) }()
	stopGeneration := context.AfterFunc(generation.ctx, stop)
	defer stop()
	defer stopGeneration()

	var delivered sync.Once
	publish := func(snapshot ActionSnapshot) {
		delivered.Do(func() {
			observer(snapshot)
		})
	}
	stopObservation := context.AfterFunc(nativeCtx, func() {
		publish(ActionSnapshot{
			Sequence: 1,
			Event:    actionObservationLostEvent(requestID),
			Terminal: true,
		})
	})
	defer stopObservation()

	value, err := c.executePreparedAction(nativeCtx, pluginID, input, generation, descriptor, actionDescriptor, actioner)
	diagnosticErr = err
	var event ActionEventDTO
	if err != nil {
		if nativeCtx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			event = actionObservationLostEvent(requestID)
		} else {
			event = ActionEventDTO{Type: "error", Error: apperror.ForResource(err, requestID)}
		}
	} else {
		event, err = actionEvent(resourcev2.ActionEvent{Type: "complete", Data: &value}, requestID)
		diagnosticErr = err
		if err != nil {
			event = ActionEventDTO{Type: "error", Error: apperror.ForResource(err, requestID)}
		}
	}
	publish(ActionSnapshot{Sequence: 1, Event: event, Terminal: true})
}
