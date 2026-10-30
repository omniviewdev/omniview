package devcompose

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
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

// Native pnpm records effective peers after overrides, so standalone roots can
// describe one tarball differently. Only policy-explained peer differences and
// additive registry metadata can be reconciled without native resolution.
func mergePackageRecord(left, right, policy map[string]any, source string) (map[string]any, error) {
	merged := make(map[string]any, len(left))
	for field, v := range left {
		merged[field] = v
	}
	for _, field := range sortedKeys(right) {
		v := right[field]
		prior, present := left[field]
		if present && reflect.DeepEqual(prior, v) {
			continue
		}
		switch field {
		case "libc", "deprecated":
			// Retain a present platform constraint instead of making the
			// package unrestricted because another lock predates it.
			if present {
				return nil, refusal("conflicting lock packages %s metadata in %s", field, source)
			}
			merged[field] = v
		case "peerDependencies":
			peers, ok := reconcileLockedPeers(mapping(prior), mapping(v), policy)
			if !present || !ok {
				return nil, refusal("conflicting lock packages peerDependencies metadata in %s", source)
			}
			merged[field] = peers
		default:
			return nil, refusal("conflicting lock packages %s metadata in %s; reconcile source locks before composition", safeSetting(field), source)
		}
	}
	for _, field := range sortedKeys(left) {
		if _, present := right[field]; !present && field != "libc" && field != "deprecated" {
			return nil, refusal("conflicting lock packages %s metadata in %s; reconcile source locks before composition", safeSetting(field), source)
		}
	}
	return merged, nil
}

