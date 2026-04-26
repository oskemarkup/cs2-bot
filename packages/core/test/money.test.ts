import { describe, expect, it } from "vitest";
import { currencyCode, formatMoneyMinor, moneyMinor } from "../src/index.js";

describe("money helpers", () => {
  it("formats integer minor units without floating point math", () => {
    expect(formatMoneyMinor(moneyMinor(12345n), currencyCode("usd"))).toBe("123.45 USD");
  });

  it("rejects negative stored money values", () => {
    expect(() => moneyMinor(-1n)).toThrow("non-negative");
  });
});
