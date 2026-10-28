//go:build windows

package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var advapi = windows.NewLazySystemDLL("advapi32.dll")
var credWrite = advapi.NewProc("CredWriteW")
var credRead = advapi.NewProc("CredReadW")
var credDelete = advapi.NewProc("CredDeleteW")
var credFree = advapi.NewProc("CredFree")

// CREDENTIALW uses native pointer alignment on both supported Windows architectures.
type credential struct {
	Flags, Type             uint32
	TargetName, Comment     *uint16
	LastWritten             windows.Filetime
	BlobSize                uint32
	Blob                    *byte
	Persist, AttributeCount uint32
	Attributes              uintptr
	TargetAlias, UserName   *uint16
}

func put(target string, key []byte) error {
	name, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	if len(key) != 32 {
		return errors.New("key must contain 32 bytes")
	}
	c := credential{Type: 1, TargetName: name, BlobSize: uint32(len(key)), Blob: &key[0], Persist: 2}
	ok, _, err := credWrite.Call(uintptr(unsafe.Pointer(&c)), 0)
	runtime.KeepAlive(c)
	runtime.KeepAlive(key)
	if ok == 0 {
		return err
	}
	return nil
}
func get(target string) ([]byte, error) {
	name, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return nil, err
	}
	var c *credential
	ok, _, err := credRead.Call(uintptr(unsafe.Pointer(name)), 1, 0, uintptr(unsafe.Pointer(&c)))
	runtime.KeepAlive(name)
	if ok == 0 {
		return nil, err
	}
	defer credFree.Call(uintptr(unsafe.Pointer(c)))
	return consumeCredential(c)
}

// consumeCredential clears native key material before get releases its allocation.
// CredReadW owns the blob bounds, including when its shape is not our key format.
func consumeCredential(c *credential) ([]byte, error) {
	if c != nil && c.Blob != nil {
		defer wipe(unsafe.Slice(c.Blob, int(c.BlobSize)))
	}
	if c == nil || c.Type != 1 || c.BlobSize != 32 || c.Blob == nil {
		return nil, errors.New("invalid stored key shape")
	}
	return bytes.Clone(unsafe.Slice(c.Blob, int(c.BlobSize))), nil
}
func remove(target string) error {
	name, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	ok, _, err := credDelete.Call(uintptr(unsafe.Pointer(name)), 1, 0)
	runtime.KeepAlive(name)
	if ok == 0 {
		return err
	}
	return nil
}
func wipe(b []byte) { clear(b); runtime.KeepAlive(b) }

func requireAbsent(target string) error {
	existing, err := get(target)
	wipe(existing)
	if !errors.Is(err, windows.ERROR_NOT_FOUND) {
		return errors.New("fresh credential was not missing")
	}
	return nil
}

// checkACL admits only owner/SYSTEM rights, whether explicit or inherited from
// the protected directory. SQLite-created sidecars must inherit this policy.
func checkACL(path, user string) error {
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	owner, _, err := sd.Owner()
	if err != nil {
		return err
	}
	if owner.String() != user {
		return errors.New("unexpected owner")
	}
	control, _, err := sd.Control()
	if err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("reparse artifact rejected")
	}
	wantFlags := uint8(0)
	if info.IsDir() {
		wantFlags = 3
	} else if control&windows.SE_DACL_PROTECTED == 0 {
		wantFlags = 0x10
	}
	if info.IsDir() && control&windows.SE_DACL_PROTECTED == 0 {
		return errors.New("DACL inheritance not protected")
	}
	acl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	if acl == nil || acl.AceCount != 2 {
		return errors.New("unexpected DACL count")
	}
	seen := map[string]bool{}
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var raw *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(acl, i, &raw); err != nil {
			return err
		}
		sid := (*windows.SID)(unsafe.Pointer(&raw.SidStart)).String()
		if raw.Header.AceFlags != wantFlags {
			return errors.New("unexpected artifact inheritance policy")
		}
		if err := allowedACE(raw.Header.AceType, raw.Header.AceFlags, uint32(raw.Mask), sid, user); err != nil {
			return err
		}
		if seen[sid] {
			return errors.New("duplicate trustee")
		}
		seen[sid] = true
	}
	return nil
}
func allowedACE(kind, flags uint8, mask uint32, sid, user string) error {
	if kind != windows.ACCESS_ALLOWED_ACE_TYPE || (flags != 0 && flags != 3 && flags != 0x10) || mask != 0x1f01ff || (sid != user && sid != "S-1-5-18") {
		return errors.New("unexpected ACL trustee, rights, type, or inheritance")
	}
	return nil
}

