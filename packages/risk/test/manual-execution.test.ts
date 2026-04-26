import { describe, expect, it } from "vitest";
import { assertManualExecutionOnly, isAllowedSystemMode } from "../src/index.js";

describe("manual execution policy", () => {
  it("allows only declared read-only/manual modes", () => {
    expect(isAllowedSystemMode("read_only_collection")).toBe(true);
    expect(isAllowedSystemMode("manual_checklist")).toBe(true);
    expect(isAllowedSystemMode("purchase")).toBe(false);
  });

  it("rejects execution actions", () => {
    expect(() => assertManualExecutionOnly("purchase")).toThrow("must remain manual");
  });
});
