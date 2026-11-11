package resource

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestMetadataWatchFailureIsClassified(t *testing.T) {
	const secret = "fake-provider-error-secret"
	ctrl, _ := newTestControllerWithEmitter(t)
	sink := &logtest.RecordingSink{}
	ctrl.logger = logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
	})
	second := make(chan struct{})
	calls := 0
	provider := &metadataTestProvider{mockProvider: &mockProvider{}}
	provider.watch = func(ctx context.Context, _ resourcev2.ConnectionMetadataSink) error {
		calls++
		if calls == 1 {
			return errors.New(secret)
		}
		close(second)
		<-ctx.Done()
		return ctx.Err()
	}
	state := metadataTestState(ctrl, "plugin", provider)
	ctrl.startMetadata("plugin", state, provider)
	select {
	case <-second:
	case <-time.After(3 * time.Second):
		t.Fatal("watch did not reconnect")
	}
	records := sink.Records()
	found := false
	for _, record := range records {
		fields := record.ToMap()
		if strings.Contains(fmt.Sprint(fields), secret) {
			t.Fatal("provider error leaked into logs")
		}
		if record.Level == logging.LevelWarn && fields["errorClass"] == "PROVIDER_ERROR" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing classified watch failure: %v", records)
	}
}
