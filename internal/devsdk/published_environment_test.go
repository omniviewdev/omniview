package devsdk_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
)

// environmentRunner runs real Go under the world's environment but, unlike the
// world's own runner, does NOT pin GOWORK: only the verifier's ModuleEnvironment
// (appended after this base, like a production owned runner) may keep a
// workspace file out of the verification. extra entries come first, so a test
// can still choose GOENV or GOTOOLCHAIN for the command.
func environmentRunner(f fixture, extra ...string) devsdk.Runner {
	return func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
		var base []string
		for _, entry := range append(os.Environ(), f.world.Environment()...) {
			if !strings.HasPrefix(entry, "GOWORK=") {
				base = append(base, entry)
			}
		}
		cmd := exec.CommandContext(ctx, "go", args...)
		cmd.Dir = directory
		cmd.Env = append(append(base, extra...), environment...)
		var stdout, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &stdout, &stderr
		if err := cmd.Run(); err != nil {
			return nil, fmt.Errorf("go %s: %w\n%s%s", strings.Join(args, " "), err, stdout.String(), stderr.String())
		}
		return stdout.Bytes(), nil
	}
}

// recordingEnvironmentRunner is environmentRunner that also records the commands
// it was asked to run.
func recordingEnvironmentRunner(f fixture, commands *[][]string, extra ...string) devsdk.Runner {
	run := environmentRunner(f, extra...)
	return func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
		*commands = append(*commands, append([]string(nil), args...))
		return run(ctx, directory, environment, args...)
	}
}

func (f fixture) requestWith(run devsdk.Runner) devsdk.Request {
	request := f.request()
	request.Run = run
	return request
}

func appendToFile(t *testing.T, directory, name, text string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(directory, name))
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(directory, name), append(data, []byte(text)...), 0o600))
}

// A go.work file in a directory above the consumer, using the consumer and
// replacing the SDK by a tampered copy, is what Go itself would build against.
// Verification must ignore it and identify the published release.
func TestPublishedVerificationIgnoresAParentWorkspaceFile(t *testing.T) {
	f := newFixture(t)
	tampered := filepath.Join(f.world.Root, "tampered")
	copyDirectory(t, sdktest.PinnedSDK(t), tampered)
	isolation := filepath.Join(tampered, "pkg", "config", "isolation.go")
	data, err := os.ReadFile(isolation)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(isolation, []byte(strings.Replace(string(data), `"state-root-v1"`, `"tampered"`, 1)), 0o600))
	f.world.Write(f.world.Root, "go.work", "go 1.26.0\n\nuse ./consumer\n\nreplace "+devsdk.Module+" => ./tampered\n")
	run := environmentRunner(f)

	// Control: without the verifier's environment, Go really does build against
	// the tampered copy found through the parent go.work.
	output, err := run(context.Background(), f.consumer, nil, "list", "-m", "-json", devsdk.Module)
	require.NoError(t, err)
	require.Contains(t, string(output), `"Replace"`, "control: the parent go.work must take effect for plain Go commands: %s", output)
	require.Contains(t, string(output), "tampered", "control: %s", output)

	identity, err := verifier()(context.Background(), f.requestWith(run))
	require.NoError(t, err, "the verifier's own environment must keep the workspace file out")
	published, ok := identity.Published()
	require.True(t, ok)
	require.Equal(t, f.sdk.Published(), published)
	directory, err := devsdk.PublishedDirectory(context.Background(), f.request().Consumer, run)
	require.NoError(t, err)
	require.Equal(t, f.world.Extracted(f.sdk), directory, "the verified bytes come from the module cache, never the workspace replacement")
}

