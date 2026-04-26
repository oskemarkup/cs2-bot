import Bottleneck from "bottleneck";
import { describe, expect, it, vi } from "vitest";
import { fetchJsonWithRetry, MarketplaceHttpError, type ConnectorLogger } from "../src/index.js";

describe("fetchJsonWithRetry", () => {
  it("retries ECONNRESET then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("socket reset"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await fetchJsonWithRetry({
      marketplace: "market_csgo",
      endpoint: "prices",
      url: "https://market.csgo.com/api/v2/prices/USD.json",
      fetchImpl,
      retries: 1,
      baseDelayMs: 0,
      random: () => 0,
      sleep: async () => undefined
    });

    expect(result.body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries TypeError terminated then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("terminated"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await fetchJsonWithRetry({
      marketplace: "market_csgo",
      endpoint: "full-export",
      url: "https://market.csgo.com/api/full-export/USD.json",
      fetchImpl,
      retries: 1,
      baseDelayMs: 0,
      random: () => 0,
      sleep: async () => undefined
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 503 then succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(textResponse("unavailable", 503)).mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await fetchJsonWithRetry({
      marketplace: "skinport",
      endpoint: "items",
      url: "https://api.skinport.com/v1/items",
      fetchImpl,
      retries: 1,
      baseDelayMs: 0,
      random: () => 0,
      sleep: async () => undefined
    });

    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 429 using Retry-After", async () => {
    const delays: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(textResponse("rate limited", 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await fetchJsonWithRetry({
      marketplace: "skinport",
      endpoint: "items",
      url: "https://api.skinport.com/v1/items",
      fetchImpl,
      retries: 1,
      baseDelayMs: 0,
      random: () => 0,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      }
    });

    expect(delays).toEqual([2_000]);
  });

  it("does not retry HTTP 401 or 403", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn().mockResolvedValue(textResponse("denied", status));

      await expect(
        fetchJsonWithRetry({
          marketplace: "market_csgo",
          endpoint: "orders",
          url: "https://market.csgo.com/api/v2/prices/orders/USD.json",
          fetchImpl,
          retries: 3,
          sleep: async () => undefined
        })
      ).rejects.toBeInstanceOf(MarketplaceHttpError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("fails after max retries", async () => {
    const fetchImpl = vi.fn(async () => textResponse("unavailable", 503));

    await expect(
      fetchJsonWithRetry({
        marketplace: "skinport",
        endpoint: "sales-history",
        url: "https://api.skinport.com/v1/sales/history",
        fetchImpl,
        retries: 2,
        baseDelayMs: 0,
        random: () => 0,
        sleep: async () => undefined
      })
    ).rejects.toMatchObject({ endpoint: "sales-history", status: 503, attempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("logs endpoint fields without leaking key or token query params", async () => {
    const logs: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const logger: ConnectorLogger = {
      info: (payload, message) => logs.push({ payload, message }),
      warn: (payload, message) => logs.push({ payload, message })
    };

    await fetchJsonWithRetry({
      marketplace: "market_csgo",
      endpoint: "prices",
      url: "https://market.csgo.com/api/v2/prices/USD.json?key=secret-key&token=secret-token&currency=USD",
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
      logger
    });

    const serializedLogs = JSON.stringify(logs);

    expect(serializedLogs).toContain("prices");
    expect(serializedLogs).toContain("api request started");
    expect(serializedLogs).toContain("api request finished");
    expect(serializedLogs).not.toContain("secret-key");
    expect(serializedLogs).not.toContain("secret-token");
  });

  it("schedules each attempt through the limiter", async () => {
    const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 0 });
    const fetchImpl = vi.fn().mockResolvedValueOnce(textResponse("unavailable", 503)).mockResolvedValueOnce(jsonResponse({ ok: true }));

    await fetchJsonWithRetry({
      marketplace: "market_csgo",
      endpoint: "prices",
      url: "https://market.csgo.com/api/v2/prices/USD.json",
      fetchImpl,
      limiter,
      retries: 1,
      baseDelayMs: 0,
      random: () => 0,
      sleep: async () => undefined
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}
