package apperror

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	grpcplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Reading a plugin's error takes three shapes, all of which this host must meet:
//
//   - a plugin built on an SDK that carries the sentence, read by a client that
//     predates it (the host's SDK pin): the client sets a placeholder and keeps the
//     status, with the LocalizedMessage, in Err;
//   - the same plugin read by a client that restores the sentence: it is Message;
//   - a plugin built on an SDK that does not carry it: a class, and nothing else.
//
// The first is made by the pinned SDK's own client from a status built the way the
// carrying SDK builds it, so what is tested is what that client really returns.

// pluginStatus builds the status a plugin sends: the class in an ErrorInfo and, when
// sentence is not empty, the sentence in a LocalizedMessage.
func pluginStatus(t *testing.T, grpcCode codes.Code, code, sentence string) error {
	t.Helper()
	withInfo, err := status.New(grpcCode, "resource operation failed").
		WithDetails(&errdetails.ErrorInfo{Reason: code, Domain: "omniview.resource.v2"})
	if err != nil {
		t.Fatal(err)
	}
	if sentence != "" {
		if withInfo, err = withInfo.WithDetails(&errdetails.LocalizedMessage{Locale: "en", Message: sentence}); err != nil {
			t.Fatal(err)
		}
	}
	return withInfo.Err()
}

// readByPinnedClient is what the SDK client this host is built on returns for a status.
func readByPinnedClient(t *testing.T, wire error) error {
	t.Helper()
	decoded := grpcplugin.ResourceDomainError(wire)
	var roe *resource.ResourceOperationError
	if !errors.As(decoded, &roe) {
		t.Fatalf("not a classified error: %v", decoded)
	}
	return decoded
}

// readByRestoringClient is what a client that restores the sentence returns: the
// sentence in Message (empty when there was none), the status in Err.
func readByRestoringClient(code, sentence string, wire error) error {
	return &resource.ResourceOperationError{Err: wire, Code: code, Message: sentence}
}

type kubernetesCase struct {
	code     string
	grpc     codes.Code
	sentence string
	// What the UI is given when the plugin's sentence arrives, and when it does not.
	withSentence, classOnly string
}

// The four classes the UI work reported, written as the Kubernetes plugin writes
// them (omniview-plugin-kubernetes, pkg/plugin/resource/errors.go). The JSON is
// what Wails gives the page, verbatim: `message` is this string, `cause` the same
// object. The request id is the host's, here fixed.
var kubernetesCases = []kubernetesCase{
	{"NOT_FOUND", codes.NotFound, "The requested resource or API group was not found.",
		`{"type":"omniview:resource/not-found","title":"Not found","status":404,"detail":"The requested resource or API group was not found.","code":"NOT_FOUND","requestId":"req-1","recovery":"none"}`,
		`{"type":"omniview:resource/not-found","title":"Not found","status":404,"detail":"The requested resource was not found.","code":"NOT_FOUND","requestId":"req-1","recovery":"none"}`},
	{"FORBIDDEN", codes.PermissionDenied, "You do not have permission to perform this resource operation.",
		// A denial always speaks with the host's words.
		`{"type":"omniview:resource/forbidden","title":"Access denied","status":403,"detail":"The operation is not permitted.","code":"FORBIDDEN","requestId":"req-1","recovery":"none"}`,
		`{"type":"omniview:resource/forbidden","title":"Access denied","status":403,"detail":"The operation is not permitted.","code":"FORBIDDEN","requestId":"req-1","recovery":"none"}`},
	{"CONFLICT", codes.Aborted, "The resource operation conflicts with the current cluster state.",
		`{"type":"omniview:resource/conflict","title":"Conflict","status":409,"detail":"The resource operation conflicts with the current cluster state.","code":"CONFLICT","requestId":"req-1","recovery":"refreshContract"}`,
		`{"type":"omniview:resource/conflict","title":"Conflict","status":409,"detail":"The operation conflicts with current state.","code":"CONFLICT","requestId":"req-1","recovery":"refreshContract"}`},
	{"TIMEOUT", codes.DeadlineExceeded, "The cluster did not complete the request in time.",
		`{"type":"omniview:resource/timeout","title":"Timed out","status":408,"detail":"The cluster did not complete the request in time.","code":"TIMEOUT","requestId":"req-1","recovery":"none"}`,
		`{"type":"omniview:resource/timeout","title":"Timed out","status":408,"detail":"The operation exceeded its deadline.","code":"TIMEOUT","requestId":"req-1","recovery":"none"}`},
}

