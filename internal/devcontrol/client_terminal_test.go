//go:build devcontrol

package devcontrol

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestClientWaitReturnsTerminalTimeoutFailureWithoutRepolling(t *testing.T) {
	s, _, _ := fixtureServer(t)
	accepted := s.accept(devcontract.Request{RequestID: "failed-start"}, func(context.Context) (any, error) {
		return nil, devcontract.Fail(7, "timeout", "managed process stop deadline expired")
	})
	terminal := waitOperation(t, s, accepted)
	if terminal.Status != "failed" || terminal.Error == nil || terminal.Error.Code != "timeout" {
		t.Fatalf("fixture did not reach the actual failed operation: %+v", terminal)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if polls.Add(1) > 1 {
			// A terminal result must not wait for cancellation. Cancel on an
			// unexpected second poll so the regression fails without a timer race.
			cancel()
			return
		}
		s.serveHTTP(w, r)
	}))
	defer server.Close()
	s.host = strings.TrimPrefix(server.URL, "http://")
	client, err := NewClient(server.URL+"/v1/control", s.token, testWorkspace, "host-generation")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	response, err := client.Wait(ctx, accepted.OperationID, 2*time.Second)
	if response.Status != "failed" || response.OperationID != accepted.OperationID || response.Error == nil || response.Error.Code != "timeout" || devcontract.ExitCode(err) != 7 {
		t.Fatalf("terminal failure was not preserved: response=%+v err=%v", response, err)
	}
	if polls.Load() != 1 || ctx.Err() != nil {
		t.Fatalf("terminal operation was polled again instead of returned: polls=%d context=%v", polls.Load(), ctx.Err())
	}
}
