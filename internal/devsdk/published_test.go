package devsdk_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
)

// world serves the SDK at the release floor and the one real dependency a
// consumer importing an SDK package needs, and writes a consumer requiring them.
type fixture struct {
	world    *sdktest.World
	sdk      sdktest.Release
	uuid     sdktest.Release
	consumer string
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	world := sdktest.New(t)
	sdk := world.PublishSDK(devsdk.FloorVersion, nil)
	uuid := world.PublishPinned("github.com/google/uuid")
	return fixture{world: world, sdk: sdk, uuid: uuid, consumer: world.Consumer("consumer", sdk, uuid)}
}

func (f fixture) request() devsdk.Request {
	return devsdk.Request{
		Selection: devsdk.PublishedSelection(),
		Consumer:  devsdk.Consumer{Name: "plugin", Directory: f.consumer},
		Run:       f.world.Runner(),
	}
}

func verifier() devsdk.Verifier { return devsdk.NewVerifier(devsdk.ReleasePolicy()) }

func refusal(t *testing.T, err error) *devcontract.Error {
	t.Helper()
	require.Error(t, err)
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed, "the refusal must be typed: %v", err)
	return typed
}

func digest(t *testing.T, directory string, names ...string) [32]byte {
	t.Helper()
	hash := sha256.New()
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(directory, name))
		require.NoError(t, err)
		hash.Write(data)
	}
	var sum [32]byte
	copy(sum[:], hash.Sum(nil))
	return sum
}

func TestPublishedVerificationIdentifiesTheEffectiveReleaseWithoutTouchingConsumerFiles(t *testing.T) {
	f := newFixture(t)
	before := digest(t, f.consumer, "go.mod", "go.sum", "main.go")

	identity, err := verifier()(context.Background(), f.request())
	require.NoError(t, err)
	published, ok := identity.Published()
	require.True(t, ok)
	require.Equal(t, f.sdk.Published(), published)

	require.Equal(t, before, digest(t, f.consumer, "go.mod", "go.sum", "main.go"), "published verification must leave consumer Go files unchanged")
	entries, err := os.ReadDir(f.consumer)
	require.NoError(t, err)
	require.Len(t, entries, 3, "no vendor tree, workspace file or sum file may appear in the consumer")
	require.DirExists(t, f.world.Extracted(f.sdk), "the download belongs in the (scratch) module cache")

	downloads := 0
	for _, command := range f.world.Commands() {
		if command[0] == "list" {
			require.Contains(t, command, "-mod=readonly", "resolution must be read-only: %v", command)
		}
		if command[0] == "mod" {
			downloads++
			require.Contains(t, strings.Join(command, " "), "-modfile=", "a download must use a private modfile: %v", command)
			require.NotContains(t, strings.Join(command, " "), f.consumer, "a download must not name the consumer's files")
		}
	}
	require.Equal(t, 1, downloads)

	// A warm cache needs no second download, and the identity is stable.
	before2 := len(f.world.Commands())
	again, err := verifier()(context.Background(), f.request())
	require.NoError(t, err)
	require.Equal(t, identity, again)
	for _, command := range f.world.Commands()[before2:] {
		require.NotEqual(t, "mod", command[0], "a cached, verified module must not be downloaded again")
	}
}

func TestPublishedDirectoryNamesTheVerifiedCacheEntry(t *testing.T) {
	f := newFixture(t)
	_, err := verifier()(context.Background(), f.request())
	require.NoError(t, err)
	directory, err := devsdk.PublishedDirectory(context.Background(), f.request().Consumer, f.world.Runner())
	require.NoError(t, err)
	require.Equal(t, f.world.Extracted(f.sdk), directory)
}

