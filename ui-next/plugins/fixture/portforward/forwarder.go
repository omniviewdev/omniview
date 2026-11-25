//nolint:exhaustruct // A zero value is what the fields of a fixture's own types start as.
package portforward

import (
	"context"
	"fmt"
	"io"
	"net"
	"sync"

	"github.com/google/uuid"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

const (
	// ResourceKey is the key the forwarder is registered under: a start for the target names it as the `resource_key`, and the SDK's manager picks the forwarder by it.
	ResourceKey = "fixture:/targets"

	// TargetID is the one resource the forwarder knows. A start for another is refused.
	TargetID = "fixture-target"

	// TargetPort is the port the target is said to serve, the remote port of a start. The forwarder relays to the target server wherever it listens (a port the system chose, so that two hosts on one machine never
	// meet on it), and a start for any other port is refused: a forward of this fixture is the target's and nothing else on the machine's.
	TargetPort int32 = 8080

	// maxPort is the highest port a TCP address has.
	maxPort = 65535
)

// Forwarder is the fixture's networker.ResourceForwarder. It forwards the one resource of the fixture, TargetID, to the target server at the address it was made with.
type Forwarder struct {
	target string
}

var _ networker.ResourceForwarder = (*Forwarder)(nil)

// NewForwarder makes the forwarder of the target that listens at target (`Server.Addr`).
func NewForwarder(target string) *Forwarder {
	return &Forwarder{target: target}
}

// ForwardResource listens on the loopback on the local port of the start (any free port, for 0) and relays every connection it accepts to the target. It is ready when it listens, and it states where it listens: the host of the
// address its listener really bound, which the SDK puts in the session. It runs until ctx is cancelled, and then closes the listener and every connection it relays; a listener that fails before that is said on the error channel, which
// is closed when the forward has ended and nothing of it is running.
func (f *Forwarder) ForwardResource(ctx context.Context, _ *types.PluginContext, opts networker.ResourcePortForwardHandlerOpts) (*networker.ForwarderResult, error) {
	if err := admit(opts); err != nil {
		return nil, err
	}
	listener, err := listenLoopback(ctx, opts.Options.LocalPort)
	if err != nil {
		return nil, err
	}
	ready := make(chan struct{})
	close(ready)
	// Read before the tunnel takes the listener: it closes it when the forward ends.
	host := networker.LocalHostOf(listener.Addr())

	return &networker.ForwarderResult{SessionID: uuid.NewString(), LocalHost: host, Ready: ready, ErrCh: startTunnel(ctx, listener, f.target)}, nil
}

// admit refuses, in plain words, a start for anything the target is not.
func admit(opts networker.ResourcePortForwardHandlerOpts) error {
	switch {
	case opts.Resource.ResourceID != TargetID:
		return refused(fmt.Sprintf("The fixture forwards %q only.", TargetID))
	case opts.Options.Protocol != networker.PortForwardProtocolTCP:
		return refused("The fixture forwards TCP only.")
	case opts.Options.RemotePort != TargetPort:
		return refused(fmt.Sprintf("The fixture target listens on port %d only.", TargetPort))
	case opts.Options.LocalPort < 0 || opts.Options.LocalPort > maxPort:
		return refused(fmt.Sprintf("The local port must be between 0 and %d.", maxPort))
	}

	return nil
}

func refused(words string) error {
	return resourcev2.NewError("INVALID_REQUEST", words)
}

// tunnel is one forward at work: a listener, the connections it accepted and the connections it dialled to the target for them.
type tunnel struct {
	*endpoint

	ctx    context.Context
	cancel context.CancelFunc
	target string
	wg     sync.WaitGroup
}

// startTunnel serves listener until ctx is cancelled or the listener fails, and answers the channel that says how it ended: an error when the listener failed, and nothing when it was told to stop. The channel is
// closed last, when the listener and every connection are closed and every goroutine of the tunnel has returned.
func startTunnel(ctx context.Context, listener net.Listener, target string) <-chan error {
	t := &tunnel{endpoint: newEndpoint(listener), target: target}
	t.ctx, t.cancel = context.WithCancel(ctx)
	errCh := make(chan error, 1)
	go func() {
		defer close(errCh)
		if err := t.run(); err != nil {
			errCh <- err
		}
	}()

	return errCh
}

// run accepts connections until the tunnel ends, then ends it, whichever way it was ending, and waits for everything that ran for it. The watcher is what turns the context's end into the end of a blocked Accept.
func (t *tunnel) run() error {
	var watcher sync.WaitGroup
	watcher.Go(func() {
		<-t.ctx.Done()
		t.shutdown()
	})
	failure := t.accept()
	t.shutdown()
	watcher.Wait()
	t.wg.Wait()

	return failure
}

// shutdown ends the endpoint and everything that waits on the context.
func (t *tunnel) shutdown() {
	t.cancel()
	_ = t.close()
}

// accept relays each connection until the listener ends. It answers nil when the tunnel was ended and an error when the listener failed on its own.
func (t *tunnel) accept() error {
	for {
		client, err := t.listener.Accept()
		if err != nil {
			if t.isClosed() {
				return nil
			}

			return fmt.Errorf("the forwarding listener failed: %w", err)
		}
		if !t.track(client) {
			_ = client.Close()

			return nil
		}
		t.wg.Go(func() { t.relay(client) })
	}
}

// relay joins a client to a connection of its own to the target. A target that cannot be reached closes the client and nothing else: the next connection is served as if it had not happened.
func (t *tunnel) relay(client net.Conn) {
	defer t.release(client)
	var dialer net.Dialer
	target, err := dialer.DialContext(t.ctx, "tcp", t.target)
	if err != nil {
		return
	}
	if !t.track(target) {
		_ = target.Close()

		return
	}
	defer t.release(target)

	var directions sync.WaitGroup
	directions.Go(func() { carry(target, client) })
	directions.Go(func() { carry(client, target) })
	directions.Wait()
}

// carry sends what src says to dst until src has no more, and then tells the other side of dst that nothing more comes: a client that stops sending still gets everything that was sent back to it.
func carry(dst, src net.Conn) {
	_, _ = io.Copy(dst, src)
	if half, ok := dst.(interface{ CloseWrite() error }); ok {
		_ = half.CloseWrite()

		return
	}
	_ = dst.Close()
}
