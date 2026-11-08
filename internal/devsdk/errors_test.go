package devsdk

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// The missing go.sum entry texts below were captured from real `go list` runs
// (go1.26.1) against consumers whose go.sum lacked the named entries; the
// cached-path and temp-directory parts are shortened. TestPublishedVerification
// MapsGoSumDiagnosticsFromRealGo reproduces them end to end with a real Go.
const (
	// The SDK's own module checksum is absent (a package of the SDK is imported).
	missingSDKPackage = "go list -mod=readonly -modfile=private.mod -deps -f {{.ImportPath}} ./...: exit status 1\n" +
		"main.go:6:2: missing go.sum entry for module providing package github.com/omniviewdev/plugin-sdk/pkg/profilecontract (imported by example.com/consumer); to add:\n" +
		"\tgo get example.com/consumer\n"
	// The SDK's go.mod checksum is absent.
	missingSDKGoMod = "go list -mod=readonly -modfile=private.mod -deps -f {{.ImportPath}} ./...: exit status 1\n" +
		"main.go:6:2: github.com/omniviewdev/plugin-sdk@v0.17.0: missing go.sum entry for go.mod file; to add it:\n" +
		"\tgo mod download github.com/omniviewdev/plugin-sdk\n"
	// Another module is absent; the SDK is named only as the importer.
	missingOtherPackageImportedBySDK = "go list -mod=readonly -modfile=private.mod -deps -f {{.ImportPath}} ./...: exit status 1\n" +
		"../modcache/github.com/omniviewdev/plugin-sdk@v0.17.0/pkg/profilecontract/profile.go:14:2: missing go.sum entry for module providing package github.com/google/uuid " +
		"(imported by github.com/omniviewdev/plugin-sdk/pkg/profilecontract); to add:\n" +
		"\tgo get github.com/omniviewdev/plugin-sdk/pkg/profilecontract@v0.17.0\n"
	// Another module's go.mod checksum is absent, reached through the SDK.
	missingOtherGoModViaSDK = "go list -mod=readonly -modfile=private.mod -deps -f {{.ImportPath}} ./...: exit status 1\n" +
		"go: downloading github.com/google/uuid v1.6.0\n" +
		"../modcache/github.com/omniviewdev/plugin-sdk@v0.17.0/pkg/profilecontract/profile.go:14:2: github.com/google/uuid@v1.6.0: missing go.sum entry for go.mod file; to add it:\n" +
		"\tgo mod download github.com/google/uuid\n"
	// The SDK's go.mod checksum is absent at a version another module requires.
	missingSDKRequiredByHelper = "go list -mod=readonly -modfile=private.mod -m -json github.com/omniviewdev/plugin-sdk: exit status 1\n" +
		"go: example.com/helper@v1.0.0 requires\n" +
		"\tgithub.com/omniviewdev/plugin-sdk@v0.18.0: missing go.sum entry for go.mod file; to add it:\n" +
		"\tgo mod download github.com/omniviewdev/plugin-sdk\n"
	// Another module's go.mod checksum is absent, required by the SDK: the SDK
	// is named only as the requirer.
	missingOtherRequiredBySDK = "go list -mod=readonly -modfile=private.mod -m -json github.com/omniviewdev/plugin-sdk: exit status 1\n" +
		"go: github.com/omniviewdev/plugin-sdk@v0.17.0 requires\n" +
		"\tgithub.com/creack/pty@v1.1.21: missing go.sum entry for go.mod file; to add it:\n" +
		"\tgo mod download github.com/creack/pty\n"
	// The older single-line form, for the SDK and for another module.
	missingSDKModuleLine   = "github.com/omniviewdev/plugin-sdk@v0.17.0: missing go.sum entry; to add it:\n\tgo mod download github.com/omniviewdev/plugin-sdk\n"
	missingOtherModuleLine = "github.com/example/other@v1.0.0: missing go.sum entry; to add it:\n\tgo mod download github.com/example/other\n"
)

