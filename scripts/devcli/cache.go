package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/omniviewdev/omniview/internal/devsession"
)

const cacheKind = "omniview-dev-cli-v2"

var cacheKeyPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type namespaceOwner struct {
	SchemaVersion int    `json:"schemaVersion"`
	Kind          string `json:"kind"`
}
type inputOwner struct {
	SchemaVersion    int    `json:"schemaVersion"`
	Key              string `json:"key"`
	Root             string `json:"root"`
	SourceModfile    string `json:"sourceModfile"`
	SDKSource        string `json:"sdkSource"`
	ModuleSHA256     string `json:"moduleSHA256"`
	SumSHA256        string `json:"sumSHA256"`
	SumExists        bool   `json:"sumExists"`
	RootModuleSHA256 string `json:"rootModuleSHA256"`
	RootSumSHA256    string `json:"rootSumSHA256"`
	RootSumExists    bool   `json:"rootSumExists"`
	SDKModuleSHA256  string `json:"sdkModuleSHA256"`
	SDKSumSHA256     string `json:"sdkSumSHA256"`
	SDKSumExists     bool   `json:"sdkSumExists"`
}
type artifactOwner struct {
	SchemaVersion int    `json:"schemaVersion"`
	Kind          string `json:"kind"`
	InputKey      string `json:"inputKey"`
	SHA256        string `json:"sha256"`
}
type cachePaths struct {
	directory, host, binaries, inputMod, inputSum, hostRecord string
	initialDirectory                                          os.FileInfo
}
type hostReply struct {
	Modfile string `json:"modfile"`
}
type hostRecord struct {
	SchemaVersion int       `json:"schemaVersion"`
	Output        hostReply `json:"output"`
	ModuleSHA256  string    `json:"moduleSHA256"`
	SumSHA256     string    `json:"sumSHA256"`
}

func digestBytes(raw []byte) string { value := sha256.Sum256(raw); return hex.EncodeToString(value[:]) }
func expectedInputOwner(key string, selected selectedInputs) inputOwner {
	return inputOwner{SchemaVersion: 1, Key: key, Root: selected.root, SourceModfile: selected.sourceModfile, SDKSource: selected.sdkSource, ModuleSHA256: digestBytes(selected.module), SumSHA256: digestBytes(selected.sum), SumExists: selected.sumExists, RootModuleSHA256: digestBytes(selected.rootModule), RootSumSHA256: digestBytes(selected.rootSum), RootSumExists: selected.rootSumExists, SDKModuleSHA256: digestBytes(selected.sdkModule), SDKSumSHA256: digestBytes(selected.sdkSum), SDKSumExists: selected.sdkSumExists}
}

