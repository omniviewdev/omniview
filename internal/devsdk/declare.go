package devsdk

import (
	"fmt"
	"strings"

	"golang.org/x/mod/modfile"
	"golang.org/x/mod/semver"
)

// ModuleFiles are one consumer's module files as committed or checked out. They
// are read without running Go and without touching the network.
type ModuleFiles struct {
	GoMod []byte
	GoSum []byte
	// Vendored reports that the module root holds a vendor entry. Go would
	// default to compiling repository-local bytes instead of the module cache.
	Vendored bool
}

// Declare reads the SDK tuple a consumer's own module files state: the required
// version and the go.sum checksums recorded for it. It refuses what no later
// step could repair: an unusable go.mod, any replacement of the SDK (including a
// dormant version-specific one, which a different graph resolution could
// activate), a vendored dependency tree, a missing requirement, and missing or
// conflicting checksums. It never selects, downloads or applies release policy.
// Replacement targets are never echoed: they can carry credentials.
func Declare(consumer string, files ModuleFiles) (Published, error) {
	var declared Published
	module, err := modfile.Parse("go.mod", files.GoMod, nil)
	if err != nil {
		return declared, contractMismatch(consumer, fmt.Sprintf("%s/go.mod is invalid; repair the selected source before building", consumer))
	}
	for _, replacement := range module.Replace {
		if replacement.Old.Path != Module {
			continue
		}
		line := 0
		if replacement.Syntax != nil {
			line = replacement.Syntax.Start.Line
		}
		kind := "a replace directive"
		if replacement.Old.Version != "" {
			kind = "a version-specific replace directive"
		}
		return declared, selectionConflict(consumer, Published{Module: Module, Version: replacement.Old.Version}, fmt.Sprintf(
			"%s/go.mod (line %d) contains %s for %s: published SDK mode refuses every SDK replacement, including dormant ones. "+
				"Remove it from that repository, or select the plugin-sdk repository to build against explicit SDK source",
			consumer, line, kind, Module))
	}
	if files.Vendored {
		return declared, selectionConflict(consumer, Published{}, fmt.Sprintf(
			"%s vendors its dependencies: Go would compile repository-local SDK bytes instead of the verified module. "+
				"Remove the vendor directory from that repository, or select the plugin-sdk repository to build against explicit SDK source",
			consumer))
	}
	required := ""
	for _, requirement := range module.Require {
		if requirement.Mod.Path != Module {
			continue
		}
		if required == "" || semver.Compare(requirement.Mod.Version, required) > 0 {
			required = requirement.Mod.Version
		}
	}
	if required == "" {
		return declared, contractMismatch(consumer, fmt.Sprintf("%s/go.mod does not declare %s; select compatible host and plugin branches", consumer, Module))
	}
	if !semver.IsValid(required) || semver.Canonical(required) != required {
		return declared, contractMismatch(consumer, fmt.Sprintf("%s/go.mod requires %s at %q, which is not a canonical module version", consumer, Module, required))
	}
	declared = Published{Module: Module, Version: required}
	declared.ModuleSum, declared.GoModSum, err = recordedSums(files.GoSum, required)
	if err != nil {
		return declared, integrityMismatch(consumer, declared, fmt.Sprintf("%s/go.sum %v; repair the source branch", consumer, err), nil)
	}
	if declared.ModuleSum == "" || declared.GoModSum == "" {
		return declared, checksumsRequired(consumer, declared, fmt.Sprintf(
			"%s/go.sum lacks the checksums of %s %s (module and go.mod); update go.sum in that repository's source branch, "+
				"nothing was downloaded or written", consumer, Module, required), nil)
	}
	if err = declared.validate(); err != nil {
		return declared, checksumsRequired(consumer, declared, fmt.Sprintf("%s/go.sum records no valid checksum for %s %s: %v", consumer, Module, required, err), nil)
	}
	return declared, nil
}

// recordedSums returns the module and go.mod checksums a go.sum records for the
// SDK at version, or an error when it records conflicting values for either.
func recordedSums(goSum []byte, version string) (moduleSum, goModSum string, err error) {
	for _, line := range strings.Split(string(goSum), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 3 || fields[0] != Module {
			continue
		}
		target := &moduleSum
		switch fields[1] {
		case version:
		case version + "/go.mod":
			target = &goModSum
		default:
			continue
		}
		if *target != "" && *target != fields[2] {
			return "", "", fmt.Errorf("records conflicting checksums for %s %s", Module, fields[1])
		}
		*target = fields[2]
	}
	return moduleSum, goModSum, nil
}
