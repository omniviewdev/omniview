//go:build !windows

package terminal

import (
	"bufio"
	"context"
	"embed"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/marks"
	"github.com/omniviewdev/omniview/internal/shellenv"
)

// Shell integration (issue #694, step 2): the host starts the user's zsh or fish so that the shell tells it where a
// command starts and ends, with what status and in which directory (OSC 133, OSC 7 and the 633;E and 633;P marks with
// the session's nonce, which the scanner of package marks reads).
//
// The mechanism is the shell's own startup. Nothing of the user's is edited and nothing is typed into the pty:
//
//   - zsh is started with ZDOTDIR pointing at a directory of the host's whose four startup files run the user's
//     real ones, in zsh's own order, with the user's ZDOTDIR, and give ZDOTDIR back;
//   - fish is started with that directory in front of XDG_DATA_DIRS, so that its vendor_conf.d file runs before the
//     user's config.fish, and gives XDG_DATA_DIRS back at once.
//
// The shell is started once, as the one interactive login shell of the shell contract (T1-go.md 2.8): the arguments and
// the order of PATH are the shell's own, and only these variables are added.
//
// The nonce does not travel in the environment. The host makes it from crypto/rand, writes it with the user's value of
// the variable it replaced onto a socket, and gives the shell the other end as file descriptor 3. The script reads it
// into a variable that is not exported and closes the descriptor (fish cannot close one: it is read to its end, and a
// fish that is started inside finds nothing there). So no child of the shell has it in its environment, a nested shell
// has no nonce and no integration, and /proc/<pid>/environ does not show it. The script writes "ready" to the socket
// when the shell has run every startup file: that is how the host knows the shell came up with it, and the
// directory is removed at that moment, so that a crash of the host later leaves nothing.

//go:embed integration_scripts/zsh/zshenv integration_scripts/zsh/zprofile integration_scripts/zsh/zshrc integration_scripts/zsh/zlogin integration_scripts/fish/omniview-integration.fish
var integrationScripts embed.FS

const (
	// shimDirPrefix begins the name of the host's directory of one session's integration, which is made in the
	// system's temporary directory and is owner-only.
	shimDirPrefix = "omniview-integration-"
	// earlyExit is how long a shell that has the integration has to come up. One that ends within it is started once
	// more without the integration; one that is neither ready nor gone by then is taken to be a slow startup.
	earlyExit = 500 * time.Millisecond
	// channelWrite bounds the host's write of the two lines the shell reads, which a socket takes at once.
	channelWrite = time.Second
	// readyLine is what the script writes when the shell is up.
	readyLine = "ready"
)

// shellKind is a shell that has an integration.
type shellKind string

const (
	kindNone shellKind = ""
	kindZsh  shellKind = "zsh"
	kindFish shellKind = "fish"
)

// integrationPlan decides, with no effect, what the host does for a shell: the kind of script to inject or why not.
// args are the arguments the shell starts with (shellenv.Resolve: the login flags and then the caller's own) and env is the
// launch environment.
func integrationPlan(enabled bool, shellPath string, args, env []string) (shellKind, Integration) {
	if !enabled {
		return kindNone, Integration{State: IntegrationOff, Reason: ""}
	}
	var kind shellKind
	switch shellenv.Name(shellPath) {
	case "zsh":
		kind = kindZsh
	case "fish":
		kind = kindFish
	default:
		return kindNone, skipped(SkipUnsupportedShell)
	}
	if reason := unknownArguments(args); reason != "" {
		return kindNone, skipped(reason)
	}
	if envValue(env, "P9K_VERSION") != "" {
		return kindNone, skipped(SkipPowerlevel10k)
	}
	if inMultiplexer(env) {
		return kindNone, skipped(SkipMultiplexer)
	}
	return kind, Integration{State: IntegrationOn, Reason: ""}
}

func skipped(reason IntegrationReason) Integration {
	return Integration{State: IntegrationSkipped, Reason: reason}
}

