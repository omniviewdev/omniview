//go:build darwin && !server

package hostruntime

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Foundation -framework WebKit
#include <stdint.h>
#include <stdlib.h>
int omniviewNativeBundleMatches(const char *expected);
void omniviewRemoveNativeStorage(uintptr_t token);
*/
import "C"

import (
	"fmt"
	"sync"
	"sync/atomic"
	"unsafe"

	"github.com/omniviewdev/omniview/internal/instance"
)

var nativeStorageCallbacks sync.Map
var nativeStorageSequence atomic.Uint64

func validateNativeBundle(profile instance.Profile) error {
	expected := C.CString("dev.omniview.workspace." + profile.Descriptor.WorkspaceID)
	defer C.free(unsafe.Pointer(expected))
	if C.omniviewNativeBundleMatches(expected) == 0 {
		return fmt.Errorf("native workspace must run inside its immutable same-ID application bundle")
	}
	return nil
}

func removeNativeStorage(complete func(error)) func() {
	token := uintptr(nativeStorageSequence.Add(1))
	nativeStorageCallbacks.Store(token, complete)
	C.omniviewRemoveNativeStorage(C.uintptr_t(token))
	// A deadline or exited event loop must release Go callback state. A late
	// native callback is harmless rather than dereferencing a deleted cgo.Handle.
	return func() { nativeStorageCallbacks.Delete(token) }
}

//export omniviewNativeStorageComplete
func omniviewNativeStorageComplete(token C.uintptr_t) {
	completeNativeStorage(uintptr(token))
}

func completeNativeStorage(token uintptr) {
	callback, ok := nativeStorageCallbacks.LoadAndDelete(token)
	if !ok {
		return
	}
	// Never block WebKit's main-queue callback behind shutdown's sync.Once:
	// a competing deadline may already hold it while Quit dispatches to main.
	go callback.(func(error))(nil)
}
