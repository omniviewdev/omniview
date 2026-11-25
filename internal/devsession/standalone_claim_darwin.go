//go:build darwin

package devsession

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/plugin-sdk/pkg/profilecontract"
	"golang.org/x/sys/unix"
)

// StandaloneClaim is a private checkout ownership record, not actor
// authentication. The checkout path and filesystem identity intentionally make
// copied or moved records invalid. Branch and commit are provenance, not identity.
type StandaloneClaim struct {
	SchemaVersion    int    `json:"schemaVersion"`
	Checkout         string `json:"checkout"`
	PhysicalIdentity string `json:"physicalIdentity"`
	Nonce            string `json:"nonce"`
}

// StandaloneClaimHandle pins the checkout, .local and claim directories. Close
// releases handles only; it never removes claims, state or stable guard inodes.
// Call Revalidate while holding TargetGuard immediately before state opening.
type StandaloneClaimHandle struct {
	Target                                devcontract.StandaloneTarget
	Claim                                 StandaloneClaim
	checkout, local, boundary             *os.Root
	checkoutInfo, localInfo, boundaryInfo os.FileInfo
	locks                                 string
	lockRoot                              *os.Root
	lockInfo                              os.FileInfo
}

func standaloneConflict(message string) error {
	return devcontract.Fail(4, "standalone_ownership_conflict", message)
}

func (h *StandaloneClaimHandle) Close() error {
	var failures []error
	for _, root := range []*os.Root{h.boundary, h.local, h.checkout, h.lockRoot} {
		if root != nil {
			failures = append(failures, root.Close())
		}
	}
	return errors.Join(failures...)
}

func standalonePhysical(info os.FileInfo) (string, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || stat.Uid != uint32(os.Geteuid()) {
		return "", standaloneConflict("checkout directory identity or ownership is unavailable")
	}
	return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino), nil
}

func privateStandaloneDirectory(info os.FileInfo) error {
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return standaloneConflict("standalone directory must be a real directory")
	}
	return checkPrivatePath("", info)
}

func openStandaloneChild(parent *os.Root, name string, create, private bool) (*os.Root, os.FileInfo, error) {
	info, err := parent.Lstat(name)
	if errors.Is(err, os.ErrNotExist) && create {
		if err = parent.Mkdir(name, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, nil, err
		}
		info, err = parent.Lstat(name)
	}
	if err != nil {
		return nil, nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, nil, standaloneConflict("standalone parent or child is redirected")
	}
	if _, err = standalonePhysical(info); err != nil {
		return nil, nil, err
	}
	if private {
		if err = privateStandaloneDirectory(info); err != nil {
			return nil, nil, err
		}
	}
	root, err := parent.OpenRoot(name)
	if err != nil {
		return nil, nil, err
	}
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(info, opened) {
		root.Close()
		return nil, nil, standaloneConflict("standalone directory changed while opening")
	}
	return root, opened, nil
}

func standaloneDigest(domain string, claim StandaloneClaim) string {
	raw, _ := json.Marshal(claim)
	sum := sha256.Sum256(append([]byte(domain+"\x00"), raw...))
	return hex.EncodeToString(sum[:])
}

func readStandaloneClaim(root *os.Root) (StandaloneClaim, error) {
	var claim StandaloneClaim
	before, err := root.Lstat(".owner.json")
	if err != nil {
		return claim, err
	}
	if !before.Mode().IsRegular() {
		return claim, standaloneConflict("standalone claim must be a private regular file")
	}
	if err = checkPrivatePath("", before); err != nil {
		return claim, err
	}
	file, err := root.Open(".owner.json")
	if err != nil {
		return claim, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return claim, standaloneConflict("standalone claim changed while opening")
	}
	raw, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil {
		return claim, err
	}
	if len(raw) > 4096 {
		return claim, standaloneConflict("standalone claim exceeds its metadata bound")
	}
	// Check exact fields as well as decoder strictness; Go otherwise accepts
	// case aliases and repeated keys. Claims always have four scalar fields.
	decoder := json.NewDecoder(bytes.NewReader(raw))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return claim, standaloneConflict("standalone claim is malformed")
	}
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		token, err := decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || fields[key] != nil {
			return claim, standaloneConflict("standalone claim has duplicate or malformed fields")
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return claim, standaloneConflict("standalone claim is malformed")
		}
		fields[key] = value
	}
	if _, err = decoder.Token(); err != nil {
		return claim, standaloneConflict("standalone claim is malformed")
	}
	if _, err = decoder.Token(); err != io.EOF || len(fields) != 4 {
		return claim, standaloneConflict("standalone claim has trailing or unknown fields")
	}
	for _, key := range []string{"schemaVersion", "checkout", "physicalIdentity", "nonce"} {
		if fields[key] == nil {
			return claim, standaloneConflict("standalone claim has unknown or missing fields")
		}
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&claim) != nil {
		return claim, standaloneConflict("standalone claim is malformed")
	}
	nonce, err := hex.DecodeString(claim.Nonce)
	if err != nil || len(nonce) != 32 || hex.EncodeToString(nonce) != claim.Nonce || claim.SchemaVersion != 2 {
		return claim, standaloneConflict("standalone claim version or nonce is invalid")
	}
	return claim, nil
}

