import { z } from "zod";

export const AlertCandidateSchema = z.object({
  itemName: z.string().min(1),
  sourceMarketplace: z.string().min(1),
  targetMarketplace: z.string().min(1),
  sourcePriceMinor: z.bigint().nonnegative(),
  targetPriceMinor: z.bigint().nonnegative(),
  expectedProfitMinor: z.bigint(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  checklistUrl: z.string().url().optional()
});

export type AlertCandidate = z.infer<typeof AlertCandidateSchema>;

export interface AlertSink {
  send(candidate: AlertCandidate): Promise<void>;
}

export const TradeSignalAlertSchema = z.object({
  side: z.enum(["buy", "sell"]),
  marketHashName: z.string().min(1),
  priceMinor: z.bigint().nonnegative(),
  fairValueMinor: z.bigint().nonnegative(),
  expectedProfitMinor: z.bigint(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expectedEdgeBps: z.number().int(),
  confidenceBps: z.number().int().min(0).max(10_000),
  residualBps: z.number().int(),
  baselineKey: z.string().min(1),
  reason: z.string().min(1),
  observedAt: z.date(),
  unlockAt: z.date().optional(),
  evidence: z.record(z.unknown()).optional()
});

export type TradeSignalAlert = z.infer<typeof TradeSignalAlertSchema>;

export interface TradeSignalAlertSink {
  send(signal: TradeSignalAlert): Promise<void>;
}

export interface TelegramAlertSinkOptions {
  readonly botToken: string;
  readonly chatId: string;
  readonly fetchImpl?: typeof fetch | undefined;
}

export class TelegramAlertSink implements TradeSignalAlertSink {
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TelegramAlertSinkOptions) {
    if (options.botToken.trim() === "") {
      throw new Error("Telegram bot token is required");
    }

    if (options.chatId.trim() === "") {
      throw new Error("Telegram chat id is required");
    }

    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(signal: TradeSignalAlert): Promise<void> {
    const parsed = TradeSignalAlertSchema.parse(signal);
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: formatTradeSignalMessage(parsed),
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with status ${response.status}: ${await response.text()}`);
    }
  }
}

export function formatTradeSignalMessage(signal: TradeSignalAlert): string {
  const title = signal.side === "buy" ? "BUY signal" : "SELL signal";
  const lines = [
    `${title}: ${signal.marketHashName}`,
    `Price: ${formatMinor(signal.priceMinor, signal.currency)}`,
    `Fair value: ${formatMinor(signal.fairValueMinor, signal.currency)}`,
    `Expected profit: ${formatSignedMinor(signal.expectedProfitMinor, signal.currency)}`,
    `Edge: ${formatBps(signal.expectedEdgeBps)}, confidence: ${formatBps(signal.confidenceBps)}`,
    `Residual vs ${signal.baselineKey}: ${formatBps(signal.residualBps)}`,
    ...formatEvidenceLines(signal),
    `Observed: ${signal.observedAt.toISOString()}`,
    `Reason: ${signal.reason}`
  ];

  if (signal.unlockAt !== undefined) {
    lines.splice(7, 0, `Unlock: ${signal.unlockAt.toISOString()}`);
  }

  return lines.join("\n");
}

function formatEvidenceLines(signal: TradeSignalAlert): string[] {
  const evidence = signal.evidence;

  if (evidence === undefined) {
    return [];
  }

  const currentListingRows = evidenceNumber(evidence, "currentListingRows");
  const eligibleListingRows = evidenceNumber(evidence, "eligibleListingRows");
  const selectedPriceRank = evidenceNumber(evidence, "selectedPriceRank");
  const nearbyListingRows = evidenceNumber(evidence, "nearbyListingRows");
  const variantKind = evidenceString(evidence, "variantKind");
  const variantFilteredRows = evidenceNumber(evidence, "variantFilteredRows");
  const marketUrl = evidenceString(evidence, "marketUrl");
  const p10PriceMinor = evidenceMinor(evidence, "p10PriceMinor");
  const medianPriceMinor = evidenceMinor(evidence, "medianPriceMinor");
  const selectedPriceVsMedianBps = evidenceNumber(evidence, "selectedPriceVsMedianBps");
  const lines: string[] = [];

  if (marketUrl !== null) {
    lines.push(`Market: ${marketUrl}`);
  }

  if (variantKind !== null && (variantKind !== "regular" || (variantFilteredRows ?? 0) > 0)) {
    lines.push(`Variant: ${variantKind}${variantFilteredRows === null ? "" : `, filtered: ${variantFilteredRows}`}`);
  }

  if (selectedPriceRank !== null && eligibleListingRows !== null) {
    lines.push(`Listing rank: #${selectedPriceRank} of ${eligibleListingRows}${nearbyListingRows === null ? "" : `, nearby: ${nearbyListingRows}`}`);
  }

  if (currentListingRows !== null && eligibleListingRows !== null && currentListingRows !== eligibleListingRows) {
    lines.push(`Listing depth: ${eligibleListingRows} eligible of ${currentListingRows} current`);
  }

  if (p10PriceMinor !== null && medianPriceMinor !== null) {
    lines.push(`Price band: p10 ${formatMinor(p10PriceMinor, signal.currency)}, median ${formatMinor(medianPriceMinor, signal.currency)}`);
  }

  if (selectedPriceVsMedianBps !== null) {
    lines.push(`Price vs median: ${formatBps(selectedPriceVsMedianBps)}`);
  }

  return lines;
}

function evidenceNumber(evidence: Record<string, unknown>, key: string): number | null {
  const value = evidence[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function evidenceString(evidence: Record<string, unknown>, key: string): string | null {
  const value = evidence[key];

  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function evidenceMinor(evidence: Record<string, unknown>, key: string): bigint | null {
  const value = evidence[key];

  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }

  return null;
}

function formatMinor(amount: bigint, currency: string): string {
  const absolute = amount < 0n ? -amount : amount;
  const major = absolute / 100n;
  const minor = absolute % 100n;
  const sign = amount < 0n ? "-" : "";

  return `${sign}${major.toString()}.${minor.toString().padStart(2, "0")} ${currency}`;
}

function formatSignedMinor(amount: bigint, currency: string): string {
  return amount >= 0n ? `+${formatMinor(amount, currency)}` : formatMinor(amount, currency);
}

function formatBps(value: number): string {
  const sign = value > 0 ? "+" : "";

  return `${sign}${(value / 100).toFixed(2)}%`;
}
