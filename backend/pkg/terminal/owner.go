package terminal

import "reflect"

// ValidOwner says whether owner can be taken for a window: some value, and one that can be compared. The VALUE is
// asked, not its type: a struct with an interface field is a comparable type, and comparing two of them panics when
// that field holds a slice. Nothing, and a value that cannot be compared, is no window and holds nothing.
func ValidOwner(owner Owner) bool { return owner != nil && reflect.ValueOf(owner).Comparable() }
