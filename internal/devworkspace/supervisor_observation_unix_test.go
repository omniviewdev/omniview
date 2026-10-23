//go:build darwin || linux

package devworkspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devsession"
	"golang.org/x/sys/unix"
)

// Block real Git configuration reading during another start's output preparation.
// Existing process observation must not depend on that preparation completing.
func assertManagedObservationDuringBlockedStart(t *testing.T, ctx context.Context, endpoint, token, source, processID string, start devsession.ProcessRequest) {
	t.Helper()
	config := filepath.Join(source, ".git", "config")
	original, err := os.ReadFile(config)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(config)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(config); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Remove(config); err != nil && !os.IsNotExist(err) {
			t.Error(err)
		}
		if err := os.WriteFile(config, original, info.Mode().Perm()); err != nil {
			t.Error(err)
		}
	}()
	if err = unix.Mkfifo(config, 0600); err != nil {
		t.Fatal(err)
	}
	call := func(callCtx context.Context, request devsession.ProcessRequest) (devsession.ProcessResponse, error) {
		var result devsession.ProcessResponse
		data, err := json.Marshal(request)
		if err != nil {
			return result, err
		}
		req, err := http.NewRequestWithContext(callCtx, http.MethodPost, endpoint+"/v1/process", bytes.NewReader(data))
		if err != nil {
			return result, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			return result, err
		}
		defer response.Body.Close()
		err = json.NewDecoder(response.Body).Decode(&result)
		return result, err
	}
	other := start
	selection := *start.Start
	selection.PluginGeneration = NewGeneration()
	other.RequestID, other.Start = NewGeneration(), &selection
	started := make(chan error, 1)
	go func() { _, err := call(ctx, other); started <- err }()
	var writer *os.File
	for writer == nil {
		writer, err = os.OpenFile(config, os.O_WRONLY|unix.O_NONBLOCK, 0)
		if err == nil {
			break
		}
		if !errors.Is(err, unix.ENXIO) {
			t.Fatal(err)
		}
		select {
		case err := <-started:
			t.Fatalf("start finished before real Git rendezvous: %v", err)
		case <-ctx.Done():
			t.Fatal("managed start did not reach real Git preparation")
		case <-time.After(10 * time.Millisecond):
		}
	}
	// A writer can open only after real Git has opened its read end. Keep it
	// waiting for bytes/EOF until the independent log request has completed.
	defer writer.Close()
	observeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	observation := devsession.ProcessRequest{RequestID: NewGeneration(), WorkspaceID: start.WorkspaceID, Generation: start.Generation, Host: start.Host, Operation: "logs", ProcessID: processID}
	observed, observationErr := call(observeCtx, observation)
	cancel()
	if _, err := writer.Write(original); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(config); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config, original, info.Mode().Perm()); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-started:
		if err != nil {
			t.Fatalf("blocked start transport failed after release: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("managed start did not finish after Git release")
	}
	if observationErr != nil {
		t.Fatalf("existing process logs blocked behind another start: %v", observationErr)
	}
	if observed.Error != nil || observed.Process == nil || !observed.Process.Running || observed.Process.ProcessID != processID || observed.Logs == nil {
		t.Fatalf("existing owned process was not independently observable: %+v", observed)
	}
}
