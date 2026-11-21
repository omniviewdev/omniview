package plugin

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	goplugin "github.com/hashicorp/go-plugin"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	sdkactivity "github.com/omniviewdev/plugin-sdk/pkg/activity"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
)

// The channel between the host and an out-of-process plugin is mutually
// authenticated TLS (go-plugin AutoMTLS). These tests stop short of claiming
// more than that: they show that other local processes cannot use the channel,
// not that a plugin is contained.
//
// The child is the activity broker test child (activities_broker_test.go). It
// reports, for every unary call it serves, what its own gRPC server saw of the
// peer, through the file named by channelPeerFileEnv.

const (
	// channelAuthChildMode makes the child behave as a supporting producer and,
	// when the host binds activities, call the host's callback server once so the
	// brokered connection is exercised by a real plugin-to-host call.
	channelAuthChildMode = "channel-auth"
	channelPeerFileEnv   = "OMNIVIEW_CHANNEL_PEER_FILE"
)

// channelPeerRecord is what the plugin's gRPC server saw for one inbound call.
type channelPeerRecord struct {
	Method string `json:"method"`
	// TLS reports that the connection carried TLS auth info.
	TLS bool `json:"tls"`
	// VerifiedChains is the number of verified client certificate chains.
	VerifiedChains int `json:"verifiedChains"`
	// ClientIsHostCertificate reports that the verified client leaf is exactly
	// the certificate the host handed to the child in PLUGIN_CLIENT_CERT.
	ClientIsHostCertificate bool `json:"clientIsHostCertificate"`
}

// recordChannelPeer runs in the child process. It does nothing unless the test
// asked for peer reports.
func recordChannelPeer(ctx context.Context, method string) {
	path := os.Getenv(channelPeerFileEnv)
	if path == "" {
		return
	}
	record := channelPeerRecord{Method: method}
	if p, ok := peer.FromContext(ctx); ok {
		if info, isTLS := p.AuthInfo.(credentials.TLSInfo); isTLS {
			record.TLS = true
			record.VerifiedChains = len(info.State.VerifiedChains)
			block, _ := pem.Decode([]byte(os.Getenv("PLUGIN_CLIENT_CERT")))
			if block != nil && len(info.State.PeerCertificates) > 0 {
				record.ClientIsHostCertificate = string(block.Bytes) == string(info.State.PeerCertificates[0].Raw)
			}
		}
	}
	line, err := json.Marshal(record)
	if err != nil {
		return
	}
	// One small append per call: concurrent calls do not interleave their lines.
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer func() { _ = file.Close() }()
	_, _ = file.Write(append(line, '\n'))
}

func readChannelPeerRecords(t *testing.T, path string) []channelPeerRecord {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var records []channelPeerRecord
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var record channelPeerRecord
		require.NoError(t, json.Unmarshal([]byte(line), &record), line)
		records = append(records, record)
	}
	return records
}

// channelPeerReporter is the host side of the activity callback connection. It
// records what the host's callback server saw of the plugin.
type channelPeerReporter struct {
	mu    sync.Mutex
	peers []credentials.TLSInfo
	plain int
}

func (r *channelPeerReporter) observe(ctx context.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := peer.FromContext(ctx); ok {
		if info, isTLS := p.AuthInfo.(credentials.TLSInfo); isTLS {
			r.peers = append(r.peers, info)
			return
		}
	}
	r.plain++
}

func (r *channelPeerReporter) BeginTask(ctx context.Context, _ sdkactivity.Spec) (sdkactivity.Record, error) {
	r.observe(ctx)
	return sdkactivity.Record{}, nil
}

func (*channelPeerReporter) ReportTask(context.Context, sdkactivity.ReportTaskRequest) (sdkactivity.Record, error) {
	return sdkactivity.Record{}, errors.New("not used")
}

func (*channelPeerReporter) FinishTask(context.Context, sdkactivity.FinishTaskRequest) (sdkactivity.Record, error) {
	return sdkactivity.Record{}, errors.New("not used")
}

func (*channelPeerReporter) PublishMessage(context.Context, sdkactivity.Spec) (sdkactivity.Record, error) {
	return sdkactivity.Record{}, errors.New("not used")
}

func (*channelPeerReporter) UpsertAlert(context.Context, sdkactivity.AlertRequest) (sdkactivity.Record, error) {
	return sdkactivity.Record{}, errors.New("not used")
}

func (*channelPeerReporter) ResolveAlert(context.Context, sdkactivity.ResolveAlertRequest) (sdkactivity.Record, error) {
	return sdkactivity.Record{}, errors.New("not used")
}

// channelWrapperFixture lays out a plugin directory whose executable runs the
// test binary as the broker child. before is what the executable does first.
func channelWrapperFixture(t *testing.T, before *pluginFixtureBehaviour) string {
	t.Helper()
	root := channelWrapperFor(t, "TestActivityBrokerChildProcess", before)
	t.Setenv(activityBrokerChildEnv, channelAuthChildMode)
	return root
}