func TestMissingSDKChecksumNamesTheSDKOnlyWhenTheSDKEntryIsMissing(t *testing.T) {
	for name, test := range map[string]struct {
		text         string
		missing, sdk bool
		version      string
	}{
		"package of the SDK":                         {missingSDKPackage, true, true, ""},
		"SDK go.mod":                                 {missingSDKGoMod, true, true, "v0.17.0"},
		"SDK required by another module":             {missingSDKRequiredByHelper, true, true, "v0.18.0"},
		"other module, required by the SDK":          {missingOtherRequiredBySDK, true, false, ""},
		"SDK, older form":                            {missingSDKModuleLine, true, true, "v0.17.0"},
		"other package, SDK only importing":          {missingOtherPackageImportedBySDK, true, false, ""},
		"other go.mod, reached through the SDK":      {missingOtherGoModViaSDK, true, false, ""},
		"other module, older form":                   {missingOtherModuleLine, true, false, ""},
		"sibling module sharing the SDK path prefix": {"main.go:3:2: github.com/omniviewdev/plugin-sdk-extras@v1.0.0: missing go.sum entry for go.mod file; to add it:\n\tgo mod download github.com/omniviewdev/plugin-sdk-extras\n", true, false, ""},
		"package of a sibling module":                {"main.go:3:2: missing go.sum entry for module providing package github.com/omniviewdev/plugin-sdk-extras/x (imported by example.com/c); to add:\n\tgo get example.com/c\n", true, false, ""},
		"the SDK among several entries":              {missingOtherGoModViaSDK + missingSDKGoMod, true, true, "v0.17.0"},
		"unidentifiable subject":                     {"go: missing go.sum entry somewhere", true, false, ""},
		"another failure":                            {"dial tcp: connection refused", false, false, ""},
	} {
		t.Run(name, func(t *testing.T) {
			missing, sdk, version := missingSDKChecksum(test.text)
			require.Equal(t, test.missing, missing)
			require.Equal(t, test.sdk, sdk)
			require.Equal(t, test.version, version)
		})
	}
}

func TestCommandFailureMapsMissingChecksumsByTheModuleTheyConcern(t *testing.T) {
	published := fixturePublished()
	for name, test := range map[string]struct {
		text string
		code string
		exit int
	}{
		"SDK package":                 {missingSDKPackage, CodeChecksumsRequired, 3},
		"SDK go.mod":                  {missingSDKGoMod, CodeChecksumsRequired, 3},
		"SDK, older form":             {missingSDKModuleLine, CodeChecksumsRequired, 3},
		"other package under the SDK": {missingOtherPackageImportedBySDK, CodeDependencyUnavailable, 5},
		"other go.mod under the SDK":  {missingOtherGoModViaSDK, CodeDependencyUnavailable, 5},
		"other, older form":           {missingOtherModuleLine, CodeDependencyUnavailable, 5},
		"checksum mismatch":           {"verifying module: checksum mismatch\n\tSECURITY ERROR", CodeIntegrityMismatch, 4},
		"unreachable":                 {"dial tcp: connection refused", CodeDependencyUnavailable, 5},
	} {
		t.Run(name, func(t *testing.T) {
			err := commandFailure(context.Background(), "plugin", published, errors.New(test.text))
			var typed *devcontract.Error
			require.ErrorAs(t, err, &typed)
			require.Equal(t, test.code, typed.Code, typed.Message)
			require.Equal(t, test.exit, typed.Exit)
			if test.code == CodeDependencyUnavailable {
				require.Contains(t, typed.Message, "no source fallback")
			}
		})
	}
	// The refusal names the SDK version whose checksums are missing, not the declared one.
	err := commandFailure(context.Background(), "plugin", published, errors.New(missingSDKRequiredByHelper))
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed)
	require.Contains(t, typed.Message, Module+"@v0.18.0")
	require.NotContains(t, typed.Message, Module+"@"+published.Version)

	// A dependency diagnostic about another module keeps Go's own text, so the
	// user sees which module's checksum is missing.
	err = commandFailure(context.Background(), "plugin", published, errors.New(missingOtherGoModViaSDK))
	require.ErrorAs(t, err, &typed)
	require.Contains(t, typed.Message, "github.com/google/uuid@v1.6.0: missing go.sum entry for go.mod file")
}

