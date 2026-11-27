package plugin

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	json "encoding/json/v2"
	"errors"
	"io"
	"os"
	"slices"
	"strings"
	"syscall"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
)

const (
	extensionReceiptLimit = 1 << 20
	extensionReceiptPerm  = 0o600
	builtinPluginOrigin   = "builtin"
)

var errExtensionUnavailable = errors.New("verified extension asset unavailable")

// Immutable after publication. Replacing this pointer under recordsMu fences
// even an in-flight read across a reload of exactly the same signed archive.
type extensionInstall struct {
	receipt    *extensionReceipt
	machine    *lifecycle.PluginStateMachine
	generation string
	refused    bool
	reads      *extensionReadCache
}

func receiptName(id string) string { return ".ui-archive-" + id + ".json" }

func extensionStartupDisabled() bool { return os.Getenv("OMNIVIEW_DISABLE_UI_EXTENSIONS") == "1" }

func (pm *pluginManager) removeExtensionReceipt(id string) error {
	pm.recordsMu.Lock()
	pm.replaceExtensionLocked(id, nil)
	pm.recordsMu.Unlock()
	if !extensionSegment(id) {
		return nil
	}
	err := pm.stateRoot.Remove(receiptName(id))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return syncUninstallDirectory(pm.stateRoot, ".")
}

// Persist outside all plugin directories. In particular an archive-supplied
// receipt, public LoadPluginOptions.ExistingState, dev link, or reconstructed
// filesystem inventory cannot create a trusted pin. Only the durably committed
// archive may publish this file; an interrupted replacement never adopts the
// prior receipt because the canonical directory identity also has to match.
func (pm *pluginManager) publishExtensionReceipt(recovery *archiveRecovery, r *extensionReceipt) error {
	if !extensionSegment(r.ID) {
		return nil // outside the extension namespace; preserve legacy installations
	}
	if !recovery.committed || r.ID != recovery.ID || r.Directory != recovery.CandidateIdentity || !pm.sameExtensionDir(r.ID, r.Directory) {
		return errExtensionUnavailable
	}
	data, err := json.Marshal(r)
	if err != nil || len(data) > extensionReceiptLimit {
		return errExtensionUnavailable
	}
	name := receiptName(r.ID)
	tmp := name + "." + rand.Text()
	file, err := pm.stateRoot.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, extensionReceiptPerm)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	if err = errors.Join(err, file.Close()); err == nil {
		err = pm.stateRoot.Rename(tmp, name)
	}
	if err != nil {
		_ = pm.stateRoot.Remove(tmp)
		return err
	}
	if err = syncUninstallDirectory(pm.stateRoot, "."); err != nil {
		return err
	}
	pm.recordsMu.Lock()
	if rec := pm.records[r.ID]; rec != nil {
		pm.setExtensionLocked(rec, r)
	}
	pm.recordsMu.Unlock()
	return nil
}

func (pm *pluginManager) sameExtensionDir(name string, expected appstate.FilesystemIdentity) bool {
	var missing appstate.FilesystemIdentity
	if expected == missing {
		return false
	}
	if st, err := pm.pluginsRoot.Stat(name); err != nil || !st.IsDir() {
		return false
	}
	actual, err := pm.pluginsRoot.DirectoryIdentity(name)
	return err == nil && actual == expected
}

func (pm *pluginManager) extensionDirectoriesCurrent(r *extensionReceipt) bool {
	return pm.sameExtensionDir(r.ID, r.Directory) && pm.sameExtensionDir(r.ID+"/assets", r.Assets)
}

func (pm *pluginManager) readExtensionReceipt(rec *plugintypes.PluginRecord) *extensionReceipt {
	if rec.DevMode || rec.DevPath != "" || rec.Origin == builtinPluginOrigin || !extensionSegment(rec.ID) {
		return nil
	}
	if st, err := pm.stateRoot.Stat(receiptName(rec.ID)); err != nil || !st.Mode().IsRegular() ||
		st.Size() < 1 || st.Size() > extensionReceiptLimit {
		return nil
	}
	file, _, err := pm.stateRoot.OpenPrivateFile(receiptName(rec.ID), os.O_RDONLY)
	if err != nil {
		return nil
	}
	defer file.Close()
	st, err := file.Stat()
	if err != nil || st.Size() < 1 || st.Size() > extensionReceiptLimit {
		return nil
	}
	data, err := readExactFile(file, st.Size())
	var r extensionReceipt
	if err != nil || json.Unmarshal(data, &r, json.RejectUnknownMembers(true)) != nil || r.ID != rec.ID || r.Version != 1 || !pm.sameExtensionDir(r.ID, r.Directory) {
		return nil
	}
	return &r
}

