package gateway

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/omniviewdev/omniview/internal/devsession"
)

// ErrCredentialFileExists reports that the credential's file is already there.
// A credential's file is written once and never replaced.
var ErrCredentialFileExists = errors.New("gateway: credential file already exists")

// FileChannel delivers a credential's secret to a new private file. It is the
// [SecretChannel] the CLI uses: the secret goes to a 0600 file in a private
// directory and nowhere else (not stdout, not argv, not a log).
type FileChannel struct {
	dir string

	mu sync.Mutex
	// delivered maps every credential this channel wrote to its file, so that
	// Discard can remove any of them and not only the last.
	delivered map[string]string
	path      string
}

// NewFileChannel returns a channel that writes into dir. dir must already be a
// private directory of the current user (see devsession.EnsurePrivateDirectory)
// that is not redirected through a link. It is not created or repaired here.
//
// It also checks that dir supports hard links, which publishing a credential
// file depends on, so that a directory that cannot is found here and not by
// the first exchange, after its pairing code was spent.
func NewFileChannel(dir string) (*FileChannel, error) {
	if err := devsession.ValidatePrivateDirectory(dir); err != nil {
		return nil, fmt.Errorf("credential directory is not private: %w", err)
	}
	if err := probeHardLinks(dir); err != nil {
		return nil, err
	}
	return &FileChannel{dir: dir, mu: sync.Mutex{}, delivered: make(map[string]string), path: ""}, nil
}

// probeHardLinks creates a file in dir, links it under a second name and
// removes both.
func probeHardLinks(dir string) error {
	suffix, err := randomHex(idBytes)
	if err != nil {
		return err
	}
	probe := filepath.Join(dir, ".audit-probe-"+suffix)
	if err = devsession.WritePrivateFile(probe, []byte("probe")); err != nil {
		return fmt.Errorf("credential directory is not writable: %w", err)
	}
	link := probe + ".link"
	linkErr := os.Link(probe, link)
	removeErr := os.Remove(probe)
	if linkErr == nil {
		removeErr = errors.Join(removeErr, os.Remove(link))
	}
	if linkErr != nil {
		return fmt.Errorf("credential directory does not support hard links: %w", linkErr)
	}
	if removeErr != nil {
		return fmt.Errorf("remove the credential directory's probe files: %w", removeErr)
	}
	return nil
}

// Deliver writes the secret, and nothing else, to
// "audit-<audit ID>-<credential ID>.secret" in the channel's directory.
func (c *FileChannel) Deliver(ctx context.Context, credential IssuedCredential) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := WriteCredentialFile(c.dir, credential)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.delivered[credential.CredentialID] = path
	c.path = path
	c.mu.Unlock()
	return nil
}

// Discard removes the file Deliver wrote for credentialID, if any. It leaves
// the files of other credentials alone.
func (c *FileChannel) Discard(_ context.Context, credentialID string) {
	c.mu.Lock()
	path := c.delivered[credentialID]
	delete(c.delivered, credentialID)
	c.mu.Unlock()
	if path != "" {
		_ = os.Remove(path)
	}
}

// Path is the file the credential was written to, or "" before delivery.
func (c *FileChannel) Path() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.path
}

// credentialFileName names a credential's file. Both IDs are validated hex, so
// the name is one safe path element.
func credentialFileName(credential IssuedCredential) (string, error) {
	if !validHexID(credential.AuditID) || !validHexID(credential.CredentialID) {
		return "", errors.New("gateway: credential IDs are not valid file name parts")
	}
	return "audit-" + credential.AuditID + "-" + credential.CredentialID + ".secret", nil
}

func validHexID(s string) bool {
	return s != "" && len(s) <= 2*maxIDHexBytes && allBytes([]byte(s), isLowerHex)
}

const maxIDHexBytes = 32

// WriteCredentialFile writes a credential's secret to a new file in dir and
// returns its path.
//
// dir must be a private directory (0700 and owned by the current user, or the
// platform's equivalent). The file is created exclusively, with owner-only
// permissions, through the same private-file primitives the control and
// supervisor token files use, and contains the secret alone, with no newline,
// so its content is exactly the password to paste. An existing file is never
// replaced: it fails with [ErrCredentialFileExists]. Deleting the file later
// does not erase copies already made.
func WriteCredentialFile(dir string, credential IssuedCredential) (string, error) {
	if len(credential.Secret) != secretLength {
		return "", errors.New("gateway: credential secret has the wrong length")
	}
	name, err := credentialFileName(credential)
	if err != nil {
		return "", err
	}
	if err = devsession.ValidatePrivateDirectory(dir); err != nil {
		return "", fmt.Errorf("credential directory is not private: %w", err)
	}
	path := filepath.Join(dir, name)

	// Write the secret to a private temporary file first, then link it to its
	// final name. Linking fails if the name exists, which makes publication
	// exclusive and atomic: the final path never holds a partial file.
	suffix, err := randomHex(idBytes)
	if err != nil {
		return "", err
	}
	temporary := filepath.Join(dir, ".audit-credential-"+suffix+".tmp")
	if err = devsession.WritePrivateFile(temporary, credential.Secret); err != nil {
		return "", err
	}
	if err = os.Link(temporary, path); err != nil {
		_ = os.Remove(temporary)
		if errors.Is(err, fs.ErrExist) {
			return "", ErrCredentialFileExists
		}
		return "", fmt.Errorf("publish credential file: %w", err)
	}
	// The secret is now under two names. If the temporary one cannot be
	// removed, say so and take the published one away again, so that the
	// caller does not believe in a delivery that left a copy behind.
	if err = os.Remove(temporary); err != nil && !errors.Is(err, fs.ErrNotExist) {
		_ = os.Remove(path)
		return "", fmt.Errorf("remove the temporary credential file: %w", err)
	}
	if err = devsession.ValidatePrivateFile(path); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}
