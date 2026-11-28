package extensionpolicy

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func wireGrant(name string, fields ...string) string {
	if fields == nil {
		fields = []string{}
	}
	list, _ := json.Marshal(fields)
	return fmt.Sprintf(`{"point":"owner/point","offer":"peer/%s","ownerPin":"sha256:%s","contributorPin":"sha256:%s","contract":"%s","fields":%s}`,
		name, strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64), list)
}

func document(previous []byte, extra string, rows ...string) []byte {
	if previous != nil {
		sum := sha256.Sum256(previous)
		extra += `,"previous":"` + hex.EncodeToString(sum[:]) + `"`
	}
	return []byte(`{"schemaVersion":1,"grants":[` + strings.Join(rows, ",") + `]` + extra + `}`)
}

func TestClosedPolicyGrammar(t *testing.T) {
	row := wireGrant("body", "kind")
	good := string(document(nil, "", row))
	for name, invalid := range map[string]string{
		"not object": "null", "missing version": `{"grants":[]}`, "wrong version": strings.Replace(good, `:1,`, `:2,`, 1),
		"missing grants": `{"schemaVersion":1}`, "null grants": `{"schemaVersion":1,"grants":null}`,
		"trailing": good + ` {}`, "duplicate escaped root key": `{"schemaVersion":1,"grants":[],"g\u0072ants":[]}`,
		"unknown root": string(document(nil, `,"automatic":true`, row)), "wrong case": strings.Replace(good, "ownerPin", "OwnerPin", 1),
		"null switch": string(document(nil, `,"disabled":null`)), "unknown row": strings.Replace(good, `"fields":`, `"enabled":true,"fields":`, 1),
		"renderer continuity":  strings.Replace(good, `"fields":`, `"continuity":"old","fields":`, 1),
		"duplicate row member": strings.Replace(good, `"point":`, `"point":"x/y","point":`, 1),
		"duplicate pair":       string(document(nil, "", row, row)), "duplicate field": string(document(nil, "", wireGrant("body", "x", "x"))),
		"missing fields": strings.Replace(good, `,"fields":["kind"]`, "", 1), "null read": strings.Replace(good, `"fields":`, `"read":null,"fields":`, 1),
		"null previous": string(document(nil, `,"previous":null`)), "bad proof": string(document(nil, `,"previous":"bad"`)),
		"unqualified": strings.Replace(good, "owner/point", "point", 1), "wildcard": strings.Replace(good, "peer/body", "peer/*", 1),
		"extra segment": strings.Replace(good, "peer/body", "peer/body/more", 1), "reserved": strings.Replace(good, "peer/body", "host/body", 1),
		"sdk namespace": strings.Replace(good, "peer/body", "visuals/body", 1), "unsafe field": strings.Replace(good, "kind", "constructor", 1),
		"unicode ID": strings.Replace(good, "peer/body", "peer/é", 1), "long segment": string(document(nil, "", wireGrant(strings.Repeat("g", 129)))),
		"plain pin": strings.Replace(good, "sha256:", "", 1), "uppercase pin": strings.Replace(good, strings.Repeat("a", 64), strings.Repeat("A", 64), 1),
		"short contract": strings.Replace(good, strings.Repeat("c", 64), "c", 1), "duplicate disable": string(document(nil, `,"disabledOffers":["a/b","a/b"]`)),
		"duplicate binding disable": string(document(nil, `,"disabledBindings":[{"point":"a/b","offer":"c/d"},{"point":"a/b","offer":"c/d"}]`)),
		"unknown disable member":    string(document(nil, `,"disabledBindings":[{"point":"a/b","offer":"c/d","source":"e/f"}]`)),
		"invalid UTF8":              strings.Replace(good, "kind", "k\xff", 1),
	} {
		t.Run(name, func(t *testing.T) {
			_, _, err := decode([]byte(invalid))
			require.ErrorIs(t, err, errPolicy)
		})
	}
	fields := make([]string, maxFields+1)
	for i := range fields {
		fields[i] = fmt.Sprintf("f%d", i)
	}
	_, _, err := decode(document(nil, "", wireGrant("body", fields[:maxFields]...)))
	require.NoError(t, err)
	_, _, err = decode(document(nil, "", wireGrant("body", fields...)))
	require.ErrorIs(t, err, errPolicy)
	rows := make([]string, maxRows+1)
	for i := range rows {
		rows[i] = wireGrant(fmt.Sprintf("g%d", i))
	}
	s, _, err := decode(document(nil, "", rows[:maxRows]...))
	require.NoError(t, err)
	require.Len(t, s.Grants, maxRows)
	_, _, err = decode(document(nil, "", rows...))
	require.ErrorIs(t, err, errPolicy)
}