// channelWrapperFor lays out a plugin directory whose executable (the fixture
// program, a real executable on every OS) runs the test function childTest of
// this test binary. before, which may be nil, says what it does first: files it
// writes and variables it changes.
func channelWrapperFor(t *testing.T, childTest string, before *pluginFixtureBehaviour) string {
	t.Helper()
	binary, err := os.Executable()
	require.NoError(t, err)
	// The child makes its listener under TMPDIR, and a child that is killed (or
	// that the host stops without a graceful exit) leaves the socket behind: give
	// the child a short directory of its own that the test removes.
	shortSocketRoot(t, "ch-")
	root := t.TempDir()
	behaviour := pluginFixtureRunsTestBinary("CHANNEL_TEST_BINARY", childTest)
	if before != nil {
		behaviour.Records, behaviour.Env = before.Records, before.Env
	}
	writePluginFixture(t, filepath.Join(root, "bin"), behaviour)
	t.Setenv("CHANNEL_TEST_BINARY", binary)
	return root
}

// TestCreateBackendChannelIsMutuallyAuthenticated starts a real child through
// the production path and inspects both ends of the channel.
func TestCreateBackendChannelIsMutuallyAuthenticated(t *testing.T) {
	dir := t.TempDir()
	certFile := filepath.Join(dir, "host-cert")
	peerFile := filepath.Join(dir, "peers")
	root := channelWrapperFixture(t, &pluginFixtureBehaviour{Records: []pluginFixtureRecord{
		{File: "${CHANNEL_TEST_CERT_FILE}", Text: "${PLUGIN_CLIENT_CERT}"},
	}})
	t.Setenv("CHANNEL_TEST_CERT_FILE", certFile)
	t.Setenv(channelPeerFileEnv, peerFile)

	pm := newTestManager(t)
	backend, err := pm.createBackend("activity-broker-test", config.PluginMeta{ID: "activity-broker-test"}, root)
	require.NoError(t, err)
	defer backend.Kill()

	// The main connection: a unary call made by the host's own lifecycle client.
	require.True(t, backend.Healthy(), "lifecycle health check must succeed over the authenticated channel")

	// A brokered connection: the host serves the activity reporter through the
	// broker and the child dials it back and makes a call (see the child hook).
	external, ok := backend.(*types.ExternalBackend)
	require.True(t, ok)
	raw, err := external.Dispense("lifecycle")
	require.NoError(t, err)
	lifecycle, ok := raw.(*lc.Client)
	require.True(t, ok)
	reporter := &channelPeerReporter{}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	stop, err := lifecycle.ServeActivities(ctx, reporter)
	require.NoError(t, err)
	defer stop()

	hostCertificate, err := os.ReadFile(certFile)
	require.NoError(t, err)
	hostBlock, _ := pem.Decode(hostCertificate)
	require.NotNil(t, hostBlock, "the child must have been handed a host certificate")

	// What the plugin's server saw: every call arrived over TLS, the client
	// certificate verified, and it is the certificate the host handed over.
	records := readChannelPeerRecords(t, peerFile)
	require.NotEmpty(t, records)
	methods := map[string]bool{}
	for _, record := range records {
		methods[record.Method] = true
		require.True(t, record.TLS, "%s reached the plugin without TLS", record.Method)
		require.Positive(t, record.VerifiedChains,
			"%s reached the plugin without a verified client certificate", record.Method)
		require.True(t, record.ClientIsHostCertificate, "%s was not made with the host's certificate", record.Method)
	}
	require.True(t, methods["/omniview.sdk.lifecycle.v1.PluginLifecycle/HealthCheck"],
		"the host's health check must have reached the plugin")
	require.True(t, methods["/omniview.activity.v1.ActivityBinding/Bind"],
		"the host's activity binding must have reached the plugin")

	// What the host's callback server saw: the plugin connected over TLS and its
	// certificate verified. It is the plugin's own certificate, not the host's.
	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Zero(t, reporter.plain, "a callback reached the host without TLS")
	require.NotEmpty(t, reporter.peers, "the child must have called back through the broker")
	for _, info := range reporter.peers {
		require.GreaterOrEqual(t, info.State.Version, uint16(tls.VersionTLS12))
		require.NotEmpty(t, info.State.VerifiedChains, "the host callback server did not verify the plugin's certificate")
		require.NotEmpty(t, info.State.PeerCertificates)
		require.NotEqual(t, hostBlock.Bytes, info.State.PeerCertificates[0].Raw,
			"the plugin must present its own certificate on callbacks")
	}
}

