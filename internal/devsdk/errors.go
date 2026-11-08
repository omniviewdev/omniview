package devsdk

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devdiag"
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

// buildEnvironmentConflict refuses a Go environment whose effective GOFLAGS
// could change the SDK source that is compiled. flags is already redacted and
// bounded.
func buildEnvironmentConflict(consumer string, published Published, flags string) error {
	typed := devcontract.Fail(4, CodeSelectionConflict, fmt.Sprintf(
		"the Go environment sets GOFLAGS=%s, which could change the plugin SDK source %s is built from (an overlay, toolexec, modfile or vendor flag), "+
			"so published SDK mode refuses it. Run `go env -u GOFLAGS`, or remove GOFLAGS from the file `go env GOENV` names",
		flags, consumer))
	err := refuse(typed, consumer, published, nil)
	typed.Details["goflags"] = flags
	return err
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
// ErrNotAccepted, so callers that only know the sentinel classify it too. The
// message states the policy's own cause (below the floor, not a release, not a
// reviewed release, checksums that differ from the reviewed row, or a missing
// capability) and the ways forward, never a claim that a range of releases works.
func releaseUntrusted(consumer string, published Published, cause error) error {
	typed := devcontract.Fail(4, CodeReleaseUntrusted, fmt.Sprintf(
		"%s resolves %s %s, which this controller does not accept: %s. "+
			"Update that repository to a released %s this controller has reviewed (at or above %s), "+
			"rebuild the controller from a host checkout that adopts this release, "+
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

// diagnostic returns the tail of a failed command's text with credentials
// redacted: the runner sanitizes it already, and a typed refusal copies it.
// Redaction comes first, so a cut can never separate a credential from the
// scheme or key that identifies it.
func diagnostic(err error) string {
	return devdiag.Tail(devdiag.Redact(strings.TrimSpace(err.Error())), diagnosticLimit)
}

// Forms of Go's missing go.sum entry diagnostics. Each names the module (or a
// package it provides) whose checksum is absent; the SDK is named elsewhere in
// such a message only as the importer or the requirer, which is not a missing
// SDK entry.
var (
	// "missing go.sum entry for module providing package <pkg> (imported by <importer>)"
	missingForPackage = regexp.MustCompile(`missing go\.sum entry for module providing package (\S+)`)
	// "missing go.sum entry for go.mod file; to add it:\n\tgo mod download <module>"
	missingForGoMod = regexp.MustCompile(`missing go\.sum entry for go\.mod file; to add it:\s*go mod download (\S+)`)
	// "<module>@<version>: missing go.sum entry"
	missingForModule = regexp.MustCompile(`(\S+)@(\S+): missing go\.sum entry`)
)

// missingSDKChecksum reports whether text carries a missing go.sum entry
// diagnostic, whether any such entry belongs to the SDK module, and the SDK
// version Go names when it names one. A diagnostic whose subject cannot be
// identified is not attributed to the SDK.
func missingSDKChecksum(text string) (missing, sdk bool, version string) {
	if !strings.Contains(text, "missing go.sum entry") {
		return false, false, ""
	}
	for _, match := range missingForPackage.FindAllStringSubmatch(text, -1) {
		if match[1] == Module || strings.HasPrefix(match[1], Module+"/") {
			sdk = true
		}
	}
	for _, match := range missingForGoMod.FindAllStringSubmatch(text, -1) {
		if match[1] == Module {
			sdk = true
		}
	}
	for _, match := range missingForModule.FindAllStringSubmatch(text, -1) {
		if match[1] == Module {
			sdk, version = true, match[2]
		}
	}
	return true, sdk, version
}

// canceled is a command that failed because its operation was canceled or timed
// out. It is deliberately not a typed refusal: it satisfies errors.Is for the
// context error and keeps the runner's own error reachable, which can carry the
// owner's marker that a process may still be running.
type canceled struct {
	reason error
	cause  error
}

func (c *canceled) Error() string { return c.reason.Error() }

func (c *canceled) Unwrap() []error { return []error{c.reason, c.cause} }

// commandFailure maps a failed Go command to the refusal it proves. A missing
// go.sum entry of the SDK module and integrity failures are Go's own
// diagnostics; any other failure, including a missing entry of another module,
// means the module could not be reached or resolved. A canceled operation is not
// a dependency problem and is never typed: it carries the context error and the
// runner's error.
func commandFailure(ctx context.Context, consumer string, published Published, err error) error {
	if ctx.Err() != nil {
		return &canceled{reason: ctx.Err(), cause: err}
	}
	text := err.Error()
	if missing, sdk, version := missingSDKChecksum(text); missing && sdk {
		if version == "" {
			version = published.Version
		}
		return checksumsRequired(consumer, published, fmt.Sprintf(
			"%s records no go.sum checksums for the published plugin SDK; update its go.sum in the source branch (go mod download %s@%s)",
			consumer, Module, version), err)
	}
	switch {
	case strings.Contains(text, "checksum mismatch"), strings.Contains(text, "SECURITY ERROR"):
		return integrityMismatch(consumer, published, fmt.Sprintf(
			"the downloaded published plugin SDK for %s does not match its recorded go.sum checksums; no launch or attestation, and the shared module cache was left untouched",
			consumer), err)
	}
	return dependencyUnavailable(consumer, published, err)
}
