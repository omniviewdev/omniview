package plugin

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"hash"
	"io"
	"io/fs"
	"path"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/omniviewdev/omniview/internal/appstate"
)

const (
	extensionManifestFile  = "extensions.v1.json"
	extensionFeaturesFile  = "extensions.js"
	extensionViewsFile     = "views.js"
	extensionPageEntry     = "assets/entry.js"
	extensionManifestLimit = 256 << 10
	extensionModuleLimit   = 1 << 20
	extensionListLimit     = 1024
	extensionSegmentLimit  = 128
)

const (
	manifestMemberIndex = iota
	featuresMemberIndex
	viewsMemberIndex
	extensionMemberCount
)

// Receipt is private host state, never extracted plugin metadata or a load option.
// No live generation, JS, plugin-supplied path or operator grant is persisted.
type extensionReceipt struct {
	Version    int                         `json:"version"`
	ID         string                      `json:"id"`
	Directory  appstate.FilesystemIdentity `json:"directory"`
	Assets     appstate.FilesystemIdentity `json:"assets,omitzero"`
	HasPage    bool                        `json:"hasPage"`
	PageDigest string                      `json:"pageDigest,omitempty"`
	PageFiles  map[string]extensionFile    `json:"pageFiles,omitempty"`
	Refused    bool                        `json:"refused,omitempty"`
	Pin        string                      `json:"pin,omitempty"`
	Manifest   *extensionFile              `json:"manifest,omitempty"`
	Features   *extensionFile              `json:"features,omitempty"`
	Views      *extensionFile              `json:"views,omitempty"`
}

type extensionFile struct {
	Size     int      `json:"size"`
	Digest   string   `json:"digest"`
	Exports  []string `json:"exports,omitempty"`
	Modified int64    `json:"modified,omitempty"`
}

type archiveExtensionInventory struct {
	id, digest string // digest is nonempty only for a signature-verified registry download
	assets     appstate.FilesystemIdentity
	seen       [extensionMemberCount]bool
	data       [extensionMemberCount][]byte
	role       int // one-based index of the most recently captured fixed asset
	modified   [extensionMemberCount]int64
	pageSeen   bool
	hasPage    bool
	invalid    bool

	pageHash  hash.Hash
	pageName  string
	pageSize  int
	indexSize int
	pageFiles map[string]extensionFile
	folded    map[string]bool
}