// standaloneLockDirectory creates only typed guard parents, validating existing
// ownership and modes without chmod/adoption. Ancestor aliases in the selected
// HOME are canonicalized once; the dedicated namespaces may not be redirected.
func standaloneLockDirectory(home string) (_ string, _ *os.Root, _ os.FileInfo, resultErr error) {
	canonical, err := devcontract.CanonicalPath(home)
	if err != nil {
		return "", nil, nil, err
	}
	homeRoot, err := os.OpenRoot(canonical)
	if err != nil {
		return "", nil, nil, err
	}
	defer homeRoot.Close()
	base, _, err := openStandaloneChild(homeRoot, ".omniview-dev", true, true)
	if err != nil {
		return "", nil, nil, err
	}
	defer base.Close()
	locks, lockInfo, err := openStandaloneChild(base, "locks", true, true)
	if err != nil {
		return "", nil, nil, err
	}
	defer func() {
		if resultErr != nil {
			_ = locks.Close()
		}
	}()
	path := filepath.Join(canonical, ".omniview-dev", "locks")
	actual, err := devcontract.CanonicalPath(path)
	if err != nil || actual != path {
		return "", nil, nil, standaloneConflict("standalone guard namespace changed")
	}
	return path, locks, lockInfo, nil
}

func standaloneProtected(checkout, home string) error {
	boundary := filepath.Join(checkout, ".local", "dev-standalone")
	for _, suffix := range []string{".omniview", ".omniview-nightly", ".omniview-dev"} {
		protected, err := devcontract.CanonicalPath(filepath.Join(home, suffix))
		if err != nil {
			return err
		}
		overlap, err := devcontract.ProfilePathsOverlap(boundary, protected)
		if err != nil {
			return err
		}
		if overlap {
			return standaloneConflict("standalone storage overlaps a protected application namespace")
		}
	}
	path := filepath.Join(home, ".omniview-dev", "custom-profiles.json")
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return standaloneConflict("custom profile registry is redirected")
	}
	if err = checkPrivatePath("", info); err != nil {
		return err
	}
	var claims profilecontract.Claims
	if err = ReadPrivateJSON(path, &claims); err != nil {
		return err
	}
	if err = profilecontract.ValidateClaims(claims); err != nil {
		return err
	}
	for _, claim := range claims.Claims {
		overlap, err := devcontract.ProfilePathsOverlap(boundary, filepath.Dir(claim.StateRoot))
		if err != nil {
			return err
		}
		if overlap {
			return standaloneConflict("standalone storage overlaps an existing custom profile claim")
		}
	}
	return nil
}

type standaloneTrackedProbe struct{ seen bool }

func (w *standaloneTrackedProbe) Write(raw []byte) (int, error) {
	w.seen = w.seen || len(raw) != 0
	return len(raw), nil
}

