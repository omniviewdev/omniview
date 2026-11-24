package bindretry_test

import (
	"errors"
	"fmt"
	"net"
	"os"
	"syscall"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/ui-next/plugins/fixture/internal/bindretry"
)

// The rule that the package states, held to what it says: a bind that fails because the address is in use is tried again, a few times, and no other failure is.

const (
	// errWinsockAddrInUse and errWinsockAccessDenied are what Windows gives a bind (Winsock's WSAEADDRINUSE and WSAEACCES). They are written out here, as numbers, so that the rule can be held to them on any system the tests run on.
	errWinsockAddrInUse    syscall.Errno = 10048
	errWinsockAccessDenied syscall.Errno = 10013
)

// bindFailed is what a bind says when the system refuses it with number: the layers a listener puts round the number, made by hand.
func bindFailed(number syscall.Errno) error {
	return &net.OpError{Op: "listen", Net: "tcp", Err: os.NewSyscallError("bind", number)}
}

func TestAddressInUseIsTheNumberEachSystemGives(t *testing.T) {
	require.True(t, bindretry.AddressInUse(bindFailed(syscall.EADDRINUSE)), "Linux and macOS")
	require.True(t, bindretry.AddressInUse(bindFailed(errWinsockAddrInUse)), "Windows, whose own number is not the syscall package's EADDRINUSE")
	require.True(t, bindretry.AddressInUse(fmt.Errorf("a layer of the caller's: %w", bindFailed(errWinsockAddrInUse))), "however many layers are round it")
}

func TestAddressInUseIsWhatTheSystemSaysOfARealBind(t *testing.T) {
	held, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = held.Close() })

	_, bind := net.Listen("tcp", held.Addr().String())

	require.Error(t, bind)
	require.True(t, bindretry.AddressInUse(bind))
	require.True(t, bindretry.AddressInUse(fmt.Errorf("a layer of the caller's: %w", bind)))
}

func TestAddressInUseIsNotAnyOtherFailure(t *testing.T) {
	for name, err := range map[string]error{
		"no failure":                nil,
		"a permission, as Unix":     bindFailed(syscall.EACCES),
		"a permission, as Windows":  bindFailed(errWinsockAccessDenied),
		"its words, without number": errors.New("listen tcp 127.0.0.1:8080: bind: address already in use"),
	} {
		require.False(t, bindretry.AddressInUse(err), name)
	}
}

func TestUntilAsksAgainWhileTheAddressIsInUse(t *testing.T) {
	asked := 0

	answer, err := bindretry.Until(func() (string, error) {
		asked++
		if asked < 3 {
			return "", bindFailed(syscall.EADDRINUSE)
		}
		return "bound", nil
	})

	require.NoError(t, err)
	require.Equal(t, "bound", answer)
	require.Equal(t, 3, asked)
}

func TestUntilDoesNotAskAgainForAnyOtherFailure(t *testing.T) {
	cause := bindFailed(syscall.EACCES)
	asked := 0

	_, err := bindretry.Until(func() (string, error) {
		asked++
		return "", cause
	})

	require.ErrorIs(t, err, cause, "the failure is the caller's, as it was")
	require.Equal(t, 1, asked)
}

func TestUntilGivesUpWhenEveryAttemptFindsTheAddressTaken(t *testing.T) {
	asked := 0

	_, err := bindretry.Until(func() (string, error) {
		asked++
		return "", bindFailed(syscall.EADDRINUSE)
	})

	require.Equal(t, bindretry.Attempts, asked)
	require.ErrorIs(t, err, syscall.EADDRINUSE, "the last failure is kept as the cause")
	require.ErrorContains(t, err, "in use 5 times in a row")
}
