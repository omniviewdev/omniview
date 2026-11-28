// Package linkresolve answers the one question a terminal link asks the host: does the text that a program printed name a file or a
// directory here, and which one (issue #696 step 3).
//
// The text is printed by whatever runs in the terminal, so it is hostile: the resolver is bounded in time, in operations and in memory,
// never opens a file, never looks at /dev, /proc or /sys, never follows a link out of the directories it was told to resolve in, and says
// "unknown" with a typed reason when it cannot tell. It logs nothing and opens no span: a file name is the user's data.
package linkresolve

import (
	"io/fs"
	"time"
)

// Kind says what the text named.
type Kind string

const (
	// KindFile is a regular file.
	KindFile Kind = "file"
	// KindDir is a directory.
	KindDir Kind = "dir"
	// KindUnknown is no answer: Reason says why.
	KindUnknown Kind = "unknown"
)

// Reason says why the answer is unknown.
type Reason string

const (
	// ReasonNotFound: nothing the text can name exists in the directories searched.
	ReasonNotFound Reason = "not-found"
	// ReasonGone: the text was resolved a moment ago and the file is no longer there.
	ReasonGone Reason = "gone"
	// ReasonNoDirectory: no directory to resolve in (an unknown directory is never the home directory).
	ReasonNoDirectory Reason = "no-directory"
	// ReasonInvalid: the text holds a control character, is empty or is not UTF-8.
	ReasonInvalid Reason = "invalid"
	// ReasonTooLong: the text or its path is over the cap.
	ReasonTooLong Reason = "too-long"
	// ReasonURL: the text is a URL, which is never a path.
	ReasonURL Reason = "url"
	// ReasonDenied: the path is under /dev, /proc or /sys.
	ReasonDenied Reason = "denied"
	// ReasonOutside: the path, with its links followed, is outside every directory it may resolve in.
	ReasonOutside Reason = "outside"
	// ReasonSpecial: the path is a pipe, a socket or a device: never opened.
	ReasonSpecial Reason = "special"
	// ReasonLoop: the path runs through a loop of links.
	ReasonLoop Reason = "loop"
	// ReasonAmbiguous: the suffix scan found more than one file.
	ReasonAmbiguous Reason = "ambiguous"
	// ReasonTimeout: the call used its time or its operations, or too many calls are stuck on the file system.
	ReasonTimeout Reason = "timeout"
)

// Result is the answer. Path is the real path (links followed) that was checked, absolute; Line and Col are 1-based and zero when the text had none.
type Result struct {
	Kind   Kind
	Path   string
	Line   int
	Col    int
	Reason Reason
}

// Input is one question. Dir is the directory of the row (absolute, empty when the producer does not know it) and Roots are the other
// directories the host knows work happens in. A path is only ever resolved inside one of them.
type Input struct {
	Dir   string
	Roots []string
	Text  string
}

// FS is the file system the resolver looks at: a seam, so that a test can state a file system that hangs. Nothing here opens a file.
type FS interface {
	Lstat(path string) (fs.FileInfo, error)
	Readlink(path string) (string, error)
	// ReadDir reads at most n entries of a directory, in no order.
	ReadDir(path string, n int) ([]fs.DirEntry, error)
}

// Config states the bounds. Zero fields take the default of the same name.
type Config struct {
	FS FS
	// Budget is the time one Resolve may take (default 400 ms).
	Budget time.Duration
	// MaxOps is how many file system operations one Resolve may start (default 256).
	MaxOps int
	// MaxInFlight is how many file system operations may be stuck at once across all calls (default 16): a call that finds them all stuck answers timeout at once.
	MaxInFlight int
	// ScanEntries and ScanDepth bound the suffix scan (defaults 2000 and 4).
	ScanEntries int
	ScanDepth   int
	// CacheTTL and CacheSize bound the cache (defaults 10 s and 256).
	CacheTTL  time.Duration
	CacheSize int
	// Now is the clock of the cache (default time.Now).
	Now func() time.Time
}
