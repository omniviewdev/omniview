// Package bindretry is the one rule the fixture's tests follow when they hand something a port that they found a moment before. Nothing holds a port between finding it (listening on port 0 and closing the listener) and
// binding it, so another process of the machine can take it in that moment; the SDK's manager finds the local port of a session the same way, so a start through it is held to the same rule. A bind that fails for that reason
// alone, the address being in use, is tried again with a fresh port, a few times. No other failure is tried again, and the failure that ends the last attempt is the caller's, with its cause.
//
// Only tests import it: the plugins' own code binds the port it was given and says in plain words when it cannot.
package bindretry

import (
	"errors"
	"fmt"
	"syscall"
)

// Attempts is how many times in a row a bind is tried before the address being in use is the caller's failure.
const Attempts = 5

// errWinsockAddrInUse is the number Windows gives a bind that finds the address held (Winsock's WSAEADDRINUSE). The syscall package's own EADDRINUSE is a value it made up for that system: no call returns it, and `errors.Is`
// does not map the real number to it. Linux and macOS give EADDRINUSE itself.
const errWinsockAddrInUse syscall.Errno = 10048

// AddressInUse says whether err is a bind that failed because another socket holds the address, however many layers of the caller's (a classified error, the SDK's session error) wrap what the system said. It is the
// system's error number and never the words of a message, and a permission failure is not it.
func AddressInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE) || errors.Is(err, errWinsockAddrInUse)
}

// Until runs attempt and answers what it answered, and runs it again only while it fails because the address was in use. Any other failure is answered at once, as it was. When every one of `Attempts` attempts found the
// address taken, the last failure is the cause of the one that says so.
func Until[T any](attempt func() (T, error)) (T, error) {
	var none T
	var inUse error
	for range Attempts {
		answer, err := attempt()
		if err == nil {
			return answer, nil
		}
		if !AddressInUse(err) {
			return none, err
		}
		inUse = err
	}

	return none, fmt.Errorf("the address was in use %d times in a row: %w", Attempts, inUse)
}
