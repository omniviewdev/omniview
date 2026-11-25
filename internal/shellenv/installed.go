package shellenv

import "path/filepath"

// Shell is one installed shell as the host lists it for a person to choose from.
type Shell struct {
	// Name is the shell's own name (Name): `zsh`, `bash`.
	Name string `json:"name"`
	// Path is where the shell is, as the host would start it.
	Path string `json:"path"`
	// Default is the shell a terminal starts when the person chooses none.
	Default bool `json:"default"`
}

// shellPwsh is PowerShell's name on the systems that have it.
const shellPwsh = "pwsh"

// standardDirs are the directories a shell is looked for in, in this order (the list JetBrains uses).
func standardDirs() []string {
	return []string{"/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"}
}

// listedNames are the shells that are offered, in the order they are offered.
func listedNames() []string { return []string{"bash", "zsh", "fish", shellPwsh} }

// List says which of the shells the host offers are installed in the standard directories, and marks the one that is the default.
func List(defaultPath string) []Shell { return listIn(standardDirs(), defaultPath) }

func listIn(dirs []string, defaultPath string) []Shell {
	var shells []Shell
	seen := map[string]bool{}
	for _, name := range listedNames() {
		for _, dir := range dirs {
			path, err := Check(filepath.Join(dir, name))
			if err != nil || seen[realPath(path)] {
				continue
			}
			seen[realPath(path)] = true
			shells = append(shells, Shell{Name: Name(path), Path: path, Default: false})
		}
	}
	if defaultPath == "" {
		return shells
	}
	path, err := Check(defaultPath)
	if err != nil {
		return shells
	}
	for i := range shells {
		if realPath(shells[i].Path) == realPath(path) {
			shells[i].Default = true
			return shells
		}
	}
	return append([]Shell{{Name: Name(path), Path: path, Default: true}}, shells...)
}

// realPath is the file a path reaches, so that two paths of one shell are told as one.
func realPath(path string) string {
	if target, err := filepath.EvalSymlinks(path); err == nil {
		return target
	}
	return path
}
