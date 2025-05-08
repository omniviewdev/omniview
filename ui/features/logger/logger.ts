import { DiagnosticsClient } from "@omniviewdev/runtime/api";
export type LogFields = Record<string, any>;

/**
 * A small wrapper you can instantiate per‐component if you like.
 */
export class OmniviewLogger {
  constructor(private componentName?: string) { }

  /** 
   * Envelope the payload with a timestamp and optional component name 
   */
  private envelope(fields?: LogFields) {
    return {
      component: this.componentName,
      ...fields,
    };
  }

  /** 
   * Underlying shipper to your Go side.  
   * Calls the generic Log(level,msg,fields) binding.
   */
  private async ship(level: string, msg: string, fields?: LogFields) {
    try {
      await DiagnosticsClient.Log(level, msg, this.envelope(fields));
    } catch (err) {
      // If the backend call fails, at least show it in-console
      console.error("[Logger] failed to deliver log to Go:", err);
    }
  }

  debug(msg: string, fields?: LogFields) {
    console.debug(msg, fields);
    this.ship("debug", msg, fields);
  }

  info(msg: string, fields?: LogFields) {
    console.info(msg, fields);
    this.ship("info", msg, fields);
  }

  warn(msg: string, fields?: LogFields) {
    console.warn(msg, fields);
    this.ship("warn", msg, fields);
  }

  error(msg: string | Error, fields?: LogFields) {
    // support passing an Error directly
    if (msg instanceof Error) {
      const err = msg as Error;
      fields = { ...fields, stack: err.stack };
      msg = err.message;
    }
    console.error(msg, fields);
    this.ship("error", msg as string, fields);
  }

  /** 
   * Generic log level 
   */
  log(level: "debug" | "info" | "warn" | "error", msg: string, fields?: LogFields) {
    switch (level) {
      case "debug": return this.debug(msg, fields);
      case "info": return this.info(msg, fields);
      case "warn": return this.warn(msg, fields);
      case "error": return this.error(msg, fields);
    }
  }
}