// unknownArguments says why the arguments of the shell rule the integration out, or nothing when they are the login
// flags and options that only say the same. The user's profile is not broken for a flag the host does not know.
func unknownArguments(args []string) IntegrationReason {
	var unknown bool
	for _, arg := range args {
		switch {
		case arg == "-i" || arg == "-l" || arg == "--login" || arg == "--interactive":
		case arg == "--command" || (strings.HasPrefix(arg, "-") && !strings.HasPrefix(arg, "--") && strings.Contains(arg, "c")):
			return SkipCommand
		case arg == "--posix":
			return SkipPosix
		default:
			unknown = true
		}
	}
	if unknown {
		return SkipArguments
	}
	return ""
}

var multiplexerTerm = regexp.MustCompile(`^(screen|tmux)([-.]|$)`)

func inMultiplexer(env []string) bool {
	return envValue(env, "TMUX") != "" || envValue(env, "STY") != "" || multiplexerTerm.MatchString(envValue(env, "TERM"))
}

// envValue is the value of the last entry of env with the name key.
func envValue(env []string, key string) string {
	for _, entry := range slices.Backward(env) {
		if name, value, ok := strings.Cut(entry, "="); ok && name == key {
			return value
		}
	}
	return ""
}

// injection is what the host made for one start of one shell: its directory, the channel the shell reads the nonce on
// and writes "ready" to, and the variables it adds. It is closed once, when it has done its work or the shell is gone.
type injection struct {
	dir   string
	host  net.Conn
	child *os.File
	nonce marks.Nonce
	// env replaces the entries of the shell's environment with the same names.
	env  []string
	once sync.Once
}

// prepareInjection makes the directory with the scripts of kind, the nonce and the channel. env is the shell's environment, whose
// value of the variable the injection replaces goes to the script.
func prepareInjection(kind shellKind, env []string) (_ *injection, err error) {
	nonce, err := marks.NewNonce()
	if err != nil {
		return nil, fmt.Errorf("making the nonce: %w", err)
	}
	inj := &injection{dir: "", host: nil, child: nil, nonce: nonce, env: nil, once: sync.Once{}}
	defer func() {
		if err != nil {
			inj.close()
		}
	}()
	// MkdirTemp makes the directory with mode 0700 and a name nobody else can have made first; the chmod is for a umask that
	// has taken less than that away, which it cannot, and costs nothing.
	if inj.dir, err = os.MkdirTemp("", shimDirPrefix); err != nil {
		return nil, fmt.Errorf("making the integration directory: %w", err)
	}
	if err = os.Chmod(inj.dir, 0o700); err != nil {
		return nil, fmt.Errorf("securing the integration directory: %w", err)
	}
	var original string
	switch kind {
	case kindZsh:
		for from, to := range map[string]string{"zshenv": ".zshenv", "zprofile": ".zprofile", "zshrc": ".zshrc", "zlogin": ".zlogin"} {
			if err = copyScript("integration_scripts/zsh/"+from, filepath.Join(inj.dir, to)); err != nil {
				return nil, err
			}
		}
		original = originalOf(env, "ZDOTDIR")
		inj.env = []string{"ZDOTDIR=" + inj.dir}
	case kindFish:
		vendor := filepath.Join(inj.dir, "data", "fish", "vendor_conf.d")
		if err = os.MkdirAll(vendor, 0o700); err != nil {
			return nil, fmt.Errorf("making the integration directory: %w", err)
		}
		if err = copyScript("integration_scripts/fish/omniview-integration.fish", filepath.Join(vendor, "omniview-integration.fish")); err != nil {
			return nil, err
		}
		original = originalOf(env, "XDG_DATA_DIRS")
		inherited := strings.TrimPrefix(original, "s:")
		if original == "u:" {
			inherited = "/usr/local/share:/usr/share"
		}
		inj.env = []string{"XDG_DATA_DIRS=" + filepath.Join(inj.dir, "data") + ":" + inherited}
	case kindNone:
		return nil, errors.New("no shell to make an integration for")
	}
	if strings.ContainsAny(original, "\n\r") {
		return nil, errors.New("the user's variable holds a line break")
	}
	if err = inj.open(); err != nil {
		return nil, err
	}
	_ = inj.host.SetWriteDeadline(time.Now().Add(channelWrite))
	if _, err = inj.host.Write([]byte(nonce.Reveal() + "\n" + original + "\n")); err != nil {
		return nil, fmt.Errorf("writing to the integration channel: %w", err)
	}
	return inj, nil
}

