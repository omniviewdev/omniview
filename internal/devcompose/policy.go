package devcompose

import (
	"bytes"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"gopkg.in/yaml.v3"
)

// Every accepted policy has aggregate-root semantics. Adding a policy requires
// deciding its merge and relative-path semantics here; unknown keys fail closed.
var policyKeys = map[string]bool{
	"registry": true, "catalog": true, "catalogs": true, "overrides": true, "packageExtensions": true, "peerDependencyRules": true,
	"strictPeerDependencies": true, "autoInstallPeers": true, "resolvePeersFromWorkspaceRoot": true, "dedupePeerDependents": true,
	"resolutionMode": true, "excludeLinksFromLockfile": true, "preferWorkspacePackages": true, "linkWorkspacePackages": true,
	"injectWorkspacePackages": true, "saveWorkspaceProtocol": true, "sharedWorkspaceLockfile": true,
	"shamefullyHoist": true, "hoist": true, "hoistPattern": true, "publicHoistPattern": true, "nodeLinker": true,
	"minimumReleaseAge": true, "minimumReleaseAgeExclude": true, "pmOnFail": true, "managePackageManagerVersions": true,
	"packageManagerStrict": true, "packageManagerStrictVersion": true, "engineStrict": true, "useNodeVersion": true,
	"allowBuilds": true, "onlyBuiltDependencies": true, "ignoredBuiltDependencies": true, "neverBuiltDependencies": true,
	"dangerouslyAllowAllBuilds": true, "strictDepBuilds": true, "ignoreScripts": true,
	"patchedDependencies": true, "allowNonAppliedPatches": true, "updateConfig": true, "supportedArchitectures": true,
	"preferFrozenLockfile": true, "verifyStoreIntegrity": true, "trustPolicy": true, "trustPolicyExclude": true,
}
var mergedMaps = map[string]bool{"catalog": true, "catalogs": true, "overrides": true, "packageExtensions": true, "peerDependencyRules": true, "allowBuilds": true, "patchedDependencies": true}