func run() (result map[string]any, err error) {
	result = map[string]any{"platform": "windows", "status": "failed", "secrets": "redacted"}
	if err = requireCipherSupport(); err != nil {
		return result, err
	}
	token := windows.GetCurrentProcessToken()
	tu, err := token.GetTokenUser()
	if err != nil {
		return result, err
	}
	user := tu.User.Sid.String()
	if user == "S-1-5-18" {
		return result, errors.New("interactive non-SYSTEM user required")
	}
	// SQLite-created sidecars use the token default owner, not the directory
	// owner. Diagnose unsupported tokens before creating a database or vault key.
	var ownerSize uint32
	if e := windows.GetTokenInformation(token, windows.TokenOwner, nil, 0, &ownerSize); !errors.Is(e, windows.ERROR_INSUFFICIENT_BUFFER) || ownerSize < uint32(unsafe.Sizeof(uintptr(0))) {
		return result, errors.New("cannot inspect token default owner")
	}
	ownerBuffer := make([]byte, ownerSize)
	if e := windows.GetTokenInformation(token, windows.TokenOwner, &ownerBuffer[0], ownerSize, &ownerSize); e != nil {
		return result, errors.New("cannot read token default owner")
	}
	defaultOwner := (*struct{ Owner *windows.SID })(unsafe.Pointer(&ownerBuffer[0]))
	supportedOwner := defaultOwner.Owner != nil && defaultOwner.Owner.String() == user
	runtime.KeepAlive(ownerBuffer)
	if !supportedOwner {
		return result, errors.New("unsupported token default owner: current-user ownership is required for SQLite sidecars")
	}
	nonce := make([]byte, 16)
	if _, err = rand.Read(nonce); err != nil {
		return result, err
	}
	target := "Omniview-HR02-Proof/" + hex.EncodeToString(nonce)
	if e := requireAbsent(target); e != nil {
		return result, e
	}
	// Register cleanup before the first write, including partial write failures.
	defer func() {
		e := remove(target)
		if e != nil && !errors.Is(e, windows.ERROR_NOT_FOUND) {
			err = errors.Join(err, errors.New("credential cleanup failed"))
		}
	}()
	a, b := make([]byte, 32), make([]byte, 32)
	defer wipe(a)
	defer wipe(b)
	if _, err = rand.Read(a); err != nil {
		return result, err
	}
	if _, err = rand.Read(b); err != nil {
		return result, err
	}
	if bytes.Equal(a, b) {
		return result, errors.New("synthetic keys unexpectedly equal")
	}
	for _, key := range [][]byte{a, b} {
		if err = put(target, key); err != nil {
			return result, err
		}
		got, e := get(target)
		if e != nil {
			return result, e
		}
		equal := bytes.Equal(got, key)
		wipe(got)
		if !equal {
			return result, errors.New("credential read mismatch")
		}
	}
	if err = remove(target); err != nil {
		return result, err
	}
	if _, e := get(target); !errors.Is(e, windows.ERROR_NOT_FOUND) {
		return result, errors.New("deleted credential not missing")
	}
	if e := remove(target); !errors.Is(e, windows.ERROR_NOT_FOUND) {
		return result, errors.New("second delete not missing")
	}
	// Missing keys never trigger an implicit replacement. Recreation is explicit and uses a fresh key.
	c := make([]byte, 32)
	defer wipe(c)
	if _, err = rand.Read(c); err != nil {
		return result, err
	}
	if bytes.Equal(c, b) || bytes.Equal(c, a) {
		return result, errors.New("recreated key reused")
	}
	if err = put(target, c); err != nil {
		return result, err
	}
	got, e := get(target)
	if e != nil {
		return result, e
	}
	equal := bytes.Equal(got, c)
	wipe(got)
	if !equal {
		return result, errors.New("recreated credential mismatch")
	}
	result["credential_lifecycle"] = "passed"
	sd, err := windows.SecurityDescriptorFromString("O:" + user + "D:P(A;OICI;FA;;;" + user + ")(A;OICI;FA;;;SY)")
	if err != nil {
		return result, err
	}
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	dir := filepath.Join(os.TempDir(), "omniview-hr02-"+hex.EncodeToString(nonce))
	name, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return result, err
	}
	if err = windows.CreateDirectory(name, &sa); err != nil {
		return result, err
	}
	defer func() {
		if e := os.RemoveAll(dir); e != nil {
			err = errors.Join(err, errors.New("owned directory cleanup failed"))
		}
	}()
	if err = checkACL(dir, user); err != nil {
		return result, err
	}
	if err = encryptedProof(dir, user, target, c, result); err != nil {
		return result, err
	}
	result["status"] = "passed"
	return result, nil
}
func main() {
	result, err := run()
	if err != nil {
		result["status"] = "failed"
		result["error"] = fmt.Sprint(err)
	}
	if e := json.NewEncoder(os.Stdout).Encode(result); e != nil {
		os.Exit(1)
	}
	if err != nil {
		os.Exit(1)
	}
}
