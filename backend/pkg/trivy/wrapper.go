package trivy

import (
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

type Command string

const (
	CommandConfig     Command = "config"
	CommandFilesystem Command = "fs"
	CommandImage      Command = "image"
	CommandKubernetes Command = "kubernetes"
	CommandRepo       Command = "repository"
	CommandRootfs     Command = "rootfs"
	CommandSBOM       Command = "sbom"
)

func (c Command) String() string {
	return string(c)
}

//nolint:gochecknoglobals // Necessary global for enum binding
var AllCommands = []struct {
	Value  Command
	TSName string
}{
	{CommandConfig, "CONFIG"},
	{CommandFilesystem, "FILESYSTEM"},
	{CommandImage, "IMAGE"},
	{CommandKubernetes, "KUBERNETES"},
	{CommandRepo, "REPOSITORY"},
	{CommandRootfs, "ROOTFS"},
	{CommandSBOM, "SBOM"},
}

type Scanner string

const (
	ScannerVuln      Scanner = "vuln"
	ScannerMisconfig Scanner = "misconfig"
	ScannerSecret    Scanner = "secret"
	ScannerLicense   Scanner = "license"
)

func (s Scanner) String() string {
	return string(s)
}

type ScanResult struct {
	Timestamp time.Time              `json:"timestamp"`
	Result    map[string]interface{} `json:"result"`
	ID        string                 `json:"id"`
	Command   Command                `json:"command"`
}

//nolint:gochecknoglobals // Necessary global for enum binding
var AllScanners = []struct {
	Value  Scanner
	TSName string
}{
	{ScannerVuln, "VULN"},
	{ScannerMisconfig, "MISCONFIG"},
	{ScannerSecret, "SECRET"},
	{ScannerLicense, "LICENSE"},
}

type ScanOptions struct {
	FilePatterns []string  `json:"filePatterns" yaml:"filePatterns"`
	SkipDirs     []string  `json:"skipDirs"     yaml:"skipDirs"`
	SkipFiles    []string  `json:"skipFiles"    yaml:"skipFiles"`
	Scanners     []Scanner `json:"scanners"     yaml:"scanners"`
}

func (o ScanOptions) Validate() error {
	return nil
}

func (o ScanOptions) String() string {
	result := ""
	if len(o.FilePatterns) > 0 {
		result += "--file-patterns " + strings.Join(o.FilePatterns, ",") + " "
	}
	if len(o.SkipDirs) > 0 {
		result += "--skip-dirs " + strings.Join(o.SkipDirs, ",") + " "
	}
	if len(o.SkipFiles) > 0 {
		result += "--skip-files " + strings.Join(o.SkipFiles, ",") + " "
	}
	if len(o.Scanners) > 0 {
		result += "--scanners "
		for idx, scanner := range o.Scanners {
			result += scanner.String()
			if idx < len(o.Scanners)-1 {
				result += ","
			}
		}
	}
	return result
}

func (o ScanOptions) ToArgs() []string {
	args := []string{}
	if len(o.FilePatterns) > 0 {
		args = append(args, "--file-patterns")
		args = append(args, strings.Join(o.FilePatterns, ","))
	}
	if len(o.SkipDirs) > 0 {
		args = append(args, "--skip-dirs")
		args = append(args, strings.Join(o.SkipDirs, ","))
	}
	if len(o.SkipFiles) > 0 {
		args = append(args, "--skip-files")
		args = append(args, strings.Join(o.SkipFiles, ","))
	}
	if len(o.Scanners) > 0 {
		args = append(args, "--scanners")

		scannersArg := ""
		for idx, scanner := range o.Scanners {
			scannersArg += scanner.String()
			if idx < len(o.Scanners)-1 {
				scannersArg += ","
			}
		}
	}

	return args
}

type Args interface {
	Validate() error
	String() string
	ToArgs() []string
}

// Wraps the trivy command to run a scan
// TODO: convert to plugin
func RunTrivyScan(
	command Command,
	target string,
	// args Args,
	opts ScanOptions,
) (map[string]interface{}, error) {
	runargs := []string{"-q", command.String(), "-f", "json"}
	// runargs = append(runargs, args.ToArgs()...)
	runargs = append(runargs, opts.ToArgs()...)
	runargs = append(runargs, target)

	c := exec.Command("trivy", runargs...)
	res, err := c.Output()
	if err != nil {
		return nil, err
	}
	// Assuming the output is JSON, unmarshal it into a map
	var result map[string]interface{}
	err = json.Unmarshal(res, &result)
	if err != nil {
		return nil, err
	}

	return result, nil
}
