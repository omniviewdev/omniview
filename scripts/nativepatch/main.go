// Command nativepatch materializes the reviewed native Wails patch without
// importing Wails, patching cached source, or changing the host go.mod.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

type fileChange struct {
	Path   string `json:"path"`
	Before string `json:"before"`
	After  string `json:"after"`
}

type license struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Copy   string `json:"copy"`
}

type manifest struct {
	Schema      int          `json:"schema"`
	Module      string       `json:"module"`
	Version     string       `json:"version"`
	Sum         string       `json:"sum"`
	GoModSum    string       `json:"goModSum"`
	Patch       string       `json:"patch"`
	PatchSHA256 string       `json:"patchSHA256"`
	Licenses    []license    `json:"licenses"`
	Files       []fileChange `json:"files"`
}

type moduleJSON struct {
	Module  struct{ Path string }
	Replace []struct {
		Old struct {
			Path    string
			Version string
		}
		New struct {
			Path    string
			Version string
		}
	}
}

func main() {
	root := flag.String("root", ".", "host checkout root")
	input := flag.String("host-modfile", "", "effective input host modfile (default root/go.mod)")
	sdkInput := flag.String("sdk-source", "", "explicit absolute companion plugin-sdk source directory")
	outputInput := flag.String("output-directory", "", "existing canonical private directory for all generated source/modfile output")
	format := flag.String("format", "modfile", "stdout format: modfile, goflags, or json")
	flag.Parse()
	if flag.NArg() != 0 {
		fatal(errors.New("unexpected positional arguments"))
	}
	if *format != "modfile" && *format != "goflags" && *format != "json" {
		fatal(errors.New("unknown output format"))
	}
	absolute, err := filepath.Abs(*root)
	if err != nil {
		fatal(err)
	}
	if *input == "" {
		*input = filepath.Join(absolute, "go.mod")
	} else if !filepath.IsAbs(*input) {
		*input = filepath.Join(absolute, *input)
	}
	sdkSource, err := resolveSDKSource(*sdkInput)
	if err != nil {
		fatal(err)
	}
	artifact := filepath.Join(absolute, "scripts", "nativepatch", "patches")
	data, err := os.ReadFile(filepath.Join(artifact, "manifest.json"))
	if err != nil {
		fatal(err)
	}
	var m manifest
	if err = decodeJSON(data, &m); err != nil {
		fatal(err)
	}
	if m.Schema != 1 || m.Module != "github.com/wailsapp/wails/v3" || m.Version != "v3.0.0-beta.29" || m.Sum != "h1:oJbXasfieQmMkYtqPlFSPnDe0RwpzA5BKiov8WPD5lo=" || m.GoModSum != "h1:5DR/EG5FHU8+BNV7tQYQ/rJMjoFsVlYpM+0gp1+gcTI=" {
		fatal(errors.New("manifest does not describe the approved beta29 pin"))
	}
	outputRoot, err := outputDirectory(absolute, *outputInput, m)
	if err != nil {
		fatal(err)
	}
	if !safeRelative(m.Patch) {
		fatal(errors.New("unsafe patch path"))
	}
	patch, err := os.ReadFile(filepath.Join(artifact, filepath.FromSlash(m.Patch)))
	if err != nil {
		fatal(err)
	}
	if sha256Hex(patch) != m.PatchSHA256 {
		fatal(errors.New("patch checksum mismatch"))
	}
	for _, item := range m.Licenses {
		if !safeRelative(item.Copy) {
			fatal(errors.New("unsafe license artifact path"))
		}
		copy, err := os.ReadFile(filepath.Join(artifact, filepath.FromSlash(item.Copy)))
		if err != nil {
			fatal(err)
		}
		if sha256Hex(copy) != item.SHA256 {
			fatal(errors.New("license artifact checksum mismatch"))
		}
	}
	if err := ownedDirectory(outputRoot); err != nil {
		fatal(err)
	}
	archive, cleanup, err := download(m, outputRoot)
	if err != nil {
		fatal(err)
	}
	source, err := materialize(archive, outputRoot, m, patch)
	cleanup()
	if err != nil {
		fatal(err)
	}
	modfile, err := hostModfile(absolute, *input, source, m.PatchSHA256, m.Module, sdkSource, outputRoot)
	if err != nil {
		fatal(err)
	}
	if *outputInput != "" {
		if err := recordOutput(outputRoot, m); err != nil {
			fatal(err)
		}
	}
	switch *format {
	case "modfile":
		fmt.Println(modfile)
	case "goflags":
		// cmd/go's quoted.Split accepts whole-argument quotes, not shell escaping.
		arg := "-modfile=" + modfile
		if !strings.Contains(arg, "'") {
			fmt.Println("'" + arg + "'")
		} else if !strings.Contains(arg, "\"") {
			fmt.Println("\"" + arg + "\"")
		} else {
			fatal(errors.New("GOFLAGS cannot quote a path containing both quote types; use explicit -modfile"))
		}
	case "json":
		if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"modfile": modfile, "source": source, "patchSHA256": m.PatchSHA256}); err != nil {
			fatal(err)
		}
	}
}

