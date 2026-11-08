package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
)

// RuntimeHealth keeps independent observations independent. Unknown never means ready.
type RuntimeHealth struct {
	Liveness     string `json:"liveness"`
	Build        string `json:"build"`
	Dependencies string `json:"dependencies"`
	// ServedSource remains unknown without an artifact-to-source attestation.
	ServedSource       string `json:"servedSource"`
	CheckoutSinceReady string `json:"checkoutSinceReady"`
	Readiness          string `json:"readiness"`
	HMR                string `json:"hmr"`
	SourceReload       string `json:"sourceReload"`
}

// CheckoutStatus is a filesystem observation, not a served-source attestation.
type CheckoutStatus struct {
	Commit       string `json:"commit"`
	Branch       string `json:"branch,omitempty"`
	Dirty        bool   `json:"dirty"`
	SourceDigest string `json:"sourceDigest"`
	Error        string `json:"error,omitempty"`
}

func checkoutStatuses(ctx context.Context, w Workspace) map[string]CheckoutStatus {
	result := make(map[string]CheckoutStatus, len(w.Manifest.Repositories))
	for _, repository := range w.Manifest.Repositories {
		directory := filepath.Join(w.Root, repository.Directory)
		state, err := observeCheckout(ctx, directory)
		if err != nil {
			state.Error = "cannot inspect selected checkout"
		}
		result[repository.ID] = state
	}
	return result
}

func observeCheckout(ctx context.Context, directory string) (CheckoutStatus, error) {
	var state CheckoutStatus
	porcelain, err := git(ctx, directory, "", "status", "--porcelain=v2", "--branch", "--no-ahead-behind", "--untracked-files=all", "-z")
	if err != nil {
		return state, err
	}
	var changes, untracked []string
	records := strings.Split(porcelain, "\x00")
	for i := 0; i < len(records); i++ {
		record := records[i]
		switch {
		case strings.HasPrefix(record, "# branch.oid "):
			state.Commit = strings.TrimPrefix(record, "# branch.oid ")
		case strings.HasPrefix(record, "# branch.head "):
			state.Branch = strings.TrimPrefix(record, "# branch.head ")
			if state.Branch == "(detached)" {
				// This is also a legal branch name; resolve the rare ambiguity.
				state.Branch, err = git(ctx, directory, "", "branch", "--show-current")
				if err != nil {
					return state, err
				}
				state.Branch = strings.TrimSpace(state.Branch)
			}
		case record == "" || strings.HasPrefix(record, "# "):
			continue
		default:
			path, _, parseErr := parseGitStatusRecord(record)
			if parseErr != nil {
				return state, parseErr
			}
			state.Dirty = true
			changes = append(changes, record)
			if record[0] == '?' {
				untracked = append(untracked, path)
			}
			if record[0] == '2' {
				// A rename/copy has a second NUL-delimited original pathname,
				// which must never be parsed as a header or untracked entry.
				i++
				if i >= len(records) || records[i] == "" {
					return state, fmt.Errorf("incomplete checkout rename record")
				}
				changes = append(changes, records[i])
			}
		}
	}
	if state.Commit == "" || state.Commit == "(initial)" {
		return CheckoutStatus{}, fmt.Errorf("selected checkout has no HEAD commit")
	}
	diff, err := git(ctx, directory, "", "diff", "HEAD", "--binary", "--no-ext-diff")
	if err != nil {
		return state, err
	}
	hash := sha256.New()
	// Status records contain NULs. Length-frame segments so record boundaries
	// cannot be confused with the boundary before the binary diff.
	for _, part := range []string{"checkout-v2", state.Commit, strings.Join(changes, "\x00"), diff} {
		fmt.Fprintf(hash, "%d\x00", len(part))
		io.WriteString(hash, part)
	}
	sort.Strings(untracked)
	for _, name := range untracked {
		if err := hashUntrackedPath(ctx, hash, directory, name); err != nil {
			return state, err
		}
	}
	state.SourceDigest = hex.EncodeToString(hash.Sum(nil))
	return state, nil
}

// Hash links themselves and describe special files without opening their targets.
func hashUntrackedPath(ctx context.Context, hash io.Writer, directory, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path := filepath.Join(directory, name)
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	fmt.Fprintf(hash, "\x00%s\x00%s\x00", name, info.Mode().String())
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(path)
		if err != nil {
			return err
		}
		_, err = io.WriteString(hash, target)
		return err
	}
	if !info.Mode().IsRegular() {
		_, err = fmt.Fprintf(hash, "%d", info.Size())
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(hash, checkoutContextReader{ctx: ctx, reader: file})
	return err
}

type checkoutContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r checkoutContextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(buffer)
}

func (s *workspaceSupervisor) observeStatus(ctx context.Context, status Status) Status {
	status.Health = RuntimeHealth{Liveness: "alive", Build: "unknown", Dependencies: "unknown", ServedSource: "unknown", CheckoutSinceReady: "unknown", Readiness: "unknown", HMR: "unverified", SourceReload: "unverified"}
	status.Checkouts = checkoutStatuses(ctx, status.Workspace)
	if len(status.Builds) > 0 {
		status.Health.Build = "ready"
	}
	for node, build := range status.Builds {
		if build.Phase == "error" || build.Phase == "invalidated" {
			status.Health.Build = "failed"
			status.FailedStage = node
			status.RecoveryCommand = workspaceRecoveryCommand(status.Workspace, "refresh")
			break
		}
		if build.Phase == "building" {
			status.Health.Build = "building"
		}
	}
	if report, err := s.manager.InspectLinks(ctx, status.Manifest.WorkspaceID); err == nil && report.Phase == "linked" {
		status.Health.Dependencies = "current"
		for _, resolution := range report.Resolutions {
			if resolution.Problem != "" {
				status.Health.Dependencies = "stale"
			}
		}
	} else {
		status.Health.Dependencies = "stale"
	}
	if len(status.ReadyCheckouts) > 0 {
		status.Health.CheckoutSinceReady = "changed"
		if reflect.DeepEqual(status.Checkouts, status.ReadyCheckouts) {
			status.Health.CheckoutSinceReady = "unchanged"
		}
	}
	for _, checkout := range status.Checkouts {
		if checkout.Error != "" {
			status.Health.CheckoutSinceReady = "unknown"
		}
	}
	if status.Instance != nil {
		status.Health.Readiness = "authenticated"
	}
	for _, service := range status.Services {
		if service.Ready && service.HMR != "" {
			status.Health.HMR = "connected"
		}
	}
	return status
}