// Deliberately cover only unconditional bare-name overrides with ordinary
// exact/caret/tilde versions. More-specific selectors or non-semver overrides
// need native resolution, not a second partial override interpreter here.
var lockedPeerOverride = regexp.MustCompile(`^[~^]?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)

func reconcileLockedPeers(left, right, policy map[string]any) (map[string]any, bool) {
	if left == nil || right == nil || len(left) != len(right) {
		return nil, false
	}
	overrides := mapping(policy["overrides"])
	peers := make(map[string]any, len(left))
	for name, prior := range left {
		value, present := right[name]
		if !present {
			return nil, false
		}
		if reflect.DeepEqual(prior, value) {
			peers[name] = value
			continue
		}
		replacement, ok := overrides[name].(string)
		if !ok || !lockedPeerOverride.MatchString(replacement) {
			return nil, false
		}
		for selector := range overrides {
			// A version comparator can contain '>'; it is not a parent
			// separator. Refuse unsupported qualified rules before splitting.
			if selector != name && strings.Contains(selector, name+"@") {
				return nil, false
			}
			target := selector
			if i := strings.LastIndex(target, ">"); i >= 0 {
				target = target[i+1:]
			}
			if selector != name && (target == name || strings.HasPrefix(target, name+"@")) {
				return nil, false
			}
		}
		peers[name] = replacement
	}
	return peers, true
}

// Host-led convergence keeps preferred child pins, while retaining compatible
// additional edges. Native's single install and recursive audit own the final
// graph, which may differ from every standalone source graph.
func mergeSnapshotRecord(left, right map[string]any, source string) (map[string]any, error) {
	merged := make(map[string]any, len(left))
	for field, v := range left {
		merged[field] = v
	}
	for _, field := range sortedKeys(right) {
		v := right[field]
		prior, present := left[field]
		if present && reflect.DeepEqual(prior, v) {
			continue
		}
		switch field {
		case "dependencies", "optionalDependencies":
			if mapping(v) == nil || (present && mapping(prior) == nil) {
				return nil, refusal("invalid lock snapshots %s in %s", field, source)
			}
			deps := make(map[string]any, len(mapping(v))+len(mapping(prior)))
			for name, version := range mapping(v) {
				deps[name] = version
			}
			for name, version := range mapping(prior) {
				deps[name] = version
			}
			merged[field] = deps
		case "optional":
			if _, ok := v.(bool); !ok {
				return nil, refusal("invalid lock snapshots optional in %s", source)
			}
			if _, ok := prior.(bool); present && !ok {
				return nil, refusal("invalid lock snapshots optional in %s", source)
			}
			if prior == true && v == true {
				merged[field] = true
			} else {
				delete(merged, field)
			}
		case "transitivePeerDependencies":
			names := map[string]bool{}
			for _, value := range []any{prior, v} {
				if value == nil {
					continue
				}
				list, ok := value.([]any)
				if !ok {
					return nil, refusal("invalid lock snapshots transitivePeerDependencies in %s", source)
				}
				for _, item := range list {
					name, ok := item.(string)
					if !ok {
						return nil, refusal("invalid lock snapshots transitivePeerDependencies in %s", source)
					}
					names[name] = true
				}
			}
			list := make([]any, 0, len(names))
			for _, name := range sortedKeys(names) {
				list = append(list, name)
			}
			merged[field] = list
		default:
			return nil, refusal("conflicting lock snapshots %s metadata in %s; reconcile source locks before composition", safeSetting(field), source)
		}
	}
	for _, field := range sortedKeys(left) {
		if _, present := right[field]; !present {
			switch field {
			case "optional":
				delete(merged, field)
			case "dependencies", "optionalDependencies", "transitivePeerDependencies":
			default:
				return nil, refusal("conflicting lock snapshots %s metadata in %s; reconcile source locks before composition", safeSetting(field), source)
			}
		}
	}
	// Required paths win when another root labels the same child edge optional.
	// Across the two maps, the preferred source still owns the selected pin.
	required, optional := mapping(merged["dependencies"]), mapping(merged["optionalDependencies"])
	for name := range optional {
		if _, exists := required[name]; exists {
			if version, preferred := mapping(left["dependencies"])[name]; preferred {
				required[name] = version
			} else if version, preferred := mapping(left["optionalDependencies"])[name]; preferred {
				required[name] = version
			}
			delete(optional, name)
		}
	}
	return merged, nil
}

var reportableLockKey = regexp.MustCompile(`^(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+@[0-9][0-9A-Za-z._+@/()=-]*$`)

func mergeSeedRecords(dst map[string]any, src any, section, source string, owners map[string]string, plan *Plan, policy map[string]any) error {
	records := mapping(src)
	if src != nil && records == nil {
		return refusal("invalid lock %s records in %s", section, source)
	}
	for _, key := range sortedKeys(records) {
		value := records[key]
		old, exists := dst[key]
		if !exists {
			dst[key], owners[key] = value, source
			continue
		}
		if reflect.DeepEqual(old, value) {
			continue
		}
		left, right := mapping(old), mapping(value)
		if left == nil || right == nil {
			return refusal("invalid lock %s record in %s", section, source)
		}
		changed := map[string]bool{}
		for field, v := range left {
			if other, present := right[field]; !present || !reflect.DeepEqual(v, other) {
				changed[safeSetting(field)] = true
			}
		}
		for field := range right {
			if _, present := left[field]; !present {
				changed[safeSetting(field)] = true
			}
		}
		var merged map[string]any
		var err error
		if section == "packages" {
			merged, err = mergePackageRecord(left, right, policy, source)
		} else {
			merged, err = mergeSnapshotRecord(left, right, source)
		}
		if err != nil {
			return err
		}
		reportKey := key
		if !reportableLockKey.MatchString(key) {
			reportKey = "sha256:" + hash([]byte(key))
		}
		plan.Convergence = append(plan.Convergence, LockConvergence{
			Section: section, PackageKey: reportKey, PreferredSource: owners[key],
			OtherSource: source, ChangedFields: sortedKeys(changed),
		})
		dst[key] = merged
	}
	return nil
}

func seedLock(w devcontract.ResolvedWorkspace, sources sourceSet, plan *Plan, policy map[string]any) ([]map[string]any, map[string]string, error) {
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
	owners := map[string]map[string]string{"packages": {}, "snapshots": {}}
	host, _ := w.RepositoryPath("omniview")
	ui := ""
	if w.Manifest.Links.UIRepositoryID != nil {
		ui, _ = w.RepositoryPath(*w.Manifest.Links.UIRepositoryID)
	}
	priority := func(path string) int {
		switch path {
		case filepath.Join(host, "pnpm-lock.yaml"):
			return 0
		case filepath.Join(ui, "pnpm-lock.yaml"):
			if ui != "" {
				return 1
			}
		}
		return 2
	}
	sort.Slice(sources.locks, func(i, j int) bool {
		left, right := sources.locks[i], sources.locks[j]
		if priority(left) != priority(right) {
			return priority(left) < priority(right)
		}
		return relative(w.Root, left) < relative(w.Root, right)
	})
	// Declaration ownership is independent of whether its lock exists. A missing
	// nested owner's lock must not reactivate an enclosing leftover importer.
	nearest := map[string]string{}
	for _, pkg := range plan.Packages {
		owner := workspaceOwner(pkg.Path, sources.configs)
		if owner == "" {
			for _, root := range sources.roots {
				if within(root.Path, pkg.Path) && len(root.Path) > len(owner) {
					owner = root.Path
				}
			}
		}
		for _, path := range sources.locks {
			if filepath.Dir(path) == owner {
				nearest[pkg.Path] = path
				break
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
		if err := mergeLockedPatches(w, main, doc, policy, plan.SourceHashes, path); err != nil {
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
			if err := mergeSeedRecords(mapping(main[key]), doc[key], key, source, owners[key], plan, policy); err != nil {
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
			rewritten, err := rewriteImporter(w, *plan, dir, importer, source)
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

func mergeLockedPatches(w devcontract.ResolvedWorkspace, dst, src, policy map[string]any, sourceHashes map[string]string, lockPath string) error {
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
		if lockedHash, ok := value.(string); ok {
			if scalarErr := validateNativeScalarPatch(w, policy, sourceHashes, repo, source, name, lockedHash); scalarErr != nil {
				return scalarErr
			}
			rewritten[name] = lockedHash
			continue
		}
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

func validateNativeScalarPatch(w devcontract.ResolvedWorkspace, policy map[string]any, sourceHashes map[string]string, repo, source, name, lockedHash string) error {
	patch, declared := mapping(policy["patchedDependencies"])[name].(string)
	if !declared {
		lockPath := filepath.Join(w.Root, filepath.FromSlash(source))
		directory := "'" + strings.ReplaceAll(filepath.Dir(lockPath), "'", "'\\''") + "'"
		command := "(export PNPM_CONFIG_WORKSPACE_DIR=" + directory + " npm_config_workspace_dir=" + directory + " pnpm_config_pm_on_fail=error; " +
			"native=\"${OMNIVIEW_PNPM_EXECUTABLE:?Set canonical native pnpm " + Version + " executable}\"; " +
			"test \"$(\"$native\" --version)\" = '" + Version + "' && " +
			"\"$native\" --dir " + directory + " install --lockfile-only --ignore-scripts --no-frozen-lockfile)"
		return refusal("locked scalar patch in %s lacks a reconciled source declaration; regenerate standalone lockfile %s using canonical native pnpm %s (not the managed launcher): %s", source, lockPath, Version, command)
	}
	absolute := filepath.Join(w.Root, filepath.FromSlash(patch))
	if !within(repo, absolute) || exactPath(absolute) != nil {
		return refusal("locked patch escapes or redirects selected repository in %s", source)
	}
	fingerprint, recorded := sourceHashes[patch]
	if !recorded || len(fingerprint) != 64 || len(lockedHash) != 64 {
		return refusal("locked patch hash in %s lacks a reconciled source fingerprint", source)
	}
	// Re-reading through the existing fingerprint refuses any raw-byte change,
	// including CRLF/LF changes that retain the same native package identity.
	inputs := sourceSet{hashes: sourceHashes}
	raw, readErr := readInput(w, &inputs, absolute)
	if readErr != nil {
		return readErr
	}
	matches := fingerprint == lockedHash
	if crlf := bytes.Index(raw, []byte("\r\n")); crlf >= 0 {
		// Native12 hashes LF-normalized patch bytes. Stream the unchanged spans
		// rather than allocating a second copy of the entire patch.
		digest := sha256.New()
		for crlf >= 0 {
			digest.Write(raw[:crlf])
			raw = raw[crlf+1:]
			crlf = bytes.Index(raw, []byte("\r\n"))
		}
		digest.Write(raw)
		var sum [sha256.Size]byte
		normalized := digest.Sum(sum[:0])
		var encoded [sha256.Size * 2]byte
		hex.Encode(encoded[:], normalized)
		matches = string(encoded[:]) == lockedHash
	}
	if !matches {
		return refusal("locked patch hash in %s does not match its normalized source bytes", source)
	}
	return nil
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
func validateManifestDependencies(w devcontract.ResolvedWorkspace, p Plan, manifests map[string]map[string]any) error {
	for _, dir := range sortedKeys(manifests) {
		source := relative(w.Root, filepath.Join(dir, "package.json"))
		for _, section := range []string{"dependencies", "devDependencies", "optionalDependencies"} {
			for _, name := range sortedKeys(mapping(manifests[dir][section])) {
				specifier, ok := mapping(manifests[dir][section])[name].(string)
				if !ok {
					continue
				}
				if err := validateLocalDependency(w, p, dir, name, specifier, source); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// Explicit framework mappings have already been checked by validateTargets and
// replace source specifiers with workspace:*. Other local edges must resolve to
// the actual selected package, never another repository or an untracked member.
func validateLocalDependency(w devcontract.ResolvedWorkspace, p Plan, dir, name, specifier, source string) error {
	if _, managed := p.Targets[name]; managed {
		return nil
	}
	protocol, target, local := strings.Cut(specifier, ":")
	if !local {
		return nil
	}
	switch protocol {
	case "file":
		return refusal("file dependency in %s requires explicit reconciliation", source)
	case "workspace":
		if !strings.ContainsAny(target, "/\\") && !strings.HasPrefix(target, ".") {
			matches := 0
			for _, pkg := range p.Packages {
				if pkg.Name == name {
					matches++
				}
			}
			if matches != 1 {
				return refusal("workspace dependency in %s is not an unambiguous selected package", source)
			}
			return nil
		}
	case "link":
	default:
		return nil
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(dir, filepath.FromSlash(target))
	}
	if !within(w.Root, target) || exactPath(target) != nil {
		return refusal("linked dependency in %s escapes or redirects selected composition", source)
	}
	for _, pkg := range p.Packages {
		if pkg.Path == target && pkg.Name == name {
			return nil
		}
	}
	return refusal("linked dependency in %s is not an actual selected package with the declared name", source)
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
					if err := validateLocalDependency(w, p, dir, name, version, source); err != nil {
						return nil, err
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
