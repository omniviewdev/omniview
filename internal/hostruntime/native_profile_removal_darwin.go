//go:build darwin && !server

package hostruntime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"golang.org/x/sys/unix"
)

// HandleNativeProfileRemoval dispatches the hidden removal command before normal
// profile state/settings/plugin startup. A stopped UUID-owned profile and an
// active native main queue are both required.
func HandleNativeProfileRemoval(args []string) (bool, int) {
	if len(args) == 0 || args[0] != "--remove-native-profile" {
		return false, 0
	}
	fail := func(code int, message string) (bool, int) { fmt.Fprintln(os.Stderr, message); return true, code }
	if len(args) != 2 {
		return fail(2, "native profile removal requires exactly one workspace manifest")
	}
	profile, err := instance.Resolve(instance.Options{Workspace: args[1], EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), StateRoot: os.Getenv("OMNIVIEW_STATE_DIR"), Channel: "local"})
	if err != nil {
		return fail(devcontract.ExitCode(err), "native profile removal: invalid workspace identity")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return fail(5, "native profile removal: cannot locate profile guard")
	}
	release, inherited, err := nativeRemovalUUIDGuard(home, profile.Descriptor.WorkspaceID)
	if err != nil {
		return fail(4, "native profile removal: profile guard capability is invalid or busy")
	}
	defer release()
	selected, err := instance.Resolve(instance.Options{Workspace: args[1], EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), StateRoot: os.Getenv("OMNIVIEW_STATE_DIR"), Channel: "local"})
	if err != nil || selected.Descriptor.WorkspaceID != profile.Descriptor.WorkspaceID {
		return fail(4, "native profile removal: workspace binding changed; resolve it again")
	}
	profile = selected
	if err := devcontract.ValidateDefaultProfileOwnership(home, profile.Descriptor.WorkspaceID); err != nil {
		return fail(4, "native profile removal: default UUID profile ownership is not established")
	}
	unlock, err := nativeRemovalStateGuards(home, profile.Descriptor.WorkspaceID, profile.Descriptor.StateRoot, inherited)
	if err != nil {
		return fail(4, "native profile removal: state is busy or its lock identity is unsafe")
	}
	defer unlock()
	if err := validateNativeBundle(profile); err != nil {
		return fail(4, "native profile removal: application bundle identity differs from the guarded workspace")
	}
	options := application.Options{Name: "Omniview profile cleanup"}
	// A tooling-tagged host may start MCP even without windows. Give this helper
	// an unadvertised ephemeral, authenticated listener instead of reusing the
	// stopped instance's leased port or the framework's fixed default.
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return fail(5, "native profile removal: cannot secure tooling listener")
	}
	for key, value := range map[string]string{"WAILS_MCP_HOST": "127.0.0.1", "WAILS_MCP_PORT": "0", "WAILS_MCP_TOKEN": hex.EncodeToString(token[:])} {
		if err := os.Setenv(key, value); err != nil {
			return fail(5, "native profile removal: cannot isolate tooling listener")
		}
	}
	_ = os.Unsetenv("FRONTEND_DEVSERVER_URL")
	app := application.New(options)
	result := make(chan error, 1)
	var once sync.Once
	finish := func(err error) { once.Do(func() { result <- err; app.Quit() }) }
	cancellations := make(chan func(), 1)
	defer func() {
		select {
		case cancel := <-cancellations:
			cancel()
		default:
		}
	}()
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
		cancellations <- removeNativeStorage(finish)
	})
	timer := time.AfterFunc(30*time.Second, func() { finish(context.DeadlineExceeded) })
	defer timer.Stop()
	if err := app.Run(); err != nil {
		return fail(5, "native profile removal: native event loop failed")
	}
	select {
	case err := <-result:
		if err == context.DeadlineExceeded {
			return fail(7, "native profile removal: callback deadline exceeded; no cleanup success recorded")
		}
		return true, 0
	default:
		return fail(5, "native profile removal: event loop exited before deletion callback")
	}
}

