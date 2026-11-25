package shellenv

// Shell is one installed shell as the host lists it for a person to choose from.
type Shell struct {
	// Name is the shell's own name (Name): `zsh`, `bash`.
	Name string `json:"name"`
	// Path is where the shell is, as the host would start it.
	Path string `json:"path"`
	// Default is the shell a terminal starts when the person chooses none.
	Default bool `json:"default"`
}

// standardDirs are the directories a shell is looked for in, in this order (the list JetBrains uses).
var standardDirs = []string{"/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"}

// listedNames are the shells that are offered, in the order they are offered.
var listedNames = []string{"bash", "zsh", "fish", "pwsh"}

// List says which of the shells the host offers are installed in the standard directories, and marks the one that is the default.
func List(defaultPath string) []Shell { return listIn(standardDirs, defaultPath) }

func listIn(dirs []string, defaultPath string) []Shell { return nil }
