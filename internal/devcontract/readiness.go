package devcontract

// FailedReadinessStage names a terminal producer stage, independently of the
// caller's generation, LastError, managed mode, and aggregate ready observation.
// Pending, stopped, and inapplicable capabilities are not producer failures.
func FailedReadinessStage(build, vite, rpc, controllers string) string {
	switch {
	case build == "error":
		return "build"
	case vite == "error":
		return "Vite"
	case rpc == "error":
		return "RPC"
	case controllers == "error":
		return "controllers"
	default:
		return ""
	}
}
