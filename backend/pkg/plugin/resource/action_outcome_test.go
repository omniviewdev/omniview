package resource

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestAdoptedStreamRequiresAuthoritativeTerminalEvent(t *testing.T) {
	cases := []struct {
		name    string
		result  error
		event   *sdkresource.ActionEvent
		unknown bool
	}{
		{name: "clean-eof", unknown: true},
		{name: "transport-eof", result: io.EOF, unknown: true},
		{name: "transport-failure", result: errors.New("connection lost"), unknown: true},
		{name: "observation-cancelled", result: context.Canceled, unknown: true},
		{name: "provider-completed", event: &sdkresource.ActionEvent{Type: "complete"}},
		{name: "provider-failed", event: &sdkresource.ActionEvent{Type: "error", Error: &sdkresource.ResourceOperationError{
			Code: "PROVIDER_ERROR", Title: "Action failed", Message: "Provider confirmed failure.",
		}}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			registry := newActionRegistry()
			registry.afterFunc = func(_ time.Duration, fn func()) actionTimer {
				return &controlledActionTimer{fn: fn}
			}
			ctx, err := invocation.NewBoundary(nil).Admit(testInvocationContext(), "resource.StreamAction", invocation.Target{Provider: "flat"})
			if err != nil {
				t.Fatal(err)
			}
			request, _ := invocation.FromContext(ctx)
			reservation, err := registry.reserve(request, func() {})
			if err != nil {
				t.Fatal(err)
			}
			var observed ActionSnapshot
			reservation.observer = func(snapshot ActionSnapshot) {
				observed = snapshot
			}
			handle, err := registry.commit(reservation, ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer registry.stopAll()
			events := make(chan sdkresource.ActionEvent, 1)
			if test.event != nil {
				events <- *test.event
			}
			controller := &controller{actions: registry}
			controller.runActionStream(ctx, handle, events, nil, true, test.result, nil)
			if !observed.Terminal {
				t.Fatal("observer did not receive terminal tracking state")
			}
			unknown := observed.Event.Error != nil && observed.Event.Error.Code == "ACTIVITY_OBSERVATION_LOST"
			if unknown != test.unknown {
				t.Fatalf("incorrect remote-outcome certainty: %+v", observed)
			}
		})
	}
}