func TestPublishedVerificationRefusalsAreTypedAndHappenBeforeAnyGoCommandWhenTheFilesDecideThem(t *testing.T) {
	append := func(f fixture, name, extra string) {
		data, err := os.ReadFile(filepath.Join(f.consumer, name))
		require.NoError(t, err)
		f.world.Write(f.consumer, name, string(data)+extra)
	}
	tests := []struct {
		name   string
		mutate func(f fixture)
		code   string
		exit   int
	}{
		{"local replace", func(f fixture) {
			append(f, "go.mod", "\nreplace "+devsdk.Module+" => ./sdk\n")
		}, devsdk.CodeSelectionConflict, 4},
		{"dormant version-specific replace", func(f fixture) {
			append(f, "go.mod", "\nreplace "+devsdk.Module+" v0.99.0 => ./sdk\n")
		}, devsdk.CodeSelectionConflict, 4},
		{"remote module replace", func(f fixture) {
			append(f, "go.mod", "\nreplace "+devsdk.Module+" => example.com/fork v1.0.0\n")
		}, devsdk.CodeSelectionConflict, 4},
		{"vendor directory", func(f fixture) {
			f.world.Write(f.consumer, "vendor/modules.txt", "# vendored\n")
		}, devsdk.CodeSelectionConflict, 4},
		{"no SDK requirement", func(f fixture) {
			f.world.Write(f.consumer, "go.mod", "module example.com/consumer\n\ngo 1.26.0\n")
		}, devsdk.CodeContractMismatch, 3},
		{"invalid go.mod", func(f fixture) {
			f.world.Write(f.consumer, "go.mod", "this is not a go.mod\n")
		}, devsdk.CodeContractMismatch, 3},
		{"missing go.sum checksums", func(f fixture) {
			f.world.Write(f.consumer, "go.sum", "")
		}, devsdk.CodeChecksumsRequired, 3},
		{"only the module checksum", func(f fixture) {
			f.world.Write(f.consumer, "go.sum", f.sdk.Module+" "+f.sdk.Version+" "+f.sdk.ModuleSum+"\n")
		}, devsdk.CodeChecksumsRequired, 3},
		{"conflicting go.sum lines", func(f fixture) {
			append(f, "go.sum", f.sdk.Module+" "+f.sdk.Version+" h1:"+strings.Repeat("A", 43)+"=\n")
		}, devsdk.CodeIntegrityMismatch, 4},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f := newFixture(t)
			test.mutate(f)
			identity, err := verifier()(context.Background(), f.request())
			typed := refusal(t, err)
			require.Equal(t, test.code, typed.Code, typed.Message)
			require.Equal(t, test.exit, typed.Exit)
			require.Equal(t, devsdk.Identity{}, identity, "a refusal must not yield partial evidence")
			require.Equal(t, "plugin", typed.Details["consumer"])
			require.Empty(t, f.world.Commands(), "the consumer's own files decide this refusal: no Go command may run, nothing may be downloaded")
			require.NoDirExists(t, f.world.Extracted(f.sdk))
		})
	}
}

func TestPublishedVerificationRefusesReleasesBelowTheFloorAndNonReleases(t *testing.T) {
	for _, version := range []string{"v0.16.0", "v0.9.9", "v0.17.1-0.20261108000000-abcdefabcdef", "v0.18.0-rc.1"} {
		t.Run(version, func(t *testing.T) {
			world := sdktest.New(t)
			sdk := world.PublishSDK(version, nil)
			uuid := world.PublishPinned("github.com/google/uuid")
			f := fixture{world: world, sdk: sdk, uuid: uuid, consumer: world.Consumer("consumer", sdk, uuid)}
			_, err := verifier()(context.Background(), f.request())
			typed := refusal(t, err)
			require.Equal(t, devsdk.CodeReleaseUntrusted, typed.Code, typed.Message)
			require.Equal(t, 4, typed.Exit)
			require.ErrorIs(t, err, devsdk.ErrNotAccepted)
			require.Equal(t, version, typed.Details["version"])
			require.Equal(t, devsdk.FloorVersion, typed.Details["floor"])
			require.Contains(t, typed.Message, devsdk.FloorVersion)
			require.Empty(t, f.world.Commands(), "the declared version decides this: nothing may be resolved or downloaded")
			require.NoDirExists(t, world.Extracted(sdk))
		})
	}
}

