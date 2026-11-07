package devworkspace

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"golang.org/x/mod/modfile"
	"golang.org/x/mod/module"
)

// sdkProbe names a committed Git revision whose go.mod declares a consumer's
// plugin-sdk requirement. Only committed blobs are read: no network, no checkout.
type sdkProbe struct {
	Repository string
	GitDir     string
	Revision   string
}

// SDKRequirement is one consumer's declared plugin-sdk requirement, reported in
// the sdk_source_required error details.
type SDKRequirement struct {
	Repository string `json:"repository"`
	Module     string `json:"module"`
	Version    string `json:"version"`
	// Ref is the tag, or the commit embedded in a pseudo-version.
	Ref  string `json:"ref"`
	Kind string `json:"kind"`
}

func workspaceSDKProbes(w Workspace) []sdkProbe {
	var probes []sdkProbe
	for _, r := range w.Manifest.Repositories {
		if !filepath.IsLocal(r.Directory) {
			continue
		}
		probes = append(probes, sdkProbe{Repository: r.ID, GitDir: filepath.Join(w.Root, r.Directory), Revision: "HEAD"})
	}
	return probes
}

func declaredSDKRequirements(ctx context.Context, probes []sdkProbe) []SDKRequirement {
	var found []SDKRequirement
	for _, p := range probes {
		raw, err := git(ctx, p.GitDir, "", "show", p.Revision+":go.mod")
		if err != nil {
			continue
		}
		file, err := modfile.ParseLax("go.mod", []byte(raw), nil)
		if err != nil {
			continue
		}
		for _, req := range file.Require {
			if req.Mod.Path != linkedSDK {
				continue
			}
			requirement := SDKRequirement{Repository: p.Repository, Module: linkedSDK, Version: req.Mod.Version, Ref: req.Mod.Version, Kind: "tag"}
			if module.IsPseudoVersion(req.Mod.Version) {
				rev, revErr := module.PseudoVersionRev(req.Mod.Version)
				if revErr != nil {
					continue
				}
				requirement.Ref, requirement.Kind = rev, "pseudo-version"
			}
			found = append(found, requirement)
		}
	}
	sort.SliceStable(found, func(i, j int) bool {
		hi, hj := found[i].Repository == "omniview", found[j].Repository == "omniview"
		if hi != hj {
			return hi
		}
		return found[i].Repository < found[j].Repository
	})
	return found
}

// sdkSourceRequired keeps the sdk_source_required code and exit while naming the
// exact next command. It never selects the SDK itself. The host's requirement is
// preferred; differing consumer requirements are reported, not reconciled.
func sdkSourceRequired(ctx context.Context, message string, probes []sdkProbe, command func(ref string) string) *devcontract.Error {
	failure := devcontract.Fail(2, "sdk_source_required", message)
	requirements := declaredSDKRequirements(ctx, probes)
	if len(requirements) == 0 {
		return failure
	}
	chosen := requirements[0]
	mixed := false
	for _, r := range requirements[1:] {
		if r.Ref != chosen.Ref {
			mixed = true
		}
	}
	next := command(chosen.Ref)
	failure.Details = map[string]any{
		"requirements": requirements,
		"ref":          chosen.Ref,
		"nextCommand":  next,
		"mixed":        mixed,
	}
	failure.Message = fmt.Sprintf("%s; %s declares %s %s (%s); next: %s", message, chosen.Repository, linkedSDK, chosen.Version, chosen.Kind, next)
	if mixed {
		failure.Message += "; consumers declare different plugin-sdk versions (see details.requirements)"
	}
	return failure
}

func editAddSDKCommand(w Workspace) func(string) string {
	return func(ref string) string {
		executable := "omniview-dev"
		args := []string{executable, "workspace", "edit", "--workspace", w.ManifestPath, "--add-repo", "plugin-sdk", "--ref", "plugin-sdk=" + ref}
		if w.ManifestPath == "" {
			args = []string{executable, "workspace", "edit", w.Manifest.Slug, "--add-repo", "plugin-sdk", "--ref", "plugin-sdk=" + ref}
		}
		return strings.TrimSpace(shellCommand(args))
	}
}
