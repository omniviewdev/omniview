package devcompose

import (
	"path/filepath"
	"reflect"
	"regexp"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

var registryVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)

// Native12 writes tool/config metadata in a separate first YAML document. It
// must remain distinct from ordinary application importers, especially '.'.
func metadataDocument(doc map[string]any) bool {
	importers := mapping(doc["importers"])
	if len(importers) == 0 {
		return false
	}
	found := false
	for _, v := range importers {
		m := mapping(v)
		for k := range m {
			if k == "packageManagerDependencies" || k == "configDependencies" {
				found = true
			} else {
				return false
			}
		}
	}
	return found
}
func mergeRecords(dst map[string]any, src any, setting, source string) error {
	m := mapping(src)
	if src != nil && m == nil {
		return refusal("invalid lock %s records in %s", setting, source)
	}
	for _, key := range sortedKeys(m) {
		value := m[key]
		if old, ok := dst[key]; ok && !reflect.DeepEqual(old, value) {
			return refusal("conflicting lock %s record from %s; resolve source locks before composition", setting, source)
		}
		dst[key] = value
	}
	return nil
}
func seedLock(w devcontract.ResolvedWorkspace, sources sourceSet, plan Plan, policy map[string]any) ([]map[string]any, map[string]string, error) {
	emptyDocument := func() map[string]any {
		return map[string]any{
			"lockfileVersion": "9.0",
			"importers":       map[string]any{},
			"packages":        map[string]any{},
			"snapshots":       map[string]any{},
		}
	}
	main, metadata := emptyDocument(), emptyDocument()
	haveMetadata := false
	documents := map[string]map[string]any{}
	// Only the nearest actual source lock owns a package's importer. Parent lock
	// leftovers cannot override a nested workspace's frozen registry selection.
	nearest := map[string]string{}
	for _, pkg := range plan.Packages {
		for _, path := range sources.locks {
			if within(filepath.Dir(path), pkg.Path) && len(path) > len(nearest[pkg.Path]) {
				nearest[pkg.Path] = path
			}
		}
	}
	for _, path := range sources.locks {
		raw, err := readInput(w, &sources, path)
		if err != nil {
			return nil, nil, err
		}
		docs, err := decodeDocuments(raw)
		source := relative(w.Root, path)
		if err != nil {
			return nil, nil, refusal("invalid source lock in %s", source)
		}
		if len(docs) < 1 || len(docs) > 2 {
			return nil, nil, refusal("unsupported source lock document layout in %s", source)
		}
		if len(docs) == 2 {
			if !metadataDocument(docs[0]) || metadataDocument(docs[1]) {
				return nil, nil, refusal("unsupported native12 metadata layout in %s", source)
			}
			if err := mergeMetadata(metadata, docs[0], source); err != nil {
				return nil, nil, err
			}
			haveMetadata = true
		}
		doc := docs[len(docs)-1]
		if metadataDocument(doc) {
			return nil, nil, refusal("source lock has metadata but no application document in %s", source)
		}
		if doc["lockfileVersion"] != "9.0" {
			return nil, nil, refusal("unsupported source lock version in %s", source)
		}
		if err := mergeLockPolicy(main, doc, source); err != nil {
			return nil, nil, err
		}
		if err := mergeLockedPatches(w, main, doc, policy, path); err != nil {
			return nil, nil, err
		}
		for _, key := range []string{"packages", "snapshots"} {
			for _, record := range mapping(doc[key]) {
				if err := safePolicyValue(record); err != nil {
					return nil, nil, refusal("repository-relative or credential-bearing lock resolution in %s requires explicit reconciliation", source)
				}
				resolution := mapping(mapping(record)["resolution"])
				if _, exists := resolution["directory"]; exists {
					return nil, nil, refusal("directory lock resolution in %s requires explicit reconciliation", source)
				}
				if tarball, ok := resolution["tarball"].(string); ok && !strings.Contains(tarball, "://") {
					return nil, nil, refusal("relative tarball lock resolution in %s requires explicit reconciliation", source)
				}
			}
			if err := mergeRecords(mapping(main[key]), doc[key], key, source); err != nil {
				return nil, nil, err
			}
		}
		importers := mapping(doc["importers"])
		if importers == nil {
			return nil, nil, refusal("source lock has no importers in %s", source)
		}
		for _, key := range sortedKeys(importers) {
			if filepath.IsAbs(key) || !within(filepath.Dir(path), filepath.Join(filepath.Dir(path), key)) {
				return nil, nil, refusal("source lock importer escapes its workspace in %s", source)
			}
			dir := filepath.Join(filepath.Dir(path), filepath.FromSlash(key))
			if nearest[dir] != path {
				continue
			}
			if _, selected := sources.manifests[dir]; !selected {
				continue
			}
			importer := mapping(importers[key])
			if importer == nil {
				return nil, nil, refusal("invalid source lock importer in %s", source)
			}
			rewritten, err := rewriteImporter(w, plan, dir, importer, source)
			if err != nil {
				return nil, nil, err
			}
			target := relative(plan.Root, dir)
			if old, exists := mapping(main["importers"])[target]; exists && !reflect.DeepEqual(old, rewritten) {
				return nil, nil, refusal("conflicting source lock importer in %s", source)
			}
			mapping(main["importers"])[target] = rewritten
		}
		documents[path] = doc
	}
	if _, exists := main["settings"]; !exists {
		main["settings"] = map[string]any{"autoInstallPeers": true, "excludeLinksFromLockfile": false}
	}
	for _, key := range []string{"autoInstallPeers", "excludeLinksFromLockfile"} {
		if value, exists := policy[key]; exists {
			mapping(main["settings"])[key] = value
		}
	}
	providers, err := lockedHostProviders(w, sources, documents, nearest)
	if err != nil {
		return nil, nil, err
	}
	if haveMetadata {
		return []map[string]any{metadata, main}, providers, nil
	}
	return []map[string]any{main}, providers, nil
}

