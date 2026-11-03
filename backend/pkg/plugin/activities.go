package plugin

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	hostactivity "github.com/omniviewdev/omniview/backend/pkg/activity"
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	sdkactivity "github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdklifecycle "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type activityProcess struct {
	generation string
	stop       func()
}

type activityBinding struct {
	mu        sync.Mutex
	service   *hostactivity.Service
	processes map[string]activityProcess
}

// ConfigureActivities connects process reporting and host-owned resource action observation.
func ConfigureActivities(manager Manager, controller resource.Controller, service *hostactivity.Service) {
	pm := manager.(*pluginManager)
	pm.activities = &activityBinding{
		service:   service,
		processes: make(map[string]activityProcess),
	}
	adopter := controller.(interface {
		PrepareActivityAction(context.Context, string, resourcev2.ActionRequest, func(resource.ActionSnapshot)) (func() error, func(), error)
	})
	service.SetActionStarter(func(ctx context.Context, input sdkactivity.StartResourceActionRequest) (sdkactivity.Record, error) {
		if err := resourcev2.ValidateActivityPresentation(input.Presentation); err != nil {
			return sdkactivity.Record{}, err
		}
		owner := "native:" + input.PluginID

		// Persist the execution identity before either lane may mutate remotely.
		record, err := service.BeginOwnedTask(owner, sdkactivity.Spec{
			Presentation: input.Presentation,
			ParentID:     input.ParentID,
			Source: &sdkactivity.Source{
				PluginID:     input.PluginID,
				ConnectionID: input.Request.Route.Connection,
			},
		}, nil)
		if err != nil {
			return record, err
		}
		var mu sync.Mutex
		_, start, err := adopter.PrepareActivityAction(ctx, input.PluginID, input.Request, func(snapshot resource.ActionSnapshot) {
			mu.Lock()
			defer mu.Unlock()
			if record.ID == "" {
				return
			}

			presentation := mergeActivityPresentation(record.Presentation, snapshot.Event.Activity, input.Presentation.Actions)
			updated, observationErr := recordActivitySnapshot(service, owner, record.ID, snapshot, presentation, record.Presentation)
			if observationErr != nil {
				// Accepted native execution continues. Never replay a mutation or
				// claim rollback because presentation or storage failed.
				pm.logger.Errorw(context.Background(), "activity observation could not be recorded",
					"pluginID", input.PluginID,
					"activityID", record.ID,
					"error", sanitizeLogMessage(observationErr.Error()),
				)
				if updated.ID == "" {
					pm.emitter.Emit("activity/observation-error", ActivityObservationError{
						ID:       record.ID,
						PluginID: input.PluginID,
						Message:  "Activity updates could not be recorded. The remote action may still be running; do not retry it without checking its outcome.",
					})
				}
			}
			if updated.ID != "" {
				record = updated
			}
		})
		if err != nil {
			presentation := input.Presentation
			presentation.Details = apperror.ForResource(err, uuid.NewString()).Detail
			_, finishErr := service.FinishOwnedTask(owner, sdkactivity.FinishTaskRequest{
				ID:           record.ID,
				State:        "failed",
				Presentation: &presentation,
			})
			return record, errors.Join(err, finishErr)
		}
		if start != nil {
			start()
		}
		mu.Lock()
		result := record
		mu.Unlock()
		return result, nil
	})
}

func (pm *pluginManager) bindActivities(id string, backend plugintypes.PluginBackend) error {
	if pm.activities == nil {
		return nil
	}
	pm.retireActivities(id)

	raw, err := backend.Dispense("lifecycle")
	if err != nil {
		return err
	}
	client, ok := raw.(*sdklifecycle.Client)
	if !ok {
		return fmt.Errorf("plugin %s has invalid lifecycle client", id)
	}

	generation := uuid.NewString()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	stop, err := client.ServeActivities(ctx, pm.activities.service.Reporter(id, generation))
	if status.Code(err) == codes.Unimplemented {
		return nil
	}
	if err != nil {
		_ = pm.activities.service.RetireProducer(id, generation)
		return err
	}

	pm.activities.mu.Lock()
	pm.activities.processes[id] = activityProcess{generation: generation, stop: stop}
	pm.activities.mu.Unlock()
	return nil
}

func (pm *pluginManager) retireActivities(id string) {
	if pm.activities == nil {
		return
	}
	pm.activities.mu.Lock()
	process, ok := pm.activities.processes[id]
	delete(pm.activities.processes, id)
	pm.activities.mu.Unlock()
	if ok {
		// Revoke producer ownership before stopping its callback server.
		_ = pm.activities.service.RetireProducer(id, process.generation)
		process.stop()
	}
}

// ActivityObservationError reports lost observation without claiming execution
// failed or inviting an automatic replay of an accepted mutation.
type ActivityObservationError struct {
	ID       string `json:"id"`
	PluginID string `json:"pluginID"`
	Message  string `json:"message"`
}

func mergeActivityPresentation(current sdkactivity.Presentation, update *sdkactivity.Presentation, contextual []resourcev2.ActivityAction) sdkactivity.Presentation {
	if update == nil {
		return current
	}
	presentation := *update
	if presentation.Actions == nil {
		presentation.Actions = contextual
	}
	return presentation
}

func recordActivitySnapshot(service *hostactivity.Service, owner, id string, snapshot resource.ActionSnapshot, presentation, accepted sdkactivity.Presentation) (sdkactivity.Record, error) {
	if snapshot.Terminal {
		state := "succeeded"
		if snapshot.Event.Error != nil {
			state = "failed"
			presentation.Details = snapshot.Event.Error.Detail
			if snapshot.Event.Error.Code == "ACTIVITY_OBSERVATION_LOST" {
				state = "unknown"
			}
		}
		record, err := service.FinishOwnedTask(owner, sdkactivity.FinishTaskRequest{
			ID: id, State: state, Presentation: &presentation,
		})
		if err == nil {
			return record, nil
		}
		// Presentation rejection must not erase a known terminal business
		// outcome. Record that outcome with the last accepted presentation.
		record, fallbackErr := service.FinishOwnedTask(owner, sdkactivity.FinishTaskRequest{ID: id, State: state})
		return record, errors.Join(err, fallbackErr)
	}
	record, err := service.ReportOwnedTask(owner, sdkactivity.ReportTaskRequest{
		ID: id, State: "running", Presentation: presentation,
	})
	if err == nil {
		return record, nil
	}
	// Invalid producer presentation cannot poison the cached presentation.
	// The action still runs; preserve accepted context and report the error.
	record, fallbackErr := service.ReportOwnedTask(owner, sdkactivity.ReportTaskRequest{
		ID: id, State: "running", Presentation: accepted,
	})
	return record, errors.Join(err, fallbackErr)
}
