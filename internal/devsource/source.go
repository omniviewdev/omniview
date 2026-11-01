// Package devsource verifies local development SDK source identities without
// importing native, plugin-process, profile or workspace orchestration packages.
package devsource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type Identity struct {
	Directory        string
	ReviewedRevision string
	SourceDigest     string
}

type VerifyOptions struct {
	// Explicit per-workspace developer opt-in; never infer this from dirty files.
	AllowIsolationCoreChanges bool
}

var fullRevision = regexp.MustCompile(`^([0-9a-f]{40}|[0-9a-f]{64})$`)

// Isolation-boundary changes need deliberate per-workspace developer consent,
// not a source-text heuristic or imported plugin metadata assertion.
var protectedFiles = []string{"pkg/state/root.go", "pkg/state/custom.go", "pkg/profilecontract/profile.go", "pkg/utils/store.go", "pkg/sdk/plugin.go"}

func command(ctx context.Context, dir string, args ...string) ([]byte, error) {
	return commandWithInput(ctx, dir, nil, args...)
}

func commandWithInput(ctx context.Context, dir string, input io.Reader, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Stdin = input
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "GOWORK", "GOFLAGS", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "GOWORK=off", "GOFLAGS=")
	raw, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("selected SDK source verification failed (%s): %w", args[0], err)
	}
	return raw, nil
}

// Read the same pinned blobs in one Git process. This is observation-local:
// every verification still checks ancestry, protected live bytes and source.
func reviewedSources(ctx context.Context, directory, revision string) ([][]byte, error) {
	var requests strings.Builder
	for _, relative := range protectedFiles {
		fmt.Fprintf(&requests, "%s:%s\n", revision, relative)
	}
	raw, err := commandWithInput(ctx, directory, strings.NewReader(requests.String()), "cat-file", "--batch")
	if err != nil {
		return nil, err
	}
	return parseReviewedSources(raw)
}

// Batch bodies are length-framed, not line-framed: source may contain any
// bytes, including newlines, NULs and text that resembles another header.
func parseReviewedSources(raw []byte) ([][]byte, error) {
	files := make([][]byte, 0, len(protectedFiles))
	for _, relative := range protectedFiles {
		end := bytes.IndexByte(raw, '\n')
		if end < 0 {
			return nil, fmt.Errorf("reviewed SDK baseline is incomplete: %s", relative)
		}
		header := strings.Fields(string(raw[:end]))
		if len(header) != 3 || !fullRevision.MatchString(header[0]) || header[1] != "blob" {
			return nil, fmt.Errorf("reviewed SDK baseline is not a source blob: %s", relative)
		}
		size, err := strconv.ParseUint(header[2], 10, 64)
		raw = raw[end+1:]
		if err != nil || size >= uint64(len(raw)) || raw[size] != '\n' {
			return nil, fmt.Errorf("reviewed SDK baseline has an invalid blob body: %s", relative)
		}
		files = append(files, raw[:size])
		raw = raw[size+1:]
	}
	if len(raw) != 0 {
		return nil, fmt.Errorf("reviewed SDK baseline has unexpected trailing output")
	}
	return files, nil
}

// Verify anchors the selected local source in a reviewed fixed-capability
// commit, verifies isolation-boundary bytes, and binds the actual current dirty
// tracked/untracked nonignored source tree. This trusted local-builder identity
// is not a sandbox and is not proof that an arbitrary binary used this source.
func Verify(ctx context.Context, directory, reviewedRevision string) (Identity, error) {
	return VerifyWithOptions(ctx, directory, reviewedRevision, VerifyOptions{})
}

