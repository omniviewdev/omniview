package devworkspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSDKImportPreflight(t *testing.T) {
	write := func(t *testing.T, root, name, source string) {
		t.Helper()
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(source), 0644); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("missing package and dirty source addition", func(t *testing.T) {
		consumer, sdk := t.TempDir(), t.TempDir()
		write(t, consumer, "main.go", "package consumer\nimport _ \""+linkedSDK+"/pkg/resource/v2\"\n")
		err := validateSDKImports(context.Background(), consumer, sdk)
		if err == nil {
			t.Fatal("missing SDK package passed")
		}
		for _, want := range []string{consumer, sdk, linkedSDK + "/pkg/resource/v2"} {
			if !strings.Contains(err.Error(), want) {
				t.Fatalf("missing diagnostic %q: %v", want, err)
			}
		}
		write(t, sdk, "pkg/resource/v2/resource_test.go", "package resource\n")
		if err := validateSDKImports(context.Background(), consumer, sdk); err == nil {
			t.Fatal("test-only SDK package passed")
		}
		write(t, sdk, "pkg/resource/v2/resource_windows.go", "//go:build windows && custom\n\npackage resource\n")
		if err := validateSDKImports(context.Background(), consumer, sdk); err != nil {
			t.Fatal(err)
		}
		write(t, sdk, "pkg/resource/go.mod", "module other\n")
		if err := validateSDKImports(context.Background(), consumer, sdk); err == nil {
			t.Fatal("SDK nested module passed")
		}
	})
	t.Run("ignore non-import text and excluded trees", func(t *testing.T) {
		consumer, sdk := t.TempDir(), t.TempDir()
		write(t, consumer, "main.go", "package consumer\n// import \""+linkedSDK+"/missing\"\nvar text = `import \""+linkedSDK+"/missing\"`\n")
		for _, directory := range []string{"node_modules", "dist", "vendor", ".cache", "_cache", "testdata", "nested"} {
			write(t, consumer, directory+"/bad.go", "not Go source")
		}
		write(t, consumer, "nested/go.mod", "module other\n")
		write(t, consumer, ".ignored.go", "not Go source")
		if err := validateSDKImports(context.Background(), consumer, sdk); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("all consumer platforms scanned", func(t *testing.T) {
		consumer, sdk := t.TempDir(), t.TempDir()
		write(t, consumer, "source_windows_test.go", "//go:build windows && custom\n\npackage consumer\nimport _ \""+linkedSDK+"/missing\"\n")
		if err := validateSDKImports(context.Background(), consumer, sdk); err == nil {
			t.Fatal("platform-specific missing import passed")
		}
	})
	t.Run("cancellation and source errors", func(t *testing.T) {
		consumer, sdk := t.TempDir(), t.TempDir()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := validateSDKImports(ctx, consumer, sdk); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation lost: %v", err)
		}
		write(t, consumer, "bad.go", "not Go source")
		if err := validateSDKImports(context.Background(), consumer, sdk); err == nil {
			t.Fatal("invalid consumer source passed")
		}
		if err := os.Remove(filepath.Join(consumer, "bad.go")); err != nil {
			t.Fatal(err)
		}
		write(t, consumer, "good.go", "package consumer\nimport _ \""+linkedSDK+"/broken\"\n")
		write(t, sdk, "broken/source.go", "not Go source")
		if err := validateSDKImports(context.Background(), consumer, sdk); err == nil {
			t.Fatal("invalid SDK package clause passed")
		}
	})
}
