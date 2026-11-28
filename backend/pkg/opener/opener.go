// Package opener opens an address in the system's browser on behalf of the page, after the host's own checks (issue #696, the URL half).
//
// The page used to call Wails' Browser.OpenURL directly. Its validator lets `vscode:`, `ms-msdt:` and `smb:` through and has no rule for the host's own
// servers, so the allow-list lived in the page only and any page code could skip it. Here the host decides: http and https only, no userinfo, no
// address of the host's own servers (every spelling of a loopback host on a port a server of the host listens on), no more than 2,083 bytes, and
// whatever the platform's own validator refuses. It then starts the platform's opener with an argument array and no shell.
//
// A refusal is an answer, typed with a Reason that holds nothing of the address; a failure of the platform opener is an error that does not hold it either:
// an address is the user's data.
package opener

import (
	"encoding/binary"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/net/idna"
)

// MaxURL is the longest address that is opened, in bytes.
const MaxURL = 2083

const (
	defaultHTTPPort  = 80
	defaultHTTPSPort = 443
	maxPort          = 65535
	maxIPv4Labels    = 4
	maxOctet         = 255
	byteBits         = 8
	ipv4Bits         = 32
	decimalBase      = 10
	hexBase          = 16
	octalBase        = 8
)

// Reason says why an address was refused.
type Reason string

const (
	// ReasonScheme: not `http://` or `https://` (anything else starts another program on the machine).
	ReasonScheme Reason = "scheme"
	// ReasonUserinfo: the address has `user@` or `user:password@`, which can show one host and open another.
	ReasonUserinfo Reason = "userinfo"
	// ReasonOwnServer: the address is one of the host's own servers, whatever the spelling of its host.
	ReasonOwnServer Reason = "own-server"
	// ReasonMalformed: the address has a control character, a backslash, a space, a character the platform opener refuses (`;`, `|`, a backtick, `$`, `<`, `>`), no
	// host, or a host that is not one.
	ReasonMalformed Reason = "malformed"
	// ReasonTooLong: over MaxURL bytes.
	ReasonTooLong Reason = "too-long"
)

// Result is the answer: Opened, or a Reason.
type Result struct {
	Opened bool   `json:"opened"`
	Reason Reason `json:"reason,omitempty"`
}

func refused(reason Reason) Result { return Result{Opened: false, Reason: reason} }

// Opener opens addresses. The zero value is not usable: use New.
type Opener struct {
	open func(string) error

	mu  sync.RWMutex
	own func() []string
}

// New makes an opener that starts the platform's browser.
func New() *Opener { return &Opener{open: platformOpen, mu: sync.RWMutex{}, own: nil} }

// withOpen makes an opener that hands the checked address to open: the seam of the tests.
func withOpen(open func(string) error) *Opener {
	return &Opener{open: open, mu: sync.RWMutex{}, own: nil}
}

// SetOwn says where the host's own servers listen, as `host:port` strings, asked each time an address is checked (a server may start and stop). A listener that is not
// loopback names the host's interface address too.
func (o *Opener) SetOwn(addresses func() []string) {
	o.mu.Lock()
	o.own = addresses
	o.mu.Unlock()
}

func (o *Opener) ownAddresses() []string {
	o.mu.RLock()
	own := o.own
	o.mu.RUnlock()
	if own == nil {
		return nil
	}
	return own()
}

// OpenExternalURL checks the address and opens it in the system's browser. It returns an error only when the platform's opener could not be started.
func (o *Opener) OpenExternalURL(raw string) (Result, error) {
	sanitized, reason := o.check(raw)
	if reason != "" {
		return refused(reason), nil
	}
	if err := o.open(sanitized); err != nil {
		return refused(""), errors.New("the system's browser could not be started")
	}
	return Result{Opened: true, Reason: ""}, nil
}

// check says why an address is refused, or gives the address to open.
func (o *Opener) check(raw string) (string, Reason) {
	if len(raw) > MaxURL {
		return "", ReasonTooLong
	}
	lower := strings.ToLower(raw)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return "", ReasonScheme
	}
	if !utf8.ValidString(raw) || strings.ContainsAny(raw, "\\ ") || hasControl(raw) {
		return "", ReasonMalformed
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.Hostname() == "" {
		return "", ReasonMalformed
	}
	if parsed.User != nil {
		return "", ReasonUserinfo
	}
	port, ok := portOf(parsed)
	if !ok {
		return "", ReasonMalformed
	}
	host, ok := normalHost(parsed.Hostname())
	if !ok {
		return "", ReasonMalformed
	}
	local, ip, ok := classify(host)
	if !ok {
		return "", ReasonMalformed
	}
	if o.isOwn(local, ip, port) {
		return "", ReasonOwnServer
	}
	sanitized, err := application.ValidateAndSanitizeURL(raw)
	if err != nil {
		return "", ReasonMalformed
	}
	if len(sanitized) > MaxURL { // the platform validator escapes what it hands back: the cap is on what is opened
		return "", ReasonTooLong
	}
	return sanitized, ""
}

// hasControl is whether the text has a control character, a tab and a newline included (a browser drops them from an address, which hides what it names).
func hasControl(s string) bool {
	for _, r := range s {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r < 0xa0) {
			return true
		}
	}
	return false
}