func mergeLockPolicy(dst, src map[string]any, source string) error {
	for key, value := range src {
		switch key {
		case "lockfileVersion", "importers", "packages", "snapshots", "overrides", "catalogs", "patchedDependencies":
		case "settings", "packageExtensionsChecksum", "ignoredOptionalDependencies":
			if err := safePolicyValue(value); err != nil {
				return refusal("nonrepresentable lock setting %s in %s", key, source)
			}
			if key == "settings" {
				settings := mapping(value)
				if settings == nil {
					return refusal("invalid lock settings in %s", source)
				}
				for setting := range settings {
					if setting != "autoInstallPeers" && setting != "excludeLinksFromLockfile" {
						return refusal("unsupported lock setting %s in %s", safeSetting(setting), source)
					}
				}
			}
			if old, exists := dst[key]; exists && !reflect.DeepEqual(old, value) {
				return refusal("conflicting lock %s in %s", key, source)
			}
			dst[key] = value
		default:
			return refusal("unsupported source lock setting %s in %s", safeSetting(key), source)
		}
	}
	if value, exists := src["catalogs"]; exists {
		if err := safePolicyValue(value); err != nil {
			return refusal("credential-bearing locked catalogs in %s cannot be copied", source)
		}
		prior := dst["catalogs"]
		if prior == nil {
			prior = map[string]any{}
		}
		merged, err := mergePolicyMap(prior, value, "locked catalogs", "composed source locks", source)
		if err != nil {
			return err
		}
		dst["catalogs"] = merged
	}
	return nil
}

