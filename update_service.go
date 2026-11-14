package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/omniviewdev/omniview/internal/releasechannel"
	feed "github.com/omniviewdev/omniview/internal/updater"
	"github.com/wailsapp/wails/v3/pkg/application"
	wailsupdater "github.com/wailsapp/wails/v3/pkg/updater"
)

type UpdateService struct {
	updater          *wailsupdater.Updater
	provider         *feed.Provider
	channel          string
	root             string
	configured       bool
	mu               sync.Mutex
	flow             sync.Mutex
	identityMu       sync.Mutex
	identities       map[string]profileIdentity
	lastError        string
	availableVersion string
	switchTarget     string
	cancel           context.CancelFunc
}

type profileIdentity struct {
	channel string
	handle  *os.File
}

type UpdateStatus struct {
	State            string `json:"state"`
	Version          string `json:"version"`
	AvailableVersion string `json:"availableVersion"`
	Error            string `json:"error"`
	Channel          string `json:"channel"`
	SwitchTarget     string `json:"switchTarget"`
}

type ChannelOption struct {
	Channel             string            `json:"channel"`
	Branch              string            `json:"branch"`
	Status              string            `json:"status"`
	DesktopVersion      string            `json:"desktopVersion"`
	StatePath           string            `json:"statePath"`
	StateExists         bool              `json:"stateExists"`
	StateIdentity       string            `json:"stateIdentity"`
	StateModifiedAt     string            `json:"stateModifiedAt"`
	StateInUse          string            `json:"stateInUse"`
	StateFileModifiedAt map[string]string `json:"stateFileModifiedAt"`
	StateError          string            `json:"stateError"`
}

type ChannelList struct {
	Current string          `json:"current"`
	Options []ChannelOption `json:"options"`
	Error   string          `json:"error"`
}

func newUpdateService(app *application.App, channel, root, version string) *UpdateService {
	s := &UpdateService{updater: app.Updater, channel: channel, root: root}
	provider, err := feed.NewProvider(channel, root, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "updater disabled: %v\n", err)
		return s
	}
	if provider == nil {
		return s
	}
	s.provider = provider
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
	s.identityMu.Lock()
	for _, identity := range s.identities {
		_ = identity.handle.Close()
	}
	s.identities = nil
	s.identityMu.Unlock()
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
	target := s.switchTarget
	s.mu.Unlock()
	return UpdateStatus{State: state, Version: s.updater.CurrentVersion(), AvailableVersion: available, Error: err, Channel: s.channel, SwitchTarget: target}
}

func (s *UpdateService) Check() error {
	if !s.configured {
		return fmt.Errorf("updater is not configured")
	}
	return s.check(context.Background())
}