func profile(t *testing.T) string {
	t.Helper()
	root, err := devsession.EnsurePrivateDirectory(t.TempDir())
	require.NoError(t, err)
	return root
}

func watchProfile(t *testing.T, root string) (*Store, <-chan Change) {
	t.Helper()
	changes := make(chan Change, 32)
	s, err := Open(root, func(c Change) { changes <- c })
	require.NoError(t, err)
	t.Cleanup(s.Close)
	return s, changes
}

func next(t *testing.T, ch <-chan Change) Change {
	t.Helper()
	select {
	case c := <-ch:
		return c
	case <-time.After(3 * time.Second):
		t.Fatal("watch did not invalidate after a completed filesystem change")
		return Change{}
	}
}

func TestPrivatePolicyAtomicConsent(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	root := profile(t)
	s, events := watchProfile(t, root)
	service := NewService(s)
	require.False(t, service.Read().Known)
	a, b := wireGrant("a", "z", "k"), wireGrant("b")
	p := document(nil, "", b, a)
	require.NoError(t, s.Replace(p))
	baseline := service.Read()
	require.True(t, baseline.Known)
	require.Nil(t, next(t, events).Affected)
	require.Equal(t, []string{"k", "z"}, baseline.Grants[0].Fields)
	require.Equal(t, []string{}, baseline.Grants[1].Fields) // explicit empty consent
	require.NotEmpty(t, baseline.Grants[0].Continuity)
	beforeA, beforeB := baseline.Grants[0].Continuity, baseline.Grants[1].Continuity
	baseline.Grants[0].Fields[0] = "leak"
	baseline.Grants[1].Point = "forged/point"
	require.Equal(t, []string{"k", "z"}, service.Read().Grants[0].Fields)
	require.Equal(t, "owner/point", service.Read().Grants[1].Point)

	// Ordering is immaterial. A well-formed stale/absent sibling stays inert
	// at binding admission and cannot poison either original grant here.
	a = wireGrant("a", "k", "z")
	stale := strings.Replace(wireGrant("stale"), "owner/point", "absent/point", 1)
	p = document(p, "", a, stale, b)
	require.NoError(t, s.Replace(p))
	c := next(t, events)
	require.Equal(t, baseline.Revision, c.Previous)
	require.Equal(t, []AffectedBinding{{Point: "absent/point", Offer: "peer/stale"}}, *c.Affected)
	unchanged := s.Snapshot()
	require.Equal(t, beforeA, unchanged.Grants[1].Continuity)
	require.Equal(t, beforeB, unchanged.Grants[2].Continuity)

	// The renderer can preserve work when none of these exact changed keys
	// were requested, but only after the native read confirms that issuance.
	a = wireGrant("a", "k", "extra")
	p = document(p, "", a, stale, b)
	require.NoError(t, s.Replace(p))
	fieldChange := next(t, events)
	require.Equal(t, []AffectedBinding{{Point: "owner/point", Offer: "peer/a", Fields: []string{"extra", "z"}}}, *fieldChange.Affected)
	require.Equal(t, fieldChange.Revision, s.Snapshot().Grants[1].Continuity)

	// A read decision changes only its binding. Removing and reissuing the
	// same scalar grant cannot resurrect work from that issuance.
	read := strings.TrimSuffix(a, "}") + `,"read":"` + strings.Repeat("d", 64) + `"}`
	edge := AffectedBinding{Point: "owner/point", Offer: "peer/a"}
	p = document(p, "", read, stale, b)
	require.NoError(t, s.Replace(p))
	readOnly := AffectedBinding{Point: edge.Point, Offer: edge.Offer, ReadOnly: true}
	require.Equal(t, []AffectedBinding{readOnly}, *next(t, events).Affected)
	withRead := s.Snapshot()
	require.NotEmpty(t, withRead.Grants[1].Read)
	require.NotEqual(t, beforeA, withRead.Grants[1].Continuity)
	p = document(p, "", a, stale, b)
	require.NoError(t, s.Replace(p))
	require.Equal(t, []AffectedBinding{readOnly}, *next(t, events).Affected)
	require.Empty(t, s.Snapshot().Grants[1].Read)
	// A combined edit proves neither scalar nor read continuity.
	p = document(p, "", strings.Replace(read, `"extra"`, `"another"`, 1), stale, b)
	require.NoError(t, s.Replace(p))
	require.Equal(t, []AffectedBinding{edge}, *next(t, events).Affected)
	p = document(p, "", stale, b)
	require.NoError(t, s.Replace(p))
	require.Equal(t, []AffectedBinding{edge}, *next(t, events).Affected)
	p = document(p, "", a, stale, b)
	require.NoError(t, s.Replace(p))
	require.Equal(t, []AffectedBinding{edge}, *next(t, events).Affected)
	reissued := s.Snapshot()
	require.NotEqual(t, beforeA, reissued.Grants[1].Continuity)
	require.Equal(t, beforeB, reissued.Grants[2].Continuity)

	for _, deny := range []string{`,"disabledOffers":["peer/a"]`, `,"disabledBindings":[{"point":"owner/point","offer":"peer/a"}]`} {
		p = document(p, deny, a, stale, b)
		require.NoError(t, s.Replace(p))
		require.Equal(t, []AffectedBinding{edge}, *next(t, events).Affected)
		p = document(p, "", a, stale, b)
		require.NoError(t, s.Replace(p))
		require.Equal(t, []AffectedBinding{edge}, *next(t, events).Affected)
		require.Equal(t, beforeB, s.Snapshot().Grants[2].Continuity)
	}
	p = document(p, `,"disabled":true`, a, stale, b)
	require.NoError(t, s.Replace(p))
	require.Nil(t, next(t, events).Affected)
	require.True(t, s.Snapshot().Disabled)
	p = document(p, "", a, stale, b)
	require.NoError(t, s.Replace(p))
	require.Nil(t, next(t, events).Affected)
	require.NotEqual(t, beforeB, s.Snapshot().Grants[2].Continuity)

	revision := s.Snapshot().Revision
	require.Error(t, s.Replace(document([]byte("superseded"), "", a)))
	require.Error(t, s.Replace([]byte(`{"schemaVersion":2,"grants":[]}`)))
	require.Equal(t, revision, s.Snapshot().Revision)
	stored, err := os.ReadFile(filepath.Join(root, directory, filename))
	require.NoError(t, err)
	require.True(t, bytes.Equal(stored, p))
	other, _ := watchProfile(t, profile(t))
	require.False(t, other.Snapshot().Known)
}