func TestKubernetesStyleErrorsReachTheUI(t *testing.T) {
	for _, k := range kubernetesCases {
		t.Run(k.code, func(t *testing.T) {
			carrying := pluginStatus(t, k.grpc, k.code, k.sentence)
			older := pluginStatus(t, k.grpc, k.code, "")
			for name, got := range map[string]error{
				"a carrying plugin, read by the pinned client":  readByPinnedClient(t, carrying),
				"a carrying plugin, read by a restoring client": readByRestoringClient(k.code, k.sentence, carrying),
			} {
				if app := ForResource(got, "req-1"); app.Error() != k.withSentence {
					t.Errorf("%s:\n got  %s\n want %s", name, app.Error(), k.withSentence)
				}
			}
			for name, got := range map[string]error{
				"an older plugin, read by the pinned client":  readByPinnedClient(t, older),
				"an older plugin, read by a restoring client": readByRestoringClient(k.code, "", older),
			} {
				if app := ForResource(got, "req-1"); app.Error() != k.classOnly {
					t.Errorf("%s:\n got  %s\n want %s", name, app.Error(), k.classOnly)
				}
			}
		})
	}
}

// The placeholders the SDK puts where a sentence would be are not sentences, in a
// call or in an action event.
func TestSDKPlaceholdersAreNotSentences(t *testing.T) {
	for _, placeholder := range []string{"resource operation failed", "action operation failed"} {
		app := ForResource(&resource.ResourceOperationError{Code: "TIMEOUT", Message: placeholder}, "req-1")
		if app.Detail != "The operation exceeded its deadline." {
			t.Errorf("%q took the place of the class's sentence: %q", placeholder, app.Detail)
		}
	}
}

// A tripwire for the day this host pins an SDK whose client restores the sentence
// (plugin-sdk, the release that carries it). Until then the client leaves a
// placeholder in Message and the sentence in the status, and ForResource reads it
// from there (providerSentence). When this fails, delete statusSentence, the status
// branch of providerSentence, the "resource operation failed" entry of
// sdkPlaceholders, and this test: Message carries the sentence.
func TestPinnedSDKClientStillLeavesTheSentenceInTheStatus(t *testing.T) {
	var roe *resource.ResourceOperationError
	if !errors.As(readByPinnedClient(t, pluginStatus(t, codes.Aborted, "CONFLICT", "A sentence.")), &roe) {
		t.Fatal("not a classified error")
	}
	if roe.Message != "resource operation failed" {
		t.Fatalf("the pinned SDK client now restores the sentence (Message %q): remove the status reading from ForResource", roe.Message)
	}
}

// Whatever a plugin says, these classes speak with the host's words and nothing of
// the plugin's reaches the envelope.
func TestHostOwnedClassesNeverShowProviderText(t *testing.T) {
	for _, code := range []string{"FORBIDDEN", "UNAUTHORIZED", "INTERNAL", "PROVIDER_ERROR", "CANCELLED", "GRANT_DENIED", "DELEGATION_NOT_ACTIVE", "OWNER_UNAVAILABLE", "CONNECTION_NOT_STARTED", "A_CLASS_THAT_DOES_NOT_EXIST"} {
		t.Run(code, func(t *testing.T) {
			for name, err := range map[string]error{
				"the restoring client": readByRestoringClient(code, "PLUGIN-SENTENCE", nil),
				"the pinned client":    &resource.ResourceOperationError{Err: pluginStatus(t, codes.Internal, "INTERNAL", "PLUGIN-SENTENCE"), Code: code, Message: "resource operation failed"},
				"a typed error":        &resource.ResourceOperationError{Code: code, Title: "PLUGIN-TITLE", Message: "PLUGIN-SENTENCE", Suggestions: []string{"PLUGIN-SUGGESTION"}},
			} {
				if wire := ForResource(err, "req-1").Error(); strings.Contains(wire, "PLUGIN") {
					t.Errorf("%s: provider text reached the envelope: %s", name, wire)
				}
			}
		})
	}
}