func TestPublishedVerificationAdmitsEveryReleasedTagAtOrAboveTheFloor(t *testing.T) {
	world := sdktest.New(t)
	sdk := world.PublishSDK("v0.17.4", nil)
	uuid := world.PublishPinned("github.com/google/uuid")
	f := fixture{world: world, sdk: sdk, uuid: uuid, consumer: world.Consumer("consumer", sdk, uuid)}
	identity, err := verifier()(context.Background(), f.request())
	require.NoError(t, err)
	published, _ := identity.Published()
	require.Equal(t, "v0.17.4", published.Version)
}

func TestPublishedVerificationRefusesBytesThatDisagreeWithTheRecordedChecksums(t *testing.T) {
	wrong := "h1:" + strings.Repeat("A", 43) + "="
	t.Run("wrong recorded checksum, module not yet downloaded", func(t *testing.T) {
		f := newFixture(t)
		f.world.Write(f.consumer, "go.sum", f.sdk.Module+" "+f.sdk.Version+" "+wrong+"\n"+f.sdk.Module+" "+f.sdk.Version+"/go.mod "+f.sdk.GoModSum+"\n"+
			f.uuid.Module+" "+f.uuid.Version+" "+f.uuid.ModuleSum+"\n"+f.uuid.Module+" "+f.uuid.Version+"/go.mod "+f.uuid.GoModSum+"\n")
		_, err := verifier()(context.Background(), f.request())
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeIntegrityMismatch, typed.Code, typed.Message)
		require.Equal(t, 4, typed.Exit)
	})
	t.Run("wrong recorded checksum, module already cached", func(t *testing.T) {
		f := newFixture(t)
		f.world.Download(f.consumer, f.sdk)
		f.world.Write(f.consumer, "go.sum", f.sdk.Module+" "+f.sdk.Version+" "+wrong+"\n"+f.sdk.Module+" "+f.sdk.Version+"/go.mod "+f.sdk.GoModSum+"\n")
		_, err := verifier()(context.Background(), f.request())
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeIntegrityMismatch, typed.Code, typed.Message)
	})
	t.Run("wrong recorded go.mod checksum", func(t *testing.T) {
		f := newFixture(t)
		f.world.Download(f.consumer, f.sdk)
		f.world.Write(f.consumer, "go.sum", f.sdk.Module+" "+f.sdk.Version+" "+f.sdk.ModuleSum+"\n"+f.sdk.Module+" "+f.sdk.Version+"/go.mod "+wrong+"\n")
		_, err := verifier()(context.Background(), f.request())
		require.Equal(t, devsdk.CodeIntegrityMismatch, refusal(t, err).Code)
	})
}

// The Go module cache never re-verifies an extracted directory, so tampering
// after extraction is invisible to Go and must be caught by hashing the bytes.
func TestPublishedVerificationRefusesATamperedModuleCacheEntry(t *testing.T) {
	tampers := map[string]func(t *testing.T, directory string){
		"edited file": func(t *testing.T, directory string) {
			path := filepath.Join(directory, "pkg", "state", "root.go")
			data, err := os.ReadFile(path)
			require.NoError(t, err)
			require.NoError(t, os.Chmod(path, 0o600))
			require.NoError(t, os.WriteFile(path, append(data, []byte("\n// tampered\n")...), 0o600))
		},
		"extra file": func(t *testing.T, directory string) {
			require.NoError(t, os.WriteFile(filepath.Join(directory, "pkg", "state", "extra.go"), []byte("package state\n"), 0o600))
		},
		"deleted file": func(t *testing.T, directory string) {
			require.NoError(t, os.Remove(filepath.Join(directory, "pkg", "state", "root.go")))
		},
		"symlink in place of a file": func(t *testing.T, directory string) {
			path := filepath.Join(directory, "pkg", "profilecontract")
			entries, err := os.ReadDir(path)
			require.NoError(t, err)
			target := filepath.Join(path, entries[0].Name())
			require.NoError(t, os.Remove(target))
			require.NoError(t, os.Symlink(filepath.Join(directory, "go.mod"), target))
		},
	}
	for name, tamper := range tampers {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			f.world.Download(f.consumer, f.sdk)
			control, err := verifier()(context.Background(), f.request())
			require.NoError(t, err, "control: the untouched scratch cache verifies")
			require.NotEqual(t, devsdk.Identity{}, control)

			tamper(t, f.world.Extracted(f.sdk))
			identity, err := verifier()(context.Background(), f.request())
			typed := refusal(t, err)
			require.Equal(t, devsdk.CodeIntegrityMismatch, typed.Code, typed.Message)
			require.Equal(t, 4, typed.Exit)
			require.Equal(t, devsdk.Identity{}, identity)
			require.NotContains(t, f.world.Commands()[len(f.world.Commands())-1], "clean", "the shared cache must never be repaired or deleted")
			require.DirExists(t, f.world.Extracted(f.sdk), "a tampered cache is reported, never repaired or deleted")
		})
	}
}