func fatal(err error)                          { fmt.Fprintln(os.Stderr, "nativepatch:", err); os.Exit(1) }
func decodeJSON(data []byte, result any) error { return json.Unmarshal(data, result) }
func sha256Hex(data []byte) string             { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func safeRelative(name string) bool {
	return name != "" && name != "." && path.Clean(name) == name && !strings.HasPrefix(name, "/") && !strings.HasPrefix(name, "../") && !strings.ContainsAny(name, "\\\x00\r\n") && !strings.Contains(name, ":")
}

// All Go invocations are isolated from parent module-selection environment.
// GO_MODFILE is a Task convention, not a cmd/go variable; never export it here.
func runGo(directory string, args ...string) ([]byte, error) {
	cmd := exec.Command("go", args...)
	cmd.Dir = directory
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if key != "GOWORK" && key != "GOFLAGS" && key != "GO_MODFILE" && key != "GO111MODULE" {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "GOWORK=off", "GOFLAGS=", "GO111MODULE=on")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("go %s: %w\n%s%s", strings.Join(args, " "), err, &stdout, &stderr)
	}
	if stderr.Len() != 0 {
		fmt.Fprint(os.Stderr, &stderr)
	}
	return stdout.Bytes(), nil
}

func download(m manifest, base string) (string, func(), error) {
	work, err := os.MkdirTemp(base, ".nativepatch-download-")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() { _ = os.RemoveAll(work) }
	if err = os.WriteFile(filepath.Join(work, "go.mod"), []byte("module omniview.invalid/native-download\n\ngo 1.20\n"), 0600); err != nil {
		cleanup()
		return "", nil, err
	}
	// Seed both expected sums. Go's own checksum machinery validates download;
	// materialize additionally hashes the actual zip bytes rather than trusting
	// the module cache's extracted Dir or cached ziphash metadata.
	sums := m.Module + " " + m.Version + " " + m.Sum + "\n" + m.Module + " " + m.Version + "/go.mod " + m.GoModSum + "\n"
	if err = os.WriteFile(filepath.Join(work, "go.sum"), []byte(sums), 0600); err != nil {
		cleanup()
		return "", nil, err
	}
	data, err := runGo(work, "mod", "download", "-json", m.Module+"@"+m.Version)
	if err != nil {
		cleanup()
		return "", nil, err
	}
	var result struct{ Path, Version, Zip, Sum, GoModSum, Error string }
	if err = decodeJSON(data, &result); err != nil {
		cleanup()
		return "", nil, err
	}
	if result.Error != "" || result.Path != m.Module || result.Version != m.Version || result.Sum != m.Sum || result.GoModSum != m.GoModSum || result.Zip == "" {
		cleanup()
		return "", nil, errors.New("download metadata does not match pinned module/checksums")
	}
	return result.Zip, cleanup, nil
}