// The plugin's text is untrusted. What cannot be shown is cleaned, and text that
// carries a credential or a path into the user's home is not shown at all: the
// class's own sentence stands.
func TestProviderSentenceIsCleanedOrRefused(t *testing.T) {
	const class = "The operation exceeded its deadline."
	for name, tc := range map[string]struct{ in, want string }{
		"a sentence":              {"The cluster did not complete the request in time.", "The cluster did not complete the request in time."},
		"controls and escapes":    {"\x1b[31mThe cluster\x00 did\u202e not\u200b complete\r\nthe request.\x1b[0m", "The cluster did not complete the request."},
		"white space":             {"  The   cluster\t\tdid not respond.  ", "The cluster did not respond."},
		"a bearer token":          {"Request rejected: Bearer abcdefghijklmnop", class},
		"a token pair":            {"Request failed (token=abc123def456)", class},
		"a URL with userinfo":     {"Could not reach https://admin:s3cret@cluster.example.com", class},
		"a kubeconfig fragment":   {"invalid client-key-data: LS0tLS1CRUdJTg", class},
		"a path under the home":   {"Could not read /Users/alice/.kube/config", class},
		"a tilde path":            {"Could not read ~/.kube/config", class},
		"nothing but invisible":   {"\u200b\u202e\x00", class},
		"not UTF-8":               {"The cluster \xff did not respond.", class},
		"longer than a sentence":  {strings.Repeat("The cluster did not respond. ", 200), class},
		"a secret past the bound": {strings.Repeat("The cluster did not respond. ", 30) + "token=abc123def456", class},
	} {
		typed := ForResource(&resource.ResourceOperationError{Code: "TIMEOUT", Message: tc.in}, "req-1")
		if typed.Detail != tc.want {
			t.Errorf("%s: detail %q, want %q", name, typed.Detail, tc.want)
		}
		// The same text through the status, as the pinned client leaves it. A proto
		// string cannot hold what is not UTF-8, so such text never gets this far.
		if utf8.ValidString(tc.in) {
			wire := readByPinnedClient(t, pluginStatus(t, codes.DeadlineExceeded, "TIMEOUT", tc.in))
			if got := ForResource(wire, "req-1").Detail; got != tc.want {
				t.Errorf("%s: through the status, detail %q, want %q", name, got, tc.want)
			}
		}
	}
}

// A sentence that is only long is cut, not dropped.
func TestProviderSentenceIsBounded(t *testing.T) {
	long := strings.Repeat("The cluster did not respond. ", 30) // 870 bytes
	got := ForResource(&resource.ResourceOperationError{Code: "TIMEOUT", Message: long}, "req-1").Detail
	if n := utf8.RuneCountInString(got); n != 512 || !strings.HasSuffix(got, "…") {
		t.Fatalf("%d runes: %q", n, got)
	}
}

// Title and suggestions of a typed error (a host-authored one, or an in-band one)
// are held to the same standard.
func TestTitleAndSuggestionsPassThroughTheSameGate(t *testing.T) {
	got := ForResource(&resource.ResourceOperationError{
		Code: "CONFLICT", Title: "Resource\x00 conflict\u202e", Message: "Changed.",
		Suggestions: []string{"Refresh and try again", "Open /Users/alice/.kube/config", "Wait\x1b[0m a moment"},
	}, "req-1")
	if got.Title != "Resource conflict" || got.Detail != "Changed." {
		t.Fatalf("title %q, detail %q", got.Title, got.Detail)
	}
	if fmt.Sprint(got.Suggestions) != "[Refresh and try again Wait a moment]" {
		t.Fatalf("suggestions %q", got.Suggestions)
	}
}

// A host-authored AppError was never checked either: its detail meets the same gate.
func TestHostAuthoredDetailIsHeldToTheSameGate(t *testing.T) {
	leaky := New(TypeConnectionFailed, 503, "Source unavailable", "dial tcp: read /Users/alice/.kube/config: permission denied")
	if got := ForResource(leaky, "req-1"); got.Detail != "The source is unavailable." {
		t.Fatalf("detail %q", got.Detail)
	}
	fine := New(TypeConnectionFailed, 503, "Source unavailable", "The connection is not started.")
	if got := ForResource(fine, "req-1"); got.Detail != "The connection is not started." {
		t.Fatalf("detail %q", got.Detail)
	}
}