// OpenStandaloneClaim establishes only the approved ownership marker. It does
// not create state/runtime/logs/build, launch a host or grant managed authority.
// Only genuinely absent managed context and a physical Git checkout qualify.
func OpenStandaloneClaim(ctx context.Context, checkout, home string, create bool) (_ *StandaloneClaimHandle, resultErr error) {
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return nil, err
		}
	}
	for _, key := range []string{"GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"} {
		if os.Getenv(key) != "" {
			return nil, standaloneConflict("ambient Git source overrides cannot select a standalone checkout")
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	canonical, err := devcontract.CanonicalPath(checkout)
	if err != nil {
		return nil, err
	}
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{CWD: canonical, EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), StateRoot: os.Getenv("OMNIVIEW_STATE_DIR"), Home: home})
	if err == nil {
		return nil, standaloneConflict("selected managed context cannot become standalone: " + resolved.Manifest.WorkspaceID)
	}
	var contractErr *devcontract.Error
	if !errors.As(err, &contractErr) || contractErr.Code != "missing_workspace" || os.Getenv(devcontract.WorkspaceEnvironment) != "" || os.Getenv("OMNIVIEW_STATE_DIR") != "" {
		return nil, err
	}
	command := exec.CommandContext(ctx, "git", "-C", canonical, "rev-parse", "--show-toplevel")
	command.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	raw, err := command.Output()
	if err != nil {
		return nil, standaloneConflict("standalone requires a readable physical Git checkout")
	}
	gitRoot, err := devcontract.CanonicalPath(strings.TrimSuffix(string(raw), "\n"))
	if err != nil || gitRoot != canonical {
		return nil, standaloneConflict("standalone target must be the actual Git checkout root")
	}
	// The dedicated subtree must never overlap committed source. This query
	// reads only this checkout's index and streams names without retaining them.
	tracked := &standaloneTrackedProbe{}
	index := exec.CommandContext(ctx, "git", "-C", canonical, "ls-files", "-z", "--", ".local/dev-standalone")
	index.Env = command.Env
	index.Stdout = tracked
	if err := index.Run(); err != nil {
		return nil, standaloneConflict("cannot validate standalone destination against tracked source")
	}
	if tracked.seen {
		return nil, standaloneConflict("standalone destination overlaps tracked source")
	}
	h := &StandaloneClaimHandle{}
	defer func() {
		if resultErr != nil {
			_ = h.Close()
		}
	}()
	h.checkout, err = os.OpenRoot(canonical)
	if err != nil {
		return nil, err
	}
	h.checkoutInfo, err = h.checkout.Stat(".")
	if err != nil {
		return nil, err
	}
	physical, err := standalonePhysical(h.checkoutInfo)
	if err != nil {
		return nil, err
	}
	if err = standaloneProtected(canonical, home); err != nil {
		return nil, err
	}
	h.locks, h.lockRoot, h.lockInfo, err = standaloneLockDirectory(home)
	if err != nil {
		return nil, err
	}
	key := sha256.Sum256([]byte("omniview/standalone/claim/v2\x00" + canonical + "\x00" + physical))
	lock, err := h.acquireGuard(ctx, "standalone-claim-"+hex.EncodeToString(key[:])+".lock", true)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	h.local, h.localInfo, err = openStandaloneChild(h.checkout, ".local", create, false)
	if err != nil {
		return nil, err
	}
	if h.localInfo.Mode().Perm()&0022 != 0 {
		return nil, standaloneConflict("checkout .local permits foreign writes")
	}
	h.boundary, h.boundaryInfo, err = openStandaloneChild(h.local, "dev-standalone", create, true)
	if err != nil {
		return nil, err
	}
	claim, err := readStandaloneClaim(h.boundary)
	if errors.Is(err, os.ErrNotExist) && create {
		directory, e := h.boundary.Open(".")
		if e != nil {
			return nil, e
		}
		_, e = directory.Readdirnames(1)
		directory.Close()
		if e != io.EOF {
			return nil, standaloneConflict("nonempty unowned standalone directory cannot be claimed")
		}
		nonce := make([]byte, 32)
		if _, err = rand.Read(nonce); err != nil {
			return nil, err
		}
		claim = StandaloneClaim{SchemaVersion: 2, Checkout: canonical, PhysicalIdentity: physical, Nonce: hex.EncodeToString(nonce)}
		encoded, _ := json.Marshal(claim)
		// Exclusive creation never overwrites another actor's marker. An interrupted
		// write is intentionally a malformed retained claim, never auto-repaired.
		file, e := h.boundary.OpenFile(".owner.json", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return nil, e
		}
		_, err = file.Write(append(encoded, '\n'))
		err = errors.Join(err, file.Sync(), file.Close())
		if err != nil {
			return nil, err
		}
		directory, e = h.boundary.Open(".")
		if e != nil {
			return nil, e
		}
		err = errors.Join(directory.Sync(), directory.Close())
		if err != nil {
			return nil, err
		}
		claim, err = readStandaloneClaim(h.boundary)
	}
	if err != nil {
		return nil, err
	}
	if claim.Checkout != canonical || claim.PhysicalIdentity != physical {
		return nil, standaloneConflict("standalone claim belongs to another physical checkout; copy/move migration is unsupported")
	}
	h.Claim = claim
	h.Target = devcontract.StandaloneTarget{Kind: "standalone", InstanceID: "standalone-" + standaloneDigest("omniview/standalone/instance/v2", claim), Checkout: canonical, ClaimDigest: standaloneDigest("omniview/standalone/claim-record/v2", claim)}
	if err = h.Revalidate(home); err != nil {
		return nil, err
	}
	return h, nil
}

