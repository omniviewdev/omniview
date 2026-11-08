package devsdk

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsource"
)

// These are the real go.sum checksums of plugin-sdk v0.16.0, the controller's
// current pin. They only need to be well formed here.
const (
	fixtureModuleSum = "h1:q3jMU47l+0APFGpEdbJ4d5NmAnwaloV+siwiu3G4OOU="
	fixtureGoModSum  = "h1:FFxi7m1H27zsC3VwMZ6Z9zVrwIytVTAkRjLT5cpv0G4="
)

func fixtureSource(t *testing.T) devsource.Identity {
	t.Helper()
	return devsource.Identity{
		Directory: filepath.Join(t.TempDir(), "sdk"), Revision: strings.Repeat("a", 40), SourceDigest: strings.Repeat("b", 64),
	}
}

func fixturePublished() Published {
	return Published{Module: Module, Version: "v0.16.0", ModuleSum: fixtureModuleSum, GoModSum: fixtureGoModSum}
}

func TestSourceSelectionRequiresAbsoluteCleanDirectory(t *testing.T) {
	directory := t.TempDir()
	selection, err := SourceSelection(directory)
	require.NoError(t, err)
	require.Equal(t, ModeSource, selection.Mode())
	selected, ok := selection.Directory()
	require.True(t, ok)
	require.Equal(t, directory, selected)

	for name, invalid := range map[string]string{
		"empty":           "",
		"relative":        "sdk",
		"parent segment":  directory + string(filepath.Separator) + ".." + string(filepath.Separator) + "sdk",
		"trailing slash":  directory + string(filepath.Separator),
		"redundant slash": directory + string(filepath.Separator) + string(filepath.Separator) + "sdk",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := SourceSelection(invalid)
			require.Error(t, err)
		})
	}
}

func TestPublishedSelectionHasNoDirectoryAuthority(t *testing.T) {
	for name, selection := range map[string]Selection{"constructor": PublishedSelection(), "zero value": {}} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, ModePublished, selection.Mode())
			directory, ok := selection.Directory()
			require.False(t, ok)
			require.Empty(t, directory)
		})
	}
}

func TestSelectionOfFollowsTheManifestLinkOnly(t *testing.T) {
	root := t.TempDir()
	sdk := "plugin-sdk"
	workspace := devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{
		Repositories: []devcontract.Repository{{ID: "omniview", Directory: "host"}, {ID: sdk, Directory: "sdk"}},
	}}

	// A registered, selected SDK repository does not activate source mode by itself.
	selection, err := SelectionOf(workspace)
	require.NoError(t, err)
	require.Equal(t, ModePublished, selection.Mode())

	workspace.Manifest.Links.SDKRepositoryID = &sdk
	selection, err = SelectionOf(workspace)
	require.NoError(t, err)
	require.Equal(t, ModeSource, selection.Mode())
	directory, _ := selection.Directory()
	require.Equal(t, filepath.Join(root, "sdk"), directory)

	missing := "absent"
	workspace.Manifest.Links.SDKRepositoryID = &missing
	_, err = SelectionOf(workspace)
	require.Error(t, err, "a link to an unselected repository must not select a checkout")
}

func TestSelectionPersistedFormIsTheBareDirectory(t *testing.T) {
	type persisted struct {
		SDK Selection `json:"sdk,omitzero"`
	}
	directory := t.TempDir()
	selection, err := SourceSelection(directory)
	require.NoError(t, err)

	encoded, err := json.Marshal(persisted{SDK: selection})
	require.NoError(t, err)
	expected, err := json.Marshal(map[string]string{"sdk": directory})
	require.NoError(t, err)
	require.JSONEq(t, string(expected), string(encoded), "a source selection must persist exactly as the former string field")
	var decoded persisted
	require.NoError(t, json.Unmarshal(encoded, &decoded))
	require.Equal(t, selection, decoded.SDK)

	encoded, err = json.Marshal(persisted{SDK: PublishedSelection()})
	require.NoError(t, err)
	require.JSONEq(t, `{}`, string(encoded), "a published selection persists by omission")
	decoded = persisted{}
	require.NoError(t, json.Unmarshal([]byte(`{}`), &decoded))
	require.Equal(t, ModePublished, decoded.SDK.Mode())

	for name, document := range map[string]string{"empty": `{"sdk":""}`, "relative": `{"sdk":"sdk"}`, "unclean": `{"sdk":"/a/../b"}`} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, json.Unmarshal([]byte(document), &persisted{}))
		})
	}

	_, err = json.Marshal(struct{ SDK Selection }{SDK: PublishedSelection()})
	require.Error(t, err, "a published selection must never be encoded as an empty directory")
}

