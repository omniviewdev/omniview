package devsdk

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// Typed refusal codes of published-SDK verification. Each keeps its exit class
// across the supervisor boundary through the controller's workspace exit table.
const (
	// CodeContractMismatch: a consumer's module files state no usable SDK requirement (exit 3).
	CodeContractMismatch = "sdk_contract_mismatch"
	// CodeChecksumsRequired: go.sum lacks the SDK checksums; repair the source branch (exit 3).
	CodeChecksumsRequired = "sdk_checksums_required"
	// CodeSelectionConflict: the consumer redirects or vendors the SDK, contradicting a published selection (exit 4).
	CodeSelectionConflict = "sdk_selection_conflict"
	// CodeReleaseUntrusted: the effective SDK is not an accepted release (exit 4).
	CodeReleaseUntrusted = "sdk_release_untrusted"
	// CodeIntegrityMismatch: module-cache bytes and recorded checksums disagree (exit 4).
	CodeIntegrityMismatch = "sdk_integrity_mismatch"
	// CodeIdentityChanged: the effective SDK differs from the one verified before a build (exit 4).
	CodeIdentityChanged = "sdk_identity_changed"
	// CodeDependencyUnavailable: the SDK module could not be resolved or downloaded (exit 5).
	CodeDependencyUnavailable = "sdk_dependency_unavailable"
)

// failure pairs a typed refusal, which carries the code and exit class, with the
// error that caused it, so errors.Is and errors.As reach both (a refusal joined
// to ErrNotAccepted, or to a command error that marks an uncertain owned
// process). Its text is the refusal's: the cause never leaks into it.
type failure struct {
	typed *devcontract.Error
	cause error
}

func (f *failure) Error() string { return f.typed.Message }

func (f *failure) Unwrap() []error { return []error{f.typed, f.cause} }

// refuse attaches details and an optional cause to a typed refusal.
func refuse(typed *devcontract.Error, consumer string, published Published, cause error) error {
	typed.Details = map[string]any{"consumer": consumer, "module": Module}
	if published.Version != "" {
		typed.Details["version"] = published.Version
	}
	if cause == nil {
		return typed
	}
	return &failure{typed: typed, cause: cause}
}

func contractMismatch(consumer, message string) error {
	return refuse(devcontract.Fail(3, CodeContractMismatch, message), consumer, Published{}, nil)
}

func checksumsRequired(consumer string, published Published, message string, cause error) error {
	return refuse(devcontract.Fail(3, CodeChecksumsRequired, message), consumer, published, cause)
}

func selectionConflict(consumer string, published Published, message string) error {
	return refuse(devcontract.Fail(4, CodeSelectionConflict, message), consumer, published, nil)
}

func integrityMismatch(consumer string, published Published, message string, cause error) error {
	return refuse(devcontract.Fail(4, CodeIntegrityMismatch, message), consumer, published, cause)
}

// IdentityChanged reports an effective SDK that differs from the identity
// verified before a build. Nothing built against it may be attested or launched.
func IdentityChanged(consumer, message string) error {
	return refuse(devcontract.Fail(4, CodeIdentityChanged, message), consumer, Published{}, nil)
}

// releaseUntrusted refuses a tuple the policy does not admit. The refusal joins
// ErrNotAccepted, so callers that only know the sentinel classify it too.
func releaseUntrusted(consumer string, published Published, cause error) error {
	typed := devcontract.Fail(4, CodeReleaseUntrusted, fmt.Sprintf(
		"%s resolves %s %s, which is not an accepted release (%s); update that repository to a released %s at or above %s, "+
			"or select the plugin-sdk repository to build against explicit SDK source",
		consumer, Module, published.Version, strings.TrimPrefix(cause.Error(), ErrNotAccepted.Error()+": "), Module, FloorVersion))
	err := refuse(typed, consumer, published, cause)
	typed.Details["floor"] = FloorVersion
	return err
}

func dependencyUnavailable(consumer string, published Published, cause error) error {
	return refuse(devcontract.Fail(5, CodeDependencyUnavailable, fmt.Sprintf(
		"the published plugin SDK for %s could not be resolved or downloaded (no source fallback was attempted): %s",
		consumer, diagnostic(cause))), consumer, published, cause)
}

// diagnosticLimit bounds the Go command text copied into a typed refusal.
const diagnosticLimit = 1024

var credentialURL = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://)[^/@\s]+@`)

// diagnostic returns the tail of a failed command's text with credential-bearing
// URLs redacted: the runner sanitizes it already, and a typed refusal copies it.
func diagnostic(err error) string {
	text := credentialURL.ReplaceAllString(strings.TrimSpace(err.Error()), "${1}[REDACTED]@")
	if len(text) > diagnosticLimit {
		text = "..." + text[len(text)-diagnosticLimit:]
	}
	return text
}

// commandFailure maps a failed Go command to the refusal it proves. Missing
// checksums and integrity failures are Go's own diagnostics; any other failure
// means the module could not be reached or resolved. A canceled operation is
// not a dependency problem and passes through untouched.
func commandFailure(ctx context.Context, consumer string, published Published, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	text := err.Error()
	switch {
	case strings.Contains(text, "missing go.sum entry"):
		return checksumsRequired(consumer, published, fmt.Sprintf(
			"%s records no go.sum checksums for the published plugin SDK; update its go.sum in the source branch (go mod download %s@%s)",
			consumer, Module, published.Version), err)
	case strings.Contains(text, "checksum mismatch"), strings.Contains(text, "SECURITY ERROR"):
		return integrityMismatch(consumer, published, fmt.Sprintf(
			"the downloaded published plugin SDK for %s does not match its recorded go.sum checksums; no launch or attestation, and the shared module cache was left untouched",
			consumer), err)
	}
	return dependencyUnavailable(consumer, published, err)
}
