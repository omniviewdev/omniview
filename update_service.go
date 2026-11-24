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
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/bootstrap"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/omniviewdev/omniview/internal/releasechannel"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	feed "github.com/omniviewdev/omniview/internal/updater"
	"github.com/wailsapp/wails/v3/pkg/application"
	wailsupdater "github.com/wailsapp/wails/v3/pkg/updater"
)

var errActiveWorkBlocksRestart = errors.New("active work would be lost; confirm restart")

type UpdateService struct {
	updater                  *wailsupdater.Updater
	provider                 *feed.Provider
	channel                  string
	root                     string
	configured               bool
	updateMode               func() string
	listActiveWork           func() []ActiveWork
	modeChanged              chan struct{}
	stopSettingsSubscription func()
	mu                       sync.Mutex
	flow                     sync.Mutex
	identityMu               sync.Mutex
	identities               map[string]profileIdentity
	lastError                string
	availableVersion         string
	switchTarget             string
	operationCancel          context.CancelFunc
	canceled                 bool
	releaseURL               string
	lastCheckedAt            string
	unsupportedReason        string
	version                  string
	cancel                   context.CancelFunc
}

type profileIdentity struct {
	channel string
	handle  *os.File
}

type UpdateStatus struct {
	State             string `json:"state"`
	Version           string `json:"version"`
	AvailableVersion  string `json:"availableVersion"`
	Error             string `json:"error"`
	Channel           string `json:"channel"`
	SwitchTarget      string `json:"switchTarget"`
	Canceled          bool   `json:"canceled"`
	ReleaseURL        string `json:"releaseUrl"`
	LastCheckedAt     string `json:"lastCheckedAt"`
	UnsupportedReason string `json:"unsupportedReason"`
}

// ActiveWork is work that a restart would end.
type ActiveWork struct {
	Kind        string `json:"kind"` // "terminal", "log-stream", "port-forward", "task", "unknown"
	Description string `json:"description"`
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

func newUpdateService(app *application.App, channel, root, version string, updateMode func() string, listActiveWork func() []ActiveWork) *UpdateService {
	s := &UpdateService{
		updater: app.Updater, channel: channel, root: root, version: version,
		updateMode: updateMode, listActiveWork: listActiveWork, modeChanged: make(chan struct{}, 1),
	}
	if reason := buildUnsupportedReason(); reason != "" {
		s.unsupportedReason = reason
		return s
	}
	provider, err := feed.NewProvider(channel, root, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "updater disabled: %v\n", err)
		return s
	}
	if provider == nil {
		return s
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "updater disabled: %v\n", err)
		return s
	}
	if problem := updateTargetProblem(exe, runtime.GOOS, directoryIsWritable); problem != "" {
		s.unsupportedReason = problem
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

func buildUnsupportedReason() string {
	if !updatesSupportedByBuild {
		return "Updates are managed by the server that hosts this Omniview instance."
	}
	return ""
}

// updateTargetProblem explains why the running executable cannot replace itself, or returns "".
func updateTargetProblem(executablePath, goos string, writable func(dir string) bool) string {
	dir := filepath.Dir(executablePath)
	if goos == "darwin" {
		if strings.Contains(executablePath, "/AppTranslocation/") {
			return "Move Omniview to your Applications folder and open it again to receive updates."
		}
		if strings.HasPrefix(executablePath, "/Volumes/") {
			return "Omniview is running from a disk image. Copy it to your Applications folder and open it from there to receive updates."
		}
		if bundleEnd := strings.Index(executablePath, ".app/Contents/MacOS/"); bundleEnd >= 0 {
			dir = filepath.Dir(executablePath[:bundleEnd+len(".app")])
		}
	}
	if !writable(dir) {
		return fmt.Sprintf("Omniview cannot replace itself in %s. Move it to a folder you can write to, or update it with the tool that installed it.", dir)
	}
	return ""
}

func directoryIsWritable(dir string) bool {
	probe, err := os.CreateTemp(dir, ".omniview-update-probe-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	closeErr := probe.Close()
	removeErr := os.Remove(name)
	return closeErr == nil && removeErr == nil
}

func (s *UpdateService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	if !s.configured {
		return nil
	}
	ctx, s.cancel = context.WithCancel(ctx)
	if app := application.Get(); app != nil {
		s.stopSettingsSubscription = app.Event.On(bootstrap.SettingsChangedEvent, func(*application.CustomEvent) { s.settingsChanged() })
	}
	go func() {
		mode := s.currentMode()
		s.runScheduledCheck(ctx, mode)
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				mode = s.currentMode()
				s.runScheduledCheck(ctx, mode)
			case <-s.modeChanged:
				next := s.currentMode()
				if next != mode && next != coresettings.UpdateModeManual {
					s.runScheduledCheck(ctx, next)
				}
				mode = next
			}
		}
	}()
	return nil
}

