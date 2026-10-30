package shellenv

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestMissingShellUsesAccount(t *testing.T) {
	lookup := func(path string) (string, error) {
		if path == "/opt/homebrew/bin/fish" {
			return path, nil
		}
		return "", errors.New("missing")
	}
	got := detect("", func() string { return "/opt/homebrew/bin/fish" }, lookup)
	if got != "/opt/homebrew/bin/fish" {
		t.Fatalf("account shell lost: %s", got)
	}
	got = detect("/opt/homebrew/bin/fish", func() string { t.Fatal("account overrides SHELL"); return "" }, lookup)
	if got != "/opt/homebrew/bin/fish" {
		t.Fatal(got)
	}
}

func TestExplicitInstalledShellAndArguments(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell executable fixture")
	}
	path, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash unavailable")
	}
	alias := filepath.Join(t.TempDir(), "custom-shell")
	if err := os.Symlink(path, alias); err != nil {
		t.Fatal(err)
	}
	selected, args, err := Resolve([]string{alias, "-c", `[[ $- == *i* ]] && shopt -q login_shell && printf 'interactive-login'`})
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(selected, args...)
	cmd.Env = []string{"HOME=" + t.TempDir(), "PATH=/usr/bin:/bin"}
	output, err := cmd.Output()
	if err != nil || string(output) != "interactive-login" || selected != alias {
		t.Fatalf("explicit shell failed: path=%s output=%q error=%v", selected, output, err)
	}
	if _, _, err := Resolve([]string{"/bin/cat"}); err == nil {
		t.Fatal("unsupported explicit shell silently accepted")
	}
	if _, _, err := Resolve([]string{"/missing/shell"}); err == nil {
		t.Fatal("missing explicit shell silently accepted")
	}
}

func TestLoginMergePreservesIsolation(t *testing.T) {
	base := []string{"PATH=/usr/bin", "HOME=/host", "OMNIVIEW_NATIVE_ORIGINAL_XDG=original", "OMNIVIEW_GENERATION=host", "TMPDIR=/host/tmp", "XDG_DATA_HOME=/native", "GOWORK=off", "PLUGIN_UNIX_SOCKET_DIR=/host/socket"}
	login := []string{"PATH=/opt/homebrew/bin:/usr/bin", "HOME=/wrong", "OMNIVIEW_NATIVE_ORIGINAL_XDG=forged", "OMNIVIEW_GENERATION=wrong", "OMNIVIEW_WORKSPACE_FILE=/forged", "TMPDIR=/wrong", "XDG_DATA_HOME=/wrong", "GOWORK=on", "PLUGIN_UNIX_SOCKET_DIR=/wrong", "AWS_PROFILE=login"}
	got := merge(base, login)
	values := make(map[string]string)
	for _, entry := range got {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	for _, entry := range base[1:] {
		key, value, _ := strings.Cut(entry, "=")
		if values[key] != value {
			t.Fatalf("protected key changed: %s", key)
		}
	}
	if values["OMNIVIEW_WORKSPACE_FILE"] != "" || values["PATH"] != "/opt/homebrew/bin:/usr/bin" || values["AWS_PROFILE"] != "login" {
		t.Fatal("login merge failed")
	}
}

// This test exercises real login and interactive startup files with a sparse
// environment without touching the user's home.
func TestCaptureLoginEnvironment(t *testing.T) {
	if _, err := os.Stat("/bin/zsh"); err != nil {
		t.Skip("zsh unavailable")
	}
	home := t.TempDir()
	for name, content := range map[string]string{
		".zprofile": "export PATH=/login/tools:/usr/bin:/bin\nexport OMNIVIEW_GENERATION=forged\n",
		".zshrc":    "export OMNIVIEW_SHELL_TEST_INTERACTIVE=yes\nexport LOGIN_INTERACTIVE=yes\nprintf 'startup noise\\n'\n",
	} {
		if err := os.WriteFile(filepath.Join(home, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	// Ambient SHELL must not override the supplied capture environment.
	t.Setenv("SHELL", "/missing/ambient-shell")
	base := []string{"HOME=" + home, "ZDOTDIR=" + home, "PATH=/usr/bin:/bin", "SHELL=/bin/zsh", "OMNIVIEW_GENERATION=host"}
	got, err := Capture(context.Background(), base)
	if err != nil {
		t.Fatal(err)
	}
	joined := "\n" + strings.Join(got, "\n") + "\n"
	for _, want := range []string{"PATH=/login/tools:/usr/bin:/bin", "LOGIN_INTERACTIVE=yes", "OMNIVIEW_GENERATION=host", "HOME=" + home} {
		if !strings.Contains(joined, "\n"+want+"\n") {
			t.Fatalf("missing login result %s", strings.SplitN(want, "=", 2)[0])
		}
	}
	if strings.Contains(joined, "OMNIVIEW_SHELL_TEST_INTERACTIVE=") {
		t.Fatal("shell imported protected state")
	}
	if err := os.WriteFile(filepath.Join(home, ".zshrc"), []byte("while :; do :; done\n"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := Capture(ctx, base); err == nil {
		t.Fatal("blocked profile ignored deadline")
	}
}

func TestCaptureShellFamilies(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix login profiles")
	}
	for _, family := range []string{"bash", "zsh", "fish", "tcsh", "csh"} {
		t.Run(family, func(t *testing.T) {
			shell, err := exec.LookPath(family)
			if err != nil {
				t.Skip(family + " unavailable")
			}
			home := t.TempDir()
			profiles := map[string]string{}
			switch family {
			case "bash":
				profiles[".bash_profile"] = "export SHELL_TEST_LOGIN=yes\n. \"$HOME/.bashrc\"\n"
				profiles[".bashrc"] = "case $- in *i*) export SHELL_TEST_INTERACTIVE=yes;; esac\n"
			case "zsh":
				profiles[".zprofile"] = "export SHELL_TEST_LOGIN=yes\n"
				profiles[".zshrc"] = "export SHELL_TEST_INTERACTIVE=yes\n"
			case "fish":
				profiles[".config/fish/config.fish"] = "if status is-login\nset -gx SHELL_TEST_LOGIN yes\nend\nif status is-interactive\nset -gx SHELL_TEST_INTERACTIVE yes\nend\n"
			default:
				profiles[".login"] = "setenv SHELL_TEST_LOGIN yes\n"
				profiles[".tcshrc"] = "if ($?prompt) setenv SHELL_TEST_INTERACTIVE yes\n"
				profiles[".cshrc"] = profiles[".tcshrc"]
			}
			for name, content := range profiles {
				path := filepath.Join(home, name)
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			base := []string{"HOME=" + home, "SHELL=" + shell, "ZDOTDIR=" + home, "XDG_CONFIG_HOME=" + filepath.Join(home, ".config"), "PATH=/usr/bin:/bin", "TERM=xterm-256color"}
			got, err := Capture(context.Background(), base)
			if err != nil {
				t.Fatal(err)
			}
			environment := "\n" + strings.Join(got, "\n") + "\n"
			for _, want := range []string{"SHELL_TEST_LOGIN=yes", "SHELL_TEST_INTERACTIVE=yes", "SHELL=" + shell} {
				if !strings.Contains(environment, "\n"+want+"\n") {
					t.Fatalf("missing %s in %s login environment", want, family)
				}
			}
		})
	}
}
