package gateway_test

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// connectionsAreServed completes a TLS handshake over a fresh connection and
// reports whether the gateway answered it.
func connectionIsServed(t *testing.T, h *harness) bool {
	t.Helper()
	good := &tls.Config{RootCAs: h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13}
	conn, err := handshake(t, h, good)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func TestOneAddressCannotHoldEveryConnectionPlace(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.MaxConnectionsPerAddress = 2
		c.Timeouts.ReadHeader = time.Minute // so that the idle connections below stay
	})
	var held []net.Conn
	for range 2 {
		conn, err := net.Dial("tcp", h.ln.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		held = append(held, conn)
	}
	// The address is at its limit: the next connection from it is closed.
	third, err := net.Dial("tcp", h.ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = third.Close() })
	_ = third.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err = third.Read(make([]byte, 1)); err == nil || isTimeout(err) {
		t.Fatalf("a third connection from one address was kept open (read error %v)", err)
	}
	for i, conn := range held {
		_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		if _, err = conn.Read(make([]byte, 1)); !isTimeout(err) {
			t.Fatalf("connection %d within the limit was closed: %v", i, err)
		}
	}
	if connectionIsServed(t, h) {
		t.Fatal("a handshake was served while the address held all its places")
	}

	// A place that is given back can be used again.
	_ = held[0].Close()
	eventually(t, 5*time.Second, "a place to be given back", func() bool { return connectionIsServed(t, h) })
}

func TestAnAddressCannotConnectFasterThanItsAllowance(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.AcceptBurst = 3
		c.Limits.AcceptRefill = 10 * time.Minute
		c.Limits.MaxConnectionsPerAddress = 100
	})
	served := func(attempts int) int {
		count := 0
		for range attempts {
			if connectionIsServed(t, h) {
				count++
			}
		}
		return count
	}
	if got := served(8); got != 3 {
		t.Fatalf("%d connections served from one address at once, want the burst of 3", got)
	}
	h.clock.Advance(25 * time.Minute) // two refill periods, well inside the audit's hour
	if got := served(8); got != 2 {
		t.Fatalf("%d connections served after two refill periods, want 2", got)
	}
}

// The count of denied calls is exact, because it is a counter. What is recorded
// as an event is not: a page that is refused over and over cannot make the
// gateway's event stream the thing that is flooded.
func TestPolicyDenialsAreCountedExactlyButRecordedSparingly(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page")
	const attempts = 300
	for i := range attempts {
		res := b.call("page", callBody(fmt.Sprintf("d%d", i), createShell, ""))
		if i == 0 {
			deniedWith(t, "a call outside the allowlist", res.status, res.body, "method_denied")
		} else if res.status != http.StatusForbidden {
			t.Fatalf("denial %d = %d %q, want the same refusal every time", i, res.status, res.body)
		}
	}
	if got := h.gw.Status().Denials[gateway.DenialPolicy]; got != attempts {
		t.Fatalf("policy denials = %d, want %d", got, attempts)
	}
	recorded := h.events.count(gateway.EventPolicyDenied)
	if recorded == 0 || recorded > attempts/2 {
		t.Fatalf("%d policy_denied events for %d denials, want some but far fewer", recorded, attempts)
	}
	if len(h.up.runtimeRecords()) != 0 {
		t.Fatal("a denied call reached the host")
	}
}

func TestAnIssuedCredentialNeverPrintsItsSecret(t *testing.T) {
	credential := gateway.IssuedCredential{
		AuditID: "a1", CredentialID: "c1", Username: "u1", Secret: []byte("correct-horse-battery-staple"),
		Realm: "realm", Origin: "https://laptop.example.ts.net",
	}
	for _, format := range []string{"%v", "%+v", "%#v", "%s", "%d", "%x", "%X", "%q"} {
		for name, value := range map[string]any{"value": credential, "pointer": &credential} {
			if out := fmt.Sprintf(format, value); strings.Contains(out, "correct-horse") {
				t.Errorf("%s of a %s prints the secret: %s", format, name, out)
			}
		}
	}
	if out := fmt.Sprint(credential); strings.Contains(out, "correct-horse") {
		t.Errorf("Sprint prints the secret: %s", out)
	}
}

