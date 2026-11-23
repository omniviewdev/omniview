package plugin

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	goplugin "github.com/hashicorp/go-plugin"
	"github.com/hashicorp/yamux"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
)

// The plugin of S4's tests (docs/ui-next/status/S4.md): a real process that serves only the plugin protocol a test names, as a plugin built on an SDK of that protocol does, and that can misbehave in the ways a
// plugin the host refuses may: never answer the request go-plugin makes to stop it, accept a connection and never speak, present another certificate than the one it advertised. It writes down what the host says to it
// (every request it receives, every connection it accepts), so that a test can see that the host said nothing. Nothing in this file uses what S4 adds, so the same file builds and runs on the tree before it,
// which is how the waits on a plugin and the start of a compatible one are measured before and after (TestTheStartOfAPluginIsMeasured).

const (
	// protocolChildEnv is the protocol the child of this file serves, and the child does nothing when it is not set.
	protocolChildEnv = "OMNIVIEW_PROTOCOL_TEST_CHILD"
	// protocolChildPIDEnv names the file the child appends its process id to (a line each), so that a test can see that the host did not keep the process of a plugin it refused.
	protocolChildPIDEnv = "OMNIVIEW_PROTOCOL_TEST_PID_FILE"
	protocolChildBinary = "OMNIVIEW_PROTOCOL_TEST_BINARY"
	// protocolChildModeEnv is how the child misbehaves (the modes below); none is a plugin that answers everything.
	protocolChildModeEnv = "OMNIVIEW_PROTOCOL_TEST_MODE"
	// protocolChildHeardEnv names the file the child appends what the host said to it to, a line each.
	protocolChildHeardEnv = "OMNIVIEW_PROTOCOL_TEST_HEARD_FILE"
	// protocolChildRawEnv is what the child of the mode `raw` writes to its stdout, with no newline, before it says nothing more.
	protocolChildRawEnv = "OMNIVIEW_PROTOCOL_TEST_RAW"

	// A plugin that answers everything is the empty mode.
	// modeHangShutdown never answers the request go-plugin makes to stop a plugin (`Shutdown`), as a plugin whose server is wedged does.
	modeHangShutdown = "hang-shutdown"
	// modeTarpit says a handshake line of the right shape and accepts a connection to its socket, and then never says a word.
	modeTarpit = "tarpit"
	// modeImpostor advertises one certificate in its handshake line and serves TLS with another.
	modeImpostor = "impostor"
	// modeRaw writes protocolChildRawEnv to its stdout and then says nothing: a plugin whose handshake line never ends.
	modeRaw = "raw"
)

// protocolChildHeard writes down one thing the host said to the child.
func protocolChildHeard(line string) {
	file := os.Getenv(protocolChildHeardEnv)
	if file == "" {
		return
	}
	handle, err := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, _ = handle.WriteString(line + "\n")
	_ = handle.Close()
}

// protocolChildSocket makes the socket a go-plugin server makes: a file called plugin and a number in the temporary directory, which only the plugin's own listener closing removes.
func protocolChildSocket(t *testing.T) *net.UnixListener {
	t.Helper()
	file, err := os.CreateTemp("", "plugin")
	require.NoError(t, err)
	path := file.Name()
	require.NoError(t, file.Close())
	require.NoError(t, os.Remove(path))
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	require.NoError(t, err)
	return listener
}

// protocolChildSays writes the handshake line of a plugin of this protocol, listening on listener and presenting this certificate.
func protocolChildSays(protocol int, listener net.Listener, certificate []byte) {
	_, _ = fmt.Fprintf(os.Stdout, "1|%d|unix|%s|grpc|%s|true\n", protocol, listener.Addr().String(), base64.RawStdEncoding.EncodeToString(certificate))
	_ = os.Stdout.Sync()
}

// protocolChildInterceptors write down every request the child receives, and make the child of the mode modeHangShutdown never answer the one that stops it.
func protocolChildInterceptors(mode string) []grpc.ServerOption {
	return []grpc.ServerOption{
		grpc.ChainUnaryInterceptor(func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
			protocolChildHeard(info.FullMethod)
			if mode == modeHangShutdown && strings.HasSuffix(info.FullMethod, "/Shutdown") {
				<-ctx.Done()
				return nil, ctx.Err()
			}
			return handler(ctx, request)
		}),
		grpc.ChainStreamInterceptor(func(server any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
			protocolChildHeard(info.FullMethod)
			return handler(server, stream)
		}),
	}
}

