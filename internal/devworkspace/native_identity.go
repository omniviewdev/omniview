package devworkspace

import (
	"encoding/xml"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func verifyNativeBundleIdentity(bundle string, w Workspace) error {
	data, err := os.ReadFile(filepath.Join(bundle, "Contents", "Info.plist"))
	if err != nil {
		return err
	}
	var plist struct {
		Dict struct {
			Values []struct {
				XMLName xml.Name
				Value   string `xml:",chardata"`
			} `xml:",any"`
		} `xml:"dict"`
	}
	if err = xml.Unmarshal(data, &plist); err != nil {
		return devcontract.Fail(4, "native_profile_conflict", "native snapshot Info.plist is invalid")
	}
	found := 0
	for i, value := range plist.Dict.Values {
		if value.XMLName.Local != "key" || value.Value != "CFBundleIdentifier" {
			continue
		}
		found++
		if i+1 >= len(plist.Dict.Values) || plist.Dict.Values[i+1].XMLName.Local != "string" || plist.Dict.Values[i+1].Value != "dev.omniview.workspace."+w.Manifest.WorkspaceID {
			return devcontract.Fail(4, "native_profile_conflict", "native bundle does not select this workspace's immutable OS namespace")
		}
	}
	if found != 1 {
		return devcontract.Fail(4, "native_profile_conflict", "native bundle has no unique workspace identifier")
	}
	return nil
}