func (s *UpdateService) ServiceShutdown() error {
	if s.stopSettingsSubscription != nil {
		s.stopSettingsSubscription()
	}
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

// settingsChanged wakes the schedule loop; a pending wake already covers this change.
func (s *UpdateService) settingsChanged() {
	select {
	case s.modeChanged <- struct{}{}:
	default:
	}
}

func (s *UpdateService) currentMode() string {
	mode := s.updateMode()
	switch mode {
	case coresettings.UpdateModeAutomatic, coresettings.UpdateModeCheckOnly, coresettings.UpdateModeManual:
		return mode
	}
	s.mu.Lock()
	s.lastError = fmt.Sprintf("unknown update mode %q; background checks are off", mode)
	s.mu.Unlock()
	return coresettings.UpdateModeManual
}

func (s *UpdateService) runScheduledCheck(ctx context.Context, mode string) {
	switch mode {
	case coresettings.UpdateModeCheckOnly:
		_ = s.check(ctx, false)
	case coresettings.UpdateModeAutomatic:
		_ = s.check(ctx, true)
	}
}

// beginOperation makes the returned context cancelable through Cancel until finish runs.
func (s *UpdateService) beginOperation(parent context.Context) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	s.mu.Lock()
	s.operationCancel = cancel
	s.canceled = false
	s.mu.Unlock()
	return ctx, func() {
		s.mu.Lock()
		s.operationCancel = nil
		s.mu.Unlock()
		cancel()
	}
}

// recordResult stores the outcome of a check or download. A canceled operation is not an error.
func (s *UpdateService) recordResult(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case err == nil:
		s.lastError = ""
	case errors.Is(err, context.Canceled):
		s.canceled = true
		s.lastError = ""
	default:
		s.lastError = err.Error()
	}
}

func (s *UpdateService) check(ctx context.Context, downloadWhenFound bool) error {
	if !s.flow.TryLock() {
		return nil
	}
	defer s.flow.Unlock()
	if s.updater.State() == wailsupdater.StateReady {
		return nil
	}
	opCtx, finish := s.beginOperation(ctx)
	defer finish()
	release, err := s.updater.Check(opCtx)
	if err == nil {
		s.mu.Lock()
		s.lastCheckedAt = time.Now().UTC().Format(time.RFC3339)
		if release != nil {
			s.availableVersion = release.Version
			s.releaseURL, _ = release.Metadata["releaseUrl"].(string)
		}
		s.mu.Unlock()
		if release != nil && downloadWhenFound {
			err = s.updater.DownloadAndInstall(opCtx)
		}
	}
	s.recordResult(err)
	return err
}

func (s *UpdateService) Status() UpdateStatus {
	state := string(s.updater.State())
	s.mu.Lock()
	defer s.mu.Unlock()
	return UpdateStatus{
		State: state, Version: s.version, AvailableVersion: s.availableVersion,
		Error: s.lastError, Channel: s.channel, SwitchTarget: s.switchTarget,
		Canceled: s.canceled, ReleaseURL: s.releaseURL, LastCheckedAt: s.lastCheckedAt,
		UnsupportedReason: s.unsupportedReason,
	}
}

// Check looks for an update now. Automatic mode also downloads and prepares it.
func (s *UpdateService) Check() error {
	if !s.configured {
		return errors.New("updater is not configured")
	}
	return s.check(context.Background(), s.currentMode() == coresettings.UpdateModeAutomatic)
}

// Download prepares the update that a previous check found.
func (s *UpdateService) Download() error {
	if !s.configured {
		return errors.New("updater is not configured")
	}
	if s.updater.State() != wailsupdater.StateAvailable {
		return errors.New("no update is available; check for updates first")
	}
	if !s.flow.TryLock() {
		return errors.New("another update operation is running")
	}
	defer s.flow.Unlock()
	opCtx, finish := s.beginOperation(context.Background())
	defer finish()
	err := s.updater.DownloadAndInstall(opCtx)
	s.recordResult(err)
	return err
}

// Cancel stops the running check or download.
func (s *UpdateService) Cancel() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.operationCancel == nil {
		return errors.New("no update check or download is running")
	}
	s.operationCancel()
	return nil
}

// ActiveWork lists the work that a restart would end.
func (s *UpdateService) ActiveWork() []ActiveWork {
	if s.listActiveWork == nil {
		return []ActiveWork{}
	}
	if work := s.listActiveWork(); work != nil {
		return work
	}
	return []ActiveWork{}
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

// Restart applies the prepared update. Active work blocks it unless the caller confirms.
func (s *UpdateService) Restart(restartDespiteActiveWork bool) error {
	if !restartDespiteActiveWork && len(s.ActiveWork()) > 0 {
		return errActiveWorkBlocksRestart
	}
	return s.updater.Restart(context.Background())
}

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
