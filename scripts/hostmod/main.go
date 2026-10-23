// Command hostmod prepares private effective host module files without changing
// source modules or replacing the stock Wails dependency.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const sdkModule = "github.com/omniviewdev/plugin-sdk"
const wailsModule = "github.com/wailsapp/wails/v3"

type moduleVersion struct{ Path, Version string }
type moduleReplacement struct{ Old, New moduleVersion }
type moduleJSON struct {
	Module  moduleVersion
	Require []moduleVersion
	Replace []moduleReplacement
}
type outputOwner struct {
	Schema int    `json:"schema"`
	Root   string `json:"root"`
}

func main() {
	root := flag.String("root", ".", "host checkout root")
	input := flag.String("host-modfile", "", "effective input host modfile (default root/go.mod)")
	sdk := flag.String("sdk-source", "", "explicit absolute companion plugin-sdk source directory")
	output := flag.String("output-directory", "", "existing canonical private directory for effective module files")
	format := flag.String("format", "modfile", "stdout format: modfile, goflags, or json")
	flag.Parse()
	if flag.NArg() != 0 {
		fatal(errors.New("unexpected positional arguments"))
	}
	if *format != "modfile" && *format != "goflags" && *format != "json" {
		fatal(errors.New("unknown output format"))
	}
	modfile, err := prepare(*root, *input, *sdk, *output)
	if err != nil {
		fatal(err)
	}
	switch *format {
	case "modfile":
		fmt.Println(modfile)
	case "json":
		if err := json.NewEncoder(os.Stdout).Encode(struct {
			Modfile string `json:"modfile"`
		}{modfile}); err != nil {
			fatal(err)
		}
	case "goflags":
		argument := "-modfile=" + modfile
		if !strings.Contains(argument, "'") {
			fmt.Println("'" + argument + "'")
		} else if !strings.Contains(argument, "\"") {
			fmt.Println("\"" + argument + "\"")
		} else {
			fatal(errors.New("GOFLAGS cannot quote a path containing both quote types; use explicit -modfile"))
		}
	}
}
func fatal(err error)                          { fmt.Fprintln(os.Stderr, "hostmod:", err); os.Exit(1) }
func decodeJSON(data []byte, result any) error { return json.Unmarshal(data, result) }

// All Go invocations ignore ambient workspace/module overrides.
func runGo(directory string, args ...string) ([]byte, error) {
	command := exec.Command("go", args...)
	command.Dir = directory
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if key != "GOWORK" && key != "GOFLAGS" && key != "GO_MODFILE" && key != "GO111MODULE" {
			command.Env = append(command.Env, entry)
		}
	}
	command.Env = append(command.Env, "GOWORK=off", "GOFLAGS=", "GO111MODULE=on")
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	if err := command.Run(); err != nil {
		return nil, fmt.Errorf("go %s: %w\n%s%s", strings.Join(args, " "), err, &stdout, &stderr)
	}
	if stderr.Len() != 0 {
		fmt.Fprint(os.Stderr, &stderr)
	}
	return stdout.Bytes(), nil
}
func parseModule(root, path string) (moduleJSON, error) {
	var parsed moduleJSON
	raw, err := runGo(root, "mod", "edit", "-json", "-modfile="+path)
	if err != nil {
		return parsed, err
	}
	err = decodeJSON(raw, &parsed)
	return parsed, err
}
func resolveSDKSource(input string) (string, error) {
	if input == "" {
		return "", nil
	}
	if !filepath.IsAbs(input) {
		return "", errors.New("SDK source must be an absolute directory")
	}
	canonical, err := filepath.EvalSymlinks(input)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(filepath.Join(canonical, "go.mod"))
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("SDK source go.mod is not regular")
	}
	parsed, err := parseModule(canonical, filepath.Join(canonical, "go.mod"))
	if err != nil {
		return "", err
	}
	if parsed.Module.Path != sdkModule {
		return "", fmt.Errorf("SDK source module is %q, want %s", parsed.Module.Path, sdkModule)
	}
	return canonical, nil
}