// portOf is the port the address names, or the scheme's default.
func portOf(u *url.URL) (int, bool) {
	text := u.Port()
	if text == "" {
		if strings.EqualFold(u.Scheme, "https") {
			return defaultHTTPSPort, true
		}
		return defaultHTTPPort, true
	}
	port, err := strconv.Atoi(text)
	if err != nil || port < 0 || port > maxPort {
		return 0, false
	}
	return port, true
}

// normalHost is the host as a browser would read it, and strictly: lower case, no trailing dot, in ASCII (the other spellings of a dot and of the digits are mapped
// as a browser maps them, and a name that cannot be is refused), and then only letters, digits, hyphens and dots, with no empty label. An IPv6 literal is checked
// by its own parser. Go's parser has refused a percent escape of an ASCII character already, and decoded those of others, so a host never holds `%` here.
func normalHost(host string) (string, bool) {
	if !isASCII(host) {
		ascii, err := idna.Lookup.ToASCII(host)
		if err != nil {
			return "", false
		}
		host = ascii
	}
	host = strings.TrimRight(strings.ToLower(host), ".")
	if host == "" {
		return "", false
	}
	if strings.Contains(host, ":") { // an IPv6 literal: classify parses it
		return host, true
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" {
			return "", false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
				return "", false
			}
		}
	}
	return host, true
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}

// classify says whether a host is this machine (`localhost`, `*.localhost`, a loopback or unspecified address in any spelling of its numbers) and which address it is
// when it is one. It is not ok when the host cannot be read: a name whose last label is a number that is not an address is the browser's error too.
func classify(host string) (bool, netip.Addr, bool) {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true, netip.Addr{}, true
	}
	if strings.Contains(host, ":") {
		addr, err := netip.ParseAddr(host)
		if err != nil || addr.Zone() != "" {
			return false, netip.Addr{}, false
		}
		return isThisMachine(addr), addr.Unmap(), true
	}
	labels := strings.Split(host, ".")
	if !looksNumeric(labels[len(labels)-1]) {
		return false, netip.Addr{}, true
	}
	addr, parsed := parseIPv4(labels)
	if !parsed {
		return false, netip.Addr{}, false
	}
	return isThisMachine(addr), addr, true
}

// isThisMachine: 127.0.0.0/8, 0.0.0.0/8, ::1, ::, their IPv4-mapped and IPv4-compatible forms.
func isThisMachine(addr netip.Addr) bool {
	addr = addr.Unmap()
	if addr.Is6() {
		b := addr.As16()
		var zero [12]byte
		if [12]byte(b[:12]) == zero { // ::, ::1 and ::a.b.c.d
			addr = netip.AddrFrom4([4]byte(b[12:]))
			return addr.As4()[0] == 127 || addr.As4()[0] == 0 || addr == netip.AddrFrom4([4]byte{0, 0, 0, 1})
		}
		return false
	}
	first := addr.As4()[0]
	return first == 127 || first == 0
}

// looksNumeric is whether a label is read as a number of an IPv4 address: digits, or `0x` and hex digits.
func looksNumeric(label string) bool {
	if label == "" {
		return false
	}
	if rest, hex := strings.CutPrefix(label, "0x"); hex {
		return isHex(rest) // the URL standard: `0x` and hexadecimal digits only; `0xgarden` is a name
	}
	for i := 0; i < len(label); i++ {
		if label[i] < '0' || label[i] > '9' {
			return false
		}
	}
	return true
}

// isHex is whether every character is a hexadecimal digit (an empty text is).
func isHex(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// parseIPv4 reads 1 to 4 labels as the URL standard does: decimal, `0x` hex or a leading `0` octal, the last label filling the bytes that are left.
func parseIPv4(labels []string) (netip.Addr, bool) {
	if len(labels) > maxIPv4Labels {
		return netip.Addr{}, false
	}
	var value uint64
	for i, label := range labels {
		n, ok := number(label)
		if !ok {
			return netip.Addr{}, false
		}
		if i < len(labels)-1 {
			if n > maxOctet {
				return netip.Addr{}, false
			}
			value |= n << (byteBits * uint(maxIPv4Labels-1-i))
			continue
		}
		if n >= 1<<(byteBits*uint(maxIPv4Labels+1-len(labels))) {
			return netip.Addr{}, false
		}
		value |= n
	}
	var octets [maxIPv4Labels]byte
	binary.BigEndian.PutUint32(octets[:], uint32(value))
	return netip.AddrFrom4(octets), true
}

func number(label string) (uint64, bool) {
	base, digits := decimalBase, label
	switch {
	case strings.HasPrefix(label, "0x"):
		base, digits = hexBase, label[2:]
		if digits == "" {
			return 0, true
		}
	case len(label) > 1 && label[0] == '0':
		base, digits = octalBase, label[1:]
	}
	n, err := strconv.ParseUint(digits, base, ipv4Bits)
	return n, err == nil
}

// isOwn is whether the address is a server of the host: this machine (or the address a server listens on) at the port of a server.
func (o *Opener) isOwn(local bool, ip netip.Addr, port int) bool {
	for _, own := range o.ownAddresses() {
		host, text, err := net.SplitHostPort(own)
		if err != nil {
			continue
		}
		ownPort, convErr := strconv.Atoi(text)
		if convErr != nil || ownPort != port {
			continue
		}
		if local {
			return true
		}
		if addr, parseErr := netip.ParseAddr(host); parseErr == nil && ip.IsValid() && addr.Unmap() == ip {
			return true
		}
	}
	return false
}
