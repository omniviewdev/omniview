// Package extensionpolicy owns per-profile operator consent. Installed plugins and
// Wails callers can neither choose the profile nor write a policy through this package's service.
package extensionpolicy

import (
	"bytes"
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"unicode/utf8"
)

const (
	maxBytes  = 1 << 20
	maxRows   = 1024
	maxFields = 64
)

var errPolicy = errors.New("extension policy: invalid policy document")

// Binding names one declared edge. Neither endpoint alone grants access.
type Binding struct {
	Point string `json:"point"`
	Offer string `json:"offer"`
}

// Grant pins both packages and the complete contract. Read independently pins
// the optional read ID and row contract. Continuity is issued only by the host.
type Grant struct {
	Point          string   `json:"point"`
	Offer          string   `json:"offer"`
	OwnerPin       string   `json:"ownerPin"`
	ContributorPin string   `json:"contributorPin"`
	Contract       string   `json:"contract"`
	Fields         []string `json:"fields"`
	Read           string   `json:"read,omitempty"`
	Continuity     string   `json:"continuity"`
}

// Snapshot is the read-only transport. A missing grant, Known=false, the
// profile switch, or either applicable disable wins over every allow.
type Snapshot struct {
	Known            bool      `json:"known"`
	Revision         string    `json:"revision"`
	Disabled         bool      `json:"disabled"`
	Grants           []Grant   `json:"grants"`
	DisabledOffers   []string  `json:"disabledOffers"`
	DisabledBindings []Binding `json:"disabledBindings"`
}

// An authenticated adjacent replacement may narrow its impact to an exact
// field delta or the independent read decision. Neither marker grants access.
type AffectedBinding struct {
	Point    string   `json:"point"`
	Offer    string   `json:"offer"`
	Fields   []string `json:"fields,omitempty"`
	ReadOnly bool     `json:"readOnly,omitempty"`
}

func (b Binding) affected() AffectedBinding {
	return AffectedBinding{Point: b.Point, Offer: b.Offer, Fields: nil, ReadOnly: false}
}

// Change is an invalidation, never an authorization. Without Affected, or when
// Previous does not match the receiver's revision, all rows must be fenced.
type Change struct {
	Previous string             `json:"previous"`
	Revision string             `json:"revision"`
	Affected *[]AffectedBinding `json:"affected,omitempty"`
}

func empty() Snapshot {
	return Snapshot{
		Known:            false,
		Revision:         "",
		Disabled:         true,
		Grants:           []Grant{},
		DisabledOffers:   []string{},
		DisabledBindings: []Binding{},
	}
}

func (s Snapshot) clone() Snapshot {
	s.Grants = slices.Clone(s.Grants)
	for i := range s.Grants {
		s.Grants[i].Fields = slices.Clone(s.Grants[i].Fields)
	}
	s.DisabledBindings = slices.Clone(s.DisabledBindings)
	s.DisabledOffers = slices.Clone(s.DisabledOffers)
	return s
}

func (g Grant) binding() Binding { return Binding{Point: g.Point, Offer: g.Offer} }

func byBinding(a, b Binding) int {
	return cmp.Or(strings.Compare(a.Point, b.Point), strings.Compare(a.Offer, b.Offer))
}

func (s *Snapshot) denies(b Binding) bool {
	_, byOffer := slices.BinarySearch(s.DisabledOffers, b.Offer)
	_, byEdge := slices.BinarySearchFunc(s.DisabledBindings, b, byBinding)
	return s.Disabled || byOffer || byEdge
}