func TestPublishedVerificationRefusesAReleaseWithoutTheIsolationCapability(t *testing.T) {
	stubs := map[string]func(tree string){
		"capability constant changed": func(tree string) {
			path := filepath.Join(tree, "pkg", "config", "isolation.go")
			data, err := os.ReadFile(path)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(path, []byte(strings.Replace(string(data), `"state-root-v1"`, `"none"`, 1)), 0o600))
		},
		"isolation file removed": func(tree string) { require.NoError(t, os.Remove(filepath.Join(tree, "pkg", "config", "isolation.go"))) },
		"state root stubbed": func(tree string) {
			require.NoError(t, os.WriteFile(filepath.Join(tree, "pkg", "state", "root.go"), []byte("package state\n"), 0o600))
		},
	}
	for name, stub := range stubs {
		t.Run(name, func(t *testing.T) {
			world := sdktest.New(t)
			sdk := world.PublishSDK("v0.18.0", stub)
			uuid := world.PublishPinned("github.com/google/uuid")
			f := fixture{world: world, sdk: sdk, uuid: uuid, consumer: world.Consumer("consumer", sdk, uuid)}
			_, err := verifier()(context.Background(), f.request())
			typed := refusal(t, err)
			require.Equal(t, devsdk.CodeReleaseUntrusted, typed.Code, typed.Message)
			require.Contains(t, typed.Message, devsdk.Capability)
			require.ErrorIs(t, err, devsdk.ErrNotAccepted)
		})
	}
}

func TestPublishedVerificationReportsAnUnavailableDependencyWithoutFallingBack(t *testing.T) {
	f := newFixture(t)
	offline := func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
		return f.world.Runner()(ctx, directory, append(environment, "GOPROXY=off"), args...)
	}
	request := f.request()
	request.Run = offline
	_, err := verifier()(context.Background(), request)
	typed := refusal(t, err)
	require.Equal(t, devsdk.CodeDependencyUnavailable, typed.Code, typed.Message)
	require.Equal(t, 5, typed.Exit)
	require.Contains(t, typed.Message, "no source fallback")

	// Once the verified module is cached, the same offline runner verifies it.
	f.world.Download(f.consumer, f.sdk)
	identity, err := verifier()(context.Background(), request)
	require.NoError(t, err, "a cached verified module works offline")
	require.NotEqual(t, devsdk.Identity{}, identity)
}

func TestPublishedVerificationRedactsCredentialsFromDiagnostics(t *testing.T) {
	f := newFixture(t)
	request := f.request()
	request.Run = func(context.Context, string, []string, ...string) ([]byte, error) {
		return nil, errors.New("go list: dial https://user:hunter2@proxy.example.com/github.com/omniviewdev/plugin-sdk: connection refused")
	}
	_, err := verifier()(context.Background(), request)
	typed := refusal(t, err)
	require.Equal(t, devsdk.CodeDependencyUnavailable, typed.Code)
	require.NotContains(t, typed.Message, "hunter2")
	require.Contains(t, typed.Message, "connection refused")
}