func TestFileChannelDiscardRemovesOnlyItsOwnCredentialsFile(t *testing.T) {
	channel, err := gateway.NewFileChannel(privateDir(t))
	if err != nil {
		t.Fatal(err)
	}
	credential := issued()
	if err = channel.Deliver(t.Context(), credential); err != nil {
		t.Fatal(err)
	}
	path := channel.Path()

	channel.Discard(t.Context(), "ffffffffffffffff") // another credential's
	if _, err = os.Stat(path); err != nil {
		t.Fatalf("Discard of another credential removed this one's file: %v", err)
	}
	channel.Discard(t.Context(), credential.CredentialID)
	if _, err = os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the file is still there after Discard: %v", err)
	}
	channel.Discard(t.Context(), credential.CredentialID) // again: nothing to do, and no panic
}

// blockingFile writes the credential's file and then waits, as a slow delivery
// that has already left the secret on disk would.
type blockingFile struct {
	*gateway.FileChannel
	written chan struct{}
	release chan struct{}
}

func (c blockingFile) Deliver(ctx context.Context, credential gateway.IssuedCredential) error {
	if err := c.FileChannel.Deliver(ctx, credential); err != nil {
		return err
	}
	close(c.written)
	<-c.release
	return nil
}

func TestACredentialRevokedWhileItsFileIsBeingWrittenLeavesNoFileBehind(t *testing.T) {
	h := newHarness(t)
	files, err := gateway.NewFileChannel(privateDir(t))
	if err != nil {
		t.Fatal(err)
	}
	channel := blockingFile{FileChannel: files, written: make(chan struct{}), release: make(chan struct{})}
	result := h.exchangeAsync(channel, gateway.ExchangeOptions{})
	select {
	case <-channel.written:
	case <-time.After(5 * time.Second):
		t.Fatal("the credential file was never written")
	}
	path := files.Path()
	if _, err = os.Stat(path); err != nil {
		t.Fatalf("the file is not there before the revoke: %v", err)
	}
	var id string
	for _, credential := range h.gw.Status().Credentials {
		id = credential.ID
	}
	if err = h.gw.Revoke(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	close(channel.release)
	if err = awaitExchange(t, result); !errors.Is(err, gateway.ErrCredentialEnded) {
		t.Fatalf("Exchange = %v, want ErrCredentialEnded", err)
	}
	if _, err = os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the secret of a revoked credential is still on disk: %v", err)
	}
}

func TestADeliveryThatFailsLeavesNoFileBehind(t *testing.T) {
	h := newHarness(t)
	dir := privateDir(t)
	files, err := gateway.NewFileChannel(dir)
	if err != nil {
		t.Fatal(err)
	}
	failing := failAfterWriting{FileChannel: files}
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.gw.Exchange(t.Context(), offer.Code, failing, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrDelivery) {
		t.Fatalf("Exchange = %v, want ErrDelivery", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("%d files left behind by a failed delivery", len(entries))
	}
}

// failAfterWriting reports a failure after the file was written, which is what
// a disk that fails to flush looks like.
type failAfterWriting struct{ *gateway.FileChannel }

func (c failAfterWriting) Deliver(ctx context.Context, credential gateway.IssuedCredential) error {
	if err := c.FileChannel.Deliver(ctx, credential); err != nil {
		return err
	}
	return io.ErrClosedPipe
}

// Finding out that a directory takes hard links leaves nothing in it, and a
// channel that delivered several credentials can discard any of them.
func TestAFileChannelDiscardsEveryCredentialItDelivered(t *testing.T) {
	dir := privateDir(t)
	channel, err := gateway.NewFileChannel(dir)
	if err != nil {
		t.Fatal(err)
	}
	if entries, readErr := os.ReadDir(dir); readErr != nil || len(entries) != 0 {
		t.Fatalf("a new channel left %d entries in its directory (%v)", len(entries), readErr)
	}
	first, second := issued(), issued()
	second.CredentialID = "0011223344556677"
	for _, credential := range []gateway.IssuedCredential{first, second} {
		if err = channel.Deliver(t.Context(), credential); err != nil {
			t.Fatal(err)
		}
	}
	channel.Discard(t.Context(), first.CredentialID) // not the last one delivered
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("%d files left after discarding the first credential, want the second's alone", len(entries))
	}
	channel.Discard(t.Context(), second.CredentialID)
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("%d files left after discarding both credentials", len(entries))
	}
}

func TestServeReportsItsFailuresWithACode(t *testing.T) {
	h := newHarness(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_ = ln.Close()
	getCert := func(*tls.ClientHelloInfo) (*tls.Certificate, error) { return nil, errors.New("not used") }
	err = h.gw.Serve(ln, getCert)
	if !errors.Is(err, gateway.ErrServe) || gateway.CodeOf(err) != gateway.CodeUnavailable {
		t.Fatalf("Serve on a closed listener = %v, want an error wrapping ErrServe (audit_unavailable)", err)
	}
}
