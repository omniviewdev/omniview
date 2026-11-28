package opener

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// recorder is the platform's opener, put where the tests can see what the host asked it to open.
type recorder struct{ opened []string }

func (r *recorder) open(target string) error { r.opened = append(r.opened, target); return nil }

func newTest(own ...string) (*Opener, *recorder) {
	rec := &recorder{}
	o := withOpen(rec.open)
	o.SetOwn(func() []string { return own })
	return o, rec
}

func refusal(t *testing.T, o *Opener, rec *recorder, raw string, want Reason) {
	t.Helper()
	before := len(rec.opened)
	got, err := o.OpenExternalURL(raw)
	require.NoError(t, err, "%.60q", raw)
	assert.Equal(t, Result{Opened: false, Reason: want}, got, "%.60q", raw)
	assert.Len(t, rec.opened, before, "a refused address is never handed to the platform: %.60q", raw)
}

func opens(t *testing.T, o *Opener, rec *recorder, raw string) {
	t.Helper()
	before := len(rec.opened)
	got, err := o.OpenExternalURL(raw)
	require.NoError(t, err, "%.60q", raw)
	assert.Equal(t, Result{Opened: true}, got, "%.60q", raw)
	require.Len(t, rec.opened, before+1, "%.60q", raw)
}

func TestOnlyHTTPAndHTTPSAreOpened(t *testing.T) {
	o, rec := newTest()
	for _, raw := range []string{
		"javascript:alert(1)", "JaVaScRiPt:alert(1)", " https://a.example/", "\thttps://a.example/", "java\nscript:alert(1)", "%6Aavascript:alert(1)",
		"http:/\\evil.example", "https:\\\\evil.example", "http:example.com", "https:example.com", "vscode://file/etc/passwd", "ms-msdt:/id", "smb://h/s",
		"file:///etc/passwd", "ftp://h/", "data:text/html,x", "", "//evil.example/", "a.example", "x-man-page://ls",
	} {
		refusal(t, o, rec, raw, ReasonScheme)
	}
	opens(t, o, rec, "http://a.example/")
	opens(t, o, rec, "HTTPS://A.EXAMPLE/Path?x=1#f")
}

func TestAnAddressThatCanShowOneHostAndOpenAnotherIsRefused(t *testing.T) {
	o, rec := newTest()
	for _, raw := range []string{
		"https://user@a.example/", "https://user:pw@a.example/", "https://accounts.google.com%2Fsignin@evil.example/login", "https://@a.example/",
		"http://a.example:80@evil.example/",
	} {
		refusal(t, o, rec, raw, ReasonUserinfo)
	}
	opens(t, o, rec, "https://a.example/@x")
	opens(t, o, rec, "https://a.example/?u=a@b")
}

func TestAMalformedAddressIsRefusedAndTheSemicolonIsDecided(t *testing.T) {
	o, rec := newTest()
	for _, raw := range []string{
		"http:///evil.com", "https://", "http://", "https://a.example/\x00", "https://a.example/ x", "https://a.example/\tx", "https://a.example/\nx", "https://a.example/\x1b[31m",
		"https://a.example/a;b", "https://a.example/?q=a|b", "https://a.example/`x`", "https://a.example/$x", "https://a.example/<x>", "https://evil.example\\@good.example/",
		"https://a.example:99999/", "https://a.example:abc/", "https://[fe80::1%25eth0]/", "https://127%2e0.0.1/", "https://a.example\u202e/", "https://a.example\u200b/",
		"https://a.example/\u0090", "https://a.example/\u009b31m", "http://127.0.0.1\"x/", "http://a\"b.example/", "http://a'b.example/", "http://a_b.example/", "http://a..example/",
		"http://.a.example/", "http://a*.example/", "http://a,b.example/", "http://a!.example/", "http://a~b.example/", "http://a{b}.example/",
		"https://1.2.3.4.5/", "https://example.com.1/", "https://[::1/", "https://a.example/\u0085", "https://a.example/\xff", "https://a b.example/",
	} {
		refusal(t, o, rec, raw, ReasonMalformed)
	}
	// the control: the same shapes without the fault
	opens(t, o, rec, "https://a.example/a,b?q=a,b&r=1#x")
	opens(t, o, rec, "https://a.example:8443/path")
	opens(t, o, rec, "https://sub-domain.a.example/a%20b?q=%22x%22")
	opens(t, o, rec, "https://münchen.example/")
	opens(t, o, rec, "https://xn--mnchen-3ya.example/")
}

func TestAnAddressOverTheCapIsRefusedAndOneAtTheCapIsOpened(t *testing.T) {
	o, rec := newTest()
	head := "https://a.example/"
	refusal(t, o, rec, head+strings.Repeat("a", 100*1024), ReasonTooLong)
	refusal(t, o, rec, head+strings.Repeat("a", MaxURL-len(head)+1), ReasonTooLong)
	opens(t, o, rec, head+strings.Repeat("a", MaxURL-len(head)))
	refusal(t, o, rec, "javascript:"+strings.Repeat("a", MaxURL), ReasonTooLong)
}

