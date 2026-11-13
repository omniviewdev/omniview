package main

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	feed "github.com/omniviewdev/omniview/internal/updater"
	"github.com/wailsapp/wails/v3/pkg/application"
	wailsupdater "github.com/wailsapp/wails/v3/pkg/updater"
)

type UpdateService struct {
	updater          *wailsupdater.Updater
	configured       bool
	mu               sync.Mutex
	flow             sync.Mutex
	lastError        string
	availableVersion string
	cancel           context.CancelFunc
}

type UpdateStatus struct {
	State            string `json:"state"`
	Version          string `json:"version"`
	AvailableVersion string `json:"availableVersion"`
	Error            string `json:"error"`
}

func newUpdateService(app *application.App, channel, root, version string) *UpdateService {
	s := &UpdateService{updater: app.Updater}
	provider, err := feed.NewProvider(channel, root, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "updater disabled: %v\n", err)
		return s
	}
	if provider == nil {
		return s
	}
	if err := s.updater.Init(wailsupdater.Config{CurrentVersion: version, Providers: []wailsupdater.Provider{provider}, Window: wailsupdater.WindowNone}); err != nil {
		fmt.Fprintf(os.Stderr, "updater disabled: %v\n", err)
		return s
	}
	s.configured = true
	return s
}

func (s *UpdateService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	if !s.configured {
		return nil
	}
	ctx, s.cancel = context.WithCancel(ctx)
	go func() {
		s.check(ctx)
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.check(ctx)
			}
		}
	}()
	return nil
}

func (s *UpdateService) ServiceShutdown() error {
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

func (s *UpdateService) check(ctx context.Context) error {
	if !s.flow.TryLock() {
		return nil
	}
	defer s.flow.Unlock()
	if s.updater.State() == wailsupdater.StateReady {
		return nil
	}
	release, err := s.updater.Check(ctx)
	if err == nil && release != nil {
		s.mu.Lock()
		s.availableVersion = release.Version
		s.mu.Unlock()
		err = s.updater.DownloadAndInstall(ctx)
	}
	s.mu.Lock()
	if err != nil {
		s.lastError = err.Error()
	} else {
		s.lastError = ""
	}
	s.mu.Unlock()
	return err
}

func (s *UpdateService) Status() UpdateStatus {
	state := string(s.updater.State())
	s.mu.Lock()
	err := s.lastError
	available := s.availableVersion
	s.mu.Unlock()
	return UpdateStatus{State: state, Version: s.updater.CurrentVersion(), AvailableVersion: available, Error: err}
}

func (s *UpdateService) Check() error {
	if !s.configured {
		return fmt.Errorf("updater is not configured")
	}
	return s.check(context.Background())
}

func (s *UpdateService) Restart() error { return s.updater.Restart(context.Background()) }