func TestSourceIdentityRequiresCompleteEvidence(t *testing.T) {
	valid := fixtureSource(t)
	identity, err := NewSourceIdentity(valid)
	require.NoError(t, err)
	require.Equal(t, ModeSource, identity.Mode())
	source, ok := identity.Source()
	require.True(t, ok)
	require.Equal(t, valid, source)
	_, ok = identity.Published()
	require.False(t, ok)

	sha256Revision := valid
	sha256Revision.Revision = strings.Repeat("c", 64)
	_, err = NewSourceIdentity(sha256Revision)
	require.NoError(t, err, "SHA-256 object formats carry 64-hex commit hashes")

	for name, mutate := range map[string]func(*devsource.Identity){
		"missing directory":  func(i *devsource.Identity) { i.Directory = "" },
		"relative directory": func(i *devsource.Identity) { i.Directory = "sdk" },
		"unclean directory":  func(i *devsource.Identity) { i.Directory += string(filepath.Separator) },
		"missing revision":   func(i *devsource.Identity) { i.Revision = "" },
		"short revision":     func(i *devsource.Identity) { i.Revision = strings.Repeat("a", 39) },
		"uppercase revision": func(i *devsource.Identity) { i.Revision = strings.Repeat("A", 40) },
		"missing digest":     func(i *devsource.Identity) { i.SourceDigest = "" },
		"malformed digest":   func(i *devsource.Identity) { i.SourceDigest = "invalid" },
		"short digest":       func(i *devsource.Identity) { i.SourceDigest = strings.Repeat("b", 63) },
	} {
		t.Run(name, func(t *testing.T) {
			incomplete := valid
			mutate(&incomplete)
			_, err := NewSourceIdentity(incomplete)
			require.Error(t, err)
		})
	}
}

func TestPublishedIdentityRequiresExactModuleEvidence(t *testing.T) {
	identity, err := NewPublishedIdentity(fixturePublished())
	require.NoError(t, err)
	require.Equal(t, ModePublished, identity.Mode())
	published, ok := identity.Published()
	require.True(t, ok)
	require.Equal(t, fixturePublished(), published)
	_, ok = identity.Source()
	require.False(t, ok)

	pseudo := fixturePublished()
	pseudo.Version = "v0.14.4-0.20261103022722-1712cd3b66e1"
	_, err = NewPublishedIdentity(pseudo)
	require.NoError(t, err, "identity records what Go resolved; admission is the policy's decision")

	for name, mutate := range map[string]func(*Published){
		"wrong module":        func(p *Published) { p.Module = "github.com/example/plugin-sdk" },
		"missing version":     func(p *Published) { p.Version = "" },
		"no v prefix":         func(p *Published) { p.Version = "0.16.0" },
		"non canonical":       func(p *Published) { p.Version = "v0.16" },
		"build metadata":      func(p *Published) { p.Version = "v0.16.0+incompatible" },
		"missing module sum":  func(p *Published) { p.ModuleSum = "" },
		"wrong sum algorithm": func(p *Published) { p.ModuleSum = "h2:" + strings.TrimPrefix(fixtureModuleSum, "h1:") },
		"short module sum":    func(p *Published) { p.ModuleSum = "h1:short=" },
		"missing go.mod sum":  func(p *Published) { p.GoModSum = "" },
		"go.mod sum garbage":  func(p *Published) { p.GoModSum = "h1:" + strings.Repeat("!", 43) + "=" },
	} {
		t.Run(name, func(t *testing.T) {
			invalid := fixturePublished()
			mutate(&invalid)
			_, err := NewPublishedIdentity(invalid)
			require.Error(t, err)
		})
	}
}

func TestIdentityRejectsZeroAndMixedVariants(t *testing.T) {
	require.Error(t, Identity{}.Validate(), "the zero identity must not authorize anything")

	source, err := NewSourceIdentity(fixtureSource(t))
	require.NoError(t, err)
	published, err := NewPublishedIdentity(fixturePublished())
	require.NoError(t, err)

	mixedSource := source
	mixedSource.published = published.published
	require.ErrorContains(t, mixedSource.Validate(), "published fields")
	mixedPublished := published
	mixedPublished.source = source.source
	require.ErrorContains(t, mixedPublished.Validate(), "source fields")

	incomplete := Identity{mode: ModeSource}
	require.Error(t, incomplete.Validate())
	incomplete = Identity{mode: ModePublished}
	require.Error(t, incomplete.Validate())
	require.Error(t, Identity{mode: Mode("other"), source: source.source}.Validate())
}

func TestIdentitiesCompareByEveryEvidenceField(t *testing.T) {
	first, err := NewSourceIdentity(fixtureSource(t))
	require.NoError(t, err)
	same, err := NewSourceIdentity(first.source)
	require.NoError(t, err)
	require.True(t, first == same, "unchanged evidence must compare equal")

	changed := first.source
	changed.SourceDigest = strings.Repeat("d", 64)
	after, err := NewSourceIdentity(changed)
	require.NoError(t, err)
	require.False(t, first == after, "a changed source digest must not compare equal")

	published, err := NewPublishedIdentity(fixturePublished())
	require.NoError(t, err)
	require.False(t, first == published)
}
