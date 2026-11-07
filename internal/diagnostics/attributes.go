package diagnostics

func safeProtocolDimension(key, value string) bool {
	switch key {
	case "domain":
		switch value {
		case "resource", "plugin", "wails", "other":
			return true
		}
		return false
	case "rpc.system.name":
		return value == "grpc"
	case "rpc.response.status_code":
		switch value {
		case "OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED":
			return true
		}
		return false
	default:
		return true
	}
}
