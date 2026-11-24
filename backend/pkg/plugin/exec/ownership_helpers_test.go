package exec

// testOwner is the window of the tests that call the controller directly: they name a session of a plugin by its
// id, as the window that made it, and ownership (ownership.go) lets that window and no other use it.
const testOwner = "test-window"