func (pm *pluginManager) setExtensionLocked(rec *plugintypes.PluginRecord, r *extensionReceipt) {
	if rec.DevMode || rec.DevPath != "" || rec.Origin == builtinPluginOrigin || r == nil {
		pm.replaceExtensionLocked(rec.ID, nil)
		return
	}
	s := &extensionInstall{receipt: r, machine: rec.StateMachine, generation: "", refused: r.Refused, reads: nil}
	if r.Pin != "" && !r.Refused {
		if rec.Metadata.HasUICapabilities() && validArtifactPin(r.Pin) && r.Manifest.valid(extensionManifestLimit) &&
			(!r.HasPage || validArtifactPin(r.PageDigest) && r.PageDigest[len("sha256:"):] == r.PageFiles[extensionPageEntry].Digest) {
			s.generation = rand.Text()
			if !pm.extensionsOff {
				s.reads = newExtensionReadCache()
			}
		} else {
			s.refused = true
		}
	}
	pm.replaceExtensionLocked(rec.ID, s)
}

// Fence both dispatch and blocked native reads before another installation
// can occupy this slot, including a reload of exactly the same archive.
func (pm *pluginManager) replaceExtensionLocked(id string, next *extensionInstall) {
	if old := pm.extensionInstalls[id]; old != nil && old.reads != nil {
		old.reads.cancel()
	}
	if next == nil {
		delete(pm.extensionInstalls, id)
		return
	}
	if pm.extensionInstalls == nil {
		pm.extensionInstalls = make(map[string]*extensionInstall)
	}
	pm.extensionInstalls[id] = next
}

func validArtifactPin(pin string) bool {
	if !strings.HasPrefix(pin, "sha256:") || len(pin) != len("sha256:")+sha256.Size*2 {
		return false
	}
	for _, c := range pin[len("sha256:"):] {
		if c >= '0' && c <= '9' {
			continue
		}
		if c < 'a' || c > 'f' {
			return false
		}
	}
	return true
}

func (f *extensionFile) valid(limit int) bool {
	return f != nil && (f.Size > 0 || limit == MaxPluginSize && f.Size == 0) && f.Size <= limit && len(f.Digest) == sha256.Size*2
}

func (pm *pluginManager) retireExtension(id string) {
	pm.recordsMu.Lock()
	pm.retireExtensionLocked(id)
	pm.recordsMu.Unlock()
}

func (pm *pluginManager) retireExtensionLocked(id string) {
	if active := pm.extensionInstalls[id]; active != nil && active.generation != "" {
		retired := *active
		retired.generation, retired.reads = "", nil
		pm.replaceExtensionLocked(id, &retired)
	}
}

func (pm *pluginManager) extensionCurrentLocked(id string, s *extensionInstall) bool {
	if s == nil || s.generation == "" || pm.extensionInstalls[id] != s || pm.extensionsOff {
		return false
	}
	if _, pending := pm.pendingArchiveState[id]; pending {
		return false
	}
	r := pm.records[id]
	if r == nil || !r.Enabled || r.DevMode || r.DevPath != "" || r.Incompatible != nil || r.Phase != lifecycle.PhaseRunning ||
		r.StateMachine != s.machine || s.machine == nil || s.machine.Phase() != lifecycle.PhaseRunning {
		return false
	}
	if !r.Metadata.HasBackendCapabilities() {
		return true
	}
	// Read only the process flag. Never ping or start a backend for discovery.
	return r.Backend != nil && !processBackendExited(r.Backend)
}

func (pm *pluginManager) extensionInfoLocked(r *plugintypes.PluginRecord) (plugintypes.PluginInfo, *extensionInstall) {
	info := r.ToInfo()
	if _, pending := pm.pendingArchiveState[r.ID]; pending {
		info.HasPage = new(false)
		return info, nil
	}
	s := pm.extensionInstalls[r.ID]
	if s == nil || s.machine != r.StateMachine || r.DevMode || r.DevPath != "" {
		return info, nil
	}
	info.HasPage = new(s.receipt.HasPage)
	info.ExtensionRefused = s.refused
	if !pm.extensionCurrentLocked(r.ID, s) {
		return info, nil
	}
	return info, s
}

