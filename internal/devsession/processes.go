// Package devsession provides persistent development-session ownership primitives.
// It does not supervise children or infer service readiness from a lease or PID.
package devsession

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

var (
	ErrOwnership           = errors.New("devsession: ownership conflict")
	ErrProcessGone         = errors.New("devsession: process no longer exists")
	ErrUnsupportedIdentity = errors.New("devsession: platform cannot safely verify or terminate this process")
)

// ProcessOwner is provenance recorded by the supervisor when it starts a child.
// Workspace and generation are not inferred from an executable name or a PID.
// Source is the resolved source/build identity, not a display name.
type ProcessOwner struct {
	WorkspaceID string
	Generation  string
	Role        string
	Source      string
}

func validWorkspace(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed != uuid.Nil && parsed.String() == id
}

func validLabel(value string) bool {
	return strings.TrimSpace(value) != "" && !strings.ContainsAny(value, "\x00\r\n")
}

func (o ProcessOwner) validate() error {
	if !validWorkspace(o.WorkspaceID) || !validLabel(o.Generation) || !validLabel(o.Role) || !validLabel(o.Source) {
		return fmt.Errorf("%w: workspace, generation, role and source are required", ErrOwnership)
	}
	return nil
}

func ownerOf(identity devcontract.ProcessIdentity) ProcessOwner {
	return ProcessOwner{WorkspaceID: identity.WorkspaceID, Generation: identity.Generation, Role: identity.Role, Source: identity.Source}
}

// CaptureProcess records a kernel-sourced start identity and executable for a
// process the caller owns. Call this immediately after starting the child, and
// persist the result privately. This is an ownership attestation, not adoption
// or authorization of arbitrary processes discovered by PID.
func CaptureProcess(pid int, owner ProcessOwner) (devcontract.ProcessIdentity, error) {
	if err := owner.validate(); err != nil {
		return devcontract.ProcessIdentity{}, err
	}
	if pid <= 0 {
		return devcontract.ProcessIdentity{}, fmt.Errorf("%w: process PID must be positive", ErrOwnership)
	}
	start, executable, err := inspectProcess(pid)
	if err != nil {
		return devcontract.ProcessIdentity{}, err
	}
	if start == "" || !filepath.IsAbs(executable) {
		return devcontract.ProcessIdentity{}, fmt.Errorf("%w: incomplete kernel identity", ErrUnsupportedIdentity)
	}
	return devcontract.ProcessIdentity{PID: pid, StartIdentity: start, Executable: executable, WorkspaceID: owner.WorkspaceID, Generation: owner.Generation, Role: owner.Role, Source: owner.Source}, nil
}

func validateOwnedRecord(record devcontract.ProcessIdentity, expected ProcessOwner) error {
	if err := expected.validate(); err != nil {
		return err
	}
	if record.PID <= 0 || record.StartIdentity == "" || !filepath.IsAbs(record.Executable) || ownerOf(record) != expected {
		return fmt.Errorf("%w: process provenance does not match the requested owner", ErrOwnership)
	}
	return nil
}

// VerifyOwnedProcess compares all recorded provenance and the live kernel start
// identity/executable. Permission errors are not evidence of a stale process.
// Verification alone is not an atomic authorization for a subsequent PID kill.
func VerifyOwnedProcess(record devcontract.ProcessIdentity, expected ProcessOwner) error {
	if err := validateOwnedRecord(record, expected); err != nil {
		return err
	}
	start, executable, err := inspectProcess(record.PID)
	if err != nil {
		return err
	}
	if start != record.StartIdentity || executable != record.Executable {
		return fmt.Errorf("%w: PID was reused or executable changed", ErrOwnership)
	}
	return nil
}

// TerminateOwnedProcess terminates only the exact recorded process, through a
// process-stable OS handle. It never signals process groups or port owners.
// Linux uses pidfds; Windows uses a verified process handle. Darwin and other
// unsupported platforms fail closed rather than check-then-signal a numeric PID.
// Already exited processes are successful, but malformed/wrong-owner records
// always fail. No graceful-shutdown or escalation policy is imposed here.
func TerminateOwnedProcess(record devcontract.ProcessIdentity, expected ProcessOwner) error {
	if err := validateOwnedRecord(record, expected); err != nil {
		return err
	}
	if err := VerifyOwnedProcess(record, expected); err != nil {
		if errors.Is(err, ErrProcessGone) {
			return nil
		}
		return err
	}
	return terminateExactProcess(record)
}

// processRecordLive asks whether the recorded process lifetime still exists,
// not whether its executable still authorizes termination. An exec or Linux's
// "(deleted)" executable suffix does not end that lifetime. Only disappearance
// or a positively different start identity makes the record stale; inaccessible
// or changing identities fail closed.
func processRecordLive(record devcontract.ProcessIdentity) (bool, error) {
	if err := validateOwnedRecord(record, ownerOf(record)); err != nil {
		return false, err
	}
	start, _, err := inspectProcess(record.PID)
	if errors.Is(err, ErrProcessGone) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return start == record.StartIdentity, nil
}