// A local selection must remain authoritative under every MVS-selected SDK
// version. Never discard a contradictory dormant version-specific override.
func selectSDK(root, input string, parsed moduleJSON) (string, error) {
	selected, err := resolveSDKSource(input)
	if err != nil {
		return "", err
	}
	if selected == "" {
		version := ""
		for _, requirement := range parsed.Require {
			if requirement.Path == sdkModule {
				version = requirement.Version
			}
		}
		var general, specific *moduleReplacement
		for i := range parsed.Replace {
			replacement := &parsed.Replace[i]
			if replacement.Old.Path != sdkModule {
				continue
			}
			if replacement.Old.Version == "" {
				general = replacement
			} else if replacement.Old.Version == version {
				specific = replacement
			}
		}
		effective := specific
		if effective == nil {
			effective = general
		}
		if effective != nil && effective.New.Version == "" {
			path := effective.New.Path
			if !filepath.IsAbs(path) {
				path = filepath.Join(root, path)
			}
			selected, err = resolveSDKSource(path)
			if err != nil {
				return "", err
			}
		}
	}
	if selected == "" {
		return "", nil
	}
	for _, replacement := range parsed.Replace {
		if replacement.Old.Path != sdkModule {
			continue
		}
		if replacement.New.Version != "" {
			return "", errors.New("remote SDK replacement conflicts with selected local SDK source")
		}
		path := replacement.New.Path
		if !filepath.IsAbs(path) {
			path = filepath.Join(root, path)
		}
		path, err = resolveSDKSource(path)
		if err != nil {
			return "", err
		}
		if selected != path {
			return "", errors.New("SDK replacement conflicts with selected local SDK source")
		}
	}
	return selected, nil
}

type wailsAuthority struct{ Version, Sum, GoModSum string }

func approvedWails(root string) (wailsAuthority, error) {
	var approved wailsAuthority
	parsed, err := parseModule(root, filepath.Join(root, "go.mod"))
	if err != nil {
		return approved, err
	}
	if parsed.Module.Path != "github.com/omniviewdev/omniview" {
		return approved, errors.New("trusted root must declare the Omniview host module")
	}
	for _, replacement := range parsed.Replace {
		if replacement.Old.Path == wailsModule {
			return approved, errors.New("root Wails replacements are forbidden")
		}
	}
	for _, requirement := range parsed.Require {
		if requirement.Path == wailsModule {
			approved.Version = requirement.Version
		}
	}
	if approved.Version == "" {
		return approved, errors.New("root go.mod has no approved Wails version")
	}
	raw, err := os.ReadFile(filepath.Join(root, "go.sum"))
	if err != nil {
		return approved, err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 3 || fields[0] != wailsModule {
			continue
		}
		var destination *string
		switch fields[1] {
		case approved.Version:
			destination = &approved.Sum
		case approved.Version + "/go.mod":
			destination = &approved.GoModSum
		default:
			continue
		}
		if *destination != "" && *destination != fields[2] {
			return approved, errors.New("root Wails checksums disagree")
		}
		*destination = fields[2]
	}
	if approved.Sum == "" || approved.GoModSum == "" {
		return approved, errors.New("root go.sum has no complete approved Wails checksums")
	}
	return approved, nil
}

func seedWailsSums(sum []byte, approved wailsAuthority) ([]byte, error) {
	for _, expected := range []struct{ version, sum string }{{approved.Version, approved.Sum}, {approved.Version + "/go.mod", approved.GoModSum}} {
		found := false
		for _, line := range strings.Split(string(sum), "\n") {
			fields := strings.Fields(line)
			if len(fields) == 3 && fields[0] == wailsModule && fields[1] == expected.version {
				if fields[2] != expected.sum {
					return nil, errors.New("effective input Wails checksum conflicts with root authority")
				}
				found = true
			}
		}
		if !found {
			if len(sum) != 0 && sum[len(sum)-1] != '\n' {
				sum = append(sum, '\n')
			}
			sum = append(sum, []byte(wailsModule+" "+expected.version+" "+expected.sum+"\n")...)
		}
	}
	return sum, nil
}

