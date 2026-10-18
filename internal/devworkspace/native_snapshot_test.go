package devworkspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNativeSnapshotRetainsExactBundleNamespaceAfterSourceCleanup(t *testing.T) {
	w := generatedFixture(t)
	w.StateRoot = filepath.Join(filepath.Dir(filepath.Dir(w.Root)), "profiles", "state")
	cap, err := PrepareGeneratedTree(w, filepath.Join("bin", "native"), NewGeneration())
	if err != nil {
		t.Fatal(err)
	}
	app := filepath.Join(cap.Directory, "Omniview.dev.app")
	info := []byte(`<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.omniview.workspace.` + w.Manifest.WorkspaceID + `</string><key>CFBundleExecutable</key><string>Omniview</string></dict></plist>`)
	files := map[string][]byte{"Contents/Info.plist": info, "Contents/MacOS/Omniview": []byte("owned executable fixture"), "Contents/_CodeSignature/CodeResources": []byte("signature fixture"), "Contents/Resources/icon.icns": []byte("resource fixture")}
	for relative, data := range files {
		path := filepath.Join(app, filepath.FromSlash(relative))
		if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		mode := os.FileMode(0644)
		if relative == "Contents/MacOS/Omniview" {
			mode = 0755
		}
		if err = os.WriteFile(path, data, mode); err != nil {
			t.Fatal(err)
		}
	}
	if err = RecordGeneratedTree(cap); err != nil {
		t.Fatal(err)
	}
	if err = saveLaunchJSON(launchPath(w, "native-profile.json"), nativeProfileUse{WorkspaceID: w.Manifest.WorkspaceID, Generation: NewGeneration(), Binary: filepath.Join("bin", "native", "Omniview.dev.app", "Contents", "MacOS", "Omniview")}); err != nil {
		t.Fatal(err)
	}
	binary, err := prepareNativeSnapshot(w)
	if err != nil {
		t.Fatal(err)
	}
	bundle := filepath.Dir(filepath.Dir(filepath.Dir(binary)))
	if filepath.Base(bundle) != "Omniview.dev.app" {
		t.Fatalf("native helper lost original app namespace: %s", bundle)
	}
	if err = CleanGenerated(w); err != nil {
		t.Fatal(err)
	}
	for relative, expected := range files {
		actual, readErr := os.ReadFile(filepath.Join(bundle, filepath.FromSlash(relative)))
		if readErr != nil || string(actual) != string(expected) {
			t.Fatalf("snapshot did not preserve %s: %s %v", relative, actual, readErr)
		}
	}
	next := w
	next.Root = filepath.Join(filepath.Dir(w.Root), "renamed-fixture")
	if err = os.Rename(w.Root, next.Root); err != nil {
		t.Fatal(err)
	}
	next.StateRoot = filepath.Join(filepath.Dir(filepath.Dir(w.Root)), "other-profile", "state")
	if _, err = prepareNativeSnapshot(next); err != nil {
		t.Fatalf("slug/state root incorrectly rekeyed native UUID namespace: %v", err)
	}
	resource := filepath.Join(bundle, "Contents", "Resources", "icon.icns")
	if err = os.WriteFile(resource, []byte("foreign edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = cleanupNativeSnapshot(next); err == nil {
		t.Fatal("modified external native snapshot was deleted")
	}
	if actual, _ := os.ReadFile(resource); string(actual) != "foreign edit" {
		t.Fatal("foreign bytes were changed")
	}
	if err = os.WriteFile(resource, files["Contents/Resources/icon.icns"], 0600); err != nil {
		t.Fatal(err)
	}
	if err = cleanupNativeSnapshot(next); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(bundle); !os.IsNotExist(err) {
		t.Fatalf("owned native snapshot remained: %v", err)
	}
}
