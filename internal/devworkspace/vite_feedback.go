package devworkspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

const viteFeedbackEnvironment = "OMNIVIEW_VITE_FEEDBACK"
const viteFeedbackMaximumBytes = 64 * 1024

type viteFeedbackContext struct {
	SchemaVersion int                    `json:"schemaVersion"`
	WorkspaceID   string                 `json:"workspaceID"`
	Generation    string                 `json:"generation"`
	WorkspaceRoot string                 `json:"workspaceRoot"`
	File          string                 `json:"file"`
	Authority     *viteFeedbackAuthority `json:"authority,omitempty"`
}

type viteFeedbackState struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceID   string `json:"workspaceID"`
	Generation    string `json:"generation"`
	WorkspaceRoot string `json:"workspaceRoot"`
	Held          bool   `json:"held"`
}

// feedbackMu serializes creation, validation, durable transitions and closure.
// The file is never renamed or unlinked: all Vite generations retain its inode,
// and shutdown must never delete metadata installed by a different owner.
type viteFeedback struct {
	context     viteFeedbackContext
	environment string
	file        *os.File
	syncFile    func(*os.File) error
	identity    viteFeedbackFileIdentity
	runtime     os.FileInfo
	source      os.FileInfo
	held        []byte
	released    []byte
	// current is the exact known physical after-image, including partial owner
	// writes. pending remains true until that after-image has really synced.
	current     []byte
	publication []byte
	pending     bool
	scratch     []byte
	hostPending bool
}

func feedbackConflict(message string) error {
	return devcontract.Fail(4, "vite_feedback_conflict", message)
}

func (s *workspaceSupervisor) feedbackPath() (string, error) {
	if err := devcontract.ValidateDefaultProfileOwnership(s.manager.options.Home, s.workspace.Manifest.WorkspaceID); err != nil {
		return "", err
	}
	profile, err := profileFor(s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return "", err
	}
	if profile.Workspace == nil || profile.Workspace.Root != s.workspace.Root || profile.Descriptor.WorkspaceID != s.workspace.Manifest.WorkspaceID || profile.Descriptor.Generation != s.generation {
		return "", feedbackConflict("feedback profile differs from the owned workspace")
	}
	return filepath.Join(profile.RuntimeRoot, "vite-feedback-"+s.generation+".json"), nil
}

func (s *workspaceSupervisor) createFeedbackLocked(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.feedbackPath()
	if err != nil {
		return err
	}
	directory := filepath.Dir(path)
	canonical, err := devcontract.CanonicalPath(directory)
	if err != nil {
		return err
	}
	if canonical != directory {
		return feedbackConflict("feedback runtime directory is redirected")
	}
	if _, err := os.Lstat(directory); err == nil {
		if err := devsession.ValidatePrivateDirectory(directory); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	} else if _, err := devsession.EnsurePrivateDirectory(directory); err != nil {
		return err
	}
	runtimeInfo, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	source, err := os.Lstat(s.workspace.Root)
	if err != nil {
		return err
	}
	if !source.IsDir() || source.Mode()&os.ModeSymlink != 0 {
		return feedbackConflict("feedback source is not the canonical workspace directory")
	}
	config := viteFeedbackContext{SchemaVersion: 1, WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, WorkspaceRoot: s.workspace.Root, File: path}
	state := viteFeedbackState{SchemaVersion: 1, WorkspaceID: config.WorkspaceID, Generation: config.Generation, WorkspaceRoot: config.WorkspaceRoot, Held: true}
	held, err := json.Marshal(state)
	if err != nil {
		return err
	}
	state.Held = false
	released, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if len(held) > viteFeedbackMaximumBytes || len(released) > viteFeedbackMaximumBytes {
		return feedbackConflict("feedback context exceeds the bounded state size")
	}
	// Exclusive creation also refuses a symlink leaf. No file, even one carrying
	// identical JSON, authorizes adopting a previous or unknown owner's inode.
	file, err := createFeedbackFile(path)
	if err != nil {
		return err
	}
	buffers := make([]byte, 2*len(released))
	feedback := &viteFeedback{context: config, file: file, syncFile: (*os.File).Sync, runtime: runtimeInfo, source: source, held: held, released: released, scratch: buffers[:len(released)], publication: buffers[len(released):], hostPending: true}
	// Retain partial creation failures for the same owned cleanup path.
	s.feedback = feedback
	if runtime.GOOS != "windows" {
		if err := file.Chmod(0600); err != nil {
			return err
		}
	}
	identity, err := feedbackFileIdentity(file)
	if err != nil {
		return err
	}
	feedback.identity = identity
	executable, err := canonicalFeedbackExecutable()
	if err != nil {
		return err
	}
	config.Authority = &viteFeedbackAuthority{Executable: executable, Identity: identity}
	encoded, err := json.Marshal(config)
	if err != nil {
		return err
	}
	if len(encoded) > viteFeedbackMaximumBytes {
		return feedbackConflict("feedback authority context exceeds its bounded size")
	}
	feedback.context = config
	feedback.environment = viteFeedbackEnvironment + "=" + string(encoded)
	if err := s.writeFeedbackLocked(ctx, true); err != nil {
		return err
	}
	return syncFeedbackParent(directory)
}

