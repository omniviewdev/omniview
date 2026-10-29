package devworkspace

import (
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"golang.org/x/mod/semver"
	"gopkg.in/yaml.v3"
)

// Diagnose only provable manifest conflicts. Native strict peer resolution remains
// authoritative for complex ranges, aliases, overrides, and resolved lock versions.
func validateLinkedPeerContracts(w Workspace, plan linkPlan) error {
	var overrideSelectors []string
	// Policy can change effective dependency and peer ranges. Do not second-guess
	// native resolution when the composed cohort uses these features.
	if plan.Composition != nil {
		for _, file := range plan.Composition.Files {
			if filepath.Base(file.Path) != "pnpm-workspace.yaml" {
				continue
			}
			var policy map[string]any
			if err := yaml.Unmarshal(file.Data, &policy); err != nil {
				return err
			}
			if entries, _ := policy["packageExtensions"].(map[string]any); len(entries) != 0 {
				return nil
			}
			overrides, _ := policy["overrides"].(map[string]any)
			for selector := range overrides {
				overrideSelectors = append(overrideSelectors, selector)
			}
		}
	}
	packages := make(map[string]map[string]any)
	read := func(path string) (map[string]any, error) {
		if pkg, ok := packages[path]; ok {
			return pkg, nil
		}
		pkg, err := readLinkPackage(path)
		if err == nil {
			packages[path] = pkg
		}
		return pkg, err
	}
	var conflicts []string
	for _, consumer := range plan.Consumers {
		pkg, err := read(consumer.Path)
		if err != nil {
			return err
		}
		providers := map[string]string{}
		for _, section := range []string{"devDependencies", "dependencies", "optionalDependencies"} {
			entries, _ := pkg[section].(map[string]any)
			for name, value := range entries {
				if version, ok := value.(string); ok {
					providers[name] = version
				}
			}
		}
		visited := map[string]bool{}
		// Check only direct linked edges. Transitive peers can resolve against
		// dependencies supplied by an intermediate package, not this consumer.
		// Every discovered package gets its own direct-edge check.
		visit := func(path string) error {
			if visited[path] {
				return nil
			}
			visited[path] = true
			linked, err := read(path)
			if err != nil {
				return err
			}
			peers, _ := linked["peerDependencies"].(map[string]any)
			for name, value := range peers {
				required, ok := value.(string)
				if !ok || consumer.Targets[name] != "" {
					continue
				}
				adjusted := false
				for _, selector := range overrideSelectors {
					if selector == name || strings.Contains(selector, name+"@") || strings.HasSuffix(selector, ">"+name) {
						adjusted = true
						break
					}
				}
				if adjusted {
					continue
				}
				provided := providers[name]
				if !manifestRangesDisjoint(provided, required) {
					continue
				}
				from, _ := filepath.Rel(w.Root, filepath.Join(consumer.Path, "package.json"))
				to, _ := filepath.Rel(w.Root, filepath.Join(path, "package.json"))
				conflicts = append(conflicts, fmt.Sprintf("%s declares %s %s, but linked %s requires peer %s", from, name, provided, to, required))
			}
			return nil
		}
		for name := range providers {
			if target := consumer.Targets[name]; target != "" {
				if err := visit(target); err != nil {
					return err
				}
			}
		}
	}
	if len(conflicts) == 0 {
		return nil
	}
	sort.Strings(conflicts)
	return devcontract.Fail(3, "peer_contract_mismatch", safeCompilerDiagnostic(strings.Join(conflicts, "; ")+"; select compatible source revisions or reconcile the named manifests; strict peer validation remains enabled", w.Root))
}

// Ordinary exact, caret, and tilde ranges suffice for pinned source cohorts.
// Unknown syntax is left to pnpm, never treated as an incompatibility here.
func manifestRange(value string) (lower, upper string, ok bool) {
	value = strings.TrimSpace(value)
	kind := byte(0)
	if strings.HasPrefix(value, "^") || strings.HasPrefix(value, "~") {
		kind, value = value[0], value[1:]
	}
	parts := strings.Split(value, ".")
	if len(parts) != 3 || strings.ContainsAny(value, "-+") {
		return "", "", false
	}
	var numbers [3]int
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 || strconv.Itoa(n) != part {
			return "", "", false
		}
		numbers[i] = n
	}
	lower = "v" + value
	if !semver.IsValid(lower) {
		return "", "", false
	}
	if kind == 0 {
		return lower, "", true
	}
	index := 1
	if kind == '^' {
		index = 0
		for index < 2 && numbers[index] == 0 {
			index++
		}
	}
	if numbers[index] == int(^uint(0)>>1) {
		return "", "", false
	}
	numbers[index]++
	for i := index + 1; i < 3; i++ {
		numbers[i] = 0
	}
	return lower, fmt.Sprintf("v%d.%d.%d", numbers[0], numbers[1], numbers[2]), true
}

func manifestRangesDisjoint(left, right string) bool {
	lo, hi, ok := manifestRange(left)
	otherLo, otherHi, otherOK := manifestRange(right)
	if !ok || !otherOK {
		return false
	}
	if hi == "" && otherHi == "" {
		return semver.Compare(lo, otherLo) != 0
	}
	if hi == "" {
		return semver.Compare(lo, otherLo) < 0 || semver.Compare(lo, otherHi) >= 0
	}
	if otherHi == "" {
		return semver.Compare(otherLo, lo) < 0 || semver.Compare(otherLo, hi) >= 0
	}
	return semver.Compare(hi, otherLo) <= 0 || semver.Compare(otherHi, lo) <= 0
}
