import { describe, expect, it } from "vitest";
import { evaluateSignals, type SignalStrategySettings } from "../src/signals.js";

const now = new Date("2026-06-06T12:00:00.000Z");
const referenceAt = new Date("2026-05-30T12:00:00.000Z");

describe("evaluateSignals", () => {
  it("does not emit buy signals for a market-wide drawdown without item residual", () => {
    const result = evaluateSignals({
      watchlist: [watch("AK-47 | Redline (Field-Tested)"), watch("M4A1-S | Cyrex (Field-Tested)"), watch("AWP | Asiimov (Field-Tested)")],
      listings: [
        listing("AK-47 | Redline (Field-Tested)", 80_00n),
        listing("M4A1-S | Cyrex (Field-Tested)", 80_00n),
        listing("AWP | Asiimov (Field-Tested)", 80_00n)
      ],
      salesStats: [
        sales("AK-47 | Redline (Field-Tested)"),
        sales("M4A1-S | Cyrex (Field-Tested)"),
        sales("AWP | Asiimov (Field-Tested)")
      ],
      history: [
        history("AK-47 | Redline (Field-Tested)", 100_00n),
        history("M4A1-S | Cyrex (Field-Tested)", 100_00n),
        history("AWP | Asiimov (Field-Tested)", 100_00n)
      ],
      positions: [],
      now,
      settings: settings()
    });

    expect(result.baselines[0]?.medianReturnBps).toBeLessThan(0);
    expect(result.signals).toEqual([]);
  });

  it("emits a buy signal for an item-specific drawdown versus baseline", () => {
    const result = evaluateSignals({
      watchlist: [watch("AK-47 | Redline (Field-Tested)"), watch("M4A1-S | Cyrex (Field-Tested)"), watch("AWP | Asiimov (Field-Tested)")],
      listings: [
        listing("AK-47 | Redline (Field-Tested)", 70_00n),
        listing("M4A1-S | Cyrex (Field-Tested)", 100_00n),
        listing("AWP | Asiimov (Field-Tested)", 100_00n)
      ],
      salesStats: [
        sales("AK-47 | Redline (Field-Tested)"),
        sales("M4A1-S | Cyrex (Field-Tested)"),
        sales("AWP | Asiimov (Field-Tested)")
      ],
      history: [
        history("AK-47 | Redline (Field-Tested)", 100_00n),
        history("M4A1-S | Cyrex (Field-Tested)", 100_00n),
        history("AWP | Asiimov (Field-Tested)", 100_00n)
      ],
      positions: [],
      now,
      settings: settings()
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      side: "buy",
      marketHashName: "AK-47 | Redline (Field-Tested)"
    });
    expect(result.signals[0]?.residualBps).toBeLessThan(-800);
  });

  it("does not emit sell before unlock and emits sell after unlock when profit target is met", () => {
    const baseInput = {
      watchlist: [watch("AK-47 | Redline (Field-Tested)"), watch("M4A1-S | Cyrex (Field-Tested)"), watch("AWP | Asiimov (Field-Tested)")],
      listings: [
        listing("AK-47 | Redline (Field-Tested)", 130_00n),
        listing("M4A1-S | Cyrex (Field-Tested)", 100_00n),
        listing("AWP | Asiimov (Field-Tested)", 100_00n)
      ],
      salesStats: [
        sales("AK-47 | Redline (Field-Tested)"),
        sales("M4A1-S | Cyrex (Field-Tested)"),
        sales("AWP | Asiimov (Field-Tested)")
      ],
      history: [
        history("AK-47 | Redline (Field-Tested)", 100_00n),
        history("M4A1-S | Cyrex (Field-Tested)", 100_00n),
        history("AWP | Asiimov (Field-Tested)", 100_00n)
      ],
      settings: settings()
    };

    const locked = evaluateSignals({
      ...baseInput,
      positions: [position({ expectedUnlockAt: new Date("2026-06-07T12:00:00.000Z") })],
      now
    });
    const unlocked = evaluateSignals({
      ...baseInput,
      positions: [position({ expectedUnlockAt: new Date("2026-06-05T12:00:00.000Z") })],
      now
    });

    expect(locked.signals.filter((signal) => signal.side === "sell")).toEqual([]);
    expect(unlocked.signals.some((signal) => signal.side === "sell" && signal.positionId === "position-1")).toBe(true);
  });
});

function settings(overrides: Partial<SignalStrategySettings> = {}): SignalStrategySettings {
  return {
    lookbackHours: 168,
    rollingWindowHours: 336,
    minHistoryPoints: 2,
    minBaselineItems: 3,
    minPriceMinor: 100n,
    minSalesCount: 1,
    buyResidualBps: 800,
    buyZScoreBps: 0,
    sellResidualBps: 600,
    takeProfitBps: 1_200,
    minExpectedProfitBps: 500,
    buyFeeBps: 0,
    sellFeeBps: 500,
    safetyMarginBps: 200,
    cooldownDays: 8,
    dedupWindowHours: 12,
    envWatchlist: [],
    ...overrides
  };
}

function watch(marketHashName: string) {
  return {
    marketHashName,
    minPriceMinor: null,
    maxPriceMinor: null,
    minSalesCount: null
  };
}

function listing(marketHashName: string, priceMinor: bigint) {
  return {
    marketHashName,
    priceMinor,
    currency: "USD",
    quantity: 10,
    observedAt: now
  };
}

function sales(marketHashName: string) {
  return {
    marketHashName,
    salesCount: 20
  };
}

function history(marketHashName: string, priceMinor: bigint) {
  return {
    marketHashName,
    priceMinor,
    observedAt: referenceAt
  };
}

function position(overrides: { readonly expectedUnlockAt: Date }) {
  return {
    id: "position-1",
    marketHashName: "AK-47 | Redline (Field-Tested)",
    buyPriceMinor: 100_00n,
    currency: "USD",
    quantity: 1,
    boughtAt: new Date("2026-05-29T12:00:00.000Z"),
    actualUnlockAt: null,
    ...overrides
  };
}