func TestPublishedVerificationPropagatesCancellationAndOwnedCommandErrors(t *testing.T) {
	f := newFixture(t)
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	request := f.request()
	_, err := verifier()(canceled, request)
	require.ErrorIs(t, err, context.Canceled)
	var typed *devcontract.Error
	require.False(t, errors.As(err, &typed), "cancellation is not a dependency refusal: %v", err)

	uncertain := errors.New("owned process termination is uncertain")
	request.Run = func(context.Context, string, []string, ...string) ([]byte, error) { return nil, uncertain }
	_, err = verifier()(context.Background(), request)
	require.ErrorIs(t, err, uncertain, "the runner's own error must stay reachable through the typed refusal")
}

// Flags and a workspace file in the ambient environment, or an environment
// file, must neither change nor break the verification: the effective graph is
// resolved from the consumer's files only.
func TestPublishedVerificationIsIndependentOfTheAmbientGoEnvironment(t *testing.T) {
	f := newFixture(t)
	expected, err := verifier()(context.Background(), f.request())
	require.NoError(t, err)

	envFile := filepath.Join(t.TempDir(), "goenv")
	require.NoError(t, os.WriteFile(envFile, []byte("GOFLAGS=-mod=vendor -modfile=/nonexistent/evil.mod\n"), 0o600))
	hostile := map[string]string{
		"GOFLAGS":  "-mod=vendor -modfile=/nonexistent/evil.mod",
		"GOWORK":   filepath.Join(t.TempDir(), "evil.work"),
		"GOROOT":   "",
		"SDK_ROOT": "/nonexistent",
	}
	for key, value := range hostile {
		t.Setenv(key, value)
	}
	base := f.world.Runner()
	request := f.request()
	request.Run = func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
		// Override the world's GOENV=off with a hostile environment file.
		return base(ctx, directory, append([]string{"GOENV=" + envFile}, environment...), args...)
	}
	got, err := verifier()(context.Background(), request)
	require.NoError(t, err, "explicit -mod/-modfile and the scrubbed environment must override ambient and env-file flags")
	require.Equal(t, expected, got)
}

func TestPublishedVerificationOfAnEffectiveModfile(t *testing.T) {
	setup := func(t *testing.T, edit func(f fixture, mod, sum string) (string, string)) (fixture, devsdk.Request) {
		f := newFixture(t)
		mod, err := os.ReadFile(filepath.Join(f.consumer, "go.mod"))
		require.NoError(t, err)
		sum, err := os.ReadFile(filepath.Join(f.consumer, "go.sum"))
		require.NoError(t, err)
		newMod, newSum := edit(f, string(mod), string(sum))
		output := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(output, "host.mod"), []byte(newMod), 0o600))
		require.NoError(t, os.WriteFile(filepath.Join(output, "host.sum"), []byte(newSum), 0o600))
		request := f.request()
		request.Consumer.Modfile = filepath.Join(output, "host.mod")
		return f, request
	}
	t.Run("a generated modfile with the same tuple verifies", func(t *testing.T) {
		f, request := setup(t, func(_ fixture, mod, sum string) (string, string) { return mod, sum })
		identity, err := verifier()(context.Background(), request)
		require.NoError(t, err)
		published, _ := identity.Published()
		require.Equal(t, f.sdk.Published(), published)
		for _, command := range f.world.Commands() {
			require.Contains(t, strings.Join(command, " "), "-modfile=", "%v", command)
		}
	})
	t.Run("a generated modfile that replaces the SDK is refused before any Go command", func(t *testing.T) {
		f, request := setup(t, func(_ fixture, mod, sum string) (string, string) {
			return mod + "\nreplace " + devsdk.Module + " => /somewhere/else\n", sum
		})
		_, err := verifier()(context.Background(), request)
		require.Equal(t, devsdk.CodeSelectionConflict, refusal(t, err).Code)
		require.Empty(t, f.world.Commands())
	})
	t.Run("a generated modfile that states another SDK tuple is refused", func(t *testing.T) {
		f, request := setup(t, func(f fixture, mod, sum string) (string, string) {
			return strings.Replace(mod, devsdk.Module+" "+f.sdk.Version, devsdk.Module+" v0.17.9", 1), sum
		})
		_, err := verifier()(context.Background(), request)
		typed := refusal(t, err)
		require.True(t, typed.Code == devsdk.CodeSelectionConflict || typed.Code == devsdk.CodeChecksumsRequired, typed.Message)
		require.Empty(t, f.world.Commands())
	})
	t.Run("a generated sum file with invented checksums is refused", func(t *testing.T) {
		_, request := setup(t, func(f fixture, mod, sum string) (string, string) {
			return mod, strings.Replace(sum, f.sdk.ModuleSum, "h1:"+strings.Repeat("B", 43)+"=", 1)
		})
		_, err := verifier()(context.Background(), request)
		require.Equal(t, devsdk.CodeSelectionConflict, refusal(t, err).Code)
	})
}