// Effective-version negative controls, with real Go. A readonly Go never lets the
// effective version differ from the declared one silently: it refuses the module
// graph itself, or its checksums are absent. Either way no identity is produced,
// and never the declared one.
func TestPublishedVerificationNeverReportsTheDeclaredVersionWhenTheGraphSelectsAnother(t *testing.T) {
	t.Run("an excluded declared version", func(t *testing.T) {
		f := newFixture(t)
		appendToFile(t, f.consumer, "go.mod", "\nexclude "+devsdk.Module+" "+f.sdk.Version+"\n")
		identity, err := verifier()(context.Background(), f.request())
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeDependencyUnavailable, typed.Code, typed.Message)
		require.Equal(t, 5, typed.Exit)
		require.Equal(t, devsdk.Identity{}, identity, "the declared release is excluded: it is never reported")
		require.NoDirExists(t, f.world.Extracted(f.sdk))
	})

	// A dependency that requires a higher SDK than the consumer lists. The
	// synthetic releases carry a trimmed go.mod so that the unpruned (go 1.16)
	// module graph the consumer asks for stays small and fully served.
	trim := func(tree string) {
		require.NoError(t, os.WriteFile(filepath.Join(tree, "go.mod"),
			[]byte("module "+devsdk.Module+"\n\ngo 1.25.0\n\nrequire github.com/google/uuid v1.6.0\n"), 0o600))
	}
	sums := func(r sdktest.Release) string {
		return fmt.Sprintf("%s %s %s\n%s %s/go.mod %s\n", r.Module, r.Version, r.ModuleSum, r.Module, r.Version, r.GoModSum)
	}
	graph := func(t *testing.T) (fixture, sdktest.Release) {
		t.Helper()
		world := sdktest.New(t)
		declared := world.PublishSDK("v0.17.4", trim)
		higher := world.PublishSDK("v0.18.0", trim)
		uuid := world.PublishPinned("github.com/google/uuid")
		helper := world.PublishRequiring("example.com/helper", "v1.0.0", higher)
		consumer := world.Consumer("consumer", declared, uuid)
		world.Write(consumer, "go.mod", "module example.com/consumer\n\ngo 1.16\n\nrequire (\n\t"+strings.Join([]string{
			declared.Module + " " + declared.Version, uuid.Module + " " + uuid.Version, helper.Module + " " + helper.Version}, "\n\t")+"\n)\n")
		world.Write(consumer, "go.sum", sums(declared)+sums(uuid)+sums(helper))
		return fixture{world: world, sdk: declared, uuid: uuid, consumer: consumer}, higher
	}
	t.Run("the selected version's checksums are absent", func(t *testing.T) {
		f, _ := graph(t)
		identity, err := devsdk.NewVerifier(f.world.Policy(f.sdk))(context.Background(), f.request())
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeChecksumsRequired, typed.Code, typed.Message)
		require.Equal(t, 3, typed.Exit)
		require.Contains(t, typed.Message, devsdk.Module+"@v0.18.0", "the refusal names the version Go says is missing, not the declared one")
		require.Equal(t, devsdk.Identity{}, identity)
	})
	t.Run("the selected version's checksums are recorded", func(t *testing.T) {
		f, higher := graph(t)
		appendToFile(t, f.consumer, "go.sum", sums(higher))
		for name, policy := range map[string]devsdk.Policy{"declared only": f.world.Policy(f.sdk), "both reviewed": f.world.Policy(f.sdk, higher)} {
			identity, err := devsdk.NewVerifier(policy)(context.Background(), f.request())
			typed := refusal(t, err)
			require.Equal(t, devsdk.CodeDependencyUnavailable, typed.Code, "%s: %s", name, typed.Message)
			require.Contains(t, typed.Message, "updates to go.mod needed", "Go itself refuses a readonly graph that selects another version than go.mod lists")
			require.Equal(t, devsdk.Identity{}, identity, "%s: the declared version is never reported for a graph that selects another", name)
		}
		require.NoDirExists(t, f.world.Extracted(higher))
	})
}

// The same real Go texts the classifier is tested with (see errors_test.go),
// produced by the verifier's own commands.
func TestPublishedVerificationMapsGoSumDiagnosticsFromRealGo(t *testing.T) {
	t.Run("another module's go.mod checksum is missing while the SDK is only the requirer", func(t *testing.T) {
		f := newFixture(t)
		// go 1.16 asks Go for the full module graph: the SDK's own requirements
		// (github.com/creack/pty and others) need go.mod checksums this go.sum lacks.
		data, err := os.ReadFile(filepath.Join(f.consumer, "go.mod"))
		require.NoError(t, err)
		f.world.Write(f.consumer, "go.mod", strings.Replace(string(data), "go 1.26.0", "go 1.16", 1))
		identity, err := verifier()(context.Background(), f.request())
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeDependencyUnavailable, typed.Code, "a missing entry of another module is not the SDK's missing checksum: %s", typed.Message)
		require.Equal(t, 5, typed.Exit)
		require.Contains(t, typed.Message, "missing go.sum entry for go.mod file")
		require.Contains(t, typed.Message, "github.com/creack/pty@")
		require.Equal(t, devsdk.Identity{}, identity)
	})
}

