package devsession

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// EnsurePrivateDirectory creates/canonicalizes a dedicated private runtime
// directory and applies the platform's owner-only permissions. Callers choose
// the development root explicitly; this does not infer workspace identity.
func EnsurePrivateDirectory(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("%w: private directory is required", ErrOwnership)
	}
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(canonical, 0700); err != nil {
		return "", err
	}
	info, err := os.Lstat(canonical)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("%w: runtime root must be a directory", ErrOwnership)
	}
	if err := restrictPrivatePath(canonical, true); err != nil {
		return "", err
	}
	return canonical, nil
}

// ValidatePrivateFile rejects symlinks, nonregular files, foreign owners and
// permissions/ACLs that allow other principals. It does not repair/adopt files.
// This is a point-in-time pathname check, not a retained file handle: appenders
// must bind validation to their opened handle (SameFile/no-follow checks) and
// keep their own serialization. Initialize a new log with WritePrivateFile.
func ValidatePrivateFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%w: runtime file is not a regular file", ErrOwnership)
	}
	return checkPrivatePath(path, info)
}

// ReadPrivateJSON decodes one complete private JSON document. Workspace and
// generation checks remain the consuming record's responsibility. Unknown
// fields and trailing documents are rejected rather than silently discarded.
func ReadPrivateJSON(path string, value any) error {
	if err := ValidatePrivateFile(path); err != nil {
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("decode private runtime file: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("%w: trailing content in runtime file", ErrOwnership)
	}
	return nil
}

// WritePrivateJSON atomically publishes json.Encoder bytes, including its final
// newline, with platform-private ownership/permissions. Ensure the dedicated
// parent directory first. Existing public/foreign/nonregular files are rejected.
// This writes one file; callers own generation checks and multi-file locking.
func WritePrivateJSON(path string, value any) error {
	return atomicPrivateWrite(path, func(file *os.File) error { return json.NewEncoder(file).Encode(value) })
}

// WritePrivateFile atomically publishes exact raw bytes, without JSON encoding
// or stdout output. Use for supervisor/MCP secret files and initial empty logs;
// appending remains the owner's retained-handle responsibility. Ensure the
// dedicated private parent directory first.
func WritePrivateFile(path string, content []byte) error {
	return atomicPrivateWrite(path, func(file *os.File) error { _, err := file.Write(content); return err })
}