func TestPolicyExternalWatchAndRecovery(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	root := profile(t)
	s, events := watchProfile(t, root)
	a := wireGrant("a")
	p := document(nil, "", a)
	require.NoError(t, s.Replace(p))
	baseline := s.Snapshot()
	_ = next(t, events)
	path := filepath.Join(root, directory, filename)
	update := document(p, "", a, wireGrant("b"))
	require.NoError(t, devsession.WritePrivateFile(path, update)) // no Store read/write triggers this invalidation
	c := next(t, events)
	require.Equal(t, baseline.Revision, c.Previous)
	require.Nil(t, c.Affected, "an external writer's predecessor claim is not a continuity proof")
	require.NotEqual(t, baseline.Grants[0].Continuity, s.Snapshot().Grants[0].Continuity)

	require.NoError(t, devsession.WritePrivateFile(path, []byte(`{"schemaVersion":1,"grants":[],"grants":[]}`)))
	require.Nil(t, next(t, events).Affected)
	unknown := s.Snapshot()
	require.False(t, unknown.Known)
	require.True(t, unknown.Disabled)
	require.Empty(t, unknown.Grants)
	require.NoError(t, devsession.WritePrivateFile(path, p))
	require.Nil(t, next(t, events).Affected)
	repaired := s.Snapshot()
	require.True(t, repaired.Known)
	require.NotEqual(t, baseline.Grants[0].Continuity, repaired.Grants[0].Continuity)

	// A lost native subscription fences all windows even if the same snapshot
	// remains on disk. The next native read resubscribes before granting again.
	s.mu.Lock()
	s.watch.interrupt()
	s.mu.Unlock()
	loss := next(t, events)
	require.Equal(t, repaired.Revision, loss.Previous)
	require.Nil(t, loss.Affected)
	reconnected := NewService(s).Read()
	require.True(t, reconnected.Known)
	require.NotEqual(t, repaired.Grants[0].Continuity, reconnected.Grants[0].Continuity)
	s.Close()
	require.False(t, NewService(s).Read().Known)
	require.Error(t, s.Replace(p))
	restarted, _ := watchProfile(t, root)
	require.True(t, restarted.Snapshot().Known)
	require.NotEqual(t, reconnected.Grants[0].Continuity, restarted.Snapshot().Grants[0].Continuity)
}

