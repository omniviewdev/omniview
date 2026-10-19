package main

import (
	"flag"
	"strings"
)

// registeredFlagArguments keeps values attached to their registered options
// while moving interspersed positionals out of FlagSet's option stream. A --
// consumed as a flag value is not a terminator. Explicit false/empty values
// remain supplied, independently of the parsed value or its default.
type registeredFlagArguments struct {
	options, positionals []string
	unknownFlag          bool
	missingValue         string
}

func normalizeRegisteredFlags(flags *flag.FlagSet, args []string, supplied map[string]bool) registeredFlagArguments {
	var result registeredFlagArguments
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			result.positionals = append(result.positionals, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			result.positionals = append(result.positionals, arg)
			continue
		}
		name, _, hasValue := strings.Cut(strings.TrimLeft(arg, "-"), "=")
		option := flags.Lookup(name)
		result.options = append(result.options, arg)
		if option == nil {
			// Leave unknown flags for FlagSet diagnostics where the caller allows
			// them; control commands instead return a private usage error.
			result.unknownFlag = true
			continue
		}
		if supplied != nil {
			supplied[name] = true
		}
		boolean, ok := option.Value.(interface{ IsBoolFlag() bool })
		if !hasValue && !(ok && boolean.IsBoolFlag()) {
			if i+1 >= len(args) {
				result.missingValue = name
				break
			}
			i++
			result.options = append(result.options, args[i])
		}
	}
	return result
}