// Capture only fixed archive members while the extractor consumes the very same
// compressed stream that it checks against the authenticated digest. Never scan
// the installed directory for optional assets; it is not evidence of membership.
func (a *archiveExtensionInventory) observe(h *tar.Header, src io.Reader) (io.Reader, error) {
	a.finishPageMember()
	a.role = 0
	name := strings.TrimPrefix(h.Name, "./")
	clean := path.Clean(strings.ReplaceAll(name, `\`, "/"))
	var index, limit int
	switch strings.ToLower(clean) {
	case "assets":
		if strings.TrimSuffix(name, "/") != "assets" || h.Typeflag != tar.TypeDir {
			a.invalid = true
		}
		return src, nil
	case extensionPageEntry:
		if a.pageSeen || name != extensionPageEntry || h.Typeflag != tar.TypeReg {
			a.invalid = true
		}
		a.pageSeen = true
		a.hasPage = a.hasPage || name == extensionPageEntry && h.Typeflag == tar.TypeReg
		return a.pageMember(h, src, name, clean), nil
	case "assets/" + extensionManifestFile:
		index, limit = manifestMemberIndex, extensionManifestLimit
	case "assets/" + extensionFeaturesFile:
		index, limit = featuresMemberIndex, extensionModuleLimit
	case "assets/" + extensionViewsFile:
		index, limit = viewsMemberIndex, extensionModuleLimit
	default:
		return a.pageMember(h, src, name, clean), nil
	}
	if a.seen[index] || name != clean || name != strings.ToLower(clean) || h.Typeflag != tar.TypeReg || h.Size < 1 || h.Size > int64(limit) {
		a.invalid = true
	}
	a.seen[index] = true
	if a.invalid || a.digest == "" {
		return src, nil // preserve ordinary installation; never buffer over-budget or untrusted JS
	}
	data := make([]byte, h.Size, h.Size+1) // parser uses the spare byte as its sentinel
	if _, err := io.ReadFull(src, data); err != nil {
		return nil, err
	}
	a.data[index] = data
	a.role = index + 1
	return bytes.NewReader(data), nil
}

// The ordinary adapter can import chunks and reference styles, fonts or images.
// Use the ordinary asset handler's public types, without HTML. Never serve role
// modules or metadata through this route. A name must occur in the signed index.
func pageAssetPath(name string) bool {
	if len(name) > 4096 || !strings.HasPrefix(name, "assets/") || !fs.ValidPath(name) ||
		strings.ContainsAny(name, "\\:\x00") || name == "assets/"+extensionFeaturesFile || name == "assets/"+extensionViewsFile {
		return false
	}
	switch path.Ext(name) {
	case ".js", ".mjs", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf":
		return true
	case ".map":
		return strings.HasSuffix(name, ".js.map")
	}
	return false
}

func (a *archiveExtensionInventory) pageMember(h *tar.Header, src io.Reader, name, clean string) io.Reader {
	if a.invalid || a.digest == "" || !pageAssetPath(strings.ToLower(clean)) {
		return src
	}
	folded := strings.ToLower(clean)
	// Bound the receipt index while walking the tar, before allocating a map
	// entry. A package over this limit keeps its independently valid ordinary UI.
	const maxEscapedByte = len(`\u0000`)
	const memberOverhead = 128 // byte count, digest and JSON punctuation
	a.indexSize += maxEscapedByte*len(name) + memberOverhead
	if a.indexSize > extensionReceiptLimit-extensionManifestLimit || !pageAssetPath(name) ||
		name != clean || h.Typeflag != tar.TypeReg || a.folded[folded] {
		a.invalid = true
		return src
	}
	if a.pageHash == nil {
		a.pageHash = sha256.New()
		a.pageFiles = make(map[string]extensionFile)
		a.folded = make(map[string]bool)
	}
	a.folded[folded] = true
	a.pageHash.Reset()
	a.pageName, a.pageSize = name, int(h.Size)
	return io.TeeReader(src, a.pageHash)
}

func (a *archiveExtensionInventory) finishPageMember() {
	if a.pageName != "" {
		a.pageFiles[a.pageName] = extensionFile{
			Size: a.pageSize, Digest: hex.EncodeToString(a.pageHash.Sum(nil)), Exports: nil, Modified: 0,
		}
		a.pageName = ""
	}
}

func extensionSegment(id string) bool {
	if len(id) == 0 || len(id) > extensionSegmentLimit || id == "constructor" || id == "prototype" || id == "__proto__" {
		return false
	}
	for i := range len(id) {
		c := id[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || i > 0 && (c == '.' || c == '-' || c == '_') {
			continue
		}
		return false
	}
	return true
}

func (a *archiveExtensionInventory) receipt(directory appstate.FilesystemIdentity) *extensionReceipt {
	a.finishPageMember()
	var unverifiedAssets appstate.FilesystemIdentity
	r := &extensionReceipt{
		Version: 1, ID: a.id, Directory: directory, Assets: unverifiedAssets,
		HasPage: a.hasPage, PageDigest: "", PageFiles: nil,
		Refused: false, Pin: "", Manifest: nil, Features: nil, Views: nil,
	}
	if !a.seen[manifestMemberIndex] && !a.seen[featuresMemberIndex] && !a.seen[viewsMemberIndex] {
		return r
	}
	r.Refused = true
	if a.digest == "" || a.invalid || !a.seen[manifestMemberIndex] || !extensionSegment(a.id) || a.id == "host" || a.id == "visuals" || a.id == "navigation" {
		return r
	}
	features, views, ok := declaredModuleRoles(a.id, a.data[manifestMemberIndex])
	if !ok {
		return r
	}
	var files [extensionMemberCount]*extensionFile
	for i, expected := range [extensionMemberCount][]string{manifestMemberIndex: nil, featuresMemberIndex: features, viewsMemberIndex: views} {
		if i != manifestMemberIndex {
			if a.seen[i] != (len(expected) > 0) {
				return r
			}
			if !a.seen[i] {
				continue
			}
			names, valid := extensionModuleExports(a.data[i], i == viewsMemberIndex)
			if !valid || !slices.Equal(names, expected) {
				return r
			}
		}
		sum := sha256.Sum256(a.data[i])
		files[i] = &extensionFile{Size: len(a.data[i]), Digest: hex.EncodeToString(sum[:]), Exports: expected, Modified: a.modified[i]}
	}
	r.Refused = false
	r.Assets = a.assets
	r.Pin = "sha256:" + a.digest
	r.Manifest, r.Features, r.Views = files[manifestMemberIndex], files[featuresMemberIndex], files[viewsMemberIndex]
	if a.hasPage {
		r.PageFiles = a.pageFiles
		r.PageDigest = "sha256:" + a.pageFiles[extensionPageEntry].Digest
	}
	return r
}

// Read only what the native export check needs. The host and the packager use
// the same canonical SDK decoder for all point, offer and binding semantics.
// jsontext rejects duplicate object members, invalid UTF-8 and invalid escapes,
// including in skipped values. Count declarations before materializing them.
func declaredModuleRoles(id string, data []byte) ([]string, []string, bool) {
	if len(data) > extensionManifestLimit || !utf8.Valid(data) {
		return nil, nil, false
	}
	d := jsontext.NewDecoder(bytes.NewReader(data))
	if !consumeRoleToken(d, '{') {
		return nil, nil, false
	}
	var roles declaredRoles
	var members int
	for d.PeekKind() == '"' {
		key, err := d.ReadToken()
		if err != nil || !roles.readMember(d, key.String(), id) {
			return nil, nil, false
		}
		members++
	}
	// With duplicate and unknown names rejected, five members prove the whole v1 envelope.
	const envelopeMembers = 5
	if !consumeRoleToken(d, '}') || members != envelopeMembers {
		return nil, nil, false
	}
	if _, err := d.ReadToken(); !errors.Is(err, io.EOF) {
		return nil, nil, false
	}
	slices.Sort(roles.features)
	slices.Sort(roles.views)
	return roles.features, roles.views, true
}

type declaredRoles struct {
	features, views []string
}

func consumeRoleToken(d *jsontext.Decoder, kind jsontext.Kind) bool {
	t, err := d.ReadToken()
	return err == nil && t.Kind() == kind
}

func (r *declaredRoles) readMember(d *jsontext.Decoder, key, id string) bool {
	switch key {
	case "schemaVersion":
		t, err := d.ReadToken()
		if err != nil || t.Kind() != '0' {
			return false
		}
		version, err := t.Float()
		return err == nil && version == 1
	case "id":
		t, err := d.ReadToken()
		return err == nil && t.Kind() == '"' && t.String() == id
	case "points", "offers", "bindings":
		return r.readList(d, key == "offers")
	default:
		return false
	}
}

func (r *declaredRoles) readList(d *jsontext.Decoder, offers bool) bool {
	if !consumeRoleToken(d, '[') {
		return false
	}
	var offerIDs map[string]bool
	if offers {
		offerIDs = make(map[string]bool)
	}
	for n := 0; d.PeekKind() != ']'; n++ {
		if n >= extensionListLimit || d.PeekKind() != '{' {
			return false
		}
		if !offers {
			if d.SkipValue() != nil {
				return false
			}
			continue
		}
		if !r.readOffer(d, offerIDs) {
			return false
		}
	}
	return consumeRoleToken(d, ']')
}

func (r *declaredRoles) readOffer(d *jsontext.Decoder, seen map[string]bool) bool {
	var offer struct {
		ID     string `json:"id"`
		Kind   string `json:"kind"`
		Action struct {
			Kind string `json:"kind"`
		} `json:"action"`
	}
	if json.UnmarshalDecode(d, &offer) != nil || !extensionSegment(offer.ID) || seen[offer.ID] {
		return false
	}
	seen[offer.ID] = true
	switch {
	case offer.Kind == extensionKindSection || offer.Kind == extensionKindMenu && offer.Action.Kind == extensionActionInfo:
		r.features = append(r.features, offer.ID)
	case offer.Kind == extensionKindView:
		r.views = append(r.views, offer.ID)
	case offer.Kind == extensionKindMenu && offer.Action.Kind == extensionActionOpenView:
		// Opening a declared view needs no feature export.
	default:
		return false
	}
	return true
}