// originalOf is how the script learns the user's value of a variable the injection takes over: "s:<value>" or "u:".
func originalOf(env []string, key string) string {
	for _, entry := range slices.Backward(env) {
		if name, value, ok := strings.Cut(entry, "="); ok && name == key {
			return "s:" + value
		}
	}
	return "u:"
}

func copyScript(from, to string) error {
	data, err := integrationScripts.ReadFile(from)
	if err != nil {
		return fmt.Errorf("reading an integration script: %w", err)
	}
	if err = os.WriteFile(to, data, 0o600); err != nil {
		return fmt.Errorf("writing an integration script: %w", err)
	}
	return nil
}

// open makes the channel: a socket pair, neither end inherited by a program the host starts but the one end that is
// given to the shell on purpose.
func (i *injection) open() error {
	syscall.ForkLock.RLock()
	fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if err == nil {
		unix.CloseOnExec(fds[0])
		unix.CloseOnExec(fds[1])
	}
	syscall.ForkLock.RUnlock()
	if err != nil {
		return fmt.Errorf("making the integration channel: %w", err)
	}
	hostFile := os.NewFile(uintptr(fds[0]), "integration-host")
	i.child = os.NewFile(uintptr(fds[1]), "integration-shell")
	conn, err := net.FileConn(hostFile)
	_ = hostFile.Close()
	if err != nil {
		return fmt.Errorf("making the integration channel: %w", err)
	}
	i.host = conn
	return nil
}

// close releases what the injection holds: the channel and the directory. It is safe to call again.
func (i *injection) close() {
	if i == nil {
		return
	}
	i.once.Do(func() {
		if i.host != nil {
			_ = i.host.Close()
		}
		if i.child != nil {
			_ = i.child.Close()
		}
		if i.dir != "" {
			_ = os.RemoveAll(i.dir)
		}
	})
}

// outcome is what became of a shell that was started with an integration.
type outcome int

const (
	// outcomeReady: the script said the shell is up.
	outcomeReady outcome = iota
	// outcomeSlow: the shell is neither ready nor gone yet; its startup is slow, which is not a failure.
	outcomeSlow
	// outcomeGone: the shell ended before it was ready.
	outcomeGone
)

// await waits for the shell to say it is ready, to end, or for earlyExit to pass, whichever comes first. reaped is the
// shell's end, from the reaper of the manager. It closes nothing.
func (i *injection) await(ctx context.Context, reaped <-chan error) (outcome, error) {
	said := make(chan bool, 1)
	go func() {
		line, err := bufio.NewReader(i.host).ReadString('\n')
		said <- err == nil && strings.TrimSpace(line) == readyLine
	}()
	timer := time.NewTimer(earlyExit)
	defer timer.Stop()
	select {
	case ok := <-said:
		if ok {
			return outcomeReady, nil
		}
		// The channel ended with no word: the shell is gone, or is on its way out; its end is what decides.
		select {
		case err := <-reaped:
			return outcomeGone, err
		case <-timer.C:
			return outcomeSlow, nil
		case <-ctx.Done():
			return outcomeSlow, nil
		}
	case err := <-reaped:
		return outcomeGone, err
	case <-timer.C:
		return outcomeSlow, nil
	case <-ctx.Done():
		return outcomeSlow, nil
	}
}
