package devworkspace

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type viteFeedbackFileIdentity struct {
	Volume string `json:"volume"`
	FileID string `json:"fileID"`
}

type viteFeedbackAuthority struct {
	Executable string                   `json:"executable"`
	Identity   viteFeedbackFileIdentity `json:"identity"`
}

func decodeFeedbackJSON(reader io.Reader, size int, value any) error {
	if size == 0 || size > viteFeedbackMaximumBytes {
		return feedbackConflict("feedback JSON exceeds its bounded size")
	}
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return feedbackConflict("feedback JSON has trailing content")
	}
	return nil
}

func canonicalFeedbackExecutable() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(executable)
}

func validateFeedbackReaderContext(config viteFeedbackContext) error {
	id, err := uuid.Parse(config.WorkspaceID)
	if config.SchemaVersion != 1 || err != nil || id == uuid.Nil || id.String() != config.WorkspaceID || config.Generation == "" || strings.ContainsAny(config.Generation, "/\\\x00") || config.Authority == nil {
		return feedbackConflict("invalid feedback authority context")
	}
	for _, path := range []string{config.WorkspaceRoot, config.File, config.Authority.Executable} {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return feedbackConflict("feedback authority paths must be canonical and absolute")
		}
		canonical, err := devcontract.CanonicalPath(path)
		if err != nil {
			return err
		}
		if canonical != path {
			return feedbackConflict("feedback authority path is redirected")
		}
	}
	source, err := os.Lstat(config.WorkspaceRoot)
	if err != nil {
		return err
	}
	if !source.IsDir() || source.Mode()&os.ModeSymlink != 0 {
		return feedbackConflict("feedback authority source is not a directory")
	}
	if err := devsession.ValidatePrivateDirectory(filepath.Dir(config.File)); err != nil {
		return err
	}
	executable, err := canonicalFeedbackExecutable()
	if err != nil {
		return err
	}
	if config.Authority.Executable != executable {
		return feedbackConflict("feedback authority executable differs from the current CLI")
	}
	identity := config.Authority.Identity
	volume, err := strconv.ParseUint(identity.Volume, 10, 64)
	if err != nil || strconv.FormatUint(volume, 10) != identity.Volume || len(identity.FileID) != 32 {
		return feedbackConflict("invalid full feedback filesystem identity")
	}
	for _, digit := range identity.FileID {
		if !(digit >= '0' && digit <= '9') && !(digit >= 'a' && digit <= 'f') {
			return feedbackConflict("invalid full feedback file identifier")
		}
	}
	return nil
}

func verifyFeedbackAuthorityPath(path string, expected viteFeedbackFileIdentity) error {
	file, err := openFeedbackAuthorityFile(path)
	if err != nil {
		return err
	}
	defer file.Close()
	identity, err := feedbackFileIdentity(file)
	if err != nil {
		return err
	}
	if identity != expected {
		return feedbackConflict("feedback path no longer names the captured full file identity")
	}
	return nil
}

// ReadViteFeedbackContext is the synchronous local authority used by managed
// Windows Vite children. It opens no network endpoint, performs no mutation and
// trusts only the captured explicit context and native retained-handle proof.
// Any failure must be treated as held by its caller.
func ReadViteFeedbackContext(encoded string) (bool, error) {
	var config viteFeedbackContext
	if err := decodeFeedbackJSON(strings.NewReader(encoded), len(encoded), &config); err != nil {
		return true, err
	}
	if err := validateFeedbackReaderContext(config); err != nil {
		return true, err
	}
	file, err := openFeedbackAuthorityFile(config.File)
	if err != nil {
		return true, err
	}
	defer file.Close()
	identity, err := feedbackFileIdentity(file)
	if err != nil {
		return true, err
	}
	if identity != config.Authority.Identity {
		return true, feedbackConflict("feedback handle differs from the captured full file identity")
	}
	info, err := file.Stat()
	if err != nil {
		return true, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > viteFeedbackMaximumBytes {
		return true, feedbackConflict("feedback state is not a bounded regular file")
	}
	data := make([]byte, int(info.Size()))
	if _, err := file.ReadAt(data, 0); err != nil {
		return true, err
	}
	var state struct {
		SchemaVersion int    `json:"schemaVersion"`
		WorkspaceID   string `json:"workspaceID"`
		Generation    string `json:"generation"`
		WorkspaceRoot string `json:"workspaceRoot"`
		Held          *bool  `json:"held"`
	}
	if err := decodeFeedbackJSON(bytes.NewReader(data), len(data), &state); err != nil {
		return true, err
	}
	if state.SchemaVersion != 1 || state.WorkspaceID != config.WorkspaceID || state.Generation != config.Generation || state.WorkspaceRoot != config.WorkspaceRoot || state.Held == nil {
		return true, feedbackConflict("feedback state differs from the captured authority context")
	}
	after, err := file.Stat()
	if err != nil {
		return true, err
	}
	if after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return true, feedbackConflict("feedback state changed during its authority read")
	}
	if err := verifyFeedbackAuthorityPath(config.File, identity); err != nil {
		return true, err
	}
	return *state.Held, nil
}
