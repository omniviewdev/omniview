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
		if entry.IsDir() {
			if file == root {
				return nil
			}
			if ignoredBuildDirectory(entry.Name()) || strings.HasPrefix(entry.Name(), ".") || strings.HasPrefix(entry.Name(), "_") || entry.Name() == "testdata" {
				return filepath.SkipDir
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

func sdkGoSource(name string) bool {
	return strings.HasSuffix(name, ".go") && !strings.HasPrefix(name, ".") && !strings.HasPrefix(name, "_")
}

func sdkPackageSource(ctx context.Context, sdk, rel string) (bool, error) {
	directory := filepath.Join(sdk, filepath.FromSlash(rel))
	for current := directory; current != sdk; current = filepath.Dir(current) {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		if _, err := os.Stat(filepath.Join(current, "go.mod")); err == nil {
			return false, nil
		} else if !os.IsNotExist(err) {
			return false, err
		}
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
