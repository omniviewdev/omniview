package gateway

import (
	"strings"
	"testing"
	"time"
)

func TestServerNamesMustBeLowerCaseDNSNamesOfTwoLabelsOrMore(t *testing.T) {
	good := []string{
		"laptop.tail1234.ts.net", "a.b", "host-1.example.ts.net", "x" + strings.Repeat("y", 62) + ".example.net",
		"a.b.c.d.e.f", "1host.example.com",
	}
	for _, name := range good {
		if !validServerName(name) {
			t.Errorf("%q rejected", name)
		}
	}
	bad := []string{
		"", "laptop", "localhost", ".example.net", "example.net.", "a..b", "-a.example.net", "a-.example.net",
		"Laptop.example.net", "laptop.EXAMPLE.net", "100.64.0.1", "1.2.3.4", "::1", "[::1]", "fd7a:115c:a1e0::1",
		"laptop.example.net:8443", "user@laptop.example.net", "laptop.example.net/", "lap top.example.net",
		"laptop_1.example.net", "é.example.net", "laptop.example.123", strings.Repeat("a", 64) + ".example.net",
		strings.Repeat("a.", 130) + "net", "laptop.example.net\x00",
	}
	for _, name := range bad {
		if validServerName(name) {
			t.Errorf("%q accepted", name)
		}
	}
}

func TestAuthorityOmitsOnlyTheDefaultPort(t *testing.T) {
	if got := (Config{ServerName: "a.b", Port: 443}).authority(); got != "a.b" {
		t.Fatalf("authority on 443 = %q", got)
	}
	if got := (Config{ServerName: "a.b", Port: 8443}).authority(); got != "a.b:8443" {
		t.Fatalf("authority on 8443 = %q", got)
	}
}

func TestTimeoutDefaultsAndSpecialValues(t *testing.T) {
	got := Timeouts{}.withDefaults()
	if got.BindWait != 2*time.Second || got.PeerCache != time.Second || got.Watch != time.Second {
		t.Fatalf("defaults %+v", got)
	}
	if got = (Timeouts{BindWait: -1, PeerCache: -1}).withDefaults(); got.BindWait != 0 || got.PeerCache != 0 {
		t.Fatalf("negative values must switch the wait and the cache off: %+v", got)
	}
	if got = (Timeouts{BindWait: time.Second, PeerCache: time.Minute}).withDefaults(); got.BindWait != time.Second || got.PeerCache != time.Minute {
		t.Fatalf("explicit values overwritten: %+v", got)
	}
}

func TestCodeOfFindsCodesInWrappedErrors(t *testing.T) {
	if CodeOf(nil) != "" || CodeOf(errServerName) != "" {
		t.Fatal("a plain error has no code")
	}
	if CodeOf(ErrShutdownIncomplete) != CodeShutdownIncomplete || CodeOf(invalidOption("x")) != CodeInvalidOptions {
		t.Fatal("codes not reported")
	}
}
