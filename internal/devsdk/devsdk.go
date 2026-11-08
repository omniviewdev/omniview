// Package devsdk selects and identifies the plugin SDK a workspace builds
// against, without importing native, plugin-process, profile or workspace
// orchestration packages. The controller's build graph, the host's managed
// plugin builder and the trusted artifact recorder share this vocabulary
// instead of each deriving "which SDK" from a path string.
//
// A Selection mirrors the workspace manifest's single authority
// (links.sdkRepositoryID): a selected checkout means source mode, and no
// selection means the SDK each consumer's own Go dependency graph publishes.
// An Identity is the validated evidence of the SDK a build used. A published
// identity is produced by the verifier from a consumer's effective Go module
// graph (see NewVerifier) and admitted under the release policy.
package devsdk

import (
	"errors"
	"fmt"
	"path/filepath"
	"regexp"

	"golang.org/x/mod/semver"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsource"
)

// Module is the plugin SDK's Go module path.
const Module = "github.com/omniviewdev/plugin-sdk"

// Mode says which SDK a Selection or Identity describes.
type Mode string

const (
	// ModeSource builds against the explicitly selected SDK checkout.
	ModeSource Mode = "source"
	// ModePublished builds against each consumer's published SDK dependency.
	ModePublished Mode = "published"
)

// Selection is the SDK a workspace selected. The zero Selection is published:
// no checkout is selected, exactly like a null links.sdkRepositoryID.
type Selection struct {
	directory string
}

// SourceSelection selects the SDK checkout at directory, which must be an
// absolute clean path. It does not touch the filesystem: verification binds
// the directory to the live repository.
func SourceSelection(directory string) (Selection, error) {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return Selection{}, fmt.Errorf("selected SDK directory must be an absolute clean path: %q", directory)
	}
	return Selection{directory: directory}, nil
}

// PublishedSelection selects the SDK each consumer's Go module graph publishes.
func PublishedSelection() Selection { return Selection{} }

// SelectionOf derives the selection a resolved workspace manifest defines: the
// linked SDK repository's checkout, or the published SDK when none is linked.
func SelectionOf(workspace devcontract.ResolvedWorkspace) (Selection, error) {
	link := workspace.Manifest.Links.SDKRepositoryID
	if link == nil {
		return PublishedSelection(), nil
	}
	directory, err := workspace.RepositoryPath(*link)
	if err != nil {
		return Selection{}, err
	}
	return SourceSelection(directory)
}

// Mode reports whether the selection is a source checkout or the published SDK.
func (s Selection) Mode() Mode {
	if s.directory == "" {
		return ModePublished
	}
	return ModeSource
}

// Directory returns the selected checkout. It reports false for the published
// SDK, which has no directory authority.
func (s Selection) Directory() (string, bool) {
	return s.directory, s.directory != ""
}

// MarshalText encodes a source selection as its checkout directory, the form
// the link journal has always persisted. A published selection has no textual
// form: persist it by omission (`omitzero`), never as an empty string.
func (s Selection) MarshalText() ([]byte, error) {
	if s.directory == "" {
		return nil, errors.New("a published SDK selection has no persisted form; omit it")
	}
	return []byte(s.directory), nil
}

// UnmarshalText decodes a persisted source selection.
func (s *Selection) UnmarshalText(text []byte) error {
	selection, err := SourceSelection(string(text))
	if err != nil {
		return err
	}
	*s = selection
	return nil
}

// Published identifies a released SDK module by what Go resolved: the module
// version and the go.sum content hashes of its source tree and go.mod.
type Published struct {
	Module    string `json:"module"`
	Version   string `json:"version"`
	ModuleSum string `json:"moduleSum"`
	GoModSum  string `json:"goModSum"`
}

var moduleSumPattern = regexp.MustCompile(`^h1:[A-Za-z0-9+/]{43}=$`)

func (p Published) validate() error {
	if p.Module != Module {
		return fmt.Errorf("published SDK identity must name module %s", Module)
	}
	if !semver.IsValid(p.Version) || semver.Canonical(p.Version) != p.Version {
		return fmt.Errorf("published SDK identity requires a canonical module version, got %q", p.Version)
	}
	if !moduleSumPattern.MatchString(p.ModuleSum) {
		return errors.New("published SDK identity requires the module h1 checksum")
	}
	if !moduleSumPattern.MatchString(p.GoModSum) {
		return errors.New("published SDK identity requires the go.mod h1 checksum")
	}
	return nil
}

// Identity is the validated evidence of the SDK a build used: a tagged union of
// a source checkout's identity or a published module's identity. Construct one
// with NewSourceIdentity or NewPublishedIdentity; the zero Identity is invalid.
// Identities are comparable, so before/after observations compare with ==.
type Identity struct {
	mode      Mode
	source    devsource.Identity
	published Published
}

// NewSourceIdentity validates evidence that devsource.Verify observed.
func NewSourceIdentity(source devsource.Identity) (Identity, error) {
	identity := Identity{mode: ModeSource, source: source}
	return identity, identity.Validate()
}

// NewPublishedIdentity validates a published module's resolved identity.
func NewPublishedIdentity(published Published) (Identity, error) {
	identity := Identity{mode: ModePublished, published: published}
	return identity, identity.Validate()
}

// Mode reports which variant the identity holds, or "" for the zero Identity.
func (i Identity) Mode() Mode { return i.mode }

// Source returns the source variant. It reports false for any other variant.
func (i Identity) Source() (devsource.Identity, bool) {
	return i.source, i.mode == ModeSource
}

// Published returns the published variant. It reports false for any other
// variant.
func (i Identity) Published() (Published, bool) {
	return i.published, i.mode == ModePublished
}

// Validate rejects the zero identity, incomplete evidence and mixed variants.
func (i Identity) Validate() error {
	switch i.mode {
	case ModeSource:
		if i.published != (Published{}) {
			return errors.New("source SDK identity carries published fields")
		}
		return i.source.Validate()
	case ModePublished:
		if i.source != (devsource.Identity{}) {
			return errors.New("published SDK identity carries source fields")
		}
		return i.published.validate()
	default:
		return errors.New("SDK identity has no mode")
	}
}