// TestCreateBackendRefusesPluginThatIgnoresChannelCertificate removes the
// certificate from the child's environment, as a plugin built on a go-plugin
// that did not honour PLUGIN_CLIENT_CERT would behave: it serves plaintext.
// go-plugin dials lazily, so createBackend itself returns; the main channel's
// first call must then fail with a TLS handshake error, and no plaintext
// channel is ever used. The load path's first call (binding activities) fails
// with it, so the plugin is not admitted.
func TestCreateBackendRefusesPluginThatIgnoresChannelCertificate(t *testing.T) {
	root := channelWrapperFixture(t, &pluginFixtureBehaviour{Env: map[string]*string{"PLUGIN_CLIENT_CERT": nil}})
	pm := newTestManager(t)
	pm.activities = activityBrokerManager(activityObserverService(t)).activities

	backend, err := pm.createBackend("activity-broker-test", config.PluginMeta{ID: "activity-broker-test"}, root)
	require.NoError(t, err, "go-plugin dials lazily: createBackend returns, the first call must fail")
	defer backend.Kill()

	// The main channel itself must refuse: the plugin answers in plaintext, the
	// host speaks TLS. A bare error assertion would also pass when only the
	// broker leg failed, so assert the code and the cause.
	external, ok := backend.(*types.ExternalBackend)
	require.True(t, ok)
	raw, err := external.Dispense("lifecycle")
	require.NoError(t, err)
	lifecycle, ok := raw.(*lc.Client)
	require.True(t, ok)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_, callErr := lifecycle.GetInfo(ctx)
	require.Equal(t, codes.Unavailable, status.Code(callErr), "%v", callErr)
	require.Contains(t, callErr.Error(), "authentication handshake failed")

	require.Error(t, pm.bindActivities("activity-broker-test", backend),
		"a plugin that serves plaintext must not be admitted")
}

func channelTestCertificate(t *testing.T) (tls.Certificate, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 100))
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "localhost"},
		DNSNames:              []string{"localhost"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, key.Public(), key)
	require.NoError(t, err)
	keyDER, err := x509.MarshalECPrivateKey(key)
	require.NoError(t, err)
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	pair, err := tls.X509KeyPair(certPEM, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))
	require.NoError(t, err)
	return pair, string(certPEM)
}

// channelRogueHealth launches the child with grantedPEM as its PLUGIN_CLIENT_CERT,
// the way a host would, and then talks to it as a client that presents
// clientCertificates (possibly none). It returns the first error from starting
// the client or from a lifecycle call. The client skips server verification so
// that the only thing under test is whether the plugin accepts the client.
func channelRogueHealth(t *testing.T, grantedPEM string, clientCertificates []tls.Certificate) error {
	t.Helper()
	root := channelWrapperFixture(t, nil)
	command := exec.Command(filepath.Join(root, "bin", types.BinaryName()))
	command.Env = append(os.Environ(),
		"PLUGIN_CLIENT_CERT="+grantedPEM,
		activityBrokerHandshake.MagicCookieKey+"="+activityBrokerHandshake.MagicCookieValue,
	)
	client := goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig:     activityBrokerHandshake,
		SkipHostEnv:         true,
		Cmd:                 command,
		Plugins:             goplugin.PluginSet{"lifecycle": &lc.Plugin{}},
		AllowedProtocols:    []goplugin.Protocol{goplugin.ProtocolGRPC},
		GRPCBrokerMultiplex: true,
		StartTimeout:        15 * time.Second,
		TLSConfig: &tls.Config{
			Certificates:       clientCertificates,
			InsecureSkipVerify: true,
			MinVersion:         tls.VersionTLS12,
			ServerName:         "localhost",
		},
	})
	t.Cleanup(func() {
		// A rejected client cannot ask the plugin to shut down, and go-plugin would
		// wait out its grace period; the process is the test's own child. Kill it,
		// then let go-plugin reap it, so nothing outlives the test.
		if command.Process != nil {
			_ = command.Process.Kill()
		}
		client.Kill()
		require.True(t, client.Exited(), "child process must exit")
	})

	rpc, err := client.Client()
	if err != nil {
		return err
	}
	raw, err := rpc.Dispense("lifecycle")
	if err != nil {
		return err
	}
	lifecycle, ok := raw.(*lc.Client)
	require.True(t, ok)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = lifecycle.HealthCheck(ctx)
	return err
}

// TestChannelRejectsClientWithoutHostCertificate is the negative half. A
// process that reaches the plugin's channel first, but does not hold the
// certificate the host generated, cannot complete a call. The control case, a
// client holding the granted certificate, must succeed so the refusals cannot
// be put down to the arrangement.
func TestChannelRejectsClientWithoutHostCertificate(t *testing.T) {
	granted, grantedPEM := channelTestCertificate(t)
	other, _ := channelTestCertificate(t)

	t.Run("holding the granted certificate", func(t *testing.T) {
		require.NoError(t, channelRogueHealth(t, grantedPEM, []tls.Certificate{granted}))
	})
	t.Run("presenting no certificate", func(t *testing.T) {
		err := channelRogueHealth(t, grantedPEM, nil)
		require.Error(t, err)
		t.Logf("rejected: %v", err)
	})
	t.Run("presenting a different certificate", func(t *testing.T) {
		err := channelRogueHealth(t, grantedPEM, []tls.Certificate{other})
		require.Error(t, err)
		t.Logf("rejected: %v", err)
	})
}