func (s *workspaceSupervisor) validateFeedbackLocked() error {
	feedback := s.feedback
	if feedback == nil || feedback.file == nil {
		return feedbackConflict("owned feedback file handle is unavailable")
	}
	path, err := s.feedbackPath()
	if err != nil {
		return err
	}
	if path != feedback.context.File || s.workspace.Root != feedback.context.WorkspaceRoot || s.workspace.Manifest.WorkspaceID != feedback.context.WorkspaceID || s.generation != feedback.context.Generation {
		return feedbackConflict("feedback ownership context changed")
	}
	directory := filepath.Dir(path)
	if err := devsession.ValidatePrivateDirectory(directory); err != nil {
		return err
	}
	runtimeInfo, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	source, err := os.Lstat(s.workspace.Root)
	if err != nil {
		return err
	}
	if !os.SameFile(runtimeInfo, feedback.runtime) || !os.SameFile(source, feedback.source) || !source.IsDir() || source.Mode()&os.ModeSymlink != 0 {
		return feedbackConflict("feedback runtime or workspace directory identity changed")
	}
	if err := devsession.ValidatePrivateFile(path); err != nil {
		return err
	}
	current, err := os.Lstat(path)
	if err != nil {
		return err
	}
	opened, err := feedback.file.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(current, opened) || (runtime.GOOS != "windows" && opened.Mode().Perm() != 0600) || opened.Size() != int64(len(feedback.current)) {
		return feedbackConflict("feedback inode, permissions or size changed")
	}
	if runtime.GOOS == "windows" {
		identity, err := feedbackFileIdentity(feedback.file)
		if err != nil {
			return err
		}
		if identity != feedback.identity {
			return feedbackConflict("feedback full file identity changed")
		}
		if feedback.context.Authority == nil || feedback.context.Authority.Identity != identity {
			return feedbackConflict("feedback native authority identity changed")
		}
		if err := verifyFeedbackAuthorityPath(path, identity); err != nil {
			return err
		}
	}
	actual := feedback.scratch[:len(feedback.current)]
	if len(actual) != 0 {
		if _, err := feedback.file.ReadAt(actual, 0); err != nil {
			return err
		}
	}
	if !bytes.Equal(actual, feedback.current) {
		return feedbackConflict("feedback content changed outside its owner")
	}
	return nil
}

func (s *workspaceSupervisor) writeFeedbackLocked(ctx context.Context, held bool) error {
	err := s.publishFeedbackLocked(ctx, held)
	if err != nil && !held {
		// A failed release may already have made false bytes visible. Restore
		// held bytes through the same ownership checks even if the caller was
		// canceled; a failed restorative flush remains an explicit obligation.
		return errors.Join(err, s.publishFeedbackLocked(context.Background(), true))
	}
	return err
}

func (s *workspaceSupervisor) publishFeedbackLocked(ctx context.Context, held bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.validateFeedbackLocked(); err != nil {
		return err
	}
	feedback := s.feedback
	content := feedback.released
	if held {
		content = feedback.held
	}
	if !bytes.Equal(feedback.current, content) {
		n, err := feedback.file.WriteAt(content, 0)
		if n > 0 {
			// Track only bytes this retained owner actually wrote. Preserve the
			// known old suffix until truncation succeeds; never read/adopt an
			// unexpected after-image as a retry authorization.
			length := max(len(feedback.current), n)
			copy(feedback.publication[:n], content[:n])
			feedback.current = feedback.publication[:length]
			feedback.pending = true
		}
		if err != nil {
			return err
		}
		if n != len(content) {
			return io.ErrShortWrite
		}
		if len(feedback.current) != len(content) {
			if err := feedback.file.Truncate(int64(len(content))); err != nil {
				// Some platforms may report failure after changing the size.
				// Both possible owner-requested sizes contain known bytes.
				if info, statErr := feedback.file.Stat(); statErr == nil && info.Size() == int64(len(content)) {
					feedback.current = feedback.publication[:len(content)]
				}
				return err
			}
			feedback.current = feedback.publication[:len(content)]
		}
	}
	if !feedback.pending {
		return nil
	}
	if err := feedback.syncFile(feedback.file); err != nil {
		return err
	}
	feedback.pending = false
	return s.validateFeedbackLocked()
}