func (s *UpdateService) ListChannels() ChannelList {
	s.identityMu.Lock()
	defer s.identityMu.Unlock()
	previous := s.identities
	s.identities = make(map[string]profileIdentity)
	list := ChannelList{Current: s.channel, Options: []ChannelOption{
		{Channel: releasechannel.Stable, Status: "active"},
		{Channel: releasechannel.Nightly, Status: "active"},
	}}
	foundCurrent := false
	if s.provider != nil {
		index, err := s.provider.FetchIndex(context.Background())
		if err != nil {
			list.Error = fmt.Sprintf("load channel index: %v", err)
		} else {
			for _, entry := range index.Channels {
				if !releasechannel.IsFeature(entry.Channel) {
					continue
				}
				list.Options = append(list.Options, ChannelOption{
					Channel: entry.Channel, Branch: entry.Branch, Status: entry.Status,
					DesktopVersion: entry.DesktopVersion,
				})
				foundCurrent = foundCurrent || entry.Channel == s.channel
			}
		}
	}
	if releasechannel.IsFeature(s.channel) && !foundCurrent {
		list.Options = append(list.Options, ChannelOption{Channel: s.channel, Status: "archived"})
	}
	home, err := os.UserHomeDir()
	for i := range list.Options {
		if list.Options[i].Channel == s.channel && s.root != "" {
			list.Options[i].StatePath = s.root
		} else if err == nil {
			list.Options[i].StatePath = filepath.Join(home, releasechannel.StateLabel(list.Options[i].Channel))
		}
		list.Options[i].StateInUse = "unknown"
		if list.Options[i].StatePath != "" {
			info, statErr := os.Lstat(list.Options[i].StatePath)
			if statErr != nil && !os.IsNotExist(statErr) {
				list.Options[i].StateError = statErr.Error()
			}
			list.Options[i].StateExists = statErr == nil
			if statErr == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
				handle, identityErr := openProfileIdentity(list.Options[i].StatePath)
				if identityErr == nil {
					var pinned os.FileInfo
					pinned, identityErr = handle.Stat()
					if identityErr == nil && (!pinned.IsDir() || !os.SameFile(info, pinned)) {
						identityErr = fmt.Errorf("channel data changed during discovery")
					}
					value := ""
					if identityErr == nil {
						for token, existing := range previous {
							if existing.channel != list.Options[i].Channel {
								continue
							}
							oldInfo, statErr := existing.handle.Stat()
							if statErr == nil && os.SameFile(oldInfo, pinned) {
								value = token
								_ = handle.Close()
								handle = existing.handle
								delete(previous, token)
								break
							}
						}
						if value == "" {
							var token [32]byte
							_, identityErr = rand.Read(token[:])
							value = hex.EncodeToString(token[:])
						}
					}
					if identityErr == nil {
						list.Options[i].StateIdentity = value
						s.identities[value] = profileIdentity{channel: list.Options[i].Channel, handle: handle}
						info = pinned
					} else {
						_ = handle.Close()
					}
				}
				if identityErr != nil {
					list.Options[i].StateError = identityErr.Error()
				}
				list.Options[i].StateFileModifiedAt = make(map[string]string)
				for _, name := range []string{"settings.db", "settings.db-wal", "plugin_state.json", instance.SwitchSeedFile, "update-checkpoints.json"} {
					fileInfo, fileErr := os.Lstat(filepath.Join(list.Options[i].StatePath, name))
					if fileErr == nil && fileInfo.Mode().IsRegular() {
						list.Options[i].StateFileModifiedAt[name] = fileInfo.ModTime().UTC().Format(time.RFC3339)
					}
				}
				list.Options[i].StateModifiedAt = info.ModTime().UTC().Format(time.RFC3339)
				if list.Options[i].Channel == s.channel {
					list.Options[i].StateInUse = "in-use"
				} else {
					list.Options[i].StateInUse = profileLockStatus(list.Options[i].StatePath)
				}
			}
		}
	}
	for _, identity := range previous {
		_ = identity.handle.Close()
	}
	return list
}

func (s *UpdateService) SwitchChannel(target string, copyCurrentData bool) (err error) {
	s.flow.Lock()
	defer s.flow.Unlock()
	if !s.configured || s.provider == nil {
		return fmt.Errorf("updater is not configured")
	}
	if target == s.channel {
		return fmt.Errorf("already on channel %s", target)
	}
	if s.updater.State() == wailsupdater.StateReady {
		return fmt.Errorf("restart to apply the downloaded update before switching channels")
	}
	if !releasechannel.Valid(target) {
		return fmt.Errorf("invalid update channel %q", target)
	}
	if releasechannel.IsFeature(target) {
		index, indexErr := s.provider.FetchIndex(context.Background())
		if indexErr != nil {
			return fmt.Errorf("load channel index: %w", indexErr)
		}
		active := false
		for _, entry := range index.Channels {
			if entry.Channel == target && entry.Status == "active" && entry.DesktopVersion != "" {
				active = true
				break
			}
		}
		if !active {
			return fmt.Errorf("channel %s has no active desktop release", target)
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("find home directory: %w", err)
	}
	targetRoot := filepath.Join(home, releasechannel.StateLabel(target))
	if copyCurrentData {
		releaseGuard, lockErr := instance.LockSwitchProfile(context.Background(), targetRoot)
		if lockErr != nil {
			return fmt.Errorf("acquire channel profile guard: %w", lockErr)
		}
		defer func() {
			if releaseErr := releaseGuard(); releaseErr != nil {
				if err != nil {
					err = errors.Join(err, fmt.Errorf("release channel profile guard: %w", releaseErr))
				} else {
					log.Printf("release channel profile guard: %v", releaseErr)
				}
			}
		}()
		if _, statErr := os.Lstat(targetRoot); statErr == nil {
			return fmt.Errorf("%s already has its own data; copy is only available for a new channel", target)
		} else if !os.IsNotExist(statErr) {
			return fmt.Errorf("check channel data: %w", statErr)
		}
	}
	if err = s.provider.SetTarget(target); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = s.provider.SetTarget("")
		}
	}()
	ctx := context.Background()
	release, err := s.updater.Check(ctx)
	if err != nil {
		return err
	}
	if release == nil {
		return fmt.Errorf("channel %s has no release for this platform", target)
	}
	if copyCurrentData {
		if err = instance.WriteSwitchSeed(targetRoot, s.root); err != nil {
			return err
		}
		defer func() {
			if err != nil {
				if removeErr := os.Remove(filepath.Join(targetRoot, instance.SwitchSeedFile)); removeErr != nil {
					err = errors.Join(err, fmt.Errorf("remove switch seed: %w", removeErr))
				} else if removeErr := os.Remove(targetRoot); removeErr != nil {
					err = errors.Join(err, fmt.Errorf("remove switch target: %w", removeErr))
				}
			}
		}()
	}
	if err = s.updater.DownloadAndInstall(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	s.availableVersion = release.Version
	s.switchTarget = target
	s.lastError = ""
	s.mu.Unlock()
	return nil
}