func (pm *pluginManager) addExtensionManifest(info *plugintypes.PluginInfo, s *extensionInstall) {
	if s == nil {
		return
	}
	r := s.receipt
	data, err := pm.readPinnedFile(r, extensionManifestFile, r.Manifest, extensionManifestLimit)
	if !pm.finishExtensionRead(r.ID, s, err) {
		info.ExtensionRefused = err != nil
		return
	}
	info.Extension = &plugintypes.ExtensionSource{
		Pin: r.Pin, Generation: s.generation, Manifest: string(data), PageDigest: r.PageDigest,
		Features: exportNames(r.Features), Views: exportNames(r.Views),
	}
}

func exportNames(f *extensionFile) []string {
	if f == nil {
		return []string{}
	}
	return slices.Clone(f.Exports)
}

// finishExtensionRead checks again after I/O. A bad byte or redirected file
// withdraws both roles for this generation, never a newer installation. Emit
// outside the mutex: an inventory listener may immediately call ListPlugins.
func (pm *pluginManager) finishExtensionRead(id string, s *extensionInstall, readErr error) bool {
	pm.recordsMu.Lock()
	current := pm.extensionCurrentLocked(id, s)
	if current && readErr != nil {
		refused := *s
		refused.generation, refused.reads = "", nil
		refused.refused = true
		pm.replaceExtensionLocked(id, &refused)
	}
	pm.recordsMu.Unlock()
	if current && readErr != nil && pm.emitter != nil {
		pm.emitter.Emit(EventInventoryChanged, InventoryChangedPayload{PluginID: id})
	}
	return current && readErr == nil
}

func (pm *pluginManager) pinnedInstall(id, pin, generation string) *extensionInstall {
	pm.recordsMu.RLock()
	defer pm.recordsMu.RUnlock()
	s := pm.extensionInstalls[id]
	if !pm.extensionCurrentLocked(id, s) || s.generation != generation || s.receipt.Pin != pin {
		return nil
	}
	return s
}

func (pm *pluginManager) ReadExtensionAsset(id, pin, generation, role string) (string, error) {
	s := pm.pinnedInstall(id, pin, generation)
	if s == nil {
		return "", errExtensionUnavailable
	}
	var name string
	var f *extensionFile
	switch role {
	case "features":
		name, f = extensionFeaturesFile, s.receipt.Features
	case "views":
		name, f = extensionViewsFile, s.receipt.Views
	default:
		return "", errExtensionUnavailable
	}
	if f == nil {
		return "", errExtensionUnavailable
	}
	data, err := pm.readPinnedFile(s.receipt, name, f, extensionModuleLimit)
	if !pm.finishExtensionRead(id, s, err) {
		return "", errExtensionUnavailable
	}
	return string(data), nil
}

// ReadPinnedPageFile serves the ordinary adapter of an admitted owner. The HTTP
// handler supplies a canonical archive member, never a filesystem path. There
// is no Wails binding. Each chunk has to belong to this same signed artifact.
func (pm *pluginManager) ReadPinnedPageFile(id, pin, generation, assetPath string) ([]byte, error) {
	s := pm.pinnedInstall(id, pin, generation)
	if s == nil || !s.receipt.HasPage || !pageAssetPath(assetPath) {
		return nil, errExtensionUnavailable
	}
	f, exists := s.receipt.PageFiles[assetPath]
	if !exists {
		return nil, errExtensionUnavailable
	}
	data, err := pm.readPinnedFile(s.receipt, assetPath[len("assets/"):], &f, MaxPluginSize)
	if !pm.finishExtensionRead(id, s, err) {
		return nil, errExtensionUnavailable
	}
	return data, nil
}

func readExactFile(file *os.File, size int64) ([]byte, error) {
	data := make([]byte, size+1)
	n, err := io.ReadFull(file, data)
	atEOF := errors.Is(err, io.ErrUnexpectedEOF) || size == 0 && errors.Is(err, io.EOF)
	if int64(n) != size || !atEOF {
		return nil, errExtensionUnavailable
	}
	return data[:n], nil
}