func hostInputKey(selected selectedInputs) (string, error) {
	hash := sha256.New()
	identity := struct {
		Inputs                  inputOwner
		GoVersion, GOOS, GOARCH string
	}{expectedInputOwner("", selected), runtime.Version(), runtime.GOOS, runtime.GOARCH}
	if err := json.NewEncoder(hash).Encode(identity); err != nil {
		return "", err
	}
	paths := []string{filepath.Join(selected.root, "scripts", "hostmod", "main.go")}
	buffer := make([]byte, 32*1024)
	for _, path := range paths {
		relative, err := filepath.Rel(selected.root, path)
		if err != nil {
			return "", err
		}
		sourceDigest, err := hashSourceFile(path, buffer)
		if err != nil {
			return "", err
		}
		if err := json.NewEncoder(hash).Encode(struct{ Path, SHA256 string }{filepath.ToSlash(relative), sourceDigest}); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func hashSourceFile(path string, buffer []byte) (string, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !before.Mode().IsRegular() {
		return "", fmt.Errorf("host module helper input is not a regular file: %s", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !os.SameFile(before, opened) {
		return "", fmt.Errorf("host module helper input changed while opening: %s", path)
	}
	hash := sha256.New()
	if _, err := io.CopyBuffer(hash, file, buffer); err != nil {
		return "", err
	}
	after, err := file.Stat()
	if err != nil {
		return "", err
	}
	if before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return "", fmt.Errorf("host module helper input changed while hashing: %s", path)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func makePrivateDirectory(path string) (bool, error) {
	_, created, err := makePrivateDirectoryClaim(path)
	return created, err
}

func makePrivateDirectoryClaim(path string) (os.FileInfo, bool, error) {
	err := os.Mkdir(path, 0700)
	if err == nil {
		original, err := os.Lstat(path)
		if err != nil {
			return nil, true, err
		}
		canonical, err := devsession.EnsurePrivateDirectory(path)
		if err != nil {
			return original, true, err
		}
		if canonical != path {
			return original, true, fmt.Errorf("new CLI cache directory was redirected: %s", path)
		}
		return original, true, devsession.ValidatePrivateDirectory(path)
	}
	if !os.IsExist(err) {
		return nil, false, err
	}
	return nil, false, devsession.ValidatePrivateDirectory(path)
}

func writeNewPrivate(path string, write func(io.Writer) error) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if err = write(file); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return devsession.ValidatePrivateFile(path)
}
func writeNewJSON(path string, value any) error {
	return writeNewPrivate(path, func(writer io.Writer) error { return json.NewEncoder(writer).Encode(value) })
}
func writeNewBytes(path string, value []byte) error {
	return writeNewPrivate(path, func(writer io.Writer) error { _, err := writer.Write(value); return err })
}

func createCacheNamespace(ctx context.Context, root string) (resultErr error) {
	// Serialize initialization before mkdir: another first caller must never see
	// the interval between creating the namespace and publishing its marker.
	base := filepath.Dir(root)
	name := cacheKind + ".init.lock"
	if info, err := os.Lstat(filepath.Join(base, name)); err == nil {
		if !info.Mode().IsRegular() || info.Size() != 0 {
			return fmt.Errorf("CLI namespace lock is an unknown file")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	lock, err := devsession.AcquirePrivateLock(ctx, base, name)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, lock.Close()) }()
	original, created, err := makePrivateDirectoryClaim(root)
	if created && original != nil {
		defer func() {
			if resultErr != nil {
				resultErr = errors.Join(resultErr, removeBuildStage(root, original))
			}
		}()
	}
	if err != nil {
		return err
	}
	expected := namespaceOwner{SchemaVersion: 1, Kind: cacheKind}
	marker := filepath.Join(root, ".owner.json")
	if created {
		return writeNewJSON(marker, expected)
	}
	var actual namespaceOwner
	if err := devsession.ReadPrivateJSON(marker, &actual); err != nil {
		return fmt.Errorf("refusing unknown/incomplete CLI cache %s: %w", root, err)
	}
	if actual != expected {
		return fmt.Errorf("CLI cache namespace ownership differs: %s", root)
	}
	return nil
}

func claimInputs(root, key string, selected selectedInputs) (paths cachePaths, fresh bool, resultErr error) {
	if !cacheKeyPattern.MatchString(key) {
		return paths, false, fmt.Errorf("invalid CLI cache input identity")
	}
	if err := devsession.ValidatePrivateDirectory(root); err != nil {
		return paths, false, err
	}
	directory := filepath.Join(root, key)
	paths = cachePaths{directory: directory, host: filepath.Join(directory, "host"), binaries: filepath.Join(directory, "binaries"), inputMod: filepath.Join(directory, "module.mod"), inputSum: filepath.Join(directory, "module.sum"), hostRecord: filepath.Join(directory, "host.json")}
	original, created, err := makePrivateDirectoryClaim(directory)
	paths.initialDirectory = original
	if created && original != nil {
		defer func() {
			if resultErr != nil {
				resultErr = errors.Join(resultErr, removeBuildStage(directory, original))
			}
		}()
	}
	if err != nil {
		return paths, created, err
	}
	expected := expectedInputOwner(key, selected)
	marker := filepath.Join(directory, ".owner.json")
	if created {
		for _, path := range []string{paths.host, paths.binaries} {
			own, err := makePrivateDirectory(path)
			if err != nil {
				return paths, true, err
			}
			if !own {
				return paths, true, fmt.Errorf("new CLI cache contains an unknown directory: %s", path)
			}
		}
		if err := writeNewBytes(paths.inputMod, selected.module); err != nil {
			return paths, true, err
		}
		if err := writeNewBytes(paths.inputSum, selected.sum); err != nil {
			return paths, true, err
		}
		if err := writeNewJSON(marker, expected); err != nil {
			return paths, true, err
		}
		return paths, true, nil
	}
	var actual inputOwner
	if err := devsession.ReadPrivateJSON(marker, &actual); err != nil {
		return paths, false, fmt.Errorf("refusing unknown/incomplete CLI inputs %s: %w", directory, err)
	}
	if actual != expected {
		return paths, false, fmt.Errorf("CLI cache input ownership differs: %s", directory)
	}
	for _, pair := range []struct {
		path     string
		expected []byte
	}{{paths.inputMod, selected.module}, {paths.inputSum, selected.sum}} {
		raw, err := readPrivateBytes(pair.path)
		if err != nil {
			return paths, false, err
		}
		if !bytes.Equal(raw, pair.expected) {
			return paths, false, fmt.Errorf("CLI module snapshot was modified: %s", pair.path)
		}
	}
	for _, path := range []string{paths.host, paths.binaries} {
		if err := devsession.ValidatePrivateDirectory(path); err != nil {
			return paths, false, err
		}
	}
	return paths, false, nil
}

func openPrivateFile(path string) (*os.File, error) {
	if err := devsession.ValidatePrivateFile(path); err != nil {
		return nil, err
	}
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		file.Close()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("private CLI artifact changed while opening: %s", path)
	}
	return file, nil
}
func readPrivateBytes(path string) ([]byte, error) {
	file, err := openPrivateFile(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(file)
}
func hashPrivateFile(path string) (string, error) {
	file, err := openPrivateFile(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	after, err := file.Stat()
	if err != nil {
		return "", err
	}
	current, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !os.SameFile(before, current) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return "", fmt.Errorf("CLI artifact changed during hashing: %s", path)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func cloneBuildModule(hostMod, stage string) (string, error) {
	if err := devsession.ValidatePrivateDirectory(stage); err != nil {
		return "", err
	}
	target := filepath.Join(stage, "cli.mod")
	for _, pair := range [][2]string{{hostMod, target}, {strings.TrimSuffix(hostMod, ".mod") + ".sum", filepath.Join(stage, "cli.sum")}} {
		source, err := openPrivateFile(pair[0])
		if err != nil {
			return "", err
		}
		err = writeNewPrivate(pair[1], func(writer io.Writer) error { _, err := io.Copy(writer, source); return err })
		closeErr := source.Close()
		if err != nil {
			return "", err
		}
		if closeErr != nil {
			return "", closeErr
		}
	}
	return target, nil
}

func executableName() string {
	if runtime.GOOS == "windows" {
		return "omniview-dev.exe"
	}
	return "omniview-dev"
}
func validateExecutable(path string) error {
	if err := devsession.ValidatePrivateFile(path); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0100 == 0 {
		return fmt.Errorf("CLI artifact is not executable: %s", path)
	}
	return nil
}

// publishArtifact claims a fresh content-addressed directory, then atomically
// links the complete binary. An existing artifact is verified, never replaced.
func publishArtifact(root, staged, inputKey string) (string, error) {
	if err := devsession.ValidatePrivateDirectory(root); err != nil {
		return "", err
	}
	if err := devsession.ValidatePrivateDirectory(filepath.Dir(staged)); err != nil {
		return "", err
	}
	if err := validateExecutable(staged); err != nil {
		return "", err
	}
	digest, err := hashPrivateFile(staged)
	if err != nil {
		return "", err
	}
	directory := filepath.Join(root, digest)
	created, err := makePrivateDirectory(directory)
	if err != nil {
		return "", err
	}
	target := filepath.Join(directory, executableName())
	marker := filepath.Join(directory, ".owner.json")
	expected := artifactOwner{SchemaVersion: 1, Kind: cacheKind, InputKey: inputKey, SHA256: digest}
	if created {
		if err := os.Link(staged, target); err != nil {
			return "", err
		}
		if err := validateExecutable(target); err != nil {
			return "", err
		}
		actual, err := hashPrivateFile(target)
		if err != nil {
			return "", err
		}
		if actual != digest {
			return "", fmt.Errorf("staged CLI artifact changed during publication")
		}
		if err := writeNewJSON(marker, expected); err != nil {
			return "", err
		}
	} else {
		var actual artifactOwner
		if err := devsession.ReadPrivateJSON(marker, &actual); err != nil {
			return "", fmt.Errorf("refusing unknown/incomplete executable %s: %w", directory, err)
		}
		if actual != expected {
			return "", fmt.Errorf("CLI executable ownership differs: %s", directory)
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			return "", err
		}
		if len(entries) != 2 {
			return "", fmt.Errorf("CLI executable directory contains unknown files: %s", directory)
		}
		for _, entry := range entries {
			if entry.Name() != ".owner.json" && entry.Name() != executableName() {
				return "", fmt.Errorf("CLI executable directory contains unknown file %s", entry.Name())
			}
		}
		if err := validateExecutable(target); err != nil {
			return "", err
		}
		hash, err := hashPrivateFile(target)
		if err != nil {
			return "", err
		}
		if hash != digest {
			return "", fmt.Errorf("immutable CLI executable was modified: %s", target)
		}
	}
	return target, nil
}

func removeBuildStage(path string, original os.FileInfo) error {
	current, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !current.IsDir() || current.Mode()&os.ModeSymlink != 0 || !os.SameFile(current, original) {
		return fmt.Errorf("refusing to remove replaced CLI-owned directory: %s", path)
	}
	if err := devsession.ValidatePrivateDirectory(path); err != nil {
		return err
	}
	return os.RemoveAll(path)
}

func validateHostRecord(paths cachePaths, state hostRecord) error {
	if state.SchemaVersion != 1 || !filepath.IsAbs(state.Output.Modfile) || state.Output.Modfile != filepath.Join(paths.host, "host.mod") {
		return fmt.Errorf("CLI host module cache record identity differs")
	}
	for _, path := range []string{state.Output.Modfile, strings.TrimSuffix(state.Output.Modfile, ".mod") + ".sum"} {
		canonical, err := filepath.EvalSymlinks(path)
		if err != nil {
			return err
		}
		if canonical != path {
			return fmt.Errorf("CLI host module cache path is redirected: %s", path)
		}
	}
	moduleHash, err := hashPrivateFile(state.Output.Modfile)
	if err != nil {
		return err
	}
	sumHash, err := hashPrivateFile(strings.TrimSuffix(state.Output.Modfile, ".mod") + ".sum")
	if err != nil {
		return err
	}
	if moduleHash != state.ModuleSHA256 || sumHash != state.SumSHA256 {
		return fmt.Errorf("immutable CLI host module template was modified")
	}
	return nil
}