func TestUnobservedRevokeAndReadSpanningReplacement(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	root := profile(t)
	s, _ := watchProfile(t, root)
	p := document(nil, "", wireGrant("a"), wireGrant("b"))
	require.NoError(t, s.Replace(p))
	baseline := s.Snapshot()
	path := filepath.Join(root, directory, filename)
	func() {
		s.mu.Lock() // hold delivery across two complete operator commits; no timing assumption
		defer s.mu.Unlock()
		f, id, err := s.openFileLocked(filename)
		require.NoError(t, err)
		if runtime.GOOS == "windows" {
			f.Close() // Windows can refuse to replace an open destination
		} else {
			defer f.Close()
		}
		withdrawn := document(p, "", wireGrant("b"))
		require.NoError(t, devsession.WritePrivateFile(path, withdrawn))
		// A stale external editor still claims the original predecessor. The
		// observed final bytes alone cannot prove that no revoke occurred.
		reissued := document(p, "", wireGrant("a"), wireGrant("b"))
		require.NoError(t, devsession.WritePrivateFile(path, reissued))
		if runtime.GOOS != "windows" {
			require.False(t, s.currentLocked(f, id), "superseded read may not publish")
		}
	}()
	current := s.Snapshot()
	require.True(t, current.Known)
	require.NotEqual(t, baseline.Grants[0].Continuity, current.Grants[0].Continuity)
	require.NotEqual(t, baseline.Grants[1].Continuity, current.Grants[1].Continuity, "gap cannot prove sibling continuity")
}

func TestNativePublicationWitnessesTheDisplacedFile(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	root := profile(t)
	s, _ := watchProfile(t, root)
	a := wireGrant("a")
	original := document(nil, "", a)
	require.NoError(t, s.Replace(original))
	prior := s.Snapshot()
	s.mu.Lock()
	defer s.mu.Unlock()
	// Place a real external revoke in the interval between the native preread
	// and atomic replacement. A match against cached policy bytes would miss it.
	require.NoError(t, devsession.WritePrivateFile(filepath.Join(root, directory, filename), document(original, "")))
	regrant := document(original, "", a)
	native := publication{file: nil, sum: sha256.Sum256(regrant)}
	require.NoError(t, s.replaceLinkedLocked(regrant, &native))
	require.Nil(t, native.file)
	change := s.refreshLocked(&native)
	require.NotNil(t, change)
	require.Nil(t, change.Affected)
	require.NotEqual(t, prior.Grants[0].Continuity, s.state.Grants[0].Continuity)
}

