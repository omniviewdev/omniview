package plugin

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hashicorp/yamux"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
)

// The host's own end of the channel: it must refuse a server that does not hold
// the certificate the plugin advertised in its handshake line. The plugin's end
// and the host's callback end are inspected in loader_channel_mtls_test.go.

const (
	impostorChildEnv = "OMNIVIEW_CHANNEL_IMPOSTOR_CHILD"
	impostorOutEnv   = "OMNIVIEW_CHANNEL_IMPOSTOR_OUT"
)

func impostorCertificate(t *testing.T) (tls.Certificate, []byte) {
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
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, der
}

// TestChannelImpostorChildProcess is a hand-rolled go-plugin server using
// go-plugin's multiplexed framing. It advertises certificate A (whose key it
// discards) in the handshake line and serves TLS with certificate B, like a
// process that took over the plugin's socket without the plugin's key. It
// reports how its handshake with the host ended through the file in
// impostorOutEnv. It does nothing unless the parent test started it.
func TestChannelImpostorChildProcess(t *testing.T) {
	if os.Getenv(impostorChildEnv) == "" {
		return
	}
	listener, err := net.Listen("unix", filepath.Join(os.TempDir(), "s"))
	require.NoError(t, err)
	_, advertised := impostorCertificate(t)
	served, _ := impostorCertificate(t)
	line := fmt.Sprintf("1|1|unix|%s|grpc|%s|true\n",
		listener.Addr().String(), base64.RawStdEncoding.EncodeToString(advertised))
	_, _ = os.Stdout.WriteString(line)
	_ = os.Stdout.Sync()
	conn, err := listener.Accept()
	require.NoError(t, err)
	session, err := yamux.Server(conn, yamux.DefaultConfig())
	require.NoError(t, err)
	go func() {
		for {
			stream, acceptErr := session.Accept()
			if acceptErr != nil {
				return
			}
			go func() {
				secured := tls.Server(stream, &tls.Config{
					Certificates: []tls.Certificate{served},
					MinVersion:   tls.VersionTLS12,
					NextProtos:   []string{"h2"},
				})
				outcome := secured.Handshake()
				if outcome == nil { // TLS 1.3: the abort alert arrives on the first read
					_ = secured.SetReadDeadline(time.Now().Add(2 * time.Second))
					_, outcome = secured.Read(make([]byte, 1))
				}
				_ = os.WriteFile(os.Getenv(impostorOutEnv), []byte(fmt.Sprint(outcome)), 0o600)
			}()
		}
	}()
	time.Sleep(20 * time.Second)
	os.Exit(0)
}

// TestCreateBackendRefusesServerThatDoesNotHoldItsAdvertisedCertificate starts
// the impostor through the production path. go-plugin dials lazily, so
// createBackend returns and the refusal comes with the first call.
func TestCreateBackendRefusesServerThatDoesNotHoldItsAdvertisedCertificate(t *testing.T) {
	root := channelWrapperFor(t, "TestChannelImpostorChildProcess", "")
	out := filepath.Join(t.TempDir(), "handshake")
	t.Setenv(impostorChildEnv, "1")
	t.Setenv(impostorOutEnv, out)

	pm := newTestManager(t)
	backend, err := pm.createBackend("impostor-test", config.PluginMeta{ID: "impostor-test"}, root)
	require.NoError(t, err, "go-plugin dials lazily; the refusal comes with the first call")
	defer backend.Kill()
	external, ok := backend.(*types.ExternalBackend)
	require.True(t, ok)
	raw, err := external.Dispense("lifecycle")
	require.NoError(t, err)
	lifecycle, ok := raw.(*lc.Client)
	require.True(t, ok)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_, callErr := lifecycle.GetInfo(ctx)

	// The host's own end of the connection: it refused the server's certificate.
	// A host that skipped verification would fail here too, but with a different
	// error (EOF), so assert the cause.
	require.Equal(t, codes.Unavailable, status.Code(callErr), "%v", callErr)
	require.Contains(t, callErr.Error(), "x509", "the host must fail on certificate verification: %v", callErr)
	// The impostor's end: the host aborted the handshake instead of completing it.
	require.Eventually(t, func() bool {
		data, readErr := os.ReadFile(out)
		return readErr == nil && strings.Contains(string(data), "bad certificate")
	}, 5*time.Second, 20*time.Millisecond, "the server must have seen the host reject its certificate")
}
