import { describe, expect, it, vi } from "vitest";
import { formatTradeSignalMessage, TelegramAlertSink } from "../src/index.js";

describe("TelegramAlertSink", () => {
  it("sends a formatted trade signal message to Telegram Bot API", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const sink = new TelegramAlertSink({
      botToken: "token",
      chatId: "123",
      fetchImpl
    });

    await sink.send(signal());

    expect(fetchImpl).toHaveBeenCalledWith("https://api.telegram.org/bottoken/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: expect.any(String)
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      chat_id: "123",
      text: expect.stringContaining("BUY signal: AK-47 | Redline (Field-Tested)"),
      disable_web_page_preview: true
    });
  });

  it("formats signal details without markdown escaping requirements", () => {
    expect(formatTradeSignalMessage(signal())).toContain("Expected profit: +23.00 USD");
  });

  it("throws on unsuccessful Telegram responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));
    const sink = new TelegramAlertSink({
      botToken: "token",
      chatId: "123",
      fetchImpl
    });

    await expect(sink.send(signal())).rejects.toThrow("Telegram sendMessage failed with status 400");
  });
});

function signal() {
  return {
    side: "buy" as const,
    marketHashName: "AK-47 | Redline (Field-Tested)",
    priceMinor: 70_00n,
    fairValueMinor: 100_00n,
    expectedProfitMinor: 23_00n,
    currency: "USD",
    expectedEdgeBps: 3_285,
    confidenceBps: 8_000,
    residualBps: -3_567,
    baselineKey: "global",
    reason: "item-specific drawdown versus Market.CSGO baseline",
    observedAt: new Date("2026-06-06T12:00:00.000Z")
  };
}