func TestTheHostsOwnServerIsRefusedInEverySpellingAndOnlyOnItsPort(t *testing.T) {
	o, rec := newTest("127.0.0.1:34115", "[::1]:40000", "localhost:41000")
	for _, raw := range []string{
		"http://127.0.0.1:34115/", "http://localhost:34115/", "http://LOCALHOST:34115/x", "http://localhost.:34115/", "http://localhost..:34115/", "http://app.localhost:34115/",
		"http://a.b.localhost:34115/", "http://127.1:34115/", "http://127.0.1:34115/", "http://0x7f.1:34115/", "http://0x7f000001:34115/", "http://2130706433:34115/",
		"http://0177.0.0.1:34115/", "http://0177.1:34115/", "http://127.0.0.1.:34115/", "http://127.255.255.254:34115/", "http://0.0.0.0:34115/", "http://0:34115/", "http://[::]:34115/",
		"http://[::1]:34115/", "http://[0:0:0:0:0:0:0:1]:34115/", "http://[::ffff:127.0.0.1]:34115/", "http://[::ffff:7f00:1]:34115/", "http://[::127.0.0.1]:34115/",
		"http://１２７.０.０.１:34115/", "http://%ef%bc%91%ef%bc%92%ef%bc%97.0.0.1:34115/", "http://127。0。0。1:34115/", "http://①②⑦.0.0.1:34115/",
		"http://127.0.0.1:40000/", "http://localhost:41000/", "https://[::1]:40000/",
	} {
		before := len(rec.opened)
		got, err := o.OpenExternalURL(raw)
		require.NoError(t, err)
		assert.False(t, got.Opened, raw)
		assert.Contains(t, []Reason{ReasonOwnServer, ReasonMalformed}, got.Reason, raw)
		assert.Len(t, rec.opened, before, raw)
	}
	for _, raw := range []string{"http://127.1:34115/", "http://0x7f.1:34115/", "http://2130706433:34115/", "http://[::ffff:127.0.0.1]:34115/", "http://localhost.:34115/", "http://[::]:34115/", "http://0.0.0.0:34115/", "http://app.localhost:34115/"} {
		refusal(t, o, rec, raw, ReasonOwnServer)
	}
	// the controls: other servers of this machine are the user's own (the Ports tool opens a forward), and other hosts on the host's port are not the host
	for _, raw := range []string{
		"http://localhost:3000/", "http://127.0.0.1:8080/x", "http://127.1:34116/", "http://[::1]:34116/", "https://localhost/", "http://example.com:34115/",
		"http://[2001:db8::1]:34115/", "http://127.0.0.1.nip.io:34115/",
	} {
		opens(t, o, rec, raw)
	}
}

func TestTheDefaultPortOfTheSchemeIsAPort(t *testing.T) {
	o, rec := newTest("127.0.0.1:80", "127.0.0.1:443")
	refusal(t, o, rec, "http://localhost/", ReasonOwnServer)
	refusal(t, o, rec, "https://localhost/", ReasonOwnServer)
	refusal(t, o, rec, "http://127.1:80/", ReasonOwnServer)
	opens(t, o, rec, "http://localhost:8080/")
}

func TestAnAddressOfAnInterfaceTheHostListensOnIsRefused(t *testing.T) {
	o, rec := newTest("192.168.1.5:9000")
	refusal(t, o, rec, "http://192.168.1.5:9000/", ReasonOwnServer)
	refusal(t, o, rec, "http://3232235781:9000/", ReasonOwnServer)
	refusal(t, o, rec, "http://0xc0.0xa8.1.5:9000/", ReasonOwnServer)
	refusal(t, o, rec, "http://[::ffff:192.168.1.5]:9000/", ReasonOwnServer) // an IPv4 address in an IPv6 spelling
	refusal(t, o, rec, "http://[::ffff:c0a8:105]:9000/", ReasonOwnServer)
	opens(t, o, rec, "http://[::ffff:192.168.1.6]:9000/")
	opens(t, o, rec, "http://192.168.1.6:9000/")
	opens(t, o, rec, "http://192.168.1.5:9001/")
}

func TestTheServersAreAskedEachTime(t *testing.T) {
	servers := []string{}
	rec := &recorder{}
	o := withOpen(rec.open)
	o.SetOwn(func() []string { return servers })
	opens(t, o, rec, "http://localhost:5000/")
	servers = []string{"127.0.0.1:5000"}
	refusal(t, o, rec, "http://localhost:5000/", ReasonOwnServer)
	servers = nil
	opens(t, o, rec, "http://localhost:5000/")
	fresh := withOpen(rec.open) // no servers set at all
	opens(t, fresh, rec, "http://localhost:5000/")
}

// An address is the user's data: it is in no answer and no error.
func TestNoAnswerAndNoErrorHoldsTheAddress(t *testing.T) {
	const secret = "s3cr3t-CANARY-77"
	o, _ := newTest("127.0.0.1:34115")
	for _, raw := range []string{"javascript:" + secret, "https://user:" + secret + "@a.example/", "http://localhost:34115/" + secret, "https://a.example/;" + secret, "https://a.example/" + strings.Repeat(secret, 400)} {
		got, err := o.OpenExternalURL(raw)
		require.NoError(t, err)
		encoded, err := json.Marshal(got)
		require.NoError(t, err)
		assert.NotContains(t, string(encoded), secret)
	}
	failing := withOpen(func(string) error { return errors.New("exec: xdg-open https://a.example/" + secret) })
	_, err := failing.OpenExternalURL("https://a.example/" + secret)
	require.Error(t, err)
	assert.NotContains(t, err.Error(), secret)
	// the control: the address is what the platform opener is given
	var given string
	ok := withOpen(func(target string) error { given = target; return nil })
	_, err = ok.OpenExternalURL("https://a.example/" + secret)
	require.NoError(t, err)
	assert.Contains(t, given, secret)
}