func VerifyWithOptions(ctx context.Context, directory, reviewedRevision string, opts VerifyOptions) (Identity, error) {
	var identity Identity
	if !fullRevision.MatchString(reviewedRevision) {
		return identity, fmt.Errorf("an independently reviewed full SDK commit is required")
	}
	if !filepath.IsAbs(directory) {
		return identity, fmt.Errorf("selected SDK directory must be absolute")
	}
	canonical, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return identity, err
	}
	if canonical != filepath.Clean(directory) {
		return identity, fmt.Errorf("selected SDK directory cannot be a redirected alias")
	}
	raw, err := command(ctx, canonical, "rev-parse", "--show-toplevel")
	if err != nil {
		return identity, err
	}
	top, err := filepath.EvalSymlinks(strings.TrimSpace(string(raw)))
	if err != nil {
		return identity, err
	}
	if top != canonical {
		return identity, fmt.Errorf("selected SDK must be the explicitly owned source repository root")
	}
	raw, err = command(ctx, canonical, "cat-file", "-t", reviewedRevision)
	if err != nil {
		return identity, err
	}
	if strings.TrimSpace(string(raw)) != "commit" {
		return identity, fmt.Errorf("reviewed SDK identity must name a commit")
	}
	if _, err = command(ctx, canonical, "merge-base", "--is-ancestor", reviewedRevision, "HEAD"); err != nil {
		return identity, fmt.Errorf("selected SDK does not descend from the reviewed fixed-capability baseline: %w", err)
	}
	if !opts.AllowIsolationCoreChanges {
		baselines, err := reviewedSources(ctx, canonical, reviewedRevision)
		if err != nil {
			return identity, err
		}
		for index, relative := range protectedFiles {
			baseline := baselines[index]
			file := filepath.Join(canonical, filepath.FromSlash(relative))
			info, err := os.Lstat(file)
			if err != nil {
				return identity, err
			}
			if !info.Mode().IsRegular() {
				return identity, fmt.Errorf("reviewed SDK isolation implementation is not a regular file: %s", relative)
			}
			current, err := os.ReadFile(file)
			if err != nil {
				return identity, err
			}
			if !bytes.Equal(current, baseline) {
				return identity, fmt.Errorf("SDK isolation-boundary source differs from reviewed baseline: %s; explicitly select --allow-isolation-source-changes for this workspace to develop isolation code", relative)
			}
		}
	}
	digest, err := sourceDigest(ctx, canonical)
	if err != nil {
		return identity, err
	}
	return Identity{Directory: canonical, ReviewedRevision: reviewedRevision, SourceDigest: digest}, nil
}

func sourceDigest(ctx context.Context, directory string) (string, error) {
	raw, err := command(ctx, directory, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
	if err != nil {
		return "", err
	}
	names := strings.Split(string(raw), "\x00")
	sort.Strings(names)
	hash := sha256.New()
	_, _ = io.WriteString(hash, "omniview-sdk-source-v1\x00")
	previous := ""
	var buffer []byte
	var source struct{ io.Reader }
	for _, relative := range names {
		if err = ctx.Err(); err != nil {
			return "", err
		}
		if relative == "" || relative == previous {
			continue
		}
		previous = relative
		clean := filepath.Clean(filepath.FromSlash(relative))
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return "", fmt.Errorf("SDK source list escapes the selected directory")
		}
		skip := false
		for _, part := range strings.Split(filepath.ToSlash(clean), "/") {
			switch part {
			case ".git", ".local", "node_modules":
				skip = true
			}
		}
		if skip {
			continue
		}
		file := filepath.Join(directory, clean)
		info, err := os.Lstat(file)
		if os.IsNotExist(err) {
			_, _ = fmt.Fprintf(hash, "deleted\x00%s\x00", filepath.ToSlash(clean))
			continue
		}
		if err != nil {
			return "", err
		}
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("SDK source snapshot rejects symlinks/special files: %s", relative)
		}
		_, _ = fmt.Fprintf(hash, "file\x00%s\x00%o\x00%d\x00", filepath.ToSlash(clean), info.Mode().Perm(), info.Size())
		stream, err := os.Open(file)
		if err != nil {
			return "", err
		}
		if buffer == nil {
			buffer = make([]byte, 32*1024)
		}
		// Hide os.File.WriteTo so CopyBuffer uses this observation's scratch.
		source.Reader = stream
		_, copyErr := io.CopyBuffer(hash, &source, buffer)
		source.Reader = nil
		closeErr := stream.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		after, err := os.Lstat(file)
		if err != nil {
			return "", err
		}
		if !os.SameFile(info, after) || info.Size() != after.Size() || info.ModTime() != after.ModTime() {
			return "", fmt.Errorf("SDK source changed while its identity was being computed")
		}
		_, _ = io.WriteString(hash, "\x00")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
