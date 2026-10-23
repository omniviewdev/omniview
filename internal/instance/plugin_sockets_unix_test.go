//go:build darwin || linux

package instance

import (
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// A managed child must not inherit an arbitrary short socket directory just
// because its real UUID-owned TMPDIR is too long for sockaddr_un.
func TestManagedPluginUnixSocketEnvironmentRejectsUnownedInheritedDirectory(t *testing.T) {
	home := filepath.Join(t.TempDir(), strings.Repeat("long-home-", 16))
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	home, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	manifest := workspaceFixture(t, home, fixtureID, "Long HOME")
	profile, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local", Generation: fixtureID})
	if err != nil {
		t.Fatal(err)
	}
	short, err := os.MkdirTemp("/tmp", "ov-socket-boundary-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(short)
	short, err = filepath.EvalSymlinks(short)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", filepath.Join(short, "sentinel"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	served := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err == nil {
			defer connection.Close()
			_, err = io.WriteString(connection, "foreign-socket-stays-owned")
		}
		served <- err
	}()
	base, err := profile.ChildEnvironment(nil, "")
	if err != nil {
		t.Fatal(err)
	}
	base = append(base,
		"OMNIVIEW_PROCESS_BRIDGE_ENDPOINT=http://127.0.0.1:1/v1/process",
		"OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE="+filepath.Join(filepath.Dir(manifest), ".local", "supervisor.secret"),
		"PLUGIN_UNIX_SOCKET_DIR="+short,
		"TMPDIR="+filepath.Join(profile.RuntimeRoot, "tmp"),
	)
	_, environmentErr := PluginEnvironment(profile.Descriptor.StateRoot, "workspace-probe", base)
	connection, err := net.DialTimeout("unix", filepath.Join(short, "sentinel"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	nonce, err := io.ReadAll(connection)
	if err != nil || string(nonce) != "foreign-socket-stays-owned" {
		t.Fatalf("foreign listener was changed: nonce=%q err=%v", nonce, err)
	}
	if err := <-served; err != nil {
		t.Fatal(err)
	}
	if environmentErr == nil {
		t.Fatal("managed plugin accepted unrecorded inherited Unix socket directory under a long HOME")
	}
}

func TestManagedPluginUnixSocketEnvironmentUsesRecordedRootWithoutChangingTMPDIR(t *testing.T) {
	home := filepath.Join(t.TempDir(), strings.Repeat("long-home-", 16))
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	home, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	manifest := workspaceFixture(t, home, fixtureID, "Recorded sockets")
	profile, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local", Generation: uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	tmp := filepath.Join(profile.RuntimeRoot, "tmp")
	if err := os.MkdirAll(tmp, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TMPDIR", tmp)
	owner, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: fixtureID, Generation: profile.Descriptor.Generation, Role: "supervisor", Source: profile.Workspace.Root})
	if err != nil {
		t.Fatal(err)
	}
	directory, err := devsession.CreateUnixSocketDirectory(profile.RuntimeRoot, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := directory.Close(); err != nil {
			t.Error(err)
		}
	}()
	base, err := profile.ChildEnvironment(nil, "")
	if err != nil {
		t.Fatal(err)
	}
	base = append(base, "OMNIVIEW_PROCESS_BRIDGE_ENDPOINT=http://127.0.0.1:1/v1/process",
		"OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE="+filepath.Join(filepath.Dir(manifest), ".local", "supervisor.secret"),
		"PLUGIN_UNIX_SOCKET_DIR=/foreign", "PLUGIN_UNIX_SOCKET_GROUP=foreign", "TMPDIR="+tmp)
	env, err := PluginEnvironment(profile.Descriptor.StateRoot, "workspace-probe", base)
	if err != nil {
		t.Fatal(err)
	}
	var socketRoot string
	for _, entry := range env {
		if strings.HasPrefix(entry, "PLUGIN_UNIX_SOCKET_DIR=") {
			socketRoot = strings.TrimPrefix(entry, "PLUGIN_UNIX_SOCKET_DIR=")
		}
		if strings.Contains(entry, "foreign") || strings.HasPrefix(entry, "OMNIVIEW_PROCESS_BRIDGE_") {
			t.Fatalf("inherited transport authority survived: %q", entry)
		}
	}
	if socketRoot == "" || socketRoot == tmp {
		t.Fatal("managed plugin did not receive its short recorded namespace")
	}
	if os.Getenv("TMPDIR") != tmp || !strings.Contains(strings.Join(env, "\n"), "TMPDIR="+tmp) {
		t.Fatal("general profile temporary storage was redirected")
	}
	listener, err := net.Listen("unix", filepath.Join(socketRoot, "plugin1234567890"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	served := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err == nil {
			defer connection.Close()
			_, err = io.WriteString(connection, "actual-managed-child-nonce")
		}
		served <- err
	}()
	connection, err := net.DialTimeout("unix", filepath.Join(socketRoot, "plugin1234567890"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	nonce, err := io.ReadAll(connection)
	if err != nil || string(nonce) != "actual-managed-child-nonce" {
		t.Fatalf("nonce=%q err=%v", nonce, err)
	}
	if err := <-served; err != nil {
		t.Fatal(err)
	}
}

func TestDirectPluginEnvironmentDoesNotRequireSupervisorSocketRecord(t *testing.T) {
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	manifest := workspaceFixture(t, home, fixtureID, "Direct")
	profile, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local", Generation: fixtureID})
	if err != nil {
		t.Fatal(err)
	}
	childEnvironment, err := profile.ChildEnvironment(nil, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, base := range [][]string{
		append(childEnvironment, "PLUGIN_UNIX_SOCKET_DIR=/foreign"),
		{"OMNIVIEW_GENERATION=" + fixtureID, "PLUGIN_UNIX_SOCKET_DIR=/foreign"},
	} {
		env, err := PluginEnvironment(profile.Descriptor.StateRoot, "workspace-probe", base)
		if err != nil {
			t.Fatalf("direct flow acquired a managed-only dependency: %v", err)
		}
		if strings.Contains(strings.Join(env, "\n"), "PLUGIN_UNIX_SOCKET_DIR=") {
			t.Fatal("direct flow inherited raw socket authority")
		}
	}
}