func archiveInventory(z *zip.ReadCloser, m manifest) (map[string]string, error) {
	prefix := m.Module + "@" + m.Version + "/"
	entries := make([]*zip.File, 0, len(z.File))
	for _, entry := range z.File {
		if !entry.FileInfo().IsDir() {
			entries = append(entries, entry)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	inventory := make(map[string]string, len(entries))
	records := sha256.New()
	var modDigest string
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name, prefix) || !entry.Mode().IsRegular() {
			return nil, fmt.Errorf("unsafe module entry %q", entry.Name)
		}
		name := strings.TrimPrefix(entry.Name, prefix)
		if !safeRelative(name) {
			return nil, fmt.Errorf("unsafe module path %q", name)
		}
		if _, duplicate := inventory[name]; duplicate {
			return nil, fmt.Errorf("duplicate module entry %q", name)
		}
		r, err := entry.Open()
		if err != nil {
			return nil, err
		}
		hash := sha256.New()
		_, copyErr := io.Copy(hash, r)
		closeErr := r.Close()
		if copyErr != nil {
			return nil, copyErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		digest := hex.EncodeToString(hash.Sum(nil))
		inventory[name] = digest
		fmt.Fprintf(records, "%s  %s\n", digest, entry.Name)
		if name == "go.mod" {
			modDigest = digest
		}
	}
	if "h1:"+base64.StdEncoding.EncodeToString(records.Sum(nil)) != m.Sum {
		return nil, errors.New("actual module zip checksum mismatch")
	}
	modRecords := sha256.Sum256([]byte(modDigest + "  go.mod\n"))
	if modDigest == "" || "h1:"+base64.StdEncoding.EncodeToString(modRecords[:]) != m.GoModSum {
		return nil, errors.New("actual module go.mod checksum mismatch")
	}
	return inventory, nil
}

func materialize(archive, base string, m manifest, patch []byte) (string, error) {
	if sha256Hex(patch) != m.PatchSHA256 {
		return "", errors.New("patch checksum mismatch")
	}
	z, err := zip.OpenReader(archive)
	if err != nil {
		return "", err
	}
	defer z.Close()
	expected, err := archiveInventory(z, m)
	if err != nil {
		return "", err
	}
	seen := make(map[string]bool, len(m.Files))
	for _, item := range m.Files {
		if !safeRelative(item.Path) || item.Path == ".nativepatch.json" || seen[item.Path] || len(item.After) != 64 {
			return "", errors.New("invalid patch file inventory")
		}
		seen[item.Path] = true
		before, exists := expected[item.Path]
		if (item.Before == "" && exists) || (item.Before != "" && (!exists || before != item.Before)) {
			return "", fmt.Errorf("exact beta29 preimage mismatch: %s", item.Path)
		}
		expected[item.Path] = item.After
	}
	for _, item := range m.Licenses {
		if expected[item.Path] != item.SHA256 {
			return "", fmt.Errorf("upstream license checksum mismatch: %s", item.Path)
		}
	}
	if err = ownedDirectory(base); err != nil {
		return "", err
	}
	target := filepath.Join(base, "wails-v3-beta29-"+m.PatchSHA256)
	marker, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(target); err == nil {
		if err := verifyTree(target, expected, marker); err != nil {
			return "", fmt.Errorf("refusing altered/incomplete owned source %s: %w; remove only this generated directory and retry", target, err)
		}
		return target, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	stage, err := os.MkdirTemp(base, ".nativepatch-stage-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	prefix := m.Module + "@" + m.Version + "/"
	for _, entry := range z.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		name := strings.TrimPrefix(entry.Name, prefix)
		destination := filepath.Join(stage, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
			return "", err
		}
		mode := fs.FileMode(0644)
		if entry.Mode()&0111 != 0 {
			mode = 0755
		}
		if err := extract(entry, destination, mode); err != nil {
			return "", err
		}
	}
	cmd := exec.Command("git", "apply", "--no-index", "--whitespace=nowarn", "-")
	cmd.Dir = stage
	// --no-index does not disable repository discovery. Stop discovery at the
	// owned staging parent, and discard inherited Git repository/config routing
	// so an enclosing host checkout cannot reinterpret or skip patch paths.
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if !strings.HasPrefix(key, "GIT_") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "GIT_CEILING_DIRECTORIES="+filepath.Dir(stage), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
	cmd.Stdin = bytes.NewReader(patch)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("applying pinned patch: %w\n%s", err, output)
	}
	// Verify every source byte and added/deleted file before publishing marker.
	if err := verifyTree(stage, expected, nil); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(stage, ".nativepatch.json"), marker, 0444); err != nil {
		return "", err
	}
	if err := os.Rename(stage, target); err != nil {
		// Another bootstrap may have atomically published identical output.
		if verifyErr := verifyTree(target, expected, marker); verifyErr == nil {
			return target, nil
		}
		return "", err
	}
	return target, nil
}