func reconcile(w devcontract.ResolvedWorkspace, s sourceSet) (map[string]any, error) {
	out := map[string]any{}
	owners := map[string]string{}
	apply := func(settings map[string]any, path string) error {
		source := relative(w.Root, path)
		for _, key := range sortedKeys(settings) {
			value := settings[key]
			if key == "packages" {
				continue
			}
			if !policyKeys[key] && !(strings.HasPrefix(key, "@") && strings.HasSuffix(key, ":registry")) {
				return refusal("unsupported setting %s in %s; reconcile it explicitly before managed installation", safeSetting(key), source)
			}
			if e := safePolicyValue(value); e != nil {
				return refusal("credential-bearing or nonrepresentable setting %s in %s; use external registry authentication", safeSetting(key), source)
			}
			if mergedMaps[key] && mapping(value) == nil {
				return refusal("setting %s in %s must be a mapping", key, source)
			}
			if key == "allowBuilds" {
				for _, v := range mapping(value) {
					if _, ok := v.(bool); !ok {
						return refusal("allowBuilds in %s must contain explicit boolean approvals", source)
					}
				}
			}
			if key == "onlyBuiltDependencies" || key == "ignoredBuiltDependencies" || key == "neverBuiltDependencies" {
				list, ok := value.([]any)
				if !ok {
					return refusal("setting %s in %s must be a list", key, source)
				}
				for _, v := range list {
					if _, ok := v.(string); !ok {
						return refusal("setting %s in %s must contain package names", key, source)
					}
				}
			}
			switch key {
			case "strictPeerDependencies":
				if value != true {
					return refusal("setting strictPeerDependencies in %s conflicts with managed strict peers", source)
				}
			case "minimumReleaseAge":
				if !zero(value) {
					return refusal("setting minimumReleaseAge in %s conflicts with approved immediate-release policy", source)
				}
				value = 0
			case "dangerouslyAllowAllBuilds":
				if value != false {
					return refusal("setting dangerouslyAllowAllBuilds in %s is not supported for managed no-script installs", source)
				}
			case "sharedWorkspaceLockfile":
				if value != true {
					return refusal("setting sharedWorkspaceLockfile in %s conflicts with one managed workspace", source)
				}
			case "useNodeVersion", "managePackageManagerVersions":
				return refusal("setting %s in %s cannot replace the owned native toolchain", key, source)
			case "peerDependencyRules":
				m := mapping(value)
				for rule := range m {
					if rule == "ignoreMissing" || rule == "allowAny" || rule == "allowedVersions" {
						return refusal("setting peerDependencyRules.%s in %s would weaken managed peer validation", rule, source)
					}
				}
			}
			if key == "patchedDependencies" {
				m := mapping(value)
				if m == nil {
					return refusal("invalid setting patchedDependencies in %s", source)
				}
				resolved := map[string]any{}
				repo, e := repository(w, filepath.Dir(path))
				if e != nil {
					return e
				}
				for name, v := range m {
					p, ok := v.(string)
					if !ok {
						return refusal("unsupported patch declaration in %s", source)
					}
					abs := p
					if !filepath.IsAbs(abs) {
						abs = filepath.Join(filepath.Dir(path), p)
					}
					if !within(repo, abs) || exactPath(abs) != nil {
						return refusal("patch path in %s escapes or redirects its selected repository", source)
					}
					raw, e := readInput(w, &s, abs)
					if e != nil {
						return e
					}
					if raw == nil {
						return refusal("patch file in %s is missing", source)
					}
					resolved[name] = relative(w.Root, abs)
				}
				value = resolved
			}
			if prior, ok := out[key]; ok {
				var e error
				if mergedMaps[key] {
					value, e = mergePolicyMap(prior, value, key, owners[key], source)
				} else if !reflect.DeepEqual(prior, value) {
					e = refusal("setting %s conflicts between %s and %s", key, owners[key], source)
				}
				if e != nil {
					return e
				}
			}
			out[key] = value
			if owners[key] == "" {
				owners[key] = source
			}
		}
		return nil
	}
	for _, dir := range sortedKeys(s.configs) {
		if e := apply(s.configs[dir], filepath.Join(dir, "pnpm-workspace.yaml")); e != nil {
			return nil, e
		}
	}
	for _, dir := range sortedKeys(s.manifests) {
		m := s.manifests[dir]
		if pnpm, ok := m["pnpm"]; ok {
			settings := mapping(pnpm)
			if settings == nil {
				return nil, refusal("invalid pnpm policy in %s", relative(w.Root, filepath.Join(dir, "package.json")))
			}
			if e := apply(settings, filepath.Join(dir, "package.json")); e != nil {
				return nil, e
			}
		}
		if _, ok := m["resolutions"]; ok {
			return nil, refusal("package resolutions in %s require explicit pnpm overrides before managed installation", relative(w.Root, dir))
		}
	}
	for _, rel := range sortedKeys(s.hashes) {
		if filepath.Base(rel) != ".npmrc" || s.hashes[rel] == "absent" {
			continue
		}
		path := filepath.Join(w.Root, rel)
		raw, e := os.ReadFile(path)
		if e != nil {
			return nil, e
		}
		settings, e := npmSettings(raw, rel)
		if e != nil {
			return nil, e
		}
		if e = apply(settings, path); e != nil {
			return nil, e
		}
	}
	// A root must never authorize a build another root explicitly denied, even
	// though managed installation additionally disables every lifecycle script.
	allowed := mapping(out["allowBuilds"])
	for _, key := range []string{"ignoredBuiltDependencies", "neverBuiltDependencies"} {
		if list, ok := out[key].([]any); ok {
			for _, v := range list {
				if name, ok := v.(string); ok && allowed[name] == true {
					return nil, refusal("build approval conflicts with setting %s", key)
				}
			}
		}
	}
	if list, ok := out["onlyBuiltDependencies"].([]any); ok {
		permitted := map[string]bool{}
		for _, name := range list {
			permitted[name.(string)] = true
		}
		for name, approval := range allowed {
			if approval == true && !permitted[name] {
				return nil, refusal("build approval conflicts with setting onlyBuiltDependencies")
			}
		}
	}
	out["strictPeerDependencies"] = true
	out["ignoreScripts"] = true
	out["minimumReleaseAge"] = 0
	out["pmOnFail"] = "error"
	out["sharedWorkspaceLockfile"] = true
	return out, nil
}
func zero(v any) bool {
	switch n := v.(type) {
	case int:
		return n == 0
	case float64:
		return n == 0
	case int64:
		return n == 0
	}
	return false
}
func safeSetting(key string) string {
	if strings.ContainsAny(key, "\r\n\x00") || strings.Contains(strings.ToLower(key), "auth") || strings.Contains(key, "//") {
		return "[private registry setting]"
	}
	return key
}
func safePolicyValue(value any) error {
	switch value := value.(type) {
	case string:
		if strings.Contains(value, "${") {
			return refusal("environment-dependent policy")
		}
		candidate := strings.TrimSpace(value)
		if policyURLValue(candidate) {
			parsed, err := url.Parse(candidate)
			if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
				return refusal("credential-bearing URL")
			}
		}
		if strings.HasPrefix(value, "link:") || strings.HasPrefix(value, "file:") {
			return refusal("repository-relative resolution must be explicitly reconciled")
		}
	case map[string]any:
		for key, child := range value {
			lower := strings.ToLower(key)
			if strings.HasPrefix(lower, "_auth") || lower == "authtoken" || lower == "_password" || lower == "password" || strings.HasPrefix(lower, "//") {
				return refusal("credential-bearing mapping")
			}
			if err := safePolicyValue(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range value {
			if err := safePolicyValue(child); err != nil {
				return err
			}
		}
	}
	return nil
}

// Registry records also contain prose (for example deprecation notices). An
// embedded URL does not make that entire sentence a URL-valued resolution.
func policyURLValue(value string) bool {
	end := strings.Index(value, "://")
	if end < 1 {
		return false
	}
	for i := range end {
		c := value[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (i > 0 && ((c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.')) {
			continue
		}
		return false
	}
	return true
}
func mergePolicyMap(a, b any, key, left, right string) (any, error) {
	am, bm := mapping(a), mapping(b)
	if am == nil || bm == nil {
		return nil, refusal("invalid mapping setting %s in %s or %s", key, left, right)
	}
	out := map[string]any{}
	for k, v := range am {
		out[k] = v
	}
	for _, k := range sortedKeys(bm) {
		v := bm[k]
		if old, ok := out[k]; ok && !reflect.DeepEqual(old, v) {
			if key == "allowBuilds" {
				// Approval permits a build; it does not require one. Intersect
				// permissions without weakening any source's explicit denial.
				v = old == true && v == true
			} else if mapping(old) != nil && mapping(v) != nil {
				merged, e := mergePolicyMap(old, v, key+"."+safeSetting(k), left, right)
				if e != nil {
					return nil, e
				}
				v = merged
			} else {
				return nil, refusal("setting %s conflicts between %s and %s", key, left, right)
			}
		}
		out[k] = v
	}
	return out, nil
}
func managedOverride(overrides map[string]any, name, desired string) error {
	for key, value := range overrides {
		if key == name || strings.HasPrefix(key, name+"@") || strings.HasSuffix(key, ">"+name) || strings.Contains(key, ">"+name+"@") {
			if key != name || value != desired {
				return refusal("source override conflicts with managed target %s", name)
			}
		}
	}
	overrides[name] = desired
	return nil
}
func npmSettings(raw []byte, source string) (map[string]any, error) {
	out := map[string]any{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if !ok {
			return nil, refusal("unsupported repository-local npmrc in %s", source)
		}
		if strings.Contains(strings.ToLower(key), "auth") || strings.Contains(strings.ToLower(key), "token") || strings.Contains(strings.ToLower(key), "password") || strings.Contains(key, "//") {
			return nil, refusal("repository-local credentials in %s must remain external; they are never copied", source)
		}
		key = camel(key)
		if !policyKeys[key] && !(strings.HasPrefix(key, "@") && strings.HasSuffix(key, ":registry")) {
			return nil, refusal("unsupported npmrc setting %s in %s", safeSetting(key), source)
		}
		var v any
		if bytes.HasPrefix([]byte(value), []byte("[")) || bytes.HasPrefix([]byte(value), []byte("{")) {
			if yaml.Unmarshal([]byte(value), &v) != nil {
				return nil, refusal("invalid npmrc setting %s in %s", safeSetting(key), source)
			}
		} else if value == "true" || value == "false" {
			v = value == "true"
		} else if n, e := strconv.Atoi(value); e == nil {
			v = n
		} else {
			v = strings.Trim(value, "\"'")
		}
		out[key] = v
	}
	return out, nil
}
func camel(s string) string {
	if strings.HasPrefix(s, "@") {
		return s
	}
	parts := strings.Split(s, "-")
	for i := 1; i < len(parts); i++ {
		if parts[i] != "" {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, "")
}