func feedbackReplacesHost(change WatchChange) bool {
	for _, node := range change.Nodes {
		if node == "host-backend" {
			return true
		}
	}
	return false
}

func feedbackRestartsConsumers(change WatchChange) bool {
	if change.RuntimeChanged {
		return true
	}
	for _, node := range change.Nodes {
		switch node {
		case "base-ui", "ai-ui", "editors", "runtime", "vite-plugin":
			return true
		}
	}
	return false
}

func (s *workspaceSupervisor) beginFeedback(ctx context.Context, change WatchChange) error {
	host := feedbackReplacesHost(change)
	if !host && !feedbackRestartsConsumers(change) {
		return nil
	}
	s.feedbackMu.Lock()
	defer s.feedbackMu.Unlock()
	if s.feedback == nil {
		if err := s.createFeedbackLocked(ctx); err != nil {
			return err
		}
		// A watch-only fixture has no initial bootstrap obligation. The initial
		// launch explicitly begins with a host-backend transaction instead.
		s.feedback.hostPending = host
	}
	if host {
		s.feedback.hostPending = true
	}
	return s.writeFeedbackLocked(ctx, true)
}

func (s *workspaceSupervisor) commitFeedback(ctx context.Context, change WatchChange) error {
	s.feedbackMu.Lock()
	defer s.feedbackMu.Unlock()
	if !feedbackReplacesHost(change) && !feedbackRestartsConsumers(change) {
		if s.feedback == nil || !s.feedback.hostPending {
			s.setPhase("ready", nil)
		}
		return nil
	}
	if s.feedback == nil {
		return feedbackConflict("feedback transaction has no owned barrier")
	}
	if s.feedback.hostPending && !feedbackReplacesHost(change) {
		return s.validateFeedbackLocked()
	}
	if err := s.writeFeedbackLocked(ctx, false); err != nil {
		return err
	}
	s.feedback.hostPending = false
	s.setPhase("ready", nil)
	return nil
}

func (s *workspaceSupervisor) checkFeedback() error {
	s.feedbackMu.Lock()
	defer s.feedbackMu.Unlock()
	if s.feedback == nil {
		return nil
	}
	return s.validateFeedbackLocked()
}

func (s *workspaceSupervisor) holdExistingFeedback(ctx context.Context) (integrityErr, writeErr error) {
	s.feedbackMu.Lock()
	defer s.feedbackMu.Unlock()
	if s.feedback == nil || s.feedback.file == nil {
		return nil, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.validateFeedbackLocked(); err != nil {
		// A stronger Go ownership check need not fence Node. The caller must
		// retire exact-owned feedback consumers before any backend teardown.
		return err, nil
	}
	s.feedback.hostPending = true
	// A failed write could leave the previous valid released state intact.
	// Retain all process ownership until that hold can actually be published.
	return nil, s.writeFeedbackLocked(ctx, true)
}

func (s *workspaceSupervisor) retireUnfencedFeedbackConsumers(ctx context.Context) error {
	// Close the process-start gate and retire every exact-owned plugin Node
	// consumer before any RPC/backend shutdown can make its origin unavailable.
	managedErr := s.stopManagedProcesses(ctx)
	s.mu.Lock()
	vite := s.children["vite"]
	s.mu.Unlock()
	var viteErr error
	if vite != nil {
		viteErr = vite.stop(ctx)
	}
	return errors.Join(managedErr, viteErr)
}

func (s *workspaceSupervisor) closeFeedback() error {
	s.feedbackMu.Lock()
	defer s.feedbackMu.Unlock()
	if s.feedback == nil || s.feedback.file == nil {
		return nil
	}
	if err := s.feedback.file.Close(); err != nil {
		return fmt.Errorf("close owned Vite feedback handle: %w", err)
	}
	s.feedback.file = nil
	return nil
}
