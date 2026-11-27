//go:build !darwin && !linux && !windows

package extensionpolicy

import "os"

const privateReadFlags = os.O_RDONLY

func inspectPermissions(*os.File, os.FileInfo, role) (int64, error) { return 0, errUnsafe }

type policyWatcher struct{}

func newPolicyWatcher(string, string, string) (*policyWatcher, error) { return nil, errUnsafe }
func (*policyWatcher) next() error                                    { return errUnsafe }
func (*policyWatcher) interrupt()                                     {}
func (*policyWatcher) close()                                         {}

func exchangePolicy(*os.Root, string, string) (string, error) { return "", errUnsafe }