func TestCommandFailureOnCancellationKeepsTheRunnersErrorAndIsNeverTyped(t *testing.T) {
	uncertain := errors.New("owned process termination is uncertain")
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	expired, stop := context.WithTimeout(context.Background(), 0)
	defer stop()
	for name, test := range map[string]struct {
		ctx    context.Context
		reason error
	}{"canceled": {canceled, context.Canceled}, "deadline": {expired, context.DeadlineExceeded}} {
		t.Run(name, func(t *testing.T) {
			// Whatever the runner reported, a canceled operation is not a dependency problem.
			for _, cause := range []error{uncertain, errors.New(missingSDKGoMod), errors.New("signal: killed")} {
				err := commandFailure(test.ctx, "plugin", fixturePublished(), cause)
				require.ErrorIs(t, err, test.reason)
				require.ErrorIs(t, err, cause, "the runner's error must stay reachable")
				var typed *devcontract.Error
				require.False(t, errors.As(err, &typed), "a cancellation is never a typed refusal: %v", err)
				require.Equal(t, test.reason.Error(), err.Error(), "the text is the cancellation's, never the command's")
			}
		})
	}
}

func TestDiagnosticRedactsBeforeItBounds(t *testing.T) {
	const password = "s3cr3tpassw0rdvalue"
	// The tail cut lands 8 bytes into the password of this URL.
	cut := strings.Repeat("filler ", 400) + "dial https://user:" + password + "@proxy.example.com/x" +
		strings.Repeat("z", diagnosticLimit-(len(password)-8)-len("@proxy.example.com/x"))
	raw := cut[len(cut)-diagnosticLimit:]
	require.Contains(t, raw, password[8:], "control: truncating before redacting would keep half of the password")
	require.NotContains(t, raw, "https://", "control: and would have dropped the scheme that identifies the credential")

	for name, test := range map[string]struct {
		text    string
		secrets []string
		kept    string
	}{
		"userinfo":              {"dial https://user:hunter2@proxy.example.com/mod: refused", []string{"hunter2"}, "proxy.example.com/mod: refused"},
		"password containing @": {"dial https://user:p@ss@w0rd@proxy.example.com/mod: refused", []string{"p@ss", "ss@w0rd", "w0rd@"}, "@proxy.example.com/mod: refused"},
		"token in a URL query":  {"GET https://proxy.example.com/mod/@v/list?access=q9x8secretq&x=1: 403", []string{"q9x8secretq"}, "https://proxy.example.com/mod/@v/list"},
		"token-shaped path":     {"GET https://proxy.example.com/ghp_" + strings.Repeat("a1B2", 9) + "/mod/@v/list: 404", []string{"ghp_" + strings.Repeat("a1B2", 9)}, "/mod/@v/list: 404"},
		"bearer header":         {"Authorization: Bearer abcdef0123456789", []string{"abcdef0123456789"}, "Authorization"},
		"cut inside the secret": {cut, []string{password, password[8:]}, "proxy.example.com/x"},
	} {
		t.Run(name, func(t *testing.T) {
			text := diagnostic(errors.New("  " + test.text + "\n"))
			for _, secret := range test.secrets {
				require.NotContains(t, text, secret)
			}
			require.Contains(t, text, test.kept)
			require.LessOrEqual(t, len(text), diagnosticLimit+len("..."))
		})
	}

	short := diagnostic(errors.New("  connection refused \n"))
	require.Equal(t, "connection refused", short, "a short diagnostic is returned whole and trimmed")
	long := diagnostic(errors.New(strings.Repeat("a", 5000) + "tail"))
	require.True(t, strings.HasPrefix(long, "..."), "a long diagnostic keeps its tail, where Go prints the failing line")
	require.True(t, strings.HasSuffix(long, "tail"))
}
