package extensionpolicy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestReadPolicyRequiresCurrentIssuanceAndEveryCondition(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	root := profile(t)
	s, _ := watchProfile(t, root)
	read := strings.Repeat("d", 64)
	base := wireGrant("a", "kind", "type")
	row := strings.TrimSuffix(base, "}") + `,"read":"` + read + `"}`
	want := Grant{Point: "owner/point", Offer: "peer/a", OwnerPin: "sha256:" + strings.Repeat("a", 64),
		ContributorPin: "sha256:" + strings.Repeat("b", 64), Contract: strings.Repeat("c", 64), Read: read, Continuity: "unissued"}
	require.False(t, s.AllowsRead(want), "missing profile")
	var absent *Store
	require.False(t, absent.AllowsRead(want))

	install := func(rows string, options string) {
		t.Helper()
		require.NoError(t, s.Replace(document(nil, options, rows)))
		want.Continuity = s.Snapshot().Grants[0].Continuity
	}
	install(row, "")
	want.Fields = []string{"type", "kind"}
	require.True(t, s.AllowsRead(want))
	want.Fields = []string{"kind", "missing"}
	require.False(t, s.AllowsRead(want), "one of two comparisons is denied")
	want.Fields = []string{"kind"}
	require.True(t, s.AllowsRead(want), "uncompared scalar fields do not have to be requested or granted")
	for _, change := range []func(*Grant){
		func(g *Grant) { g.Contract = read }, func(g *Grant) { g.Read = g.Contract },
		func(g *Grant) { g.OwnerPin = g.ContributorPin }, func(g *Grant) { g.ContributorPin = g.OwnerPin },
		func(g *Grant) { g.Continuity = "" }, func(g *Grant) { g.Point = "other/point" }, func(g *Grant) { g.Offer = "peer/b" },
	} {
		bad := want
		change(&bad)
		require.False(t, s.AllowsRead(bad))
	}
	for _, disable := range []string{`,"disabled":true`, `,"disabledOffers":["peer/a"]`, `,"disabledBindings":[{"point":"owner/point","offer":"peer/a"}]`} {
		install(row, disable)
		require.False(t, s.AllowsRead(want), "even a fresh continuity cannot override a switch")
	}
	install(base, "")
	require.False(t, s.AllowsRead(want), "a scalar grant has no read authority")
	want.Read = ""
	require.False(t, s.AllowsRead(want), "two absent read digests are not an agreement")
	want.Read = read
	install(row, "")
	stale := want
	// Do not consume a watcher notification or a transport snapshot first.
	// A replacement with identical bytes has no proof of grant continuity.
	require.NoError(t, devsession.WritePrivateFile(filepath.Join(root, directory, filename), document(nil, "", row)))
	require.False(t, s.AllowsRead(stale))
	want.Continuity = s.Snapshot().Grants[0].Continuity
	require.True(t, s.AllowsRead(want))
	require.NoError(t, os.Remove(filepath.Join(root, directory, filename)))
	require.False(t, s.AllowsRead(want), "revocation precedes asynchronous invalidation")
	s.Close()
	require.False(t, s.AllowsRead(want))
}

func TestReadPolicyStartupKillSwitch(t *testing.T) {
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	root := profile(t)
	s, _ := watchProfile(t, root)
	row := strings.TrimSuffix(wireGrant("a"), "}") + `,"read":"` + strings.Repeat("d", 64) + `"}`
	require.NoError(t, s.Replace(document(nil, "", row)))
	want := s.Snapshot().Grants[0]
	require.True(t, s.AllowsRead(want))
	s.Close()
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "1")
	off, _ := watchProfile(t, root)
	t.Setenv("OMNIVIEW_DISABLE_UI_EXTENSIONS", "")
	require.False(t, off.AllowsRead(want), "override is captured at startup")
}
