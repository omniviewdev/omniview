//go:build darwin || linux

package telemetry

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// readProcessUsage reads RSS and cumulative CPU for the given PIDs with one
// bounded ps invocation. Unreadable or exited PIDs are omitted.
func readProcessUsage(pids []int) map[int]pluginUsage {
	if len(pids) == 0 {
		return nil
	}
	list := make([]string, len(pids))
	for i, pid := range pids {
		list[i] = strconv.Itoa(pid)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-o", "pid=,rss=,cputime=", "-p", strings.Join(list, ",")).Output()
	if err != nil && len(out) == 0 {
		return nil
	}
	usage := make(map[int]pluginUsage, len(pids))
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 3 {
			continue
		}
		pid, perr := strconv.Atoi(fields[0])
		rssKiB, rerr := strconv.ParseInt(fields[1], 10, 64)
		cpu, ok := parseCPUTime(fields[2])
		if perr != nil || rerr != nil || !ok || rssKiB < 0 {
			continue
		}
		usage[pid] = pluginUsage{cpuSeconds: cpu, rssBytes: rssKiB * 1024}
	}
	return usage
}
