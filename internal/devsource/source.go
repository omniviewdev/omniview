// Package devsource verifies local development SDK source identities without
// importing native, plugin-process, profile or workspace orchestration packages.
package devsource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Identity struct {
	Directory    string
	Revision     string
	SourceDigest string
}

var fullRevision = regexp.MustCompile(`^([0-9a-f]{40}|[0-9a-f]{64})$`)

func command(ctx context.Context, dir string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
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

// Verify identifies the selected checkout by its HEAD and dirty source digest.
// This local-builder identity is not a sandbox or proof of a binary's source.
func Verify(ctx context.Context, directory string) (Identity, error) {
	var identity Identity
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
	raw, err = command(ctx, canonical, "rev-parse", "HEAD")
	if err != nil {
		return identity, err
	}
	revision := strings.TrimSpace(string(raw))
	if !fullRevision.MatchString(revision) {
		return identity, errors.New("selected SDK HEAD must be a full lowercase commit hash")
	}
	digest, err := sourceDigest(ctx, canonical)
	if err != nil {
		return identity, err
	}
	return Identity{Directory: canonical, Revision: revision, SourceDigest: digest}, nil
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