func extract(entry *zip.File, destination string, mode fs.FileMode) error {
	r, err := entry.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	f, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(f, r)
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// Explicit output is supplied by a caller-owned preparation capability. Never
// create its boundary or adopt unrelated files merely because it is ignored.
func outputDirectory(root, input string, m manifest) (string, error) {
	if input == "" {
		return filepath.Join(root, ".local", "toolsrc"), nil
	}
	if !filepath.IsAbs(input) || filepath.Clean(input) != input {
		return "", errors.New("--output-directory must be an absolute canonical directory")
	}
	canonical, err := filepath.EvalSymlinks(input)
	if err != nil {
		return "", fmt.Errorf("output directory: %w", err)
	}
	if canonical != input {
		return "", errors.New("output directory aliases are not accepted")
	}
	info, err := os.Lstat(input)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&(os.ModeSymlink|os.ModeDevice|os.ModeNamedPipe|os.ModeSocket|os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || info.Mode().Perm()&0077 != 0 {
		return "", errors.New("output directory must be a private real directory")
	}
	entries, err := os.ReadDir(input)
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		return input, nil
	}
	expected := map[string]bool{
		".gitignore":                       false,
		".nativepatch-output.json":         false,
		"wails-v3-beta29-" + m.PatchSHA256: true,
		"host-" + m.PatchSHA256 + ".mod":   false,
		"host-" + m.PatchSHA256 + ".sum":   false,
	}
	if len(entries) != len(expected) {
		return "", errors.New("explicit output is nonempty and is not a complete owned nativepatch tree")
	}
	for _, entry := range entries {
		directory, exists := expected[entry.Name()]
		if !exists || entry.IsDir() != directory || (!directory && !entry.Type().IsRegular()) {
			return "", fmt.Errorf("unowned or special output entry %q", entry.Name())
		}
	}
	want, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	marker, err := os.ReadFile(filepath.Join(input, ".nativepatch-output.json"))
	if err != nil {
		return "", err
	}
	if !bytes.Equal(marker, want) {
		return "", errors.New("explicit output ownership manifest mismatch")
	}
	return input, nil
}

func recordOutput(base string, m manifest) error {
	marker, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return writeIfChanged(filepath.Join(base, ".nativepatch-output.json"), marker)
}

func ownedDirectory(base string) error {
	// Guard our output boundary without rejecting OS aliases above the checkout
	// (for example macOS /var -> /private/var temporary fixture directories).
	for _, current := range []string{filepath.Dir(base), base} {
		info, err := os.Lstat(current)
		if err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
			return fmt.Errorf("output ancestor is not a real directory: %s", current)
		}
		if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	if err := os.MkdirAll(base, 0700); err != nil {
		return err
	}
	ignore := filepath.Join(base, ".gitignore")
	if info, err := os.Lstat(ignore); err == nil && !info.Mode().IsRegular() {
		return errors.New("toolsrc .gitignore is not a regular file")
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	f, err := os.OpenFile(ignore, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if os.IsExist(err) {
		data, readErr := os.ReadFile(ignore)
		if readErr != nil {
			return readErr
		}
		if string(data) != "*\n" {
			return errors.New("unexpected toolsrc .gitignore; refusing overwrite")
		}
		return nil
	}
	if err != nil {
		return err
	}
	_, writeErr := f.WriteString("*\n")
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

func verifyTree(root string, expected map[string]string, marker []byte) error {
	info, err := os.Lstat(root)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("source root is not a real directory")
	}
	count := 0
	err = filepath.WalkDir(root, func(filename string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in generated source: %s", filename)
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("nonregular generated source: %s", filename)
		}
		relative, err := filepath.Rel(root, filename)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		if name == ".nativepatch.json" {
			data, err := os.ReadFile(filename)
			if err != nil {
				return err
			}
			if marker == nil || !bytes.Equal(data, marker) {
				return errors.New("completion marker mismatch")
			}
			return nil
		}
		want, exists := expected[name]
		if !exists {
			return fmt.Errorf("unexpected generated file %s", name)
		}
		file, err := os.Open(filename)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if hex.EncodeToString(hash.Sum(nil)) != want {
			return fmt.Errorf("generated source checksum mismatch: %s", name)
		}
		count++
		return nil
	})
	if err != nil {
		return err
	}
	if count != len(expected) {
		return errors.New("generated source files missing")
	}
	if marker != nil {
		data, err := os.ReadFile(filepath.Join(root, ".nativepatch.json"))
		if err != nil {
			return err
		}
		if !bytes.Equal(data, marker) {
			return errors.New("completion marker missing or altered")
		}
	}
	return nil
}

const sdkModule = "github.com/omniviewdev/plugin-sdk"

// The companion source is an explicit local prerequisite, never an inferred
// sibling directory or an unpublished module version. Read-only module editing
// JSON validates identity without importing/building the SDK or its graph.
func resolveSDKSource(input string) (string, error) {
	if input == "" {
		return "", nil
	}
	if !filepath.IsAbs(input) {
		return "", errors.New("--sdk-source must be an absolute directory")
	}
	source, err := filepath.EvalSymlinks(input)
	if err != nil {
		return "", fmt.Errorf("SDK source: %w", err)
	}
	info, err := os.Stat(source)
	if err != nil {
		return "", fmt.Errorf("SDK source: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("SDK source is not a directory")
	}
	modfile := filepath.Join(source, "go.mod")
	info, err = os.Stat(modfile)
	if err != nil {
		return "", fmt.Errorf("SDK source go.mod: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("SDK source go.mod is not a regular file")
	}
	data, err := runGo(source, "mod", "edit", "-json", "-modfile="+modfile)
	if err != nil {
		return "", fmt.Errorf("SDK source module identity: %w", err)
	}
	var parsed moduleJSON
	if err := decodeJSON(data, &parsed); err != nil {
		return "", err
	}
	if parsed.Module.Path != sdkModule {
		return "", fmt.Errorf("SDK source module is %q, want %s", parsed.Module.Path, sdkModule)
	}
	return source, nil
}

func hostModfile(root, input, source, digest, module, sdkSource, base string) (string, error) {
	if !strings.HasSuffix(input, ".mod") {
		return "", errors.New("input host modfile must end in .mod")
	}
	data, err := os.ReadFile(input)
	if err != nil {
		return "", err
	}
	if err := ownedDirectory(base); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(base, ".host-modfile-stage-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	temporary := filepath.Join(stage, "host.mod")
	if err = os.WriteFile(temporary, data, 0600); err != nil {
		return "", err
	}
	sumPath := strings.TrimSuffix(input, ".mod") + ".sum"
	sum, err := os.ReadFile(sumPath)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if err != nil {
		sum = nil
	}
	parsedData, err := runGo(root, "mod", "edit", "-json", "-modfile="+temporary)
	if err != nil {
		return "", err
	}
	var parsed moduleJSON
	if err = decodeJSON(parsedData, &parsed); err != nil {
		return "", err
	}
	args := []string{"mod", "edit", "-modfile=" + temporary}
	for _, replace := range parsed.Replace {
		old := replace.Old.Path
		if replace.Old.Version != "" {
			old += "@" + replace.Old.Version
		}
		if replace.Old.Path == module || (sdkSource != "" && replace.Old.Path == sdkModule) {
			// Keep an unversioned replacement in place: go mod edit updates it
			// without moving it. Drop only stale version-specific overrides.
			if replace.Old.Version != "" {
				args = append(args, "-dropreplace="+old)
			}
			continue
		}
		if replace.New.Version == "" && !filepath.IsAbs(replace.New.Path) {
			args = append(args, "-replace="+old+"="+filepath.Join(root, filepath.FromSlash(replace.New.Path)))
		}
	}
	args = append(args, "-replace="+module+"="+source)
	if sdkSource != "" {
		args = append(args, "-replace="+sdkModule+"="+sdkSource)
	}
	if _, err = runGo(root, args...); err != nil {
		return "", err
	}
	generated, err := os.ReadFile(temporary)
	if err != nil {
		return "", err
	}
	output := filepath.Join(base, "host-"+digest+".mod")
	if err := writeIfChanged(output, generated); err != nil {
		return "", err
	}
	if err := writeIfChanged(strings.TrimSuffix(output, ".mod")+".sum", sum); err != nil {
		return "", err
	}
	return output, nil
}

func writeIfChanged(filename string, data []byte) error {
	if info, err := os.Lstat(filename); err == nil && !info.Mode().IsRegular() {
		return fmt.Errorf("refusing nonregular output %s", filename)
	}
	if existing, err := os.ReadFile(filename); err == nil && bytes.Equal(existing, data) {
		return nil
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(filename), ".nativepatch-write-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filename)
}
