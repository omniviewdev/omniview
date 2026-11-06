// Package nativeapps discovers installed applications supported by native launch adapters.
package nativeapps

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Application contains device-provided metadata for a supported terminal.
type Application struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	BundleID    string `json:"bundleID"`
	Path        string `json:"path"`
	IconDataURL string `json:"iconDataURL"`
}

// BundleID resolves a stable preference to its supported launch adapter.
func BundleID(id string) (string, bool) {
	switch id {
	case "terminal":
		return "com.apple.Terminal", true
	case "iterm2":
		return "com.googlecode.iterm2", true
	default:
		return "", false
	}
}

func preference(bundleID string) string {
	for _, id := range []string{"terminal", "iterm2"} {
		if bundle, _ := BundleID(id); bundle == bundleID {
			return id
		}
	}
	return ""
}

// Discover returns installed supported applications without sending Apple Events.
func Discover(ctx context.Context) ([]Application, error) {
	return discover(ctx, runtime.GOOS, run)
}

func discover(ctx context.Context, platform string, query func(context.Context, string) (string, error)) ([]Application, error) {
	if platform != "darwin" {
		return []Application{}, nil
	}
	script := discoveryScript(true)
	output, err := query(ctx, script)
	if err != nil {
		return nil, errors.New("Cannot discover installed terminal applications. Retry Settings > Terminal.")
	}
	return decode(output)
}

func decode(output string) ([]Application, error) {
	var candidates []Application
	if err := json.Unmarshal([]byte(output), &candidates); err != nil || candidates == nil {
		return nil, errors.New("Cannot read installed terminal application metadata.")
	}
	apps := make([]Application, 0, len(candidates))
	seen := make(map[string]bool)
	for _, app := range candidates {
		id := preference(app.BundleID)
		if id == "" || seen[id] || app.Name == "" || !filepath.IsAbs(app.Path) {
			continue
		}
		app.ID = id
		apps = append(apps, app)
		seen[id] = true
	}
	return apps, nil
}

// Resolve verifies the registered application's path without generating an icon.
func Resolve(ctx context.Context, bundleID string) (string, error) {
	if preference(bundleID) == "" {
		return "", errors.New("unsupported terminal application")
	}
	output, err := run(ctx, discoveryScript(false))
	if err != nil {
		return "", err
	}
	apps, err := decode(output)
	if err != nil {
		return "", err
	}
	for _, app := range apps {
		if app.BundleID != bundleID {
			continue
		}
		info, err := os.Stat(app.Path)
		if err == nil && info.IsDir() {
			return app.Path, nil
		}
	}
	return "", errors.New("selected terminal is no longer installed; choose an installed application in Settings > Terminal")
}

func discoveryScript(icons bool) string {
	bundles := make([]string, 0, 2)
	for _, id := range []string{"terminal", "iterm2"} {
		bundle, _ := BundleID(id)
		bundles = append(bundles, bundle)
	}
	encoded, _ := json.Marshal(bundles)
	script := `ObjC.import('AppKit');
const workspace = $.NSWorkspace.sharedWorkspace;
const applications = [];
` + "const bundles = " + string(encoded) + ";\n" + `
for (const bundleID of bundles) {
 const url = workspace.URLForApplicationWithBundleIdentifier(bundleID);
 if (url.isNil()) continue;
 const path = ObjC.unwrap(url.path);
 const bundle = $.NSBundle.bundleWithURL(url);
 if (bundle.isNil() || ObjC.unwrap(bundle.bundleIdentifier) !== bundleID) continue;
 const name = ObjC.unwrap(bundle.objectForInfoDictionaryKey('CFBundleDisplayName')) ||
   ObjC.unwrap(bundle.objectForInfoDictionaryKey('CFBundleName')) ||
   ObjC.unwrap(url.URLByDeletingPathExtension.lastPathComponent);
 let iconDataURL = '';
`
	if icons {
		script += `
 const icon = workspace.iconForFile(path);
 icon.size = $.NSMakeSize(64, 64);
 const image = icon.CGImageForProposedRectContextHints(null, $(), $.NSDictionary.dictionary);
 if (!image) throw new Error('Application icon unavailable');
 const bitmap = $.NSBitmapImageRep.alloc.initWithCGImage(image);
 const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
 if (png.isNil()) throw new Error('Application icon unavailable');
 iconDataURL = 'data:image/png;base64,' + ObjC.unwrap(png.base64EncodedStringWithOptions(0));
`
	}
	return script + `applications.push({name, bundleID, path, iconDataURL});
}
JSON.stringify(applications);`
}

// Icon payloads have a separate bounded output budget; diagnostics never escape.
func run(ctx context.Context, script string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/osascript", "-l", "JavaScript", "-")
	cmd.Stdin = strings.NewReader(script)
	cmd.WaitDelay = time.Second
	var output boundedOutput
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", err
	}
	if output.overflow {
		return "", errors.New("application metadata exceeds output limit")
	}
	return output.text.String(), nil
}

type boundedOutput struct {
	text     strings.Builder
	overflow bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	const maximum = 2 << 20
	remaining := maximum - b.text.Len()
	if len(p) > remaining {
		b.overflow = true
	}
	_, _ = b.text.Write(p[:min(len(p), remaining)])
	return len(p), nil
}
