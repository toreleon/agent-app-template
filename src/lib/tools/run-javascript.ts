import { tool } from "@openai/agents";
import { z } from "zod";

/**
 * A deliberately limited "code interpreter" style tool. It evaluates a small
 * snippet of pure JavaScript inside a sandboxed `Function` with no access to
 * Node globals (require, process, fetch, etc. are shadowed to undefined) and a
 * synchronous timeout-free single expression/body. It is intended for quick
 * arithmetic, string manipulation, and data transformation — NOT for anything
 * requiring I/O.
 *
 * Security note: this is a best-effort sandbox. It blocks the obvious escape
 * hatches but is not a true VM. Network and filesystem access are unavailable.
 */
export const runJavascriptTool = tool({
  name: "run_javascript",
  description:
    "Evaluate a small snippet of pure JavaScript and return its result. Use " +
    "for arithmetic, string/array/object manipulation, date math, and quick " +
    "data transformations. The code runs in a restricted sandbox with NO " +
    "access to the network, filesystem, timers, or Node APIs. Provide the " +
    "code as the body of a function; use a `return` statement to produce the " +
    "result (e.g. 'return 2 + 2;'). Only the returned value is reported.",
  parameters: z.object({
    code: z
      .string()
      .describe(
        "JavaScript to execute. Treated as a function body; use `return` to " +
          "produce the result. Example: 'const xs=[1,2,3]; return xs.reduce((a,b)=>a+b,0);'",
      ),
  }),
  async execute({ code }) {
    // Names we shadow to deny access to host capabilities.
    const blocked = [
      "process",
      "require",
      "module",
      "exports",
      "global",
      "globalThis",
      "fetch",
      "setTimeout",
      "setInterval",
      "setImmediate",
      "Buffer",
      "import",
      "eval",
      "Function",
      "WebAssembly",
      "XMLHttpRequest",
    ];

    try {
      // Build a sandboxed function whose parameters shadow the blocked names.
      // The leading `"use strict"` prevents implicit globals.
      const runner = new Function(
        ...blocked,
        `"use strict";\n${code}`,
      ) as (...args: unknown[]) => unknown;

      const result = runner(...blocked.map(() => undefined));

      // Reject thenables so we never silently swallow async behavior.
      if (
        result &&
        typeof (result as { then?: unknown }).then === "function"
      ) {
        return {
          ok: false,
          error:
            "Async code is not supported. Return a synchronous value instead.",
        };
      }

      let serialized: unknown = result;
      // Make sure the value is JSON-serializable; fall back to String().
      try {
        JSON.stringify(result);
      } catch {
        serialized = String(result);
      }

      return {
        ok: true,
        result: serialized === undefined ? null : serialized,
        resultType: typeof result,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