// toolchain handling: a published verification never lets a toolchain
// directive change which Go runs unless the environment allows switching, and a
// toolchain that cannot run fails closed with a typed refusal and no identity.
func TestPublishedVerificationAndGoToolchainDirectives(t *testing.T) {
	version, err := exec.Command("go", "env", "GOVERSION").Output()
	require.NoError(t, err)
	local := strings.TrimSpace(string(version))
	require.True(t, strings.HasPrefix(local, "go1."), local)

	t.Run("a toolchain line naming the local toolchain", func(t *testing.T) {
		f := newFixture(t)
		expected, err := verifier()(context.Background(), f.request())
		require.NoError(t, err)
		appendToFile(t, f.consumer, "go.mod", "\ntoolchain "+local+"\n")
		got, err := verifier()(context.Background(), f.request())
		require.NoError(t, err)
		require.Equal(t, expected, got)
	})
	t.Run("a newer toolchain line is not honored while the toolchain is local", func(t *testing.T) {
		f := newFixture(t)
		expected, err := verifier()(context.Background(), f.request())
		require.NoError(t, err)
		appendToFile(t, f.consumer, "go.mod", "\ntoolchain go1.99.0\n")
		got, err := verifier()(context.Background(), f.request())
		require.NoError(t, err, "GOTOOLCHAIN=local never switches: the local toolchain verifies")
		require.Equal(t, expected, got)
	})
	t.Run("a toolchain that would be switched to but cannot run", func(t *testing.T) {
		f := newFixture(t)
		appendToFile(t, f.consumer, "go.mod", "\ntoolchain go1.99.0\n")
		var commands [][]string
		identity, err := verifier()(context.Background(), f.requestWith(recordingEnvironmentRunner(f, &commands, "GOTOOLCHAIN=local+path", "PATH="+os.Getenv("PATH"))))
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeDependencyUnavailable, typed.Code, typed.Message)
		require.Contains(t, typed.Message, "go1.99.0")
		require.Equal(t, devsdk.Identity{}, identity)
		require.Len(t, commands, 1, "the first Go command fails closed: nothing is resolved or downloaded")
		require.NoDirExists(t, f.world.Extracted(f.sdk))
	})
	t.Run("a go line newer than the local toolchain", func(t *testing.T) {
		f := newFixture(t)
		data, err := os.ReadFile(filepath.Join(f.consumer, "go.mod"))
		require.NoError(t, err)
		f.world.Write(f.consumer, "go.mod", strings.Replace(string(data), "go 1.26.0", "go 1.99.0", 1))
		identity, err := verifier()(context.Background(), f.request())
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeDependencyUnavailable, typed.Code, typed.Message)
		require.Contains(t, typed.Message, "requires go >= 1.99.0")
		require.Equal(t, devsdk.Identity{}, identity)
	})
}