// protocolChildTarpit is the plugin of the mode modeTarpit.
func protocolChildTarpit(t *testing.T, protocol int) {
	t.Helper()
	listener := protocolChildSocket(t)
	_, certificate := impostorCertificate(t)
	protocolChildSays(protocol, listener, certificate)
	for {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		protocolChildHeard("a connection was accepted")
		go func() { _, _ = io.Copy(io.Discard, connection) }()
	}
}

// protocolChildImpostor is the plugin of the mode modeImpostor: a go-plugin server by hand that advertises certificate A (whose key it discards) and serves TLS with certificate B.
func protocolChildImpostor(t *testing.T, protocol int) {
	t.Helper()
	listener := protocolChildSocket(t)
	_, advertised := impostorCertificate(t)
	served, _ := impostorCertificate(t)
	protocolChildSays(protocol, listener, advertised)
	connection, err := listener.Accept()
	if err != nil {
		return
	}
	protocolChildHeard("a connection was accepted")
	session, err := yamux.Server(connection, yamux.DefaultConfig())
	require.NoError(t, err)
	for {
		stream, acceptErr := session.Accept()
		if acceptErr != nil {
			return
		}
		go func() {
			protocolChildHeard("a TLS handshake was begun")
			_ = tls.Server(stream, &tls.Config{Certificates: []tls.Certificate{served}, MinVersion: tls.VersionTLS12, NextProtos: []string{"h2"}}).Handshake()
		}()
	}
}

// TestProtocolChildProcess is the plugin of this file: a real go-plugin server (gRPC, the host's handshake and the lifecycle service every plugin has) that serves ONLY the protocol the parent test names, and
// misbehaves as the mode says. It does nothing unless the parent test started it.
func TestProtocolChildProcess(t *testing.T) {
	text := os.Getenv(protocolChildEnv)
	if text == "" {
		return
	}
	protocol, err := strconv.Atoi(text)
	require.NoError(t, err)
	id := os.Getenv("OMNIVIEW_PLUGIN_ID")
	if file := os.Getenv(protocolChildPIDEnv); file != "" {
		handle, openErr := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		require.NoError(t, openErr)
		_, _ = fmt.Fprintf(handle, "%d\n", os.Getpid())
		require.NoError(t, handle.Close())
	}
	mode := os.Getenv(protocolChildModeEnv)
	switch mode {
	case modeTarpit:
		protocolChildTarpit(t, protocol)
		return
	case modeImpostor:
		protocolChildImpostor(t, protocol)
		return
	case modeRaw:
		_, _ = os.Stdout.WriteString(os.Getenv(protocolChildRawEnv))
		_ = os.Stdout.Sync()
		time.Sleep(time.Minute)
		return
	}
	goplugin.Serve(&goplugin.ServeConfig{
		HandshakeConfig: (&config.PluginMeta{ID: id}).GenerateHandshakeConfig(),
		VersionedPlugins: map[int]goplugin.PluginSet{protocol: {
			"lifecycle": &lc.Plugin{Impl: &lc.Server{PluginID: id, SDKProtocolVersion: int32(protocol), Capabilities: nil}},
		}},
		GRPCServer: func(options []grpc.ServerOption) *grpc.Server {
			return grpc.NewServer(append(options, protocolChildInterceptors(mode)...)...)
		},
	})
	os.Exit(0)
}

// protocolFixture is where a test finds what the child of an installed plugin did.
type protocolFixture struct {
	// pids is the file the child appends its process id to.
	pids string
	// heard is the file the child appends what the host said to it to.
	heard string
	// sockets is the plugin's own temporary directory, where it makes its socket.
	sockets string
}