func lockNativeRemovalState(root string) (func(), error) {
	info, err := os.Lstat(root)
	if os.IsNotExist(err) {
		return func() {}, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("invalid state root")
	}
	path := filepath.Join(root, ".lock")
	fd, err := unix.Open(path, unix.O_CREAT|unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	fail := func(err error) (func(), error) { _ = file.Close(); return nil, err }
	opened, err := file.Stat()
	if err != nil {
		return fail(err)
	}
	if !opened.Mode().IsRegular() {
		return fail(fmt.Errorf("nonregular profile lock"))
	}
	current, err := os.Lstat(path)
	if err != nil {
		return fail(err)
	}
	if !os.SameFile(opened, current) {
		return fail(fmt.Errorf("replaced profile lock"))
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return fail(err)
	}
	return func() { _ = unix.Flock(fd, unix.LOCK_UN); _ = file.Close() }, nil
}

// Inherited descriptors are capabilities for already-held open file descriptions,
// not permission to skip locks. Never LOCK_UN them: the parent retains the same
// description throughout the remaining removal transaction.
func nativeRemovalUUIDGuard(home, id string) (func(), map[string]int, error) {
	raw, present := os.LookupEnv("OMNIVIEW_NATIVE_PURGE_LOCK_FDS")
	if !present {
		release, err := devcontract.LockProfile(context.Background(), home, id)
		if err != nil {
			return nil, nil, err
		}
		return func() { _ = release() }, nil, nil
	}
	var inherited map[string]int
	decoder := json.NewDecoder(strings.NewReader(raw))
	if err := decoder.Decode(&inherited); err != nil {
		return nil, nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, nil, fmt.Errorf("invalid guard mapping")
	}
	if len(inherited) == 0 {
		return nil, nil, fmt.Errorf("empty guard mapping")
	}
	seen := make(map[int]bool, len(inherited))
	for role, fd := range inherited {
		if role != "uuid" && role != "selected-state" && role != "default-state" {
			return nil, nil, fmt.Errorf("unknown guard role")
		}
		if fd < 3 || fd > 1024 || seen[fd] {
			return nil, nil, fmt.Errorf("invalid guard descriptor")
		}
		seen[fd] = true
	}
	fd, ok := inherited["uuid"]
	if !ok {
		return nil, nil, fmt.Errorf("missing UUID guard")
	}
	path, err := devcontract.ProfileGuardPath(home, id)
	if err != nil {
		return nil, nil, err
	}
	file, err := retainInheritedNativeGuard(fd, path)
	if err != nil {
		return nil, nil, err
	}
	return func() { _ = file.Close() }, inherited, nil
}

func nativeRemovalStateGuards(home, id, selected string, inherited map[string]int) (func(), error) {
	expected := make(map[string]string)
	home, err := devcontract.CanonicalPath(home)
	if err != nil {
		return nil, err
	}
	defaultRoot := filepath.Join(home, ".omniview-dev", "profiles", id, "state")
	canonical, err := devcontract.CanonicalPath(defaultRoot)
	if err != nil {
		return nil, err
	}
	if canonical != defaultRoot {
		return nil, fmt.Errorf("default state root is redirected")
	}
	roots := []struct{ role, path string }{{"selected-state", selected}}
	if defaultRoot != selected {
		roots = append(roots, struct{ role, path string }{"default-state", defaultRoot})
	}
	for _, root := range roots {
		info, err := os.Lstat(root.path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("invalid state root")
		}
		expected[root.role] = filepath.Join(root.path, ".lock")
	}
	var releases []func()
	release := func() {
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
	}
	fail := func(err error) (func(), error) { release(); return nil, err }
	if inherited != nil {
		if len(inherited) != len(expected)+1 {
			return fail(fmt.Errorf("unexpected guard roles"))
		}
		for role, path := range expected {
			fd, ok := inherited[role]
			if !ok {
				return fail(fmt.Errorf("missing state guard"))
			}
			file, err := retainInheritedNativeGuard(fd, path)
			if err != nil {
				return fail(err)
			}
			releases = append(releases, func() { _ = file.Close() })
		}
	} else {
		for _, root := range roots {
			if _, ok := expected[root.role]; !ok {
				continue
			}
			unlock, err := lockNativeRemovalState(root.path)
			if err != nil {
				return fail(err)
			}
			releases = append(releases, unlock)
		}
	}
	return release, nil
}

func retainInheritedNativeGuard(fd int, path string) (*os.File, error) {
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		return nil, fmt.Errorf("invalid guard descriptor")
	}
	fail := func(err error) (*os.File, error) { _ = file.Close(); return nil, err }
	opened, err := file.Stat()
	if err != nil {
		return fail(err)
	}
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		return fail(err)
	}
	if !opened.Mode().IsRegular() || opened.Mode().Perm()&0077 != 0 || stat.Uid != uint32(os.Geteuid()) {
		return fail(fmt.Errorf("guard is not a private owned regular file"))
	}
	current, err := os.Lstat(path)
	if err != nil {
		return fail(err)
	}
	if !current.Mode().IsRegular() || !os.SameFile(opened, current) {
		return fail(fmt.Errorf("guard identity changed"))
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return fail(err)
	}
	return file, nil
}
