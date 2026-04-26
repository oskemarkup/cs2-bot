import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/index.js";

describe("createLogger", () => {
  it("serializes Error under err with message and stack", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      }
    });
    const cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const error = new Error("terminated", { cause });
    const logger = createLogger({ level: "info" }, stream);

    logger.error({ err: error }, "collector run failed");
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    const entry = JSON.parse(lines[0] ?? "{}") as { err?: { message?: string; stack?: string; cause?: { code?: string } } };

    expect(entry.err).not.toEqual({});
    expect(entry.err?.message).toContain("terminated");
    expect(entry.err?.stack).toContain("terminated");
    expect(entry.err?.cause?.code).toBe("ECONNRESET");
  });
});