// Descend one non-symlink directory at a time through held os.Root handles;
// do not allow even a redirect that would end at another valid plugin's file.
func openDirectDirectory(root *os.Root, name string) (*os.Root, error) {
	before, err := root.Lstat(name)
	if err != nil || !before.IsDir() {
		return nil, errExtensionUnavailable
	}
	child, err := root.OpenRoot(name)
	if err != nil {
		return nil, errExtensionUnavailable
	}
	info, err := child.Stat(".")
	if err != nil || !os.SameFile(before, info) {
		child.Close()
		return nil, errExtensionUnavailable
	}
	return child, nil
}

func (pm *pluginManager) extensionAssetRoot(r *extensionReceipt) (*os.Root, error) {
	if !pm.extensionDirectoriesCurrent(r) {
		return nil, errExtensionUnavailable
	}
	root, err := pm.pluginsRoot.OpenRoot(".")
	if err != nil {
		return nil, errExtensionUnavailable
	}
	defer root.Close()
	pkg, err := openDirectDirectory(root, r.ID)
	if err != nil {
		return nil, errExtensionUnavailable
	}
	defer pkg.Close()
	return openDirectDirectory(pkg, "assets")
}

// Stat only declared role members. Catalogue and ordinary-page requests never
// open feature/view code. A stat is a cheap invalidation, not a byte proof.
func checkRoleFiles(root *os.Root, r *extensionReceipt) error {
	for _, member := range [...]struct {
		name string
		file *extensionFile
	}{{extensionFeaturesFile, r.Features}, {extensionViewsFile, r.Views}} {
		if member.file == nil {
			continue
		}
		info, err := root.Lstat(member.name)
		if err != nil || !member.file.valid(extensionModuleLimit) || !info.Mode().IsRegular() ||
			info.Size() != int64(member.file.Size) || info.ModTime().UnixNano() != member.file.Modified {
			return errExtensionUnavailable
		}
	}
	return nil
}

func (pm *pluginManager) readPinnedFile(r *extensionReceipt, relative string, member *extensionFile, limit int) ([]byte, error) {
	return pm.readPinnedFileWith(r, relative, member, limit, readPinnedBytes)
}

type pinnedMemberReader func(*os.File, os.FileInfo, *extensionFile) ([]byte, error)

func (pm *pluginManager) readPinnedFileWith(r *extensionReceipt, relative string, member *extensionFile, limit int, load pinnedMemberReader) ([]byte, error) {
	root, err := pm.extensionAssetRoot(r)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if err = checkRoleFiles(root, r); err != nil {
		return nil, err
	}
	if relative != extensionManifestFile {
		// A stale renderer cannot request code against a replaced manifest
		// between two catalogue reads, even if its requested JS is unchanged.
		if _, err = readPinnedMember(root, extensionManifestFile, r.Manifest, extensionManifestLimit, readPinnedBytes); err != nil {
			return nil, err
		}
	}
	data, err := readPinnedMember(root, relative, member, limit, load)
	if err != nil || !pm.extensionDirectoriesCurrent(r) {
		return nil, errExtensionUnavailable
	}
	return data, nil
}

func readPinnedMember(assets *os.Root, relative string, member *extensionFile, limit int, load pinnedMemberReader) ([]byte, error) {
	if !member.valid(limit) {
		return nil, errExtensionUnavailable
	}
	root := assets
	defer func() {
		if root != assets {
			root.Close()
		}
	}()
	for {
		dir, rest, nested := strings.Cut(relative, "/")
		if !nested {
			break
		}
		child, err := openDirectDirectory(root, dir)
		if err != nil {
			return nil, err
		}
		if root != assets {
			root.Close()
		}
		root, relative = child, rest
	}
	before, err := root.Lstat(relative)
	if err != nil || !before.Mode().IsRegular() || before.Size() != int64(member.Size) {
		return nil, errExtensionUnavailable
	}
	// Do not block opening a FIFO swapped in after Lstat on Unix.
	file, err := root.OpenFile(relative, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, errExtensionUnavailable
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !os.SameFile(before, info) || info.Size() != before.Size() {
		return nil, errExtensionUnavailable
	}
	data, err := load(file, info, member)
	if err != nil {
		return nil, errExtensionUnavailable
	}
	after, err := root.Lstat(relative)
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || before.ModTime() != after.ModTime() {
		return nil, errExtensionUnavailable
	}
	return data, nil
}

func readPinnedBytes(file *os.File, info os.FileInfo, member *extensionFile) ([]byte, error) {
	data, err := readExactFile(file, info.Size())
	if err != nil {
		return nil, errExtensionUnavailable
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != member.Digest {
		return nil, errExtensionUnavailable
	}
	return data, nil
}
