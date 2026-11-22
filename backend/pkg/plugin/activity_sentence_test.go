package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	sdkactivity "github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	grpcplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
)

// The outcome of an action that ran as an activity is written to the activity store
// (Presentation.Details), which the user reads and which survives a restart. The resource package
// builds that outcome with the gate; activities.go copies it into the store, on three paths: the
// terminal snapshot of the observer, the failure to start the action, and the notice and the log
// line of an outcome the store refuses. Their tests live here because the resource package does
// not compile activities.go.

const activityHostileSentence = "ACTIVITY-HOSTILE \x1b[31mlogin failed: password=hunter2 reading /Users/x/.kube/config\x1b[0m"

// restoredProviderFailure is what the SDK's client returns for a provider's typed error whose
// sentence is activityHostileSentence: a status with the class and the sentence, decoded.
func restoredProviderFailure(t *testing.T) error {
	t.Helper()
	wire, err := status.New(codes.NotFound, "resource operation failed").WithDetails(
		&errdetails.ErrorInfo{Reason: "NOT_FOUND", Domain: "omniview.resource.v2"},
		&errdetails.LocalizedMessage{Locale: "en", Message: activityHostileSentence},
	)
	require.NoError(t, err)
	return grpcplugin.ResourceDomainError(wire.Err())
}

func holdsActivityHostileText(text string) bool {
	for _, part := range []string{"ACTIVITY-HOSTILE", "hunter2", "/Users/x", "\x1b", `\u001b`} {
		if strings.Contains(text, part) {
			return true
		}
	}
	return false
}

// A terminal snapshot with the gated error is recorded with the gated sentence (activities.go,
// recordActivitySnapshot), and an error the gate did not touch would be recorded as it came.
func TestAnActivityOutcomeIsRecordedWithTheGatedSentence(t *testing.T) {
	service := activityObserverService(t)
	record, err := service.BeginOwnedTask("native:alpha", sdkactivity.Spec{Presentation: navigationPresentation("alpha")}, nil)
	require.NoError(t, err)
	snapshot := resource.ActionSnapshot{Sequence: 1, Terminal: true, Event: resource.ActionEventDTO{
		Type: "error", Error: apperror.ForResource(restoredProviderFailure(t), "req-1"),
	}}

	updated, err := recordActivitySnapshot(service, "native:alpha", record.ID, snapshot, record.Presentation, record.Presentation)

	require.NoError(t, err)
	require.Equal(t, "failed", updated.Task.State)
	require.Equal(t, apperror.ForResource(resourcev2.NewError("NOT_FOUND", ""), "").Detail, updated.Presentation.Details)
	encoded, err := json.Marshal(updated)
	require.NoError(t, err)
	require.False(t, holdsActivityHostileText(string(encoded)), "the activity record holds the provider's sentence: %s", encoded)
}

// startFailingController is the resource controller as ConfigureActivities uses it, whose
// PrepareActivityAction fails with err.
type startFailingController struct {
	resource.Controller
	err error
}

func (c startFailingController) PrepareActivityAction(context.Context, string, resourcev2.ActionRequest, func(resource.ActionSnapshot)) (func() error, func(), error) {
	return nil, nil, c.err
}

// An action that cannot be prepared is recorded as failed, with details gated at activities.go:92
// whatever the controller returned: the activity store holds no sentence the gate refused.
func TestAnActivityThatFailsToStartIsRecordedWithTheGatedSentence(t *testing.T) {
	for name, failure := range map[string]func(t *testing.T) error{
		"the controller's own gated return":    func(t *testing.T) error { return apperror.ForResource(restoredProviderFailure(t), "req-1") },
		"a return that the gate did not touch": restoredProviderFailure,
	} {
		t.Run(name, func(t *testing.T) {
			service := activityObserverService(t)
			manager := activityBrokerManager(service)
			ConfigureActivities(manager, startFailingController{err: failure(t)}, service)

			record, err := service.StartResourceAction(context.Background(), sdkactivity.StartResourceActionRequest{
				PluginID: "alpha", Request: resourcev2.ActionRequest{Route: resourcev2.AccessRoute{Connection: "conn"}},
				Presentation: navigationPresentation("alpha"),
			})

			require.Error(t, err)
			var details []string
			for _, stored := range service.Snapshot().Records {
				if stored.ID == record.ID {
					details = append(details, stored.Presentation.Details)
				}
			}
			require.NotEmpty(t, details, "the failed action is in the activity store")
			encoded, marshalErr := json.Marshal(service.Snapshot())
			require.NoError(t, marshalErr)
			require.False(t, holdsActivityHostileText(string(encoded)), "the activity store holds the provider's sentence: %s", encoded)
		})
	}
}

// noticeEmitter keeps every event the manager emits.
type noticeEmitter struct {
	mu     sync.Mutex
	events []string
}

func (e *noticeEmitter) Emit(key string, data ...any) {
	encoded, err := json.Marshal(data)
	if err != nil {
		encoded = []byte(fmt.Sprintf("%v", data))
	}
	e.mu.Lock()
	e.events = append(e.events, key+" "+string(encoded))
	e.mu.Unlock()
}

func (e *noticeEmitter) all() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.events...)
}

// reportingTwiceController reports a terminal failure to the observer twice, as an action that
// reports its end twice does: the store refuses the second, which is the notice's occasion.
type reportingTwiceController struct {
	resource.Controller
	outcome *apperror.AppError
}

func (c reportingTwiceController) PrepareActivityAction(_ context.Context, _ string, _ resourcev2.ActionRequest, observer func(resource.ActionSnapshot)) (func() error, func(), error) {
	snapshot := resource.ActionSnapshot{Sequence: 1, Terminal: true, Event: resource.ActionEventDTO{Type: "error", Error: c.outcome}}
	return nil, func() { observer(snapshot); observer(snapshot) }, nil
}

// An outcome the store cannot record is told to the window with the host's own words, and logged
// beside it, and neither holds the provider's sentence (activities.go, the notice).
func TestTheActivityObservationNoticeIsTheHostsFixedText(t *testing.T) {
	const fixed = "Activity updates could not be recorded. The remote action may still be running; do not retry it without checking its outcome."
	service := activityObserverService(t)
	manager := activityBrokerManager(service)
	emitter := &noticeEmitter{}
	sink := &logtest.RecordingSink{}
	manager.emitter = emitter
	manager.logger = logging.New(logging.Config{Name: "activities", Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug)})
	outcome := apperror.ForResource(restoredProviderFailure(t), "req-1")
	ConfigureActivities(manager, reportingTwiceController{outcome: outcome}, service)

	_, err := service.StartResourceAction(context.Background(), sdkactivity.StartResourceActionRequest{
		PluginID: "alpha", Request: resourcev2.ActionRequest{Route: resourcev2.AccessRoute{Connection: "conn"}},
		Presentation: navigationPresentation("alpha"),
	})

	require.NoError(t, err)
	events := emitter.all()
	require.Len(t, events, 1, "the second terminal report is the one the store refuses")
	require.Contains(t, events[0], fixed)
	var everything strings.Builder
	everything.WriteString(strings.Join(events, "\n"))
	for _, record := range sink.Records() {
		everything.WriteString("\n" + record.Message)
		for _, field := range record.Fields {
			fmt.Fprintf(&everything, " %s=%v", field.Key, field.Value)
		}
	}
	require.False(t, holdsActivityHostileText(everything.String()), "the notice or the log holds the provider's sentence: %s", everything.String())
}
