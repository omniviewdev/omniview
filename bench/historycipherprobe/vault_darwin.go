//go:build darwin && cgo

package main

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>
#include <string.h>

// Private keychain only. Never changes the default keychain or search list.
static OSStatus createVault(const char *path, const void *password, UInt32 length, SecKeychainRef *out) {
    OSStatus status = SecKeychainSetUserInteractionAllowed(false);
    if (status != errSecSuccess) return status;
    return SecKeychainCreate(path, length, password, false, NULL, out);
}
static OSStatus putKey(SecKeychainRef vault, const char *account, const void *key, UInt32 length) {
    return SecKeychainAddGenericPassword(vault, (UInt32)strlen("omniview-hr02-proof"), "omniview-hr02-proof", (UInt32)strlen(account), account, length, key, NULL);
}
static OSStatus getKey(SecKeychainRef vault, const char *account, void **data, UInt32 *length) {
    return SecKeychainFindGenericPassword(vault, (UInt32)strlen("omniview-hr02-proof"), "omniview-hr02-proof", (UInt32)strlen(account), account, length, data, NULL);
}
static OSStatus deleteKey(SecKeychainRef vault, const char *account) {
    SecKeychainItemRef item = NULL;
    OSStatus status = SecKeychainFindGenericPassword(vault, (UInt32)strlen("omniview-hr02-proof"), "omniview-hr02-proof", (UInt32)strlen(account), account, NULL, NULL, &item);
    if (status != errSecSuccess) return status;
    status = SecKeychainItemDelete(item);
    CFRelease(item);
    return status;
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

type nativeVault struct{ ref C.SecKeychainRef }

func vaultStatus(status C.OSStatus) error {
	if status != C.errSecSuccess {
		return fmt.Errorf("native Keychain status %d", int(status))
	}
	return nil
}

func newVault(path string, password []byte) (*nativeVault, error) {
	name := C.CString(path)
	defer C.free(unsafe.Pointer(name))
	vault := &nativeVault{}
	err := vaultStatus(C.createVault(name, unsafe.Pointer(&password[0]), C.UInt32(len(password)), &vault.ref))
	return vault, err
}
func (v *nativeVault) put(account string, key []byte) error {
	name := C.CString(account)
	defer C.free(unsafe.Pointer(name))
	return vaultStatus(C.putKey(v.ref, name, unsafe.Pointer(&key[0]), C.UInt32(len(key))))
}
func (v *nativeVault) get(account string) ([]byte, error) {
	name := C.CString(account)
	defer C.free(unsafe.Pointer(name))
	var data unsafe.Pointer
	var length C.UInt32
	if err := vaultStatus(C.getKey(v.ref, name, &data, &length)); err != nil {
		return nil, err
	}
	defer C.SecKeychainItemFreeContent(nil, data)
	return C.GoBytes(data, C.int(length)), nil
}
func (v *nativeVault) remove(account string) error {
	name := C.CString(account)
	defer C.free(unsafe.Pointer(name))
	return vaultStatus(C.deleteKey(v.ref, name))
}
func (v *nativeVault) lock() error { return vaultStatus(C.SecKeychainLock(v.ref)) }
func (v *nativeVault) unlock(password []byte) error {
	return vaultStatus(C.SecKeychainUnlock(v.ref, C.UInt32(len(password)), unsafe.Pointer(&password[0]), C.Boolean(1)))
}
func (v *nativeVault) close() error {
	defer C.CFRelease(C.CFTypeRef(v.ref))
	return vaultStatus(C.SecKeychainDelete(v.ref))
}
