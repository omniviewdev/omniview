package devworkspace

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
		for _, directory := range []string{"node_modules", "vendor", "coverage", "storybook-static", ".cache", "_cache", "testdata", "nested"} {
			write(t, consumer, directory+"/bad.go", "not Go source")
		}
		write(t, consumer, "nested/go.mod", "module other\n")
		write(t, consumer, ".ignored.go", "not Go source")
		if err := validateSDKImports(context.Background(), consumer, sdk); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("ordinary Go package directories are scanned", func(t *testing.T) {
		for _, directory := range []string{"build", "bin", "dist", "shims"} {
			t.Run(directory, func(t *testing.T) {
				consumer, sdk := t.TempDir(), t.TempDir()
				write(t, consumer, directory+"/source.go", "package consumer\nimport _ \""+linkedSDK+"/missing\"\n")
				err := validateSDKImports(context.Background(), consumer, sdk)
				if err == nil || !strings.Contains(err.Error(), linkedSDK+"/missing") {
					t.Fatalf("missing import in %s escaped scan: %v", directory, err)
				}
			})
		}
	})
	t.Run("symlink package directories fail closed", func(t *testing.T) {
		for _, external := range []bool{false, true} {
			t.Run(map[bool]string{false: "in-root", true: "external"}[external], func(t *testing.T) {
				consumer, sdk := t.TempDir(), t.TempDir()
				target := filepath.Join(consumer, ".actual")
				if external {
					target = t.TempDir()
				}
				write(t, target, "source.go", "package consumer\nimport _ \""+linkedSDK+"/missing\"\n")
				link := filepath.Join(consumer, "linked")
				if err := os.Symlink(target, link); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
				err := validateSDKImports(context.Background(), consumer, sdk)
				if err == nil || !strings.Contains(err.Error(), link) || !strings.Contains(err.Error(), "symlink") {
					t.Fatalf("symlink package escaped refusal: %v", err)
				}
			})
		}
	})
	t.Run("ordinary asset symlinks remain accepted", func(t *testing.T) {
		consumer, sdk, target := t.TempDir(), t.TempDir(), t.TempDir()
		write(t, target, "README.md", "not Go source")
		write(t, consumer, "source.go", "package consumer\n")
		if err := os.Symlink(filepath.Join(target, "README.md"), filepath.Join(consumer, "README.md")); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
		if err := validateSDKImports(context.Background(), consumer, sdk); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("indeterminate symlink fails closed", func(t *testing.T) {
		consumer, sdk := t.TempDir(), t.TempDir()
		link := filepath.Join(consumer, "unknown")
		if err := os.Symlink(filepath.Join(consumer, "absent"), link); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
		err := validateSDKImports(context.Background(), consumer, sdk)
		if err == nil || !strings.Contains(err.Error(), link) || !strings.Contains(err.Error(), "cannot determine") {
			t.Fatalf("indeterminate symlink escaped refusal: %v", err)
		}
	})
	t.Run("excluded directory symlinks stay excluded", func(t *testing.T) {
		consumer, sdk, target := t.TempDir(), t.TempDir(), t.TempDir()
		write(t, target, "bad.go", "not Go source")
		for _, directory := range []string{"node_modules", "vendor", "coverage", "storybook-static", ".cache", "_cache", "testdata"} {
			if err := os.Symlink(target, filepath.Join(consumer, directory)); err != nil {
				t.Skipf("symlinks unavailable: %v", err)
			}
		}
		if err := validateSDKImports(context.Background(), consumer, sdk); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("SDK package symlink refuses external source", func(t *testing.T) {
		consumer, sdk, target := t.TempDir(), t.TempDir(), t.TempDir()
		write(t, consumer, "source.go", "package consumer\nimport _ \""+linkedSDK+"/linked/pkg\"\n")
		write(t, target, "pkg/source.go", "package sdk\n")
		link := filepath.Join(sdk, "linked")
		if err := os.Symlink(target, link); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
		err := validateSDKImports(context.Background(), consumer, sdk)
		if err == nil || !strings.Contains(err.Error(), link) || !strings.Contains(err.Error(), "symlink") {
			t.Fatalf("SDK symlink escaped refusal: %v", err)
		}
	})
	t.Run("symlink Go files refuse before parsing", func(t *testing.T) {
		for _, inSDK := range []bool{false, true} {
			t.Run(map[bool]string{false: "consumer", true: "sdk"}[inSDK], func(t *testing.T) {
				consumer, sdk, target := t.TempDir(), t.TempDir(), t.TempDir()
				write(t, target, "source.go", "package source\n")
				root := consumer
				if inSDK {
					write(t, consumer, "source.go", "package consumer\nimport _ \""+linkedSDK+"\"\n")
					root = sdk
				}
				link := filepath.Join(root, "linked.go")
				if err := os.Symlink(filepath.Join(target, "source.go"), link); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
				err := validateSDKImports(context.Background(), consumer, sdk)
				if err == nil || !strings.Contains(err.Error(), link) {
					t.Fatalf("symlink Go file escaped refusal: %v", err)
				}
			})
		}
	})
	t.Run("Go named pipes refuse before opening", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("mkfifo is unavailable on Windows")
		}
		for _, inSDK := range []bool{false, true} {
			t.Run(map[bool]string{false: "consumer", true: "sdk"}[inSDK], func(t *testing.T) {
				consumer, sdk := t.TempDir(), t.TempDir()
				root := consumer
				if inSDK {
					write(t, consumer, "source.go", "package consumer\nimport _ \""+linkedSDK+"\"\n")
					root = sdk
				}
				file := filepath.Join(root, "pipe.go")
				if output, err := exec.Command("mkfifo", file).CombinedOutput(); err != nil {
					t.Fatalf("mkfifo: %v: %s", err, output)
				}
				err := validateSDKImports(context.Background(), consumer, sdk)
				if err == nil || !strings.Contains(err.Error(), file) || !strings.Contains(err.Error(), "non-regular") {
					t.Fatalf("named pipe escaped refusal: %v", err)
				}
			})
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
