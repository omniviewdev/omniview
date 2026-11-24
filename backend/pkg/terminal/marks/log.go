package marks

// DefaultMaxRecords is how many commands a Log keeps when Config.MaxRecords is not set.
const DefaultMaxRecords = 512

// MaxCommandLine and MaxCwd are the most bytes of a command line and of a directory a Record keeps.
const (
	MaxCommandLine = 4096
	MaxCwd         = 4096
)

// Log is the bounded record of the commands of one session.
type Log struct{}

// Records returns the commands kept, oldest first.
func (l *Log) Records() []Record { return nil }

// Last returns the newest command.
func (l *Log) Last() (Record, bool) { return Record{}, false }

// Running returns the command that has started and not ended.
func (l *Log) Running() (Record, bool) { return Record{}, false }

// At returns the command that the byte at offset belongs to.
func (l *Log) At(offset uint64) (Record, bool) { _ = offset; return Record{}, false }

// Cwd returns the directory the shell is in, and how far it can be believed.
func (l *Log) Cwd() (string, Trust) { return "", TrustUnverified }