func mergeLockedPatches(w devcontract.ResolvedWorkspace, dst, src, policy map[string]any, lockPath string) error {
	value, exists := src["patchedDependencies"]
	if !exists {
		return nil
	}
	source := relative(w.Root, lockPath)
	patches := mapping(value)
	if patches == nil {
		return refusal("invalid locked patch records in %s", source)
	}
	rewritten := map[string]any{}
	repo, err := repository(w, filepath.Dir(lockPath))
	if err != nil {
		return err
	}
	for name, value := range patches {
		record := mapping(value)
		if record == nil {
			return refusal("unsupported locked patch record in %s", source)
		}
		if err := safePolicyValue(record); err != nil {
			return refusal("credential-bearing locked patch in %s cannot be copied", source)
		}
		for key := range record {
			if key != "path" && key != "hash" {
				return refusal("unsupported locked patch setting %s in %s", safeSetting(key), source)
			}
		}
		patch, ok := record["path"].(string)
		if !ok {
			return refusal("locked patch lacks path in %s", source)
		}
		absolute := patch
		if !filepath.IsAbs(absolute) {
			absolute = filepath.Join(filepath.Dir(lockPath), filepath.FromSlash(patch))
		}
		if !within(repo, absolute) || exactPath(absolute) != nil {
			return refusal("locked patch escapes or redirects selected repository in %s", source)
		}
		if mapping(policy["patchedDependencies"])[name] != relative(w.Root, absolute) {
			return refusal("locked patch in %s does not match a reconciled source patch policy", source)
		}
		// Reconciliation already fingerprints every effective patch file. Do not
		// create an additional source authority for stale lock-only patch settings.
		copy := map[string]any{}
		for key, value := range record {
			copy[key] = value
		}
		copy["path"] = relative(w.Root, absolute)
		rewritten[name] = copy
	}
	if dst["patchedDependencies"] == nil {
		dst["patchedDependencies"] = map[string]any{}
	}
	return mergeRecords(mapping(dst["patchedDependencies"]), rewritten, "patchedDependencies", source)
}

