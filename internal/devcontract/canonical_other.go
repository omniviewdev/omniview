//go:build !darwin && !linux

package devcontract

func canonicalPlainPath(string) (bool, error) { return false, nil }