// Revalidate compares both anchored handles and current path entries. It does
// not claim hostile same-account isolation; callers retain lifecycle guards and
// use anchored handles for subsequent state operations.
func (h *StandaloneClaimHandle) Revalidate(home string) error {
	if h == nil || h.Target.Validate() != nil {
		return standaloneConflict("standalone claim handle is invalid")
	}
	checks := []struct {
		path string
		info os.FileInfo
	}{{h.Target.Checkout, h.checkoutInfo}, {filepath.Join(h.Target.Checkout, ".local"), h.localInfo}, {filepath.Join(h.Target.Checkout, ".local", "dev-standalone"), h.boundaryInfo}}
	for _, check := range checks {
		info, err := os.Lstat(check.path)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !os.SameFile(info, check.info) {
			return standaloneConflict("standalone path identity changed")
		}
		if _, err := standalonePhysical(info); err != nil {
			return err
		}
		if check.path == filepath.Join(h.Target.Checkout, ".local") && info.Mode().Perm()&0022 != 0 {
			return standaloneConflict("checkout .local permits foreign writes")
		}
		if check.path == filepath.Join(h.Target.Checkout, ".local", "dev-standalone") {
			if err := privateStandaloneDirectory(info); err != nil {
				return err
			}
		}
	}
	if err := privateStandaloneDirectory(h.boundaryInfo); err != nil {
		return err
	}
	claim, err := readStandaloneClaim(h.boundary)
	if err != nil {
		return err
	}
	expected := devcontract.StandaloneTarget{Kind: "standalone", InstanceID: "standalone-" + standaloneDigest("omniview/standalone/instance/v2", claim), Checkout: claim.Checkout, ClaimDigest: standaloneDigest("omniview/standalone/claim-record/v2", claim)}
	if claim != h.Claim || expected != h.Target {
		return standaloneConflict("standalone claim changed")
	}
	return standaloneProtected(h.Target.Checkout, home)
}

// StandaloneGuard retains the actual external guard inode. Closing it unlocks
// that inode and never removes its directory entry.
type StandaloneGuard struct{ file *os.File }

func (g *StandaloneGuard) Close() error {
	return errors.Join(unix.Flock(int(g.file.Fd()), unix.LOCK_UN), g.file.Close())
}

// acquireGuard uses the same stable private-flock rule as AcquirePrivateLock,
// with os.Root anchoring for the standalone destination. No pathname reopen or
// chmod is needed. Parent/leaf substitution cannot redirect writes or locking.
func (h *StandaloneClaimHandle) acquireGuard(ctx context.Context, name string, wait bool) (*StandaloneGuard, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if h.lockRoot == nil || filepath.Base(name) != name {
		return nil, standaloneConflict("invalid standalone guard")
	}
	info, err := os.Lstat(h.locks)
	if err != nil || !os.SameFile(info, h.lockInfo) || privateStandaloneDirectory(info) != nil {
		return nil, standaloneConflict("standalone guard directory changed")
	}
	if info, err := h.lockRoot.Lstat(name); err == nil {
		if !info.Mode().IsRegular() {
			return nil, standaloneConflict("standalone guard is not a regular file")
		}
		if err := checkPrivatePath("", info); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	file, err := h.lockRoot.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if errors.Is(err, os.ErrExist) {
		file, err = h.lockRoot.OpenFile(name, os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	}
	if err != nil {
		return nil, err
	}
	failed := func(err error) (*StandaloneGuard, error) { file.Close(); return nil, err }
	opened, err := file.Stat()
	if err != nil {
		return failed(err)
	}
	if !opened.Mode().IsRegular() {
		return failed(standaloneConflict("standalone guard is not regular"))
	}
	if err := checkPrivatePath("", opened); err != nil {
		return failed(err)
	}
	for {
		err = unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			break
		}
		if !errors.Is(err, unix.EWOULDBLOCK) && !errors.Is(err, unix.EAGAIN) {
			return failed(err)
		}
		if !wait {
			return failed(devcontract.Fail(4, "standalone_busy", "standalone owner is busy; inspect or stop the current session"))
		}
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return failed(ctx.Err())
		case <-timer.C:
		}
	}
	current, err := h.lockRoot.Lstat(name)
	if err != nil || !os.SameFile(opened, current) {
		return failed(standaloneConflict("standalone guard inode changed"))
	}
	info, err = os.Lstat(h.locks)
	if err != nil || !os.SameFile(info, h.lockInfo) {
		return failed(standaloneConflict("standalone guard directory changed"))
	}
	if err := ctx.Err(); err != nil {
		return failed(err)
	}
	return &StandaloneGuard{file: file}, nil
}

// TargetGuard serializes transitions. SessionGuard is a nonblocking exclusive
// lifetime claim; a second owner gets refusal, never implicit attachment.
func (h *StandaloneClaimHandle) TargetGuard(ctx context.Context) (*StandaloneGuard, error) {
	if h.Target.Validate() != nil {
		return nil, standaloneConflict("invalid standalone target")
	}
	return h.acquireGuard(ctx, h.Target.InstanceID+".lock", true)
}
func (h *StandaloneClaimHandle) SessionGuard(ctx context.Context) (*StandaloneGuard, error) {
	if h.Target.Validate() != nil {
		return nil, standaloneConflict("invalid standalone target")
	}
	return h.acquireGuard(ctx, h.Target.InstanceID+"-session.lock", false)
}
