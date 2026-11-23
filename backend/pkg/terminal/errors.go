package terminal

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/shellenv"
)

// The error types a terminal call can answer with, beside the host's own (`omniview:session/not-found`
// for a session that is not there, `omniview:validation` for a value that is out of range,
// `omniview:resource/conflict` for an id in use). A caller branches on `type` or `code`, never on
// the text.
const (
	// TypeInputBacklog (code INPUT_BACKLOG, 429): the session holds as much input as it may; the
	// operation was not applied and may be sent again.
	TypeInputBacklog = "omniview:terminal/input-backlog"
	// TypeSequenceStale (code SEQUENCE_STALE, 409): the sequence number was already applied, or was
	// given up after GapWait; the operation was not applied.
	TypeSequenceStale = "omniview:terminal/sequence-stale"
	// TypeSequenceAhead (code SEQUENCE_AHEAD, 400): the sequence number is more than MaxSeqAhead past
	// the next expected one; the operation was not applied.
	TypeSequenceAhead = "omniview:terminal/sequence-ahead"
	// TypeShellUnavailable (code SHELL_UNAVAILABLE, 422): the shell is not installed.
	TypeShellUnavailable = "omniview:terminal/shell-unavailable"
	// TypeShellUnsupported (code SHELL_UNSUPPORTED, 422): the program is not a shell the host starts.
	TypeShellUnsupported = "omniview:terminal/shell-unsupported"
	// TypeStartFailed (code START_FAILED, 500): the pty or the process could not start.
	TypeStartFailed = "omniview:terminal/start-failed"
	// TypeUnsupported (code UNSUPPORTED, 501): this build cannot run local terminals (Windows).
	TypeUnsupported = "omniview:terminal/unsupported"
)

// The causes behind those errors, for errors.Is.
var (
	ErrInputBacklog  = errors.New("terminal input backlog is full")
	ErrSequenceStale = errors.New("terminal input sequence number is stale")
	ErrSequenceAhead = errors.New("terminal input sequence number is too far ahead")
	ErrUnsupported   = errors.New("terminal sessions are not supported on this platform")
	ErrIDInUse       = errors.New("terminal session id is in use")
	ErrInvalid       = errors.New("invalid terminal option")
)

func coded(err *apperror.AppError, code string) *apperror.AppError {
	err.Code = code
	return err
}

func backlogError() error {
	return coded(apperror.WrapWithDetail(ErrInputBacklog, TypeInputBacklog, http.StatusTooManyRequests,
		"Terminal input backlog",
		fmt.Sprintf("The terminal holds %d operations or %d bytes of input it has not applied yet. Send it again later.", MaxPendingOps, MaxPendingBytes)),
		"INPUT_BACKLOG")
}

func staleError(seq, next uint64) error {
	return coded(apperror.WrapWithDetail(ErrSequenceStale, TypeSequenceStale, http.StatusConflict,
		"Stale input sequence number",
		fmt.Sprintf("Sequence number %d was already applied or given up; the next expected is %d.", seq, next)),
		"SEQUENCE_STALE")
}

func aheadError(seq, next uint64) error {
	return coded(apperror.WrapWithDetail(ErrSequenceAhead, TypeSequenceAhead, http.StatusBadRequest,
		"Input sequence number too far ahead",
		fmt.Sprintf("Sequence number %d is more than %d past the next expected, %d.", seq, MaxSeqAhead, next)),
		"SEQUENCE_AHEAD")
}

func invalidError(detail string) error {
	return coded(apperror.WrapWithDetail(ErrInvalid, apperror.TypeValidation, http.StatusBadRequest, "Invalid terminal option", detail),
		"INVALID_REQUEST")
}

// IDInUse is the refusal of a session id that a session already has.
func IDInUse(id string) error {
	return coded(apperror.WrapWithDetail(ErrIDInUse, apperror.TypeResourceConflict, http.StatusConflict,
		"Session id in use", fmt.Sprintf("A terminal session with id %q exists.", id)),
		"ALREADY_EXISTS")
}

// maxShellDetail is the most bytes of the sentence of a shell refusal: the list in the problem has every path,
// and a sentence of three long paths must not make the runtime reject the whole problem (its limit is 4,096).
const maxShellDetail = 2048

// shellUnavailableError is the refusal of a shell that is not there, with the shells that were tried, one entry
// each, as tokens: the problem a caller reads, plus the list, so that it draws one path to a line in its own
// words without reading the sentence. Its text is the problem as JSON, as AppError's is, so that the list
// crosses the binding with it.
type shellUnavailableError struct {
	*apperror.AppError
	Tried []shellenv.Attempt `json:"tried"`
}

func (p *shellUnavailableError) Error() string {
	encoded, err := json.Marshal(p)
	if err != nil {
		return p.AppError.Error()
	}
	return string(encoded)
}

func (p *shellUnavailableError) Unwrap() error { return p.AppError }

// shellError types the refusal of shellenv.Resolve. Any other error is a failure to resolve, and it
// stays what it was.
func shellError(err error) error {
	switch {
	case errors.Is(err, shellenv.ErrUnavailable):
		problem := coded(apperror.WrapWithDetail(err, TypeShellUnavailable, http.StatusUnprocessableEntity, "Shell not found", shellenv.Bound(err.Error(), maxShellDetail)),
			"SHELL_UNAVAILABLE")
		var unavailable *shellenv.UnavailableError
		if errors.As(err, &unavailable) {
			return &shellUnavailableError{AppError: problem, Tried: unavailable.Tried}
		}
		return problem
	case errors.Is(err, shellenv.ErrUnsupported):
		return coded(apperror.WrapWithDetail(err, TypeShellUnsupported, http.StatusUnprocessableEntity, "Unsupported shell", err.Error()),
			"SHELL_UNSUPPORTED")
	default:
		return coded(apperror.Wrap(err, TypeStartFailed, http.StatusInternalServerError, "Failed to start terminal"), "START_FAILED")
	}
}

func startError(err error) error {
	return coded(apperror.Wrap(err, TypeStartFailed, http.StatusInternalServerError, "Failed to start terminal"), "START_FAILED")
}

// resolveSize reads the size of a new terminal. Zero is "not given" and becomes the default; a value
// below zero or over MaxDimension is refused, naming the field.
func resolveSize(cols, rows int) (uint16, uint16, error) {
	c, err := dimension("cols", cols, DefaultCols)
	if err != nil {
		return 0, 0, err
	}
	r, err := dimension("rows", rows, DefaultRows)
	if err != nil {
		return 0, 0, err
	}
	return c, r, nil
}

func dimension(name string, value, def int) (uint16, error) {
	switch {
	case value == 0:
		return uint16(def), nil //nolint:gosec // The default is a constant far below the size of a uint16.
	case value < 0 || value > MaxDimension:
		return 0, invalidError(fmt.Sprintf("%s must be between 1 and %d (0 for the default %d); got %d.", name, MaxDimension, def, value))
	}
	return uint16(value), nil
}

// checkSize reads the size of a resize. A resize names both numbers, so zero is not a size.
func checkSize(rows, cols int) (uint16, uint16, error) {
	for _, d := range []struct {
		name  string
		value int
	}{{"rows", rows}, {"cols", cols}} {
		if d.value < 1 || d.value > MaxDimension {
			return 0, 0, invalidError(fmt.Sprintf("%s must be between 1 and %d; got %d.", d.name, MaxDimension, d.value))
		}
	}
	return uint16(rows), uint16(cols), nil //nolint:gosec // Both are between 1 and MaxDimension, checked above.
}