// installProtocolPlugin installs a plugin whose process is the child of this file, serving only `protocol` and misbehaving as `mode` says.
func installProtocolPlugin(t *testing.T, pm *pluginManager, id string, protocol int, mode string) protocolFixture {
	t.Helper()
	binary, err := os.Executable()
	require.NoError(t, err)
	dir := t.TempDir()
	fixture := protocolFixture{pids: filepath.Join(dir, "pids"), heard: filepath.Join(dir, "heard"), sockets: shortSocketRoot(t, "pr-")}
	t.Setenv(protocolChildBinary, binary)
	t.Setenv(protocolChildEnv, strconv.Itoa(protocol))
	t.Setenv(protocolChildPIDEnv, fixture.pids)
	t.Setenv(protocolChildModeEnv, mode)
	t.Setenv(protocolChildHeardEnv, fixture.heard)
	installPluginFixture(t, pm, id, []string{"resource"}, true)
	writePluginFixture(t, filepath.Join(pm.pluginsRoot.ResolvePath(id), "bin"), pluginFixtureRunsTestBinary(protocolChildBinary, "TestProtocolChildProcess"))
	return fixture
}

// protocolPlugin installs a plugin that answers everything and serves only `protocol`. It returns the file the child appends its process id to.
func protocolPlugin(t *testing.T, pm *pluginManager, id string, protocol int) string {
	t.Helper()
	return installProtocolPlugin(t, pm, id, protocol, "").pids
}

// pidsIn is the process ids the children of a fixture wrote, in the order they started.
func pidsIn(t *testing.T, file string) []int {
	t.Helper()
	text, err := os.ReadFile(file)
	if os.IsNotExist(err) {
		return nil
	}
	require.NoError(t, err)
	var pids []int
	for _, field := range strings.Fields(string(text)) {
		pid, parseErr := strconv.Atoi(field)
		require.NoError(t, parseErr)
		pids = append(pids, pid)
	}
	return pids
}

// heardBy is what the host said to the children of a fixture: one line for each request and each connection.
func heardBy(t *testing.T, fixture protocolFixture) []string {
	t.Helper()
	text, err := os.ReadFile(fixture.heard)
	if os.IsNotExist(err) {
		return nil
	}
	require.NoError(t, err)
	return strings.Fields(strings.ReplaceAll(string(text), " ", "_"))
}

// killProcess ends a process by its id, whatever the system: the children of these tests are the host's to end, and a test that hangs ends them so that it can report.
func killProcess(pid int) {
	if process, err := os.FindProcess(pid); err == nil {
		_ = process.Kill()
	}
}

// createdBackend is what createBackend answered.
type createdBackend struct {
	backend plugintypes.PluginBackend
	err     error
}

// createWithin loads the plugin "acme" of a fixture through createBackend and waits at most `bound` for it to answer. A load that does not answer fails the test and ends the plugin's processes, which is what lets
// it answer, so that a hung load is a red test and never a hung one.
func createWithin(t *testing.T, pm *pluginManager, fixture protocolFixture, bound time.Duration) (plugintypes.PluginBackend, time.Duration, error) {
	t.Helper()
	answered := make(chan createdBackend, 1)
	started := time.Now()
	go func() {
		backend, err := pm.createBackend("acme", config.PluginMeta{ID: "acme"}, pm.pluginsRoot.ResolvePath("acme"))
		answered <- createdBackend{backend: backend, err: err}
	}()
	select {
	case result := <-answered:
		return result.backend, time.Since(started), result.err
	case <-time.After(bound):
		for _, pid := range pidsIn(t, fixture.pids) {
			killProcess(pid)
		}
		select {
		case <-answered:
		case <-time.After(30 * time.Second):
		}
		require.FailNowf(t, "the load did not answer", "createBackend had not answered after %v: the host waited on a plugin it had refused", bound)
		return nil, 0, nil
	}
}

// processEnds waits until every process that wrote its id to pidFile is gone: a plugin the host refused is not a process the host keeps.
func processEnds(t *testing.T, pidFile string) {
	t.Helper()
	require.Eventually(t, func() bool { return len(pidsIn(t, pidFile)) > 0 }, 5*time.Second, 10*time.Millisecond, "the plugin's process said who it is")
	for _, pid := range pidsIn(t, pidFile) {
		require.Eventually(t, func() bool {
			_, err := devsession.ObserveProcess(pid)
			return err != nil
		}, 5*time.Second, 10*time.Millisecond, "the process of a plugin the host refused is gone (pid %d)", pid)
	}
}