func TestVerifyBinaryChecksTheBuiltSDKAgainstTheVerifiedIdentity(t *testing.T) {
	f := newFixture(t)
	identity, err := verifier()(context.Background(), f.request())
	require.NoError(t, err)
	build := func(t *testing.T, directory string) string {
		t.Helper()
		binary := filepath.Join(t.TempDir(), "plugin")
		_, err := f.world.Runner()(context.Background(), directory, []string{"GOFLAGS="}, "build", "-mod=readonly", "-o", binary, ".")
		require.NoError(t, err)
		return binary
	}
	binary := build(t, f.consumer)
	require.NoError(t, devsdk.VerifyBinary("plugin", binary, identity), "the binary built from the verified release matches")

	t.Run("another release", func(t *testing.T) {
		other := f.world.PublishSDK("v0.18.0", func(tree string) {
			require.NoError(t, os.WriteFile(filepath.Join(tree, "marker.txt"), []byte("another release\n"), 0o600))
		})
		directory := f.world.Consumer("other", other, f.uuid)
		err := devsdk.VerifyBinary("plugin", build(t, directory), identity)
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeIdentityChanged, typed.Code, typed.Message)
		require.Equal(t, 4, typed.Exit)
	})
	t.Run("a replaced SDK", func(t *testing.T) {
		replaced := f.world.Consumer("replaced", f.sdk, f.uuid)
		data, err := os.ReadFile(filepath.Join(replaced, "go.mod"))
		require.NoError(t, err)
		f.world.Write(replaced, "go.mod", string(data)+"\nreplace "+devsdk.Module+" => "+f.world.Root+"/replacement\n")
		copyDirectory(t, sdktest.PinnedSDK(t), filepath.Join(f.world.Root, "replacement"))
		err = devsdk.VerifyBinary("plugin", build(t, replaced), identity)
		require.Equal(t, devsdk.CodeSelectionConflict, refusal(t, err).Code)
	})
	t.Run("a binary without the SDK", func(t *testing.T) {
		plain := filepath.Join(f.world.Root, "plain")
		f.world.Write(plain, "go.mod", "module example.com/plain\n\ngo 1.26.0\n")
		f.world.Write(plain, "main.go", "package main\n\nfunc main() {}\n")
		require.Error(t, devsdk.VerifyBinary("plugin", build(t, plain), identity))
	})
	t.Run("not a Go binary", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "plugin")
		require.NoError(t, os.WriteFile(path, []byte("not an executable"), 0o700))
		require.Error(t, devsdk.VerifyBinary("plugin", path, identity))
	})
	t.Run("an invalid identity", func(t *testing.T) {
		require.Error(t, devsdk.VerifyBinary("plugin", binary, devsdk.Identity{}))
	})
}

func copyDirectory(t *testing.T, from, to string) {
	t.Helper()
	cmd := exec.Command("cp", "-R", from, to)
	output, err := cmd.CombinedOutput()
	require.NoError(t, err, string(output))
	require.NoError(t, exec.Command("chmod", "-R", "u+w", to).Run())
}