func verifyEffectiveGraph(root, modfile, sdk string, approved wailsAuthority) error {
	// Named -m lookups can return only the lazy root requirements. Load the
	// complete graph before trusting versions selected through dependency edges.
	raw, err := runGo(root, "list", "-mod=mod", "-modfile="+modfile, "-m", "-json", "all")
	if err != nil {
		return err
	}
	type selectedModule struct {
		Path, Version string
		Replace       *struct{ Dir, Version string }
	}
	var framework, selectedSDK selectedModule
	foundFramework, foundSDK := false, false
	decoder := json.NewDecoder(bytes.NewReader(raw))
	for {
		var module selectedModule
		if err := decoder.Decode(&module); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return err
		}
		switch module.Path {
		case wailsModule:
			framework, foundFramework = module, true
		case sdkModule:
			selectedSDK, foundSDK = module, true
		}
	}
	if !foundFramework || framework.Version != approved.Version || framework.Replace != nil {
		return errors.New("effective Wails graph does not select the approved unreplaced root version")
	}
	if sdk != "" {
		if !foundSDK || selectedSDK.Replace == nil || selectedSDK.Replace.Version != "" {
			return errors.New("effective SDK graph lost selected local source")
		}
		actual, err := filepath.EvalSymlinks(selectedSDK.Replace.Dir)
		if err != nil {
			return err
		}
		if actual != sdk {
			return errors.New("effective SDK graph changed selected local source")
		}
	}
	var download struct{ Path, Version, Sum, GoModSum, Error string }
	raw, err = runGo(root, "mod", "download", "-modfile="+modfile, "-json", wailsModule+"@"+approved.Version)
	if err != nil {
		return err
	}
	if err := decodeJSON(raw, &download); err != nil {
		return err
	}
	if download.Error != "" || download.Path != wailsModule || download.Version != approved.Version || download.Sum != approved.Sum || download.GoModSum != approved.GoModSum {
		return errors.New("effective Wails checksums do not match root authority")
	}
	return nil
}
func prepare(root, input, sdk, output string) (string, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	if input == "" {
		input = filepath.Join(root, "go.mod")
	} else if !filepath.IsAbs(input) {
		input = filepath.Join(root, input)
	}
	if !strings.HasSuffix(input, ".mod") {
		return "", errors.New("input host modfile must end in .mod")
	}
	parsed, err := parseModule(root, input)
	if err != nil {
		return "", err
	}
	if parsed.Module.Path != "github.com/omniviewdev/omniview" {
		return "", errors.New("input must declare the Omniview host module")
	}
	for _, replacement := range parsed.Replace {
		if replacement.Old.Path == wailsModule {
			return "", errors.New("Wails replacements are forbidden; use the stock root module pin")
		}
	}
	sdk, err = selectSDK(root, sdk, parsed)
	if err != nil {
		return "", err
	}
	approved, err := approvedWails(root)
	if err != nil {
		return "", err
	}
	version := ""
	for _, requirement := range parsed.Require {
		if requirement.Path == wailsModule {
			version = requirement.Version
		}
	}
	if version != approved.Version {
		return "", errors.New("input must require the approved Wails version from root go.mod")
	}
	data, err := os.ReadFile(input)
	if err != nil {
		return "", err
	}
	sum, err := os.ReadFile(strings.TrimSuffix(input, ".mod") + ".sum")
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	sum, err = seedWailsSums(sum, approved)
	if err != nil {
		return "", err
	}
	output, err = outputDirectory(root, output)
	if err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(output, ".hostmod-stage-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	temporary := filepath.Join(stage, "host.mod")
	if err := os.WriteFile(temporary, data, 0600); err != nil {
		return "", err
	}
	args := []string{"mod", "edit", "-fmt", "-modfile=" + temporary}
	for _, replacement := range parsed.Replace {
		old := replacement.Old.Path
		if replacement.Old.Version != "" {
			old += "@" + replacement.Old.Version
		}
		if sdk != "" && replacement.Old.Path == sdkModule {
			args = append(args, "-dropreplace="+old)
			continue
		}
		if replacement.New.Version != "" || filepath.IsAbs(replacement.New.Path) {
			continue
		}
		args = append(args, "-replace="+old+"="+filepath.Join(root, filepath.FromSlash(replacement.New.Path)))
	}
	if sdk != "" {
		args = append(args, "-replace="+sdkModule+"="+sdk)
	}
	if _, err := runGo(root, args...); err != nil {
		return "", err
	}
	if err := os.WriteFile(strings.TrimSuffix(temporary, ".mod")+".sum", sum, 0600); err != nil {
		return "", err
	}
	if err := verifyEffectiveGraph(root, temporary, sdk, approved); err != nil {
		return "", err
	}
	sum, err = os.ReadFile(strings.TrimSuffix(temporary, ".mod") + ".sum")
	if err != nil {
		return "", err
	}
	generated, err := os.ReadFile(temporary)
	if err != nil {
		return "", err
	}
	modfile := filepath.Join(output, "host.mod")
	if err := writeIfChanged(modfile, generated); err != nil {
		return "", err
	}
	if err := writeIfChanged(filepath.Join(output, "host.sum"), sum); err != nil {
		return "", err
	}
	marker, err := json.Marshal(outputOwner{Schema: 1, Root: root})
	if err != nil {
		return "", err
	}
	if err := writeIfChanged(filepath.Join(output, ".hostmod-output.json"), marker); err != nil {
		return "", err
	}
	return modfile, nil
}

// Explicit output is an existing caller-owned capability. Refuse unknown files,
// aliases and public modes rather than adopting or repairing them.
func outputDirectory(root, input string) (string, error) {
	if input == "" {
		parent := filepath.Join(root, ".local")
		if info, err := os.Lstat(parent); err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
			return "", errors.New("host module output parent is redirected")
		} else if err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err := os.MkdirAll(parent, 0700); err != nil {
			return "", err
		}
		input = filepath.Join(parent, "hostmod")
		if err := os.Mkdir(input, 0700); err != nil && !os.IsExist(err) {
			return "", err
		}
	}
	if !filepath.IsAbs(input) || filepath.Clean(input) != input {
		return "", errors.New("output directory must be absolute and canonical")
	}
	canonical, err := filepath.EvalSymlinks(input)
	if err != nil {
		return "", err
	}
	if canonical != input {
		return "", errors.New("output directory aliases are not accepted")
	}
	info, err := os.Lstat(input)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&(os.ModeSymlink|os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return "", errors.New("output directory must be a private real directory")
	}
	entries, err := os.ReadDir(input)
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		return input, nil
	}
	if len(entries) != 3 {
		return "", errors.New("output directory is nonempty and not a complete owned host module tree")
	}
	for _, entry := range entries {
		if entry.Name() != "host.mod" && entry.Name() != "host.sum" && entry.Name() != ".hostmod-output.json" {
			return "", fmt.Errorf("unknown output entry %q", entry.Name())
		}
		if err := privateRegularFile(filepath.Join(input, entry.Name())); err != nil {
			return "", err
		}
	}
	raw, err := os.ReadFile(filepath.Join(input, ".hostmod-output.json"))
	if err != nil {
		return "", err
	}
	var owner outputOwner
	if err := decodeJSON(raw, &owner); err != nil {
		return "", err
	}
	if owner != (outputOwner{Schema: 1, Root: root}) {
		return "", errors.New("host module output ownership differs")
	}
	return input, nil
}
func privateRegularFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return fmt.Errorf("output is not a private regular file: %s", path)
	}
	return nil
}
func writeIfChanged(path string, data []byte) error {
	if err := privateRegularFile(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, data) {
		return nil
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".hostmod-write-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}