func lockedHostProviders(w devcontract.ResolvedWorkspace, sources sourceSet, documents map[string]map[string]any, nearest map[string]string) (map[string]string, error) {
	host, _ := w.RepositoryPath("omniview")
	providers := map[string]string{}
	manifest := sources.manifests[host]
	lock := nearest[host]
	var importer map[string]any
	if doc := documents[lock]; doc != nil {
		importer = mapping(mapping(doc["importers"])[relative(filepath.Dir(lock), host)])
	}
	for _, name := range []string{"react", "react-dom"} {
		specifier, locked := "", ""
		for _, section := range []string{"dependencies", "devDependencies", "optionalDependencies"} {
			if value, ok := mapping(manifest[section])[name].(string); ok {
				specifier = value
				break
			}
		}
		if specifier == "" {
			continue
		}
		for _, section := range []string{"dependencies", "devDependencies", "optionalDependencies"} {
			if value, ok := mapping(mapping(importer[section])[name])["version"].(string); ok {
				locked = strings.SplitN(value, "(", 2)[0]
				break
			}
		}
		if locked == "" {
			if lock != "" {
				return nil, refusal("selected host lock has no registry %s provider", name)
			}
			if strings.Contains(specifier, ":") || strings.ContainsAny(specifier, "/\\") {
				return nil, refusal("selected host %s must resolve from a registry", name)
			}
			providers[name] = specifier
			continue
		}
		if !registryVersion.MatchString(locked) {
			return nil, refusal("selected host %s provider is not a locked registry version", name)
		}
		resolution := mapping(mapping(mapping(documents[lock]["packages"])[name+"@"+locked])["resolution"])
		if integrity, ok := resolution["integrity"].(string); !ok || integrity == "" {
			return nil, refusal("selected host %s provider lacks locked registry integrity", name)
		}
		providers[name] = locked
	}
	return providers, nil
}
func mergeMetadata(dst, src map[string]any, source string) error {
	if src["lockfileVersion"] != "9.0" {
		return refusal("unsupported native12 metadata version in %s", source)
	}
	if err := safePolicyValue(src); err != nil {
		return refusal("credential-bearing or repository-local native12 metadata in %s cannot be copied", source)
	}
	for key := range src {
		if key != "lockfileVersion" && key != "importers" && key != "packages" && key != "snapshots" {
			return refusal("unsupported native12 metadata setting %s in %s", safeSetting(key), source)
		}
	}
	for _, key := range []string{"packages", "snapshots"} {
		if err := mergeRecords(mapping(dst[key]), src[key], "metadata "+key, source); err != nil {
			return err
		}
	}
	for key, value := range mapping(src["importers"]) {
		if key != "." {
			return refusal("unsupported native12 metadata importer in %s", source)
		}
		importer := mapping(value)
		if config, exists := importer["configDependencies"]; exists {
			dependencies := mapping(config)
			if dependencies == nil || len(dependencies) != 0 {
				return refusal("repository-local config dependencies in %s cannot be copied to managed root", source)
			}
		}
		if managers, exists := importer["packageManagerDependencies"]; exists {
			dependencies := mapping(managers)
			if dependencies == nil {
				return refusal("invalid native12 package manager metadata in %s", source)
			}
			for name, value := range dependencies {
				record := mapping(value)
				if name != "pnpm" || record["version"] != Version || record["specifier"] != Version {
					return refusal("incompatible native12 package manager metadata in %s", source)
				}
			}
		}
		if old, exists := mapping(dst["importers"])[key]; exists && !reflect.DeepEqual(old, value) {
			return refusal("conflicting native12 tool metadata in %s", source)
		}
		mapping(dst["importers"])[key] = value
	}
	return nil
}
func rewriteImporter(w devcontract.ResolvedWorkspace, p Plan, dir string, src map[string]any, source string) (map[string]any, error) {
	out := map[string]any{}
	for key, value := range src {
		switch key {
		case "dependencies", "devDependencies", "optionalDependencies":
			deps := mapping(value)
			if deps == nil {
				return nil, refusal("invalid dependency importer in %s", source)
			}
			rewritten := map[string]any{}
			for name, entry := range deps {
				record := mapping(entry)
				if record == nil {
					return nil, refusal("unsupported dependency record in %s", source)
				}
				copy := map[string]any{}
				for field, value := range record {
					// Local links are validated separately below; all other URL-bearing
					// values must be safe to persist without copying private credentials.
					if text, ok := value.(string); ok && (strings.Contains(text, "://") || strings.Contains(text, "${")) {
						if err := safePolicyValue(text); err != nil {
							return nil, refusal("credential-bearing lock importer in %s cannot be copied", source)
						}
					}
					copy[field] = value
				}
				if target, ok := p.Targets[name]; ok {
					copy["version"] = "link:" + relative(dir, target)
				} else if version, ok := record["version"].(string); ok {
					if strings.HasPrefix(version, "file:") {
						return nil, refusal("file dependency lock in %s requires explicit reconciliation", source)
					}
					if strings.HasPrefix(version, "link:") {
						target := filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(version, "link:")))
						if !within(w.Root, target) || exactPath(target) != nil {
							return nil, refusal("linked source lock dependency in %s escapes selected composition", source)
						}
						selected := false
						for _, pkg := range p.Packages {
							if pkg.Path == target {
								selected = true
								break
							}
						}
						if !selected {
							return nil, refusal("linked dependency in %s is not an actual selected package", source)
						}
					}
				}
				rewritten[name] = copy
			}
			out[key] = rewritten
		case "dependenciesMeta":
			if err := safePolicyValue(value); err != nil {
				return nil, refusal("unsupported dependency metadata in %s", source)
			}
			out[key] = value
		case "publishDirectory":
			return nil, refusal("publishDirectory importer in %s requires explicit source-path reconciliation", source)
		default:
			return nil, refusal("unsupported application importer setting %s in %s", safeSetting(key), source)
		}
	}
	return out, nil
}