// DeleteChannelData removes only an inactive channel's default profile.
func (s *UpdateService) DeleteChannelData(channel, stateIdentity string) error {
	s.flow.Lock()
	defer s.flow.Unlock()
	if !releasechannel.Valid(channel) {
		return fmt.Errorf("invalid update channel %q", channel)
	}
	if channel == s.channel {
		return fmt.Errorf("cannot delete the current channel")
	}
	s.mu.Lock()
	target := s.switchTarget
	s.mu.Unlock()
	if channel == target {
		return fmt.Errorf("cannot delete the pending switch target")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("find home directory: %w", err)
	}
	home, err = devcontract.CanonicalPath(home)
	if err != nil {
		return fmt.Errorf("resolve home directory: %w", err)
	}
	path := filepath.Join(home, releasechannel.StateLabel(channel))
	info, err := captureProfileIdentity(path)
	if err != nil {
		return fmt.Errorf("inspect channel data: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("channel data must be a directory, not a symlink")
	}
	s.identityMu.Lock()
	defer s.identityMu.Unlock()
	identity, ok := s.identities[stateIdentity]
	if !ok || stateIdentity == "" || identity.channel != channel {
		return fmt.Errorf("channel data identity is unavailable or expired")
	}
	pinned, err := identity.handle.Stat()
	if err != nil || !os.SameFile(pinned, info) {
		return fmt.Errorf("channel data changed since discovery")
	}
	info = pinned
	if s.root == "" {
		return fmt.Errorf("current profile root is unavailable")
	}
	overlap, err := devcontract.ProfilePathsOverlap(path, s.root)
	if err != nil {
		return fmt.Errorf("check profile overlap: %w", err)
	}
	if overlap {
		return fmt.Errorf("channel data overlaps the current profile")
	}
	if err := devcontract.ValidateProductionProfileIsolation(path, home); err != nil {
		return fmt.Errorf("check channel profile ownership: %w", err)
	}
	release, err := instance.LockSwitchProfile(context.Background(), path)
	if err != nil {
		return fmt.Errorf("acquire channel profile guard: %w", err)
	}
	defer release()
	return deleteInactiveProfile(path, info)
}

func (s *UpdateService) Restart() error { return s.updater.Restart(context.Background()) }

// removeIsolatedProfile deletes through a pinned directory, never its pathname.
// The empty quarantine is retained because removing its name would race a rename.
func removeIsolatedProfile(path string, expected os.FileInfo) error {
	root, err := os.OpenRoot(path)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := root.Stat(".")
	if err != nil || !info.IsDir() || !os.SameFile(expected, info) {
		return fmt.Errorf("isolated channel data changed")
	}
	return removeProfileContents(root)
}

func removeProfileContents(root *os.Root) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	names, err := dir.Readdirnames(-1)
	closeErr := dir.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	for _, name := range names {
		if err := root.RemoveAll(name); err != nil {
			return err
		}
	}
	return nil
}
