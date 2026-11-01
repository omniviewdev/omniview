package devworkspace

import (
	"context"
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// validateSDKImports checks source presence, not exported APIs or target-specific
// buildability. Scan all platform/tag variants so a launch on one OS does not
// silently bless a missing package used on another. Likewise, accept SDK source
// for any target; compilation remains authoritative for the selected target.
func validateSDKImports(ctx context.Context, root, sdk string) error {
	checked := make(map[string]bool)
	return filepath.WalkDir(root, func(file string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		// Exclude managed trees before inspecting links: node_modules commonly
		// points at package-manager state outside the consumer.
		if file != root && sdkImportExcludedDirectory(entry.Name()) && (entry.IsDir() || entry.Type()&os.ModeSymlink != 0) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if sdkGoSource(entry.Name()) {
				return fmt.Errorf("cannot inspect SDK imports through Go source symlink %s; replace it with an ordinary source file before launching", file)
			}
			target, err := os.Stat(file)
			if err != nil {
				return fmt.Errorf("cannot determine whether symlink %s contains Go packages; repair or remove the link before launching: %w", file, err)
			}
			if target.IsDir() {
				return fmt.Errorf("cannot inspect SDK imports through directory symlink %s; replace it with an ordinary source directory before launching", file)
			}
			return nil
		}
		if entry.IsDir() {
			if file == root {
				return nil
			}
			if _, err := os.Stat(filepath.Join(file, "go.mod")); err == nil {
				return filepath.SkipDir
			} else if !os.IsNotExist(err) {
				return err
			}
			return nil
		}
		if !sdkGoSource(entry.Name()) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("cannot inspect SDK imports in non-regular Go source %s; replace it with a regular file before launching", file)
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ImportsOnly)
		if err != nil {
			return fmt.Errorf("read SDK imports in %s: %w", file, err)
		}
		for _, spec := range parsed.Imports {
			if err := ctx.Err(); err != nil {
				return err
			}
			importPath, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return fmt.Errorf("read SDK import in %s: %w", file, err)
			}
			if importPath != linkedSDK && !strings.HasPrefix(importPath, linkedSDK+"/") || checked[importPath] {
				continue
			}
			checked[importPath] = true
			rel := strings.TrimPrefix(strings.TrimPrefix(importPath, linkedSDK), "/")
			if rel != "" && (path.Clean(rel) != rel || rel == ".." || strings.HasPrefix(rel, "../") || strings.Contains(rel, "\\") || strings.HasPrefix(rel, "/")) {
				return fmt.Errorf("invalid SDK import %q in %s", importPath, file)
			}
			present, err := sdkPackageSource(ctx, sdk, rel)
			if err != nil {
				return fmt.Errorf("inspect selected SDK %s for consumer %s import %s: %w", sdk, root, importPath, err)
			}
			if !present {
				return devcontract.Fail(3, "sdk_contract_mismatch", fmt.Sprintf("consumer %s (%s) imports %s, but selected SDK %s has no non-test Go package source; explicitly select a compatible SDK ref before installing or building", root, file, importPath, sdk))
			}
		}
		return nil
	})
}

func sdkImportExcludedDirectory(name string) bool {
	switch name {
	case "vendor", "node_modules", "coverage", "storybook-static", "testdata":
		return true
	}
	return strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_")
}

func sdkGoSource(name string) bool {
	return strings.HasSuffix(name, ".go") && !strings.HasPrefix(name, ".") && !strings.HasPrefix(name, "_")
}

func sdkPackageSource(ctx context.Context, sdk, rel string) (bool, error) {
	directory := filepath.Join(sdk, filepath.FromSlash(rel))
	current := sdk
	var components []string
	if rel != "" {
		components = strings.Split(rel, "/")
	}
	for index := 0; ; index++ {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return false, fmt.Errorf("cannot inspect selected SDK through symlink %s; select an SDK with ordinary source directories", current)
		}
		if !info.IsDir() {
			return false, fmt.Errorf("SDK package path %s is not a directory", current)
		}
		if index > 0 {
			if _, err := os.Lstat(filepath.Join(current, "go.mod")); err == nil {
				return false, nil
			} else if !os.IsNotExist(err) {
				return false, err
			}
		}
		if index == len(components) {
			break
		}
		current = filepath.Join(current, components[index])
	}
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		if entry.IsDir() || !sdkGoSource(entry.Name()) || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		file := filepath.Join(directory, entry.Name())
		info, err := entry.Info()
		if err != nil {
			return false, err
		}
		if !info.Mode().IsRegular() {
			return false, fmt.Errorf("cannot inspect non-regular SDK Go source %s; select an SDK with regular source files", file)
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.PackageClauseOnly)
		if err != nil {
			return false, err
		}
		if parsed.Name.Name != "main" {
			return true, nil
		}
	}
	return false, ctx.Err()
}
