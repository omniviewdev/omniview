import { useState, useEffect } from "react";
import { DiagnosticsClient } from "@omniviewdev/runtime/api";
import { Events } from '@omniviewdev/runtime/runtime';

export function useComponentLogs(
  component: string,
  logType: "ui" | "app" = "ui",
) {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;

    // 1) load full file once
    DiagnosticsClient.ReadLog(logType).then((text) => {
      if (!mounted) return;
      const initial = text
        .split("\n")
        .filter(Boolean)
        .filter((line) => {
          try {
            const obj = JSON.parse(line);
            return obj.component === component;
          } catch {
            return false;
          }
        });
      setLogs(initial);
    });

    // 2) handler for new lines
    const handler = (line: string) => {
      try {
        const obj = JSON.parse(line);
        if (obj.component === component) {
          setLogs((prev) => [...prev, line]);
        }
      } catch {
        // ignore non-JSON or malformed
      }
    };

    // subscribe & start tail
    const closer = Events.On(`internal/log/update:${logType}`, (ev) => handler(ev.data as string));
    DiagnosticsClient.StartTail(logType);

    return () => {
      mounted = false;
      // stop tail and unsubscribe
      DiagnosticsClient.StopTail(logType);
      closer()
    };
  }, [component, logType]);

  return logs;
}