// TestTheStartOfAPluginIsMeasured is the measurement behind S4's claim that offering go-plugin sixteen protocols and deciding by number costs a plugin that is run nothing: it starts the real process of a plugin on the
// protocol the loader's own createBackend is given (process, handshake, and for a plugin that is run, the dial) as many times as S4_MEASURE_START says, on protocol S4_MEASURE_PROTOCOL (1 when unset) and as
// S4_MEASURE_MODE misbehaves (it does not when unset), after S4_MEASURE_WARMUP starts that are not counted (5 when unset), and logs the times. It does nothing without the variable. Every start, the warm-ups
// included, must end in the outcome that is measured (requireMeasuredOutcome), so that a start that failed for another reason (an executable that could not be made, a process that could not be started) is never timed
// as if it were the start or the refusal. The file builds on the tree before the change, given a stub of refusedByNumber (see loader_protocol_outcome_test.go), so the same command measures both:
// S4_MEASURE_START=60 go test ./backend/pkg/plugin -run TheStartOfAPluginIsMeasured -v.
func TestTheStartOfAPluginIsMeasured(t *testing.T) {
	text := os.Getenv("S4_MEASURE_START")
	if text == "" {
		t.Skip("set S4_MEASURE_START=<runs> to measure the start of a plugin (see the S4 status file)")
	}
	runs, err := strconv.Atoi(text)
	require.NoError(t, err)
	protocol := 1
	if given := os.Getenv("S4_MEASURE_PROTOCOL"); given != "" {
		protocol, err = strconv.Atoi(given)
		require.NoError(t, err)
	}
	warmup := 5
	if given := os.Getenv("S4_MEASURE_WARMUP"); given != "" {
		warmup, err = strconv.Atoi(given)
		require.NoError(t, err)
	}
	mode := os.Getenv("S4_MEASURE_MODE")
	expect := measuredOutcome(protocol, mode)
	pm := newTestManager(t)
	fixture := installProtocolPlugin(t, pm, "acme", protocol, mode)
	location := pm.pluginsRoot.ResolvePath("acme")

	took := make([]time.Duration, 0, runs)
	for i := range runs + warmup {
		started := time.Now()
		backend, createErr := pm.createBackend("acme", config.PluginMeta{ID: "acme"}, location)
		elapsed := time.Since(started)
		if createErr == nil {
			backend.Kill()
		}
		requireMeasuredOutcome(t, expect, createErr, i)
		if i >= warmup {
			took = append(took, elapsed)
		}
	}
	slices.Sort(took)
	var total time.Duration
	for _, each := range took {
		total += each
	}
	at := func(fraction float64) time.Duration { return took[int(float64(len(took)-1)*fraction)] }
	t.Logf("S4_MEASURE protocol=%d mode=%q expect=%s runs=%d min=%v p10=%v median=%v p90=%v max=%v mean=%v heard=%d", protocol, mode, expect, runs, took[0], at(0.1), at(0.5), at(0.9), took[len(took)-1], total/time.Duration(len(took)), len(heardBy(t, fixture)))
}

// measuredOutcome is what every start of a measurement must end in: "start" (the load succeeds), "refused" (the host's typed refusal of the plugin's protocol number) or "failed" (any other failure of the load).
// S4_MEASURE_EXPECT says it; unset, it is "start" for the protocol 1 the host runs with no misbehaviour, "refused" for the protocols 2 to 16 the host offers go-plugin, and "failed" for everything else (a protocol past
// what it offers is go-plugin's refusal, and so is a misbehaving plugin of protocol 1 that does not start). On the tree before S4, where nothing is typed, S4_MEASURE_EXPECT=failed measures a refusal.
func measuredOutcome(protocol int, mode string) string {
	if given := os.Getenv("S4_MEASURE_EXPECT"); given != "" {
		return given
	}
	switch {
	case protocol == 1 && mode == "":
		return "start"
	case protocol >= 2 && protocol <= 16:
		return "refused"
	default:
		return "failed"
	}
}

// requireMeasuredOutcome fails the measurement when start number start ended in something else than expect.
func requireMeasuredOutcome(t *testing.T, expect string, err error, start int) {
	t.Helper()
	switch expect {
	case "start":
		require.NoError(t, err, "start %d was meant to start the plugin", start)
	case "refused":
		require.Error(t, err, "start %d was meant to be refused by the plugin's protocol number", start)
		require.True(t, refusedByNumber(err), "start %d was meant to be refused by the plugin's protocol number, and ended in: %v", start, err)
	case "failed":
		require.Error(t, err, "start %d was meant to fail", start)
	default:
		require.FailNow(t, "S4_MEASURE_EXPECT is start, refused or failed", "got %q", expect)
	}
}
