import { OmniviewLogger } from "./logger";
const logger = new OmniviewLogger("console");

// grab originals once
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

type Level = keyof typeof originalConsole;

(["log", "info", "warn", "error", "debug"] as Level[]).forEach((level) => {
  console[level] = (...args: any[]) => {
    // always call the original so we don’t re-invoke the override
    originalConsole[level](...args);

    try {
      let msg: string = ''
      const fmtArgs: Record<string, any> = {}

      // map the args into a key each
      args.forEach((arg, idx) => {
        // first entry should always be the message
        if (idx === 0 || msg === '') {
          msg = typeof arg === "object" ? JSON.stringify(arg) : String(arg)
        } else {
          fmtArgs[`arg${idx}`] = typeof arg === "object" ? JSON.stringify(arg) : String(arg)
        }
      })

      const logLevel = level === "log" ? "info" : level;
      logger.log(logLevel, msg, fmtArgs);
    } catch {
      // swallow any errors so we never break the console
    }
  };
});