func TestPolicyRejectsInsecureOrMutableState(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	p := document(nil, "", wireGrant("body"))
	for _, hazard := range []string{"redirect", "hard link", "oversized", "in place", "public", "unreadable", "public directory"} {
		t.Run(hazard, func(t *testing.T) {
			root := profile(t)
			s, _ := watchProfile(t, root)
			require.NoError(t, s.Replace(p))
			applyPolicyHazard(t, hazard, root, p)
			got := s.Snapshot()
			require.False(t, got.Known)
			require.True(t, got.Disabled)
			require.Empty(t, got.Grants)
		})
	}
}

func applyPolicyHazard(t *testing.T, hazard, root string, p []byte) {
	t.Helper()
	path := filepath.Join(root, directory, filename)
	switch hazard {
	case "redirect":
		outside := filepath.Join(profile(t), filename)
		require.NoError(t, devsession.WritePrivateFile(outside, p))
		require.NoError(t, os.Remove(path))
		if err := os.Symlink(outside, path); err != nil {
			t.Skipf("host cannot create symlinks: %v", err)
		}
	case "hard link":
		if err := os.Link(path, filepath.Join(root, "also-writable-elsewhere")); err != nil {
			t.Skipf("host cannot create hard links: %v", err)
		}
	case "oversized":
		require.NoError(t, os.Truncate(path, maxBytes+1)) // sparse; rejected before allocation
	case "in place":
		require.NoError(t, os.WriteFile(path, document(p, "", wireGrant("mutable")), 0o600))
	case "public", "unreadable", "public directory":
		if runtime.GOOS == "windows" {
			t.Skip("Windows private access uses DACLs, not chmod")
		}
		mode := os.FileMode(0o644)
		if hazard == "unreadable" {
			mode = 0
		}
		if hazard == "public directory" {
			path, mode = filepath.Dir(path), 0o750
		}
		require.NoError(t, os.Chmod(path, mode))
	}
}

func TestPolicyWatchRejectsPublicFileMode(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("requires a watched POSIX file mode")
	}
	watchPermissionChange(t, func(path string) {
		require.NoError(t, os.Chmod(path, 0o644))
	})
}

func watchPermissionChange(t *testing.T, expose func(string)) {
	t.Helper()
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	root := profile(t)
	s, events := watchProfile(t, root)
	initial := document(nil, "", wireGrant("body"))
	require.NoError(t, s.Replace(initial))
	_ = next(t, events)
	require.NoError(t, s.Replace(document(initial, "", wireGrant("body", "kind"))))
	previous := s.Snapshot().Revision
	_ = next(t, events)
	expose(filepath.Join(root, directory, filename))
	// Do not call Read to trigger detection. The watch itself must revoke.
	c := next(t, events)
	require.Equal(t, previous, c.Previous)
	require.Nil(t, c.Affected)
	require.False(t, s.Snapshot().Known)
}

func TestPolicyNeverFollowsAnotherProfile(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	other := profile(t)
	s, _ := watchProfile(t, other)
	require.NoError(t, s.Replace(document(nil, "", wireGrant("private"))))
	root := profile(t)
	if err := os.Symlink(filepath.Join(other, directory), filepath.Join(root, directory)); err != nil {
		t.Skipf("host cannot create directory links: %v", err)
	}
	wrong, err := Open(root, func(Change) { t.Error("redirected profile emitted a change") })
	require.Error(t, err)
	require.Nil(t, wrong)
}

func TestPolicyStartupOverrideAndDeniedTransport(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "1")
	root := profile(t)
	s, _ := watchProfile(t, root)
	require.Error(t, s.Replace(document(nil, "", wireGrant("a"))))
	_, statErr := os.Lstat(filepath.Join(root, directory))
	require.ErrorIs(t, statErr, os.ErrNotExist, "override does not even open policy storage")
	for _, v := range []Snapshot{s.Snapshot(), NewService(nil).Read()} {
		require.False(t, v.Known)
		require.True(t, v.Disabled)
		wire, err := json.Marshal(v)
		require.NoError(t, err)
		require.Contains(t, string(wire), `"grants":[]`)
		require.Contains(t, string(wire), `"disabledBindings":[]`)
		require.Contains(t, string(wire), `"disabledOffers":[]`)
	}
}
