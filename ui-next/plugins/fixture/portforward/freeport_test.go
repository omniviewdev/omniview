package portforward

import (
	"errors"
	"net"
	"os"
	"syscall"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/ui-next/plugins/fixture/internal/bindretry"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

// The rule for a port that a test has found and hands to something that binds it later is `bindretry`'s, and is held to what it says in its own tests. What is held here is what is of this package: the errors that the
// forwarder and the SDK's manager put round the system's number are still an address in use, a start that was refused is not, and `onFreePort` gives each attempt a port of its own.

func TestAnAddressInUseIsRecognisedAsTheForwarderAndTheManagerSayIt(t *testing.T) {
	held, err := listenLoopback(t.Context(), 0)
	require.NoError(t, err)
	t.Cleanup(func() { _ = held.Close() })
	address, ok := held.Addr().(*net.TCPAddr)
	require.True(t, ok)

	_, bind := listenLoopback(t.Context(), int32(address.Port))

	require.Error(t, bind)
	require.True(t, bindretry.AddressInUse(bind), "the forwarder's own error for a port that is held")
	require.True(t, bindretry.AddressInUse(networker.NewForwarderFailedError("a-session", bind)), "the manager's error round it")
}

func TestOtherFailuresOfAStartAreNotAnAddressInUse(t *testing.T) {
	refusal := handlerOptions(0)
	refusal.Options.RemotePort = TargetPort + 1
	denied := &net.OpError{Op: "listen", Net: "tcp", Err: os.NewSyscallError("bind", syscall.EACCES)}

	for name, err := range map[string]error{
		"a refused start":              admit(refusal),
		"the manager's other failure":  networker.NewForwarderFailedError("a-session", errors.New("the network went away")),
		"the manager's permission one": networker.NewForwarderFailedError("a-session", denied),
	} {
		require.False(t, bindretry.AddressInUse(err), name)
	}
}

func TestOnFreePortHandsStartAPortItCanBind(t *testing.T) {
	port, bound := onFreePort(t, func(port int32) (net.Listener, error) {
		return listenLoopback(t.Context(), port)
	})
	t.Cleanup(func() { _ = bound.Close() })

	require.Equal(t, loopback(port), bound.Addr().String())
}

func TestOnFreePortAsksStartAgainWithAFreshPortWhenAnotherProcessTookTheFirst(t *testing.T) {
	var given []int32
	var decoy net.Listener

	port, bound := onFreePort(t, func(port int32) (net.Listener, error) {
		given = append(given, port)
		if decoy == nil {
			// Another process takes the port in the moment between its being found and its being bound. If one takes it first in earnest, this bind fails with the same error, which is the helper's to ask again for like any other.
			listener, err := listenLoopback(t.Context(), port)
			if err != nil {
				return nil, err
			}
			decoy = listener
			t.Cleanup(func() { _ = decoy.Close() })
		}
		return listenLoopback(t.Context(), port)
	})
	t.Cleanup(func() { _ = bound.Close() })

	require.NotNil(t, decoy, "a decoy took a port")
	require.Greater(t, len(given), 1, "the start was asked again after the port was taken")
	require.NotEqual(t, decoy.Addr().String(), bound.Addr().String(), "the port it answers is not the one that was taken: that one is held, and a port found again cannot be it")
	require.Equal(t, given[len(given)-1], port, "the port it answers is the one the start that worked was given")
	require.Equal(t, loopback(port), bound.Addr().String())
}