func segment(value string) bool {
	if len(value) == 0 || len(value) > 128 || value == "constructor" || value == "prototype" {
		return false
	}
	for i := range len(value) {
		c := value[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || i != 0 && (c == '_' || c == '.' || c == '-') {
			continue
		}
		return false
	}
	return true
}

func qualified(value string) bool {
	owner, local, ok := strings.Cut(value, "/")
	return ok && owner != "host" && owner != "visuals" && owner != "navigation" && segment(owner) && segment(local)
}

func digest(value string) bool {
	if len(value) != hex.EncodedLen(sha256.Size) {
		return false
	}
	for i := range len(value) {
		if c := value[i]; c >= '0' && c <= '9' || c >= 'a' && c <= 'f' {
			continue
		}
		return false
	}
	return true
}

func pin(value string) bool {
	raw, ok := strings.CutPrefix(value, "sha256:")
	return ok && digest(raw)
}

// Parse the closed grammar directly. In particular, do not decode unbounded
// arrays into structs and check their lengths afterwards. encoding/json's
// default struct decoding also folds case and silently accepts duplicate keys.
func delimiter(d *json.Decoder, want json.Delim) error {
	t, err := d.Token()
	if err != nil || t != want {
		return errPolicy
	}
	return nil
}

func object(d *json.Decoder, keys []string, firstOptional int, value func(int) error) error {
	if err := delimiter(d, '{'); err != nil {
		return err
	}
	seen := 0
	for d.More() {
		t, err := d.Token()
		key, ok := t.(string)
		i := slices.Index(keys, key)
		if err != nil || !ok || i < 0 || seen&(1<<i) != 0 {
			return errPolicy
		}
		seen |= 1 << i
		if err = value(i); err != nil {
			return err
		}
	}
	required := (1 << firstOptional) - 1
	if seen&required != required {
		return errPolicy
	}
	return delimiter(d, '}')
}

func uniqueList[T any](d *json.Decoder, limit int, item func(*json.Decoder) (T, error), compare func(T, T) int) ([]T, error) {
	if err := delimiter(d, '['); err != nil {
		return nil, err
	}
	items := []T{}
	for d.More() {
		if len(items) == limit {
			return nil, errPolicy
		}
		v, err := item(d)
		if err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	if err := delimiter(d, ']'); err != nil {
		return items, err
	}
	return items, sortUnique(items, compare)
}

func text(d *json.Decoder, valid func(string) bool) (string, error) {
	t, err := d.Token()
	s, ok := t.(string)
	if err != nil || !ok || !valid(s) {
		return "", errPolicy
	}
	return s, nil
}

func readQualified(d *json.Decoder) (string, error) { return text(d, qualified) }
func readSegment(d *json.Decoder) (string, error)   { return text(d, segment) }

func sortUnique[T any](items []T, compare func(T, T) int) error {
	slices.SortFunc(items, compare)
	for i := 1; i < len(items); i++ {
		if compare(items[i-1], items[i]) == 0 {
			return errPolicy
		}
	}
	return nil
}

const (
	pointKey = iota
	offerKey
	ownerPinKey
	contributorPinKey
	contractKey
	fieldsKey
	readKey
)

func readBinding(d *json.Decoder) (Binding, error) {
	var b Binding
	keys := []string{pointKey: "point", offerKey: "offer"}
	err := object(d, keys, len(keys), func(i int) error {
		field := &b.Point
		if i == offerKey {
			field = &b.Offer
		}
		var err error
		*field, err = readQualified(d)
		return err
	})
	return b, err
}

func readGrant(d *json.Decoder) (Grant, error) {
	var g Grant
	keys := []string{
		pointKey:          "point",
		offerKey:          "offer",
		ownerPinKey:       "ownerPin",
		contributorPinKey: "contributorPin",
		contractKey:       "contract",
		fieldsKey:         "fields",
		readKey:           "read",
	}
	err := object(d, keys, readKey, func(i int) error {
		var err error
		switch i {
		case pointKey:
			g.Point, err = readQualified(d)
		case offerKey:
			g.Offer, err = readQualified(d)
		case ownerPinKey:
			g.OwnerPin, err = text(d, pin)
		case contributorPinKey:
			g.ContributorPin, err = text(d, pin)
		case contractKey:
			g.Contract, err = text(d, digest)
		case fieldsKey:
			g.Fields, err = uniqueList(d, maxFields, readSegment, strings.Compare)
		case readKey:
			g.Read, err = text(d, digest)
		}
		return err
	})
	return g, err
}

func decode(data []byte) (Snapshot, string, error) {
	if len(data) > maxBytes || !utf8.Valid(data) {
		return Snapshot{}, "", errPolicy
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	s := empty()
	s.Disabled = false
	var previous string
	const (
		versionKey = iota
		grantsKey
		disabledKey
		disabledOffersKey
		disabledBindingsKey
		previousKey
	)
	keys := []string{
		versionKey:          "schemaVersion",
		grantsKey:           "grants",
		disabledKey:         "disabled",
		disabledOffersKey:   "disabledOffers",
		disabledBindingsKey: "disabledBindings",
		previousKey:         "previous",
	}
	err := object(d, keys, disabledKey, func(i int) error {
		var err error
		switch i {
		case versionKey:
			t, e := d.Token()
			if e != nil || t != json.Number("1") {
				return errPolicy
			}
		case grantsKey:
			s.Grants, err = uniqueList(d, maxRows, readGrant, func(a, b Grant) int { return byBinding(a.binding(), b.binding()) })
		case disabledKey:
			t, e := d.Token()
			v, ok := t.(bool)
			if e != nil || !ok {
				return errPolicy
			}
			s.Disabled = v
		case disabledOffersKey:
			s.DisabledOffers, err = uniqueList(d, maxRows, readQualified, strings.Compare)
		case disabledBindingsKey:
			s.DisabledBindings, err = uniqueList(d, maxRows, readBinding, byBinding)
		case previousKey:
			previous, err = text(d, digest)
		}
		return err
	})
	if err != nil {
		return Snapshot{}, "", err
	}
	if _, err = d.Token(); !errors.Is(err, io.EOF) {
		return Snapshot{}, "", errPolicy
	}
	s.Known = true
	return s, previous, nil
}
