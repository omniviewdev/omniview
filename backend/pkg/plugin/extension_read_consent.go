package plugin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"hash"
	"io"
	"os"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/extensionpolicy"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/extensionread"
)

// A cache belongs to one issued installation generation, never a plugin ID
// or pin alone. Its index is immutable after the first successful byte proof.
type extensionReadCache struct {
	life   context.Context
	cancel context.CancelFunc

	mu       sync.Mutex
	index    *admittedReadManifest
	file     os.FileInfo
	change   int64
	verifier *manifestVerifier
}

func newExtensionReadCache() *extensionReadCache {
	life, cancel := context.WithCancel(context.Background())
	return &extensionReadCache{
		life: life, cancel: cancel,
		mu: sync.Mutex{}, index: nil, file: nil, change: 0, verifier: nil,
	}
}

// Without a trustworthy local change stamp, recheck signed bytes rather than
// inferring integrity from mtime or a matching path. Never reparse the index.
type manifestVerifier struct {
	hash     hash.Hash
	expected [sha256.Size]byte
	sum      [sha256.Size]byte
	chunk    [4096]byte
}

func (c *extensionReadCache) verify(f *os.File, m *extensionFile) bool {
	if c.verifier == nil {
		// The sum and chunk are reusable scratch buffers; only the expected digest needs decoding.
		v := new(manifestVerifier)
		if n, err := hex.Decode(v.expected[:], []byte(m.Digest)); err != nil || n != sha256.Size {
			return false
		}
		v.hash = sha256.New()
		c.verifier = v
	}
	v := c.verifier
	v.hash.Reset()
	src := io.LimitedReader{R: f, N: int64(m.Size) + 1}
	n, err := io.CopyBuffer(v.hash, &src, v.chunk[:])
	return err == nil && n == int64(m.Size) && bytes.Equal(v.hash.Sum(v.sum[:0]), v.expected[:])
}

// Called under c.mu with the manager's bounded, non-redirected, opened member.
// Stamp this very object, not a second path lookup after validating bytes.
func (c *extensionReadCache) admit(r *extensionReceipt, f *os.File, info os.FileInfo, m *extensionFile) error {
	change := manifestChangeTime(info)
	if c.file != nil && change == c.change && os.SameFile(info, c.file) && info.ModTime().Equal(c.file.ModTime()) {
		return nil
	}
	if c.index == nil {
		data, err := readPinnedBytes(f, info, m)
		if err != nil {
			return err
		}
		c.index = admitReadManifest(r, data)
		if c.index == nil {
			return errExtensionUnavailable
		}
	} else if !c.verify(f, m) {
		return errExtensionUnavailable
	}
	// Do not certify a timestamp in the filesystem's current clock tick. A
	// write later in that tick could otherwise keep the same change time.
	// Unknown or coarse stamps always require a byte proof on subsequent use.
	c.file = nil
	if change > 0 && change < time.Now().Add(-2*time.Second).UnixNano() && manifestLocalStamp(f) {
		c.file, c.change = info, change
	}
	return nil
}

func (pm *pluginManager) readManifestFor(s *extensionInstall) *admittedReadManifest {
	c := s.reads
	if c == nil {
		return nil
	}
	c.mu.Lock()
	if c.life.Err() != nil {
		c.mu.Unlock()
		return nil
	}
	r := s.receipt
	_, err := pm.readPinnedFileWith(r, extensionManifestFile, r.Manifest, extensionManifestLimit,
		func(f *os.File, info os.FileInfo, m *extensionFile) ([]byte, error) {
			return nil, c.admit(r, f, info, m)
		})
	index := c.index
	if err != nil {
		c.cancel()
		index = nil
	}
	c.mu.Unlock()
	if err != nil {
		// Never emit an invalidation under the source cache lock, or retire a
		// replacement on a superseded reader's error.
		pm.finishExtensionRead(r.ID, s, err)
	}
	return index
}

// ResolveExtensionRead joins current native inventory to the current profile's
// two decisions. The caller proves the selected mount, actual comparison
// values, authenticated root and citations separately at dispatch and delivery.
func (pm *pluginManager) ResolveExtensionRead(store *extensionpolicy.Store, key extensionread.Binding) (extensionread.Contract, bool) {
	var denied extensionread.Contract
	ownerID, pointID, ok := readEndpoint(key.Point)
	if !ok || store == nil || len(key.Read) != 2*sha256.Size || key.Continuity == "" {
		return denied, false
	}
	peerID, offerID, ok := readEndpoint(key.Offer)
	if !ok {
		return denied, false
	}
	owner := pm.pinnedInstall(ownerID, key.OwnerPin, key.OwnerGeneration)
	peer := pm.pinnedInstall(peerID, key.ContributorPin, key.ContributorGeneration)
	if owner == nil || !owner.receipt.HasPage || peer == nil || peer.receipt.Views == nil {
		return denied, false
	}
	ownerIndex := pm.readManifestFor(owner)
	if ownerIndex == nil {
		return denied, false
	}
	point := ownerIndex.points[pointID]
	if point == nil || point.read != key.Read {
		return denied, false
	}
	peerIndex := ownerIndex
	if peer != owner {
		peerIndex = pm.readManifestFor(peer)
	}
	if peerIndex == nil {
		return denied, false
	}
	edge, ok := peerIndex.edges[readTarget{point: key.Point, localOffer: offerID}]
	if !ok || edge.contract != point.contract || !store.AllowsRead(extensionpolicy.Grant{
		Point: key.Point, Offer: key.Offer, OwnerPin: owner.receipt.Pin, ContributorPin: peer.receipt.Pin,
		Contract: point.contract, Read: point.read, Continuity: key.Continuity, Fields: edge.conditions,
	}) {
		return denied, false
	}
	// Never hold recordsMu during manifest/policy I/O or event delivery. Both
	// slots must still name these exact lifetimes after the independent checks.
	pm.recordsMu.RLock()
	defer pm.recordsMu.RUnlock()
	if !pm.extensionCurrentLocked(ownerID, owner) || !pm.extensionCurrentLocked(peerID, peer) ||
		owner.reads.life.Err() != nil || peer.reads.life.Err() != nil {
		return denied, false
	}
	return extensionread.Contract{Operation: point.operation, Row: point.row, OwnerLife: owner.reads.life, ContributorLife: peer.reads.life}, true
}
