//go:build darwin && !server

package menus

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>
#include <stdlib.h>

static void omniviewShowAboutPanel(const char *applicationVersion) {
	@autoreleasepool {
		NSString *version = [NSString stringWithUTF8String:applicationVersion];
		[NSApp orderFrontStandardAboutPanelWithOptions:@{NSAboutPanelOptionApplicationVersion: version}];
	}
}
*/
import "C"

import (
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/internal/version"
)

// addAppMenu mirrors the Wails AppMenu role but replaces its About item. The
// standard About panel shows CFBundleShortVersionString, which CI stamps with
// only the numeric SemVer core (a nightly reads "0.0.0"), so the panel gets the
// full build label instead. CFBundleVersion still follows in parentheses.
func addAppMenu(menu *application.Menu, appName string) {
	appMenu := menu.AddSubmenu(appName)
	appMenu.Add("About " + appName).OnClick(func(_ *application.Context) {
		showAboutPanel(version.Version)
	})
	appMenu.AddSeparator()
	appMenu.AddRole(application.ServicesMenu)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide)
	appMenu.AddRole(application.HideOthers)
	appMenu.AddRole(application.UnHide)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit)
}

func showAboutPanel(applicationVersion string) {
	cVersion := C.CString(applicationVersion)
	defer C.free(unsafe.Pointer(cVersion))
	application.InvokeSync(func() {
		C.omniviewShowAboutPanel(cVersion)
	})
}
