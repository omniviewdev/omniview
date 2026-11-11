package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"debug/elf"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"golang.org/x/mod/semver"
)

const candidateArchiveName = "kubernetes-linux_amd64.tar.gz"
const candidateArchiveLimit int64 = 1 << 30
const candidateJSONLimit int64 = 1 << 20

var fullVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+].*)?$`)

var candidatePackages = []struct{ directory, name string }{
	{"omniviewdev-providers", "@omniviewdev/providers"},
	{"omniviewdev-runtime", "@omniviewdev/runtime"},
	{"omniviewdev-vite-plugin", "@omniviewdev/vite-plugin"},
}

type candidateCommits struct {
	Host       string `json:"host"`
	SDK        string `json:"sdk"`
	Kubernetes string `json:"kubernetes"`
}

type candidateStamp struct {
	Path          string `json:"path"`
	BeforeVersion string `json:"beforeVersion"`
	BeforeSHA256  string `json:"beforeSHA256"`
	AfterSHA256   string `json:"afterSHA256"`
	original      []byte
	stamped       []byte
	mode          os.FileMode
	absolute      string
}

type candidateReceipt struct {
	devworkspace.ArchivePluginStatus
	SchemaVersion      int              `json:"schemaVersion"`
	Platform           string           `json:"platform"`
	Commits            candidateCommits `json:"commits"`
	SDK                devsdk.Published `json:"sdk"`
	NPMVersion         string           `json:"npmVersion"`
	VersionTransform   string           `json:"versionTransform"`
	Packages           []candidateStamp `json:"packages"`
	LinkEvidenceSHA256 string           `json:"linkEvidenceSHA256"`
}

type candidateOutput struct {
	destination string
	stage       string
	version     string
	host        string
	commits     candidateCommits
	sdk         devsdk.Published
	stamps      []candidateStamp
	ready       bool
}

func newCandidateOutput(destination, version string, sources ...string) (*candidateOutput, error) {
	version = strings.TrimPrefix(version, "v")
	if !fullVersionPattern.MatchString(version) || !semver.IsValid("v"+version) {
		return nil, fmt.Errorf("candidate archive requires the full npm publication version")
	}
	parent := filepath.Dir(destination)
	canonical, err := filepath.EvalSymlinks(parent)
	if err != nil || !filepath.IsAbs(destination) || filepath.Clean(destination) != destination || canonical != parent {
		return nil, fmt.Errorf("archive output requires a canonical absolute new directory with an existing parent")
	}
	info, err := os.Stat(parent)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("archive output parent must be private (0700)")
	}
	for _, source := range sources {
		root, err := filepath.EvalSymlinks(source)
		if err != nil {
			return nil, err
		}
		relative, err := filepath.Rel(root, destination)
		if err != nil || relative == "." || relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("archive output must be outside caller source checkouts")
		}
	}
	if _, err = os.Lstat(destination); !os.IsNotExist(err) {
		return nil, fmt.Errorf("archive output already exists or cannot be inspected: %s", destination)
	}
	stage, err := os.MkdirTemp(parent, ".kubernetes-candidate-")
	if err != nil {
		return nil, err
	}
	return &candidateOutput{destination: destination, stage: stage, version: version}, nil
}

// finish runs after the workspace retirement defer. Failed builds or cleanup
// never expose a completed candidate directory to the artifact uploader.
func (c *candidateOutput) finish(resultErr *error) {
	if *resultErr == nil && !c.ready {
		*resultErr = fmt.Errorf("candidate archive producer did not produce its complete evidence")
	}
	if *resultErr == nil {
		if _, err := os.Lstat(c.destination); !os.IsNotExist(err) {
			*resultErr = fmt.Errorf("refusing to replace candidate output %s", c.destination)
		} else {
			*resultErr = os.Rename(c.stage, c.destination)
		}
	}
	if *resultErr != nil {
		*resultErr = errors.Join(*resultErr, os.RemoveAll(c.stage))
	}
}

func (c *candidateOutput) prepare(ctx context.Context, w devworkspace.Workspace, expected candidateCommits) error {
	for _, source := range []struct{ id, expected string }{{"omniview", expected.Host}, {"plugin-sdk", expected.SDK}, {"kubernetes", expected.Kubernetes}} {
		directory, err := w.RepositoryPath(source.id)
		if err != nil {
			return err
		}
		raw, err := candidateCommand(ctx, w, directory, "git", nil, "rev-parse", "HEAD")
		if err != nil {
			return err
		}
		observed := strings.TrimSpace(string(raw))
		if !fullCommit.MatchString(observed) || observed != source.expected {
			return fmt.Errorf("candidate %s checkout does not match its exact requested commit", source.id)
		}
	}
	c.commits = expected
	host, err := w.RepositoryPath("omniview")
	if err != nil {
		return err
	}
	c.host = host
	target, err := candidateCommand(ctx, w, host, "go", nil, "env", "-json", "GOOS", "GOARCH")
	if err != nil {
		return err
	}
	var platform struct{ GOOS, GOARCH string }
	if err = json.Unmarshal(target, &platform); err != nil {
		return err
	}
	if platform.GOOS != "linux" || platform.GOARCH != "amd64" {
		return fmt.Errorf("candidate archive output requires the actual linux/amd64 Go target")
	}
	identity, err := devsdk.NewVerifier(devsdk.ReleasePolicy())(ctx, devsdk.Request{
		Selection: devsdk.PublishedSelection(),
		Consumer:  devsdk.Consumer{Name: "omniview", Directory: host},
		Run: func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
			return candidateCommand(ctx, w, directory, "go", environment, args...)
		},
	})
	if err != nil {
		return err
	}
	c.sdk, _ = identity.Published()
	if err = requireCandidateSDKCommit(func(args ...string) ([]byte, error) {
		// Resolve provenance outside every source module so download cannot
		// write a source go.mod or go.sum.
		return candidateCommand(ctx, w, c.stage, "go", nil, args...)
	}, c.sdk, expected.SDK); err != nil {
		return err
	}
	return c.stampPackages()
}

func candidateCommand(ctx context.Context, w devworkspace.Workspace, directory, program string, environment []string, args ...string) ([]byte, error) {
	cmd := exec.Command(program, args...)
	cmd.Dir = directory
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(key) {
		case "GOWORK", "GOFLAGS", "GO_MODFILE", "GO111MODULE", "GOROOT", "GOPROXY", "SDK_SOURCE":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, devsdk.ModuleEnvironment()...)
	cmd.Env = append(cmd.Env, "GOPROXY=direct")
	cmd.Env = append(cmd.Env, environment...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := devworkspace.RunRepositoryCommand(ctx, cmd, devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: devworkspace.NewGeneration(), Role: "candidate-source-proof", Source: directory,
	})
	if err != nil {
		return nil, fmt.Errorf("candidate source proof %s: %w: %s", program, err, stderr.String())
	}
	return stdout.Bytes(), nil
}

// The canonical verifier checks the host's published selection. Its origin is
// a separate boundary: the selected release must name the requested source.
func requireCandidateSDKCommit(run func(...string) ([]byte, error), published devsdk.Published, expectedCommit string) error {
	raw, err := run("mod", "download", "-json", published.Module+"@"+published.Version)
	if err != nil {
		return err
	}
	var downloaded struct {
		Path, Version, Sum, GoModSum, Info string
		Origin                             *struct{ VCS, Hash string }
	}
	if err = json.Unmarshal(raw, &downloaded); err != nil {
		return err
	}
	if downloaded.Origin == nil && downloaded.Info != "" {
		info, _, readErr := readCandidateRegular(downloaded.Info, candidateJSONLimit)
		if readErr != nil {
			return readErr
		}
		if err = json.Unmarshal(info, &downloaded); err != nil {
			return err
		}
	}
	observed := devsdk.Published{Module: downloaded.Path, Version: downloaded.Version, ModuleSum: downloaded.Sum, GoModSum: downloaded.GoModSum}
	if observed != published || downloaded.Origin == nil || downloaded.Origin.VCS != "git" || downloaded.Origin.Hash != expectedCommit {
		return fmt.Errorf("candidate SDK checkout does not match the published module selected by the host, or module provenance is missing")
	}
	return nil
}

func (c *candidateOutput) stampPackages() error {
	for _, pkg := range candidatePackages {
		relative := filepath.Join("packages", pkg.directory, "package.json")
		absolute := filepath.Join(c.host, relative)
		raw, info, err := readCandidateRegular(absolute, candidateJSONLimit)
		if err != nil {
			return err
		}
		var manifest map[string]json.RawMessage
		var name, beforeVersion string
		if err = json.Unmarshal(raw, &manifest); err != nil {
			return err
		}
		if json.Unmarshal(manifest["name"], &name) != nil || name != pkg.name || json.Unmarshal(manifest["version"], &beforeVersion) != nil || beforeVersion == "" {
			return fmt.Errorf("candidate package identity/version is missing for %s", relative)
		}
		manifest["version"], _ = json.Marshal(c.version)
		stamped, err := json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			return err
		}
		stamped = append(stamped, '\n')
		c.stamps = append(c.stamps, candidateStamp{
			Path: filepath.ToSlash(relative), BeforeVersion: beforeVersion,
			BeforeSHA256: candidateDigest(raw), AfterSHA256: candidateDigest(stamped),
			original: raw, stamped: stamped, mode: info.Mode().Perm(), absolute: absolute,
		})
		if err = os.WriteFile(absolute, stamped, info.Mode().Perm()); err != nil {
			return err
		}
	}
	return nil
}

// restore checks the complete write set first. A foreign edit is never reverted
// or hidden by workspace removal, even when the build failed or was canceled.
func (c *candidateOutput) restore() error {
	for _, stamp := range c.stamps {
		raw, info, err := readCandidateRegular(stamp.absolute, candidateJSONLimit)
		if err != nil {
			return err
		}
		if info.Mode().Perm() != stamp.mode || !bytes.Equal(raw, stamp.original) && !bytes.Equal(raw, stamp.stamped) {
			return fmt.Errorf("candidate version stamp changed outside its owned transform: %s", stamp.absolute)
		}
	}
	for _, stamp := range c.stamps {
		if err := os.WriteFile(stamp.absolute, stamp.original, stamp.mode); err != nil {
			return err
		}
	}
	return nil
}

// record transports the canonical writer's archive and receipt. Link and
// BuildPluginArchive already validate protocol, source composition and outputs.
func (c *candidateOutput) record(receipt devworkspace.ArchivePluginStatus, evidence []byte) error {
	if int64(len(evidence)) > candidateJSONLimit {
		return fmt.Errorf("candidate protocol evidence exceeds its size bound")
	}
	staged := filepath.Join(c.stage, candidateArchiveName)
	if err := copyCandidateArchive(receipt.Archive, staged, receipt.ArchiveSHA256); err != nil {
		return err
	}
	if err := requireCandidatePlatform(staged); err != nil {
		return err
	}
	receipt.Archive = candidateArchiveName
	proof := candidateReceipt{
		ArchivePluginStatus: receipt, SchemaVersion: 1, Platform: "linux/amd64",
		Commits: c.commits, SDK: c.sdk, NPMVersion: c.version,
		VersionTransform: "package.json .version = npmVersion", Packages: c.stamps, LinkEvidenceSHA256: candidateDigest(evidence),
	}
	raw, err := json.MarshalIndent(proof, "", "  ")
	if err != nil {
		return err
	}
	for name, data := range map[string][]byte{
		"candidate.json": append(raw, '\n'), "link-protocol.json": evidence,
		"checksums_sha256.txt": []byte(receipt.ArchiveSHA256 + "  " + candidateArchiveName + "\n"),
	} {
		if err = os.WriteFile(filepath.Join(c.stage, name), data, 0600); err != nil {
			return err
		}
	}
	c.ready = true
	return nil
}

func candidateDigest(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func readCandidateRegular(filename string, limit int64) ([]byte, os.FileInfo, error) {
	info, err := os.Lstat(filename)
	if err != nil {
		return nil, nil, err
	}
	canonical, canonicalErr := filepath.EvalSymlinks(filename)
	if canonicalErr != nil || canonical != filename || !info.Mode().IsRegular() || info.Size() > limit {
		return nil, nil, fmt.Errorf("candidate input must be a bounded canonical regular file: %s", filename)
	}
	file, err := os.Open(filename)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, nil, errors.Join(err, fmt.Errorf("candidate input exceeds its size bound: %s", filename))
	}
	return raw, info, nil
}

func copyCandidateArchive(source, destination, expected string) (resultErr error) {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	canonical, err := filepath.EvalSymlinks(source)
	if err != nil || canonical != source || !info.Mode().IsRegular() || info.Size() > candidateArchiveLimit {
		return fmt.Errorf("canonical archive must be a bounded regular file")
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, output.Close()) }()
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(output, hash), io.LimitReader(input, candidateArchiveLimit+1))
	if err != nil || written > candidateArchiveLimit || hex.EncodeToString(hash.Sum(nil)) != expected {
		return errors.Join(err, fmt.Errorf("candidate archive differs from canonical writer digest or exceeds its size bound"))
	}
	return nil
}

// The canonical writer verifies backend bytes, not the advertised release
// platform. Inspect only that distinct boundary, without revalidating the tar
// layout, frontend contents or backend digest the writer already checked.
func requireCandidatePlatform(filename string) error {
	file, err := os.Open(filename)
	if err != nil {
		return err
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return fmt.Errorf("candidate archive has no backend")
		}
		if err != nil {
			return err
		}
		if header.Name == "bin/plugin" {
			var prefix [20]byte
			if _, err = io.ReadFull(reader, prefix[:]); err != nil {
				return err
			}
			if string(prefix[:4]) != elf.ELFMAG || prefix[4] != byte(elf.ELFCLASS64) || prefix[5] != byte(elf.ELFDATA2LSB) || binary.LittleEndian.Uint16(prefix[18:20]) != uint16(elf.EM_X86_64) {
				return fmt.Errorf("candidate backend is not an actual linux/amd64 ELF binary")
			}
			return nil
		}
	}
}
