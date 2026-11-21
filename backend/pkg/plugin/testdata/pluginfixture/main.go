// Command pluginfixture is the executable the plugin manager's tests install as
// a plugin's bin/plugin (bin/plugin.exe on Windows). The tests build it for the
// host's own OS (plugin_fixture_exe_test.go); no binary is checked in, and it
// uses only the standard library, so it builds on its own, outside the host's
// module.
//
// Its behaviour is read from fixture.json next to the executable. With no such
// file it exits at once with status 0, as the empty shell script it replaces did.
//
// The file holds, in the order they happen:
//
//	records: files to write before anything else; each has "file" and "text".
//	env:     variables to set (a string) or remove (null) for what runs next.
//	run:     a command (path, then arguments) that replaces this process on
//	         Unix and runs as its child, with this process's standard streams and
//	         exit status, on Windows. Without it:
//	sleepSeconds: stay alive that long (a plugin that never answers), then
//	exitCode:     exit with this status.
//
// A string in the file is expanded against the environment the executable was
// started with, shell style: $NAME, ${NAME}, ${NAME-default} (when unset),
// ${NAME:-default} (when empty or unset), ${NAME:+alternative} (when not empty)
// and ${NAME:+alternative:-default} (the alternative when not empty, else the
// default). That is how a test reaches a path or a value its process has, such as
// the test binary or PLUGIN_CLIENT_CERT, without writing it into the file.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const specFile = "fixture.json"

type record struct {
	File string `json:"file"`
	Text string `json:"text"`
}

type spec struct {
	Records      []record           `json:"records,omitempty"`
	Env          map[string]*string `json:"env,omitempty"`
	Run          []string           `json:"run,omitempty"`
	SleepSeconds float64            `json:"sleepSeconds,omitempty"`
	ExitCode     int                `json:"exitCode,omitempty"`
}

func main() {
	os.Exit(fixture())
}

func fixture() int {
	s, err := load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "pluginfixture:", err)
		return 70
	}
	for _, r := range s.Records {
		if err := os.WriteFile(expand(r.File), []byte(expand(r.Text)), 0o600); err != nil {
			fmt.Fprintln(os.Stderr, "pluginfixture:", err)
			return 70
		}
	}
	for name, value := range s.Env {
		if value == nil {
			err = os.Unsetenv(name)
		} else {
			err = os.Setenv(name, expand(*value))
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "pluginfixture:", err)
			return 70
		}
	}
	if len(s.Run) > 0 {
		args := make([]string, len(s.Run))
		for i, arg := range s.Run {
			args[i] = expand(arg)
		}
		return run(args)
	}
	if s.SleepSeconds > 0 {
		time.Sleep(time.Duration(s.SleepSeconds * float64(time.Second)))
	}
	return s.ExitCode
}

func load() (spec, error) {
	var s spec
	self, err := os.Executable()
	if err != nil {
		return s, err
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(self), specFile))
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return s, fmt.Errorf("%s: %w", specFile, err)
	}
	return s, nil
}

func expand(text string) string {
	return os.Expand(text, lookup)
}

func lookup(name string) string {
	if name == "$" {
		return "$"
	}
	i := strings.IndexAny(name, ":-")
	if i < 0 {
		return os.Getenv(name)
	}
	value, set := os.LookupEnv(name[:i])
	switch rest := name[i:]; {
	case strings.HasPrefix(rest, ":-"):
		if value == "" {
			return rest[2:]
		}
		return value
	case strings.HasPrefix(rest, ":+"):
		alternative, otherwise, _ := strings.Cut(rest[2:], ":-")
		if value != "" {
			return alternative
		}
		return otherwise
	case strings.HasPrefix(rest, "-"):
		if !set {
			return rest[1:]
		}
		return value
	}
	return ""
}