// An empty GOFLAGS variable does not mask the Go environment FILE: a flag there
// would still reach every command the verifier and the build run. The verifier
// refuses it before anything is resolved. The same flag as an ambient variable is
// neutralized by ModuleEnvironment.
func TestPublishedVerificationRefusesGoFlagsFromTheGoEnvironmentFile(t *testing.T) {
	scratch := t.TempDir()
	overlay := filepath.Join(scratch, "overlay.json")
	require.NoError(t, os.WriteFile(overlay, []byte(`{"Replace":{}}`), 0o600))
	evilMod := filepath.Join(scratch, "evil.mod")
	require.NoError(t, os.WriteFile(evilMod, []byte("module evil\n"), 0o600))
	flags := map[string]string{
		"overlay":    "-overlay=" + overlay,
		"toolexec":   "-toolexec=" + filepath.Join(scratch, "wrapper"),
		"modfile":    "-modfile=" + evilMod,
		"vendor":     "-mod=vendor",
		"modcacherw": "-modcacherw",
	}
	for name, flag := range flags {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			expected, err := verifier()(context.Background(), f.request())
			require.NoError(t, err, "control: the same consumer verifies without the flag")
			cleanCommands := len(f.world.Commands())

			envFile := filepath.Join(t.TempDir(), "goenv")
			require.NoError(t, os.WriteFile(envFile, []byte("GOFLAGS="+flag+"\n"), 0o600))
			fileRunner := func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
				return f.world.Runner()(ctx, directory, append([]string{"GOENV=" + envFile}, environment...), args...)
			}
			identity, err := verifier()(context.Background(), f.requestWith(fileRunner))
			typed := refusal(t, err)
			require.Equal(t, devsdk.CodeSelectionConflict, typed.Code, typed.Message)
			require.Equal(t, 4, typed.Exit)
			require.Equal(t, devsdk.Identity{}, identity)
			require.Contains(t, typed.Message, flag, "the refusal names the effective flags")
			require.Contains(t, typed.Message, "go env -u GOFLAGS")
			require.Equal(t, flag, typed.Details["goflags"])
			require.Equal(t, "plugin", typed.Details["consumer"])
			require.Equal(t, [][]string{{"env", "-json", "GOFLAGS"}}, f.world.Commands()[cleanCommands:],
				"only the environment query may run: nothing is listed, resolved or downloaded before the refusal")

			// The same flag in the ambient environment is neutralized, not refused.
			t.Setenv("GOFLAGS", flag)
			got, err := verifier()(context.Background(), f.request())
			require.NoError(t, err, "an ambient GOFLAGS variable is overridden by ModuleEnvironment")
			require.Equal(t, expected, got)

			// With the file as well, the file still wins and is refused.
			_, err = verifier()(context.Background(), f.requestWith(fileRunner))
			require.Equal(t, devsdk.CodeSelectionConflict, refusal(t, err).Code)
		})
	}

	t.Run("credentials in the flags are redacted and the flags are bounded", func(t *testing.T) {
		f := newFixture(t)
		envFile := filepath.Join(t.TempDir(), "goenv")
		hostile := "-tags=" + strings.Repeat("x", 1000) + " -toolexec=https://user:hunter2@example.com/wrapper"
		require.NoError(t, os.WriteFile(envFile, []byte("GOFLAGS="+hostile+"\n"), 0o600))
		run := func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
			return f.world.Runner()(ctx, directory, append([]string{"GOENV=" + envFile}, environment...), args...)
		}
		_, err := verifier()(context.Background(), f.requestWith(run))
		typed := refusal(t, err)
		require.Equal(t, devsdk.CodeSelectionConflict, typed.Code, typed.Message)
		require.NotContains(t, typed.Message, "hunter2")
		goflags, ok := typed.Details["goflags"].(string)
		require.True(t, ok)
		require.NotContains(t, goflags, "hunter2")
		require.LessOrEqual(t, len(goflags), 256+len("..."))
		require.Less(t, len(typed.Message), 1024, "the refusal is bounded")
		require.Contains(t, typed.Message, "[REDACTED]")
	})

	t.Run("a Go environment file without GOFLAGS keeps the user's other settings", func(t *testing.T) {
		f := newFixture(t)
		envFile := filepath.Join(t.TempDir(), "goenv")
		require.NoError(t, os.WriteFile(envFile, []byte("GOPROXY=file://"+f.world.Proxy+"\nGOSUMDB=off\n"), 0o600))
		run := func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
			return f.world.Runner()(ctx, directory, append([]string{"GOENV=" + envFile}, environment...), args...)
		}
		identity, err := verifier()(context.Background(), f.requestWith(run))
		require.NoError(t, err)
		require.NotEqual(t, devsdk.Identity{}, identity)
	})
}

// The refusal comes from the runner's own environment query, so a runner that
// cannot run Go reports a dependency problem, not a conflict.
func TestPublishedVerificationReportsAFailedEnvironmentQuery(t *testing.T) {
	f := newFixture(t)
	var commands [][]string
	run := func(_ context.Context, _ string, _ []string, args ...string) ([]byte, error) {
		commands = append(commands, args)
		if args[0] == "env" {
			return []byte("not json"), nil
		}
		return nil, fmt.Errorf("unexpected command %v", args)
	}
	identity, err := verifier()(context.Background(), f.requestWith(run))
	typed := refusal(t, err)
	require.Equal(t, devsdk.CodeDependencyUnavailable, typed.Code, typed.Message)
	require.Equal(t, devsdk.Identity{}, identity)
	require.Equal(t, [][]string{{"env", "-json", "GOFLAGS"}}, commands)
}
