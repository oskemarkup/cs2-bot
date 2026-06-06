import { TelegramAlertSink, type TradeSignalAlert, type TradeSignalAlertSink } from "@cs2-bot/alerts";
import { loadConfig, type AppConfig } from "@cs2-bot/config";
import { createLogger } from "@cs2-bot/core";
import { and, createDb, eq, gte, inArray, insertInBatches, or, schema } from "@cs2-bot/db";

const marketCsgo = "market_csgo" as const;
const globalBaselineKey = "global";
const signalPersistenceBatchSize = 250;

export interface SignalStrategySettings {
  readonly lookbackHours: number;
  readonly rollingWindowHours: number;
  readonly minHistoryPoints: number;
  readonly minBaselineItems: number;
  readonly minPriceMinor: bigint;
  readonly minSalesCount: number;
  readonly buyResidualBps: number;
  readonly buyZScoreBps: number;
  readonly sellResidualBps: number;
  readonly takeProfitBps: number;
  readonly minExpectedProfitBps: number;
  readonly buyFeeBps: number;
  readonly sellFeeBps: number;
  readonly safetyMarginBps: number;
  readonly cooldownDays: number;
  readonly dedupWindowHours: number;
  readonly envWatchlist: readonly string[];
}

export interface WatchlistEntry {
  readonly marketHashName: string;
  readonly minPriceMinor: bigint | null;
  readonly maxPriceMinor: bigint | null;
  readonly minSalesCount: number | null;
}

export interface ListingInput {
  readonly marketHashName: string;
  readonly externalId?: string | null;
  readonly priceMinor: bigint;
  readonly currency: string;
  readonly quantity: number | null;
  readonly observedAt: Date;
  readonly rawPayload?: unknown;
}

export interface ListingSelectionStats {
  readonly variantKind: ItemVariantKind;
  readonly variantFilteredRows: number;
  readonly currentListingRows: number;
  readonly eligibleListingRows: number;
  readonly selectedPriceRank: number;
  readonly nearbyListingRows: number;
  readonly minPriceMinor: bigint;
  readonly p10PriceMinor: bigint;
  readonly p25PriceMinor: bigint;
  readonly medianPriceMinor: bigint;
  readonly maxPriceMinor: bigint;
  readonly selectedPriceVsMedianBps: number;
}

export interface SalesStatsInput {
  readonly marketHashName: string;
  readonly salesCount: number | null;
  readonly rawPayload?: unknown;
}

export interface HistoryInput {
  readonly marketHashName: string;
  readonly priceMinor: bigint;
  readonly observedAt: Date;
  readonly rawPayload?: unknown;
}

export interface PositionInput {
  readonly id: string;
  readonly marketHashName: string;
  readonly buyPriceMinor: bigint;
  readonly currency: string;
  readonly quantity: number;
  readonly boughtAt: Date;
  readonly expectedUnlockAt: Date;
  readonly actualUnlockAt: Date | null;
}

export interface ItemPriceFeatureDecision {
  readonly marketHashName: string;
  readonly externalId: string | null;
  readonly currency: string;
  readonly priceMinor: bigint;
  readonly fairValueMinor: bigint;
  readonly referencePriceMinor: bigint;
  readonly rollingMedianPriceMinor: bigint;
  readonly itemReturnBps: number;
  readonly baselineReturnBps: number;
  readonly residualBps: number;
  readonly zScoreBps: number | null;
  readonly volatilityBps: number;
  readonly liquidityScoreBps: number;
  readonly salesCount: number | null;
  readonly quantity: number | null;
  readonly listingStats: ListingSelectionStats;
  readonly cohortKey: string;
  readonly baselineKey: string;
  readonly observedAt: Date;
}

export interface MarketBaselineDecision {
  readonly baselineKey: string;
  readonly currency: string;
  readonly itemsCount: number;
  readonly medianReturnBps: number;
  readonly dispersionBps: number;
  readonly observedAt: Date;
}

export interface TradeSignalDecision {
  readonly positionId?: string;
  readonly marketHashName: string;
  readonly side: "buy" | "sell";
  readonly priceMinor: bigint;
  readonly fairValueMinor: bigint;
  readonly expectedProfitMinor: bigint;
  readonly currency: string;
  readonly expectedEdgeBps: number;
  readonly confidenceBps: number;
  readonly baselineKey: string;
  readonly residualBps: number;
  readonly reason: string;
  readonly evidence: Record<string, unknown>;
  readonly observedAt: Date;
  readonly unlockAt?: Date;
}

export interface SignalEvaluationInput {
  readonly watchlist: readonly WatchlistEntry[];
  readonly listings: readonly ListingInput[];
  readonly salesStats: readonly SalesStatsInput[];
  readonly history: readonly HistoryInput[];
  readonly positions: readonly PositionInput[];
  readonly now: Date;
  readonly settings: SignalStrategySettings;
}

export interface SignalEvaluationResult {
  readonly baselines: readonly MarketBaselineDecision[];
  readonly features: readonly ItemPriceFeatureDecision[];
  readonly signals: readonly TradeSignalDecision[];
  readonly skipped: readonly string[];
}

export interface SignalRunSummary {
  readonly watchlistItems: number;
  readonly candidateSignals: number;
  readonly baselinesInserted: number;
  readonly featuresInserted: number;
  readonly signalsCreated: number;
  readonly signalsSent: number;
  readonly dryRun: boolean;
  readonly skipped: readonly string[];
}

export interface SignalCliOptions {
  readonly dryRun?: boolean | undefined;
  readonly sendAlerts?: boolean | undefined;
}

type ItemVariantKind = "regular" | "stattrak" | "souvenir";
type JsonRecord = Record<string, unknown>;

export function signalStrategySettingsFromConfig(config: AppConfig): SignalStrategySettings {
  return {
    lookbackHours: config.SIGNAL_LOOKBACK_HOURS,
    rollingWindowHours: config.SIGNAL_ROLLING_WINDOW_HOURS,
    minHistoryPoints: config.SIGNAL_MIN_HISTORY_POINTS,
    minBaselineItems: config.SIGNAL_MIN_BASELINE_ITEMS,
    minPriceMinor: config.SIGNAL_MIN_PRICE_MINOR,
    minSalesCount: config.SIGNAL_MIN_SALES_COUNT,
    buyResidualBps: config.SIGNAL_BUY_RESIDUAL_BPS,
    buyZScoreBps: config.SIGNAL_BUY_ZSCORE_BPS,
    sellResidualBps: config.SIGNAL_SELL_RESIDUAL_BPS,
    takeProfitBps: config.SIGNAL_TAKE_PROFIT_BPS,
    minExpectedProfitBps: config.SIGNAL_MIN_EXPECTED_PROFIT_BPS,
    buyFeeBps: config.SIGNAL_BUY_FEE_BPS,
    sellFeeBps: config.SIGNAL_SELL_FEE_BPS,
    safetyMarginBps: config.SIGNAL_SAFETY_MARGIN_BPS,
    cooldownDays: config.SIGNAL_COOLDOWN_DAYS,
    dedupWindowHours: config.SIGNAL_DEDUP_WINDOW_HOURS,
    envWatchlist: parseEnvWatchlist(config.SIGNAL_WATCHLIST)
  };
}

export async function runSignalCli(options: SignalCliOptions = {}): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const { db, pool } = createDb(config.DATABASE_URL);
  const alertSink = options.sendAlerts === false ? undefined : telegramSinkFromConfig(config);

  try {
    const summary = await runSignalEngine({
      db,
      config,
      alertSink,
      now: new Date(),
      dryRun: options.dryRun
    });

    logger.info(summary, "signal run finished");
  } finally {
    await pool.end();
  }
}

export async function runSignalEngine(options: {
  readonly db: ReturnType<typeof createDb>["db"];
  readonly config: AppConfig;
  readonly alertSink?: TradeSignalAlertSink | undefined;
  readonly now?: Date | undefined;
  readonly dryRun?: boolean | undefined;
}): Promise<SignalRunSummary> {
  const settings = signalStrategySettingsFromConfig(options.config);
  const now = options.now ?? new Date();
  const watchlist = await loadEnabledWatchlist(options.db, settings);
  const skipped: string[] = [];

  if (watchlist.length === 0) {
    return {
      watchlistItems: 0,
      candidateSignals: 0,
      baselinesInserted: 0,
      featuresInserted: 0,
      signalsCreated: 0,
      signalsSent: 0,
      dryRun: options.dryRun === true,
      skipped: ["watchlist is empty"]
    };
  }

  const names = watchlist.map((entry) => entry.marketHashName);
  const [listings, salesStats, history, positions] = await Promise.all([
    loadCurrentListings(options.db, names),
    loadCurrentSalesStats(options.db, names),
    loadListingHistory(options.db, names, hoursBefore(now, settings.rollingWindowHours)),
    loadOpenPositions(options.db)
  ]);

  const evaluation = evaluateSignals({
    watchlist,
    listings,
    salesStats,
    history,
    positions,
    now,
    settings
  });

  skipped.push(...evaluation.skipped);

  if (options.dryRun === true) {
    return {
      watchlistItems: watchlist.length,
      candidateSignals: evaluation.signals.length,
      baselinesInserted: 0,
      featuresInserted: 0,
      signalsCreated: 0,
      signalsSent: 0,
      dryRun: true,
      skipped
    };
  }

  await persistBaselines(options.db, evaluation.baselines);
  await persistFeatures(options.db, evaluation.features);

  let signalsCreated = 0;
  let signalsSent = 0;

  for (const signal of evaluation.signals) {
    if (await hasRecentSignal(options.db, signal, hoursBefore(now, settings.dedupWindowHours))) {
      skipped.push(`deduped ${signal.side} ${signal.marketHashName}`);
      continue;
    }

    const signalId = await persistTradeSignal(options.db, signal);
    signalsCreated += 1;

    if (options.alertSink !== undefined) {
      await options.alertSink.send(tradeSignalAlert(signal));
      await markSignalSent(options.db, signalId, now);
      signalsSent += 1;
    }
  }

  return {
    watchlistItems: watchlist.length,
    candidateSignals: evaluation.signals.length,
    baselinesInserted: evaluation.baselines.length,
    featuresInserted: evaluation.features.length,
    signalsCreated,
    signalsSent,
    dryRun: false,
    skipped
  };
}

export function evaluateSignals(input: SignalEvaluationInput): SignalEvaluationResult {
  const salesByName = groupBy(input.salesStats, (entry) => entry.marketHashName);
  const historyByName = groupBy(input.history, (entry) => entry.marketHashName);
  const listingsByName = groupBy(input.listings, (entry) => entry.marketHashName);
  const baseFeatures: BaseFeature[] = [];
  const skipped: string[] = [];
  const lookbackCutoff = hoursBefore(input.now, input.settings.lookbackHours);

  for (const watchlistEntry of input.watchlist) {
    const watchlistVariantKind = variantKindForName(watchlistEntry.marketHashName);
    const listings = listingsByName.get(watchlistEntry.marketHashName) ?? [];

    if (listings.length === 0) {
      skipped.push(`no current listings for ${watchlistEntry.marketHashName}`);
      continue;
    }

    const variantListings = listings.filter((listing) => variantKindForListing(listing) === watchlistVariantKind);

    const minPriceMinor = watchlistEntry.minPriceMinor ?? input.settings.minPriceMinor;
    const minSalesCount = watchlistEntry.minSalesCount ?? input.settings.minSalesCount;
    const salesCount =
      salesByName.get(watchlistEntry.marketHashName)?.find((entry) => variantKindForSalesStats(entry) === watchlistVariantKind)?.salesCount ?? null;
    const eligibleListings = variantListings.filter(
      (listing) => listing.priceMinor >= minPriceMinor && (watchlistEntry.maxPriceMinor === null || listing.priceMinor <= watchlistEntry.maxPriceMinor)
    );

    if (variantListings.length === 0) {
      skipped.push(`no ${watchlistVariantKind} listings for ${watchlistEntry.marketHashName}`);
      continue;
    }

    if ((salesCount ?? 0) < minSalesCount) {
      skipped.push(`sales below min for ${watchlistEntry.marketHashName}`);
      continue;
    }

    if (eligibleListings.length === 0) {
      skipped.push(`no eligible listing price for ${watchlistEntry.marketHashName}`);
      continue;
    }

    const selectedListing = selectBestBuyListing(eligibleListings);
    const listingStats = listingSelectionStats({
      currentListings: listings,
      eligibleListings,
      selectedPriceMinor: selectedListing.priceMinor,
      variantKind: watchlistVariantKind,
      variantFilteredRows: listings.length - variantListings.length
    });
    const itemHistory = [...(historyByName.get(watchlistEntry.marketHashName) ?? [])]
      .filter((entry) => variantKindForHistory(entry) === watchlistVariantKind)
      .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
    const priceSamples = [...itemHistory.map((entry) => entry.priceMinor), selectedListing.priceMinor];

    if (priceSamples.length < input.settings.minHistoryPoints) {
      skipped.push(`not enough history for ${watchlistEntry.marketHashName}`);
      continue;
    }

    const referencePrice = referencePriceFor(itemHistory, lookbackCutoff);

    if (referencePrice === null || referencePrice <= 0n || selectedListing.priceMinor <= 0n) {
      skipped.push(`missing reference price for ${watchlistEntry.marketHashName}`);
      continue;
    }

    const itemReturnBps = logReturnBps(referencePrice, selectedListing.priceMinor);

    baseFeatures.push({
      listing: selectedListing,
      salesCount,
      referencePriceMinor: referencePrice,
      rollingMedianPriceMinor: medianBigInt(priceSamples),
      itemReturnBps,
      volatilityBps: volatilityBps([...itemHistory, selectedListing]),
      liquidityScoreBps: liquidityScoreBps(salesCount, listingStats.eligibleListingRows),
      listingStats,
      baselineWeight: baselineWeight(salesCount, listingStats.eligibleListingRows),
      cohortKey: cohortKeyFor(selectedListing.marketHashName, selectedListing.priceMinor)
    });
  }

  if (baseFeatures.length < input.settings.minBaselineItems) {
    return {
      baselines: [],
      features: [],
      signals: [],
      skipped: [...skipped, "not enough baseline items"]
    };
  }

  const globalBaseline = baselineFor(globalBaselineKey, baseFeatures, input.now);
  const cohortBaselines = Array.from(groupBy(baseFeatures, (feature) => feature.cohortKey).entries())
    .filter(([, features]) => features.length >= input.settings.minBaselineItems)
    .map(([cohortKey, features]) => baselineFor(`cohort:${cohortKey}`, features, input.now));
  const baselinesByKey = new Map([globalBaseline, ...cohortBaselines].map((baseline) => [baseline.baselineKey, baseline]));
  const features = baseFeatures.map((feature) => {
    const cohortBaselineKey = `cohort:${feature.cohortKey}`;
    const baseline = baselinesByKey.get(cohortBaselineKey) ?? globalBaseline;
    const residualBps = feature.itemReturnBps - baseline.medianReturnBps;
    const zScoreBps =
      baseline.dispersionBps > 0 ? Math.round((residualBps * 10_000) / baseline.dispersionBps) : null;
    const fairValueMinor = fairValueFromResidual(feature.listing.priceMinor, residualBps);

    return {
      marketHashName: feature.listing.marketHashName,
      externalId: feature.listing.externalId ?? null,
      currency: feature.listing.currency,
      priceMinor: feature.listing.priceMinor,
      fairValueMinor,
      referencePriceMinor: feature.referencePriceMinor,
      rollingMedianPriceMinor: feature.rollingMedianPriceMinor,
      itemReturnBps: feature.itemReturnBps,
      baselineReturnBps: baseline.medianReturnBps,
      residualBps,
      zScoreBps,
      volatilityBps: feature.volatilityBps,
      liquidityScoreBps: feature.liquidityScoreBps,
      salesCount: feature.salesCount,
      quantity: feature.listing.quantity,
      listingStats: feature.listingStats,
      cohortKey: feature.cohortKey,
      baselineKey: baseline.baselineKey,
      observedAt: input.now
    } satisfies ItemPriceFeatureDecision;
  });
  const featureByName = new Map(features.map((feature) => [feature.marketHashName, feature]));
  const signals: TradeSignalDecision[] = [];

  for (const feature of features) {
    const expectedProfitMinor = expectedBuyProfitMinor(feature.priceMinor, feature.fairValueMinor, input.settings);
    const expectedEdgeBps = profitBps(expectedProfitMinor, applyBuyFee(feature.priceMinor, input.settings.buyFeeBps));
    const zScoreOk = feature.zScoreBps === null || feature.zScoreBps <= -input.settings.buyZScoreBps;

    if (
      feature.residualBps <= -input.settings.buyResidualBps &&
      zScoreOk &&
      expectedEdgeBps >= input.settings.minExpectedProfitBps
    ) {
      signals.push({
        marketHashName: feature.marketHashName,
        side: "buy",
        priceMinor: feature.priceMinor,
        fairValueMinor: feature.fairValueMinor,
        expectedProfitMinor,
        currency: feature.currency,
        expectedEdgeBps,
        confidenceBps: buyConfidenceBps(feature, input.settings),
        baselineKey: feature.baselineKey,
        residualBps: feature.residualBps,
        reason: "item-specific drawdown versus Market.CSGO baseline",
        evidence: signalEvidence(feature, expectedEdgeBps),
        observedAt: input.now
      });
    }
  }

  for (const position of input.positions) {
    const feature = featureByName.get(position.marketHashName);

    if (feature === undefined) {
      skipped.push(`open position has no feature for ${position.marketHashName}`);
      continue;
    }

    const unlockAt = position.actualUnlockAt ?? position.expectedUnlockAt;

    if (unlockAt.getTime() > input.now.getTime()) {
      skipped.push(`position locked until ${unlockAt.toISOString()} for ${position.marketHashName}`);
      continue;
    }

    const quantity = BigInt(position.quantity);
    const saleProceedsMinor = applySellFee(feature.priceMinor * quantity, input.settings.sellFeeBps);
    const buyCostMinor = applyBuyFee(position.buyPriceMinor * quantity, input.settings.buyFeeBps);
    const expectedProfitMinor = saleProceedsMinor - buyCostMinor;
    const expectedEdgeBps = profitBps(expectedProfitMinor, buyCostMinor);
    const residualOk = feature.residualBps >= input.settings.sellResidualBps || feature.priceMinor >= feature.fairValueMinor;
    const profitOk =
      expectedEdgeBps >= input.settings.takeProfitBps && expectedEdgeBps >= input.settings.minExpectedProfitBps;

    if (residualOk && profitOk) {
      signals.push({
        positionId: position.id,
        marketHashName: feature.marketHashName,
        side: "sell",
        priceMinor: feature.priceMinor,
        fairValueMinor: feature.fairValueMinor,
        expectedProfitMinor,
        currency: feature.currency,
        expectedEdgeBps,
        confidenceBps: sellConfidenceBps(feature, expectedEdgeBps, input.settings),
        baselineKey: feature.baselineKey,
        residualBps: feature.residualBps,
        reason: "manual position is unlocked and profitable versus baseline",
        evidence: {
          ...signalEvidence(feature, expectedEdgeBps),
          buyPriceMinor: position.buyPriceMinor.toString(),
          boughtAt: position.boughtAt.toISOString(),
          unlockAt: unlockAt.toISOString(),
          quantity: position.quantity
        },
        observedAt: input.now,
        unlockAt
      });
    }
  }

  return {
    baselines: [globalBaseline, ...cohortBaselines],
    features,
    signals,
    skipped
  };
}

export async function addWatchlistItemCli(name: string, options: Record<string, string | undefined>): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const { db, pool } = createDb(config.DATABASE_URL);
  const now = new Date();

  try {
    await db
      .insert(schema.signalWatchlist)
      .values({
        marketplace: marketCsgo,
        marketHashName: name,
        enabled: true,
        minPriceMinor: parseOptionalBigInt(options["min-price-minor"]),
        maxPriceMinor: parseOptionalBigInt(options["max-price-minor"]),
        minSalesCount: parseOptionalInteger(options["min-sales"]),
        notes: options["notes"],
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [schema.signalWatchlist.marketplace, schema.signalWatchlist.marketHashName],
        set: {
          enabled: true,
          minPriceMinor: parseOptionalBigInt(options["min-price-minor"]),
          maxPriceMinor: parseOptionalBigInt(options["max-price-minor"]),
          minSalesCount: parseOptionalInteger(options["min-sales"]),
          notes: options["notes"],
          updatedAt: now
        }
      });

    logger.info({ marketHashName: name }, "watchlist item upserted");
  } finally {
    await pool.end();
  }
}

export async function addManualPositionCli(name: string, options: Record<string, string | undefined>): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const { db, pool } = createDb(config.DATABASE_URL);
  const settings = signalStrategySettingsFromConfig(config);
  const buyPriceMinor = parseRequiredBigInt(options["buy-price-minor"], "--buy-price-minor");
  const boughtAt = parseRequiredDate(options["bought-at"], "--bought-at");
  const explicitUnlockAt = parseOptionalDate(options["unlock-at"]);
  const quantity = parseOptionalInteger(options["quantity"]) ?? 1;

  try {
    const expectedUnlockAt = explicitUnlockAt ?? daysAfter(boughtAt, settings.cooldownDays);

    await db.insert(schema.manualPositions).values({
      marketplace: marketCsgo,
      marketHashName: name,
      buyPriceMinor,
      currency: "USD",
      quantity,
      boughtAt,
      expectedUnlockAt,
      notes: options["notes"]
    });

    logger.info({ marketHashName: name, expectedUnlockAt }, "manual position added");
  } finally {
    await pool.end();
  }
}

export async function closeManualPositionCli(positionId: string): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const { db, pool } = createDb(config.DATABASE_URL);

  try {
    await db
      .update(schema.manualPositions)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(schema.manualPositions.id, positionId));

    logger.info({ positionId }, "manual position closed");
  } finally {
    await pool.end();
  }
}

interface BaseFeature {
  readonly listing: ListingInput;
  readonly salesCount: number | null;
  readonly referencePriceMinor: bigint;
  readonly rollingMedianPriceMinor: bigint;
  readonly itemReturnBps: number;
  readonly volatilityBps: number;
  readonly liquidityScoreBps: number;
  readonly listingStats: ListingSelectionStats;
  readonly baselineWeight: number;
  readonly cohortKey: string;
}

function telegramSinkFromConfig(config: AppConfig): TradeSignalAlertSink | undefined {
  if (config.TELEGRAM_BOT_TOKEN === undefined || config.TELEGRAM_CHAT_ID === undefined) {
    return undefined;
  }

  return new TelegramAlertSink({
    botToken: config.TELEGRAM_BOT_TOKEN,
    chatId: config.TELEGRAM_CHAT_ID
  });
}

async function loadEnabledWatchlist(
  db: ReturnType<typeof createDb>["db"],
  settings: SignalStrategySettings
): Promise<WatchlistEntry[]> {
  const rows = await db
    .select()
    .from(schema.signalWatchlist)
    .where(and(eq(schema.signalWatchlist.marketplace, marketCsgo), eq(schema.signalWatchlist.enabled, true)));

  if (rows.length > 0) {
    return rows.map((row) => ({
      marketHashName: row.marketHashName,
      minPriceMinor: row.minPriceMinor,
      maxPriceMinor: row.maxPriceMinor,
      minSalesCount: row.minSalesCount
    }));
  }

  return settings.envWatchlist.map((marketHashName) => ({
    marketHashName,
    minPriceMinor: null,
    maxPriceMinor: null,
    minSalesCount: null
  }));
}

async function loadCurrentListings(db: ReturnType<typeof createDb>["db"], names: readonly string[]): Promise<ListingInput[]> {
  const rows = await db
    .select({
      marketHashName: schema.itemListingCurrent.marketHashName,
      externalId: schema.itemListingCurrent.externalId,
      priceMinor: schema.itemListingCurrent.priceMinor,
      currency: schema.itemListingCurrent.currency,
      quantity: schema.itemListingCurrent.quantity,
      observedAt: schema.itemListingCurrent.lastSeenAt,
      rawPayload: schema.itemListingCurrent.rawPayload
    })
    .from(schema.itemListingCurrent)
    .where(and(eq(schema.itemListingCurrent.marketplace, marketCsgo), inArray(schema.itemListingCurrent.marketHashName, names)));

  return rows;
}

async function loadCurrentSalesStats(
  db: ReturnType<typeof createDb>["db"],
  names: readonly string[]
): Promise<SalesStatsInput[]> {
  const rows = await db
    .select({
      marketHashName: schema.salesStatsCurrent.marketHashName,
      salesCount: schema.salesStatsCurrent.salesCount,
      rawPayload: schema.salesStatsCurrent.rawPayload
    })
    .from(schema.salesStatsCurrent)
    .where(and(eq(schema.salesStatsCurrent.marketplace, marketCsgo), inArray(schema.salesStatsCurrent.marketHashName, names)));

  return rows;
}

async function loadListingHistory(
  db: ReturnType<typeof createDb>["db"],
  names: readonly string[],
  cutoff: Date
): Promise<HistoryInput[]> {
  const rows = await db
    .select({
      marketHashName: schema.itemListingSnapshots.marketHashName,
      priceMinor: schema.itemListingSnapshots.priceMinor,
      observedAt: schema.itemListingSnapshots.observedAt,
      rawPayload: schema.itemListingSnapshots.rawPayload
    })
    .from(schema.itemListingSnapshots)
    .where(
      and(
        eq(schema.itemListingSnapshots.marketplace, marketCsgo),
        inArray(schema.itemListingSnapshots.marketHashName, names),
        gte(schema.itemListingSnapshots.observedAt, cutoff)
      )
    );

  return rows;
}

async function loadOpenPositions(db: ReturnType<typeof createDb>["db"]): Promise<PositionInput[]> {
  const rows = await db
    .select()
    .from(schema.manualPositions)
    .where(and(eq(schema.manualPositions.marketplace, marketCsgo), eq(schema.manualPositions.status, "open")));

  return rows.map((row) => ({
    id: row.id,
    marketHashName: row.marketHashName,
    buyPriceMinor: row.buyPriceMinor,
    currency: row.currency,
    quantity: row.quantity,
    boughtAt: row.boughtAt,
    expectedUnlockAt: row.expectedUnlockAt,
    actualUnlockAt: row.actualUnlockAt
  }));
}

async function persistBaselines(
  db: ReturnType<typeof createDb>["db"],
  baselines: readonly MarketBaselineDecision[]
): Promise<void> {
  if (baselines.length === 0) {
    return;
  }

  const rows = baselines.map((baseline) => ({
    marketplace: marketCsgo,
    baselineKey: baseline.baselineKey,
    currency: baseline.currency,
    itemsCount: baseline.itemsCount,
    medianReturnBps: baseline.medianReturnBps,
    dispersionBps: baseline.dispersionBps,
    observedAt: baseline.observedAt
  }));

  await insertInBatches({
    table: "market_baseline_snapshot",
    rows,
    batchSize: signalPersistenceBatchSize,
    insertRows: async (batch) => {
      await db.insert(schema.marketBaselineSnapshots).values([...batch]);
    }
  });
}

async function persistFeatures(
  db: ReturnType<typeof createDb>["db"],
  features: readonly ItemPriceFeatureDecision[]
): Promise<void> {
  if (features.length === 0) {
    return;
  }

  const rows = features.map((feature) => ({
    marketplace: marketCsgo,
    marketHashName: feature.marketHashName,
    currency: feature.currency,
    priceMinor: feature.priceMinor,
    fairValueMinor: feature.fairValueMinor,
    referencePriceMinor: feature.referencePriceMinor,
    rollingMedianPriceMinor: feature.rollingMedianPriceMinor,
    itemReturnBps: feature.itemReturnBps,
    baselineReturnBps: feature.baselineReturnBps,
    residualBps: feature.residualBps,
    zScoreBps: feature.zScoreBps,
    volatilityBps: feature.volatilityBps,
    liquidityScoreBps: feature.liquidityScoreBps,
    salesCount: feature.salesCount,
    quantity: feature.quantity,
    cohortKey: feature.cohortKey,
    baselineKey: feature.baselineKey,
    observedAt: feature.observedAt
  }));

  await insertInBatches({
    table: "item_price_feature",
    rows,
    batchSize: signalPersistenceBatchSize,
    insertRows: async (batch) => {
      await db.insert(schema.itemPriceFeatures).values([...batch]);
    }
  });
}

async function hasRecentSignal(
  db: ReturnType<typeof createDb>["db"],
  signal: TradeSignalDecision,
  cutoff: Date
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.tradeSignals.id })
    .from(schema.tradeSignals)
    .where(
      and(
        eq(schema.tradeSignals.marketplace, marketCsgo),
        eq(schema.tradeSignals.marketHashName, signal.marketHashName),
        eq(schema.tradeSignals.side, signal.side),
        or(eq(schema.tradeSignals.status, "new"), eq(schema.tradeSignals.status, "sent")),
        gte(schema.tradeSignals.observedAt, cutoff)
      )
    )
    .limit(1);

  return rows.length > 0;
}

async function persistTradeSignal(db: ReturnType<typeof createDb>["db"], signal: TradeSignalDecision): Promise<string> {
  const rows = await db
    .insert(schema.tradeSignals)
    .values({
      marketplace: marketCsgo,
      marketHashName: signal.marketHashName,
      positionId: signal.positionId,
      side: signal.side,
      priceMinor: signal.priceMinor,
      fairValueMinor: signal.fairValueMinor,
      expectedProfitMinor: signal.expectedProfitMinor,
      currency: signal.currency,
      expectedEdgeBps: signal.expectedEdgeBps,
      confidenceBps: signal.confidenceBps,
      baselineKey: signal.baselineKey,
      residualBps: signal.residualBps,
      reason: signal.reason,
      evidence: signal.evidence,
      observedAt: signal.observedAt
    })
    .returning({ id: schema.tradeSignals.id });

  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error("trade signal insert did not return an id");
  }

  return id;
}

async function markSignalSent(db: ReturnType<typeof createDb>["db"], signalId: string, sentAt: Date): Promise<void> {
  await db.update(schema.tradeSignals).set({ status: "sent", sentAt }).where(eq(schema.tradeSignals.id, signalId));
}

function tradeSignalAlert(signal: TradeSignalDecision): TradeSignalAlert {
  const base = {
    side: signal.side,
    marketHashName: signal.marketHashName,
    priceMinor: signal.priceMinor,
    fairValueMinor: signal.fairValueMinor,
    expectedProfitMinor: signal.expectedProfitMinor,
    currency: signal.currency,
    expectedEdgeBps: signal.expectedEdgeBps,
    confidenceBps: signal.confidenceBps,
    residualBps: signal.residualBps,
    baselineKey: signal.baselineKey,
    reason: signal.reason,
    observedAt: signal.observedAt,
    evidence: signal.evidence
  };

  return signal.unlockAt === undefined ? base : { ...base, unlockAt: signal.unlockAt };
}

function baselineFor(baselineKey: string, features: readonly BaseFeature[], observedAt: Date): MarketBaselineDecision {
  const returns = features.map((feature) => ({
    value: feature.itemReturnBps,
    weight: feature.baselineWeight
  }));
  const medianReturnBps = weightedMedian(returns);
  const dispersionBps = Math.max(
    1,
    median(features.map((feature) => Math.abs(feature.itemReturnBps - medianReturnBps)))
  );

  return {
    baselineKey,
    currency: "USD",
    itemsCount: features.length,
    medianReturnBps,
    dispersionBps,
    observedAt
  };
}

function selectBestBuyListing(listings: readonly ListingInput[]): ListingInput {
  const selected = [...listings].sort((left, right) => {
    if (left.priceMinor !== right.priceMinor) {
      return left.priceMinor < right.priceMinor ? -1 : 1;
    }

    return right.observedAt.getTime() - left.observedAt.getTime();
  })[0];

  if (selected === undefined) {
    throw new Error("cannot select a buy listing from an empty listing set");
  }

  return selected;
}

function listingSelectionStats(options: {
  currentListings: readonly ListingInput[],
  eligibleListings: readonly ListingInput[],
  selectedPriceMinor: bigint,
  variantKind: ItemVariantKind,
  variantFilteredRows: number
}): ListingSelectionStats {
  const eligiblePrices = options.eligibleListings.map((listing) => listing.priceMinor);
  const selectedPriceRank = eligiblePrices.filter((price) => price < options.selectedPriceMinor).length + 1;
  const nearbyCeilingMinor = applyBps(options.selectedPriceMinor, 10_300);

  return {
    variantKind: options.variantKind,
    variantFilteredRows: options.variantFilteredRows,
    currentListingRows: options.currentListings.length,
    eligibleListingRows: options.eligibleListings.length,
    selectedPriceRank,
    nearbyListingRows: eligiblePrices.filter((price) => price >= options.selectedPriceMinor && price <= nearbyCeilingMinor).length,
    minPriceMinor: minBigInt(eligiblePrices),
    p10PriceMinor: percentileBigInt(eligiblePrices, 0.1),
    p25PriceMinor: percentileBigInt(eligiblePrices, 0.25),
    medianPriceMinor: medianBigInt(eligiblePrices),
    maxPriceMinor: maxBigInt(eligiblePrices),
    selectedPriceVsMedianBps: relativeBps(options.selectedPriceMinor, medianBigInt(eligiblePrices))
  };
}

function variantKindForListing(listing: ListingInput): ItemVariantKind {
  return variantKindFromPayload(listing.rawPayload) ?? variantKindForName(listing.marketHashName);
}

function variantKindForSalesStats(salesStats: SalesStatsInput): ItemVariantKind {
  return variantKindFromPayload(salesStats.rawPayload) ?? variantKindForName(salesStats.marketHashName);
}

function variantKindForHistory(history: HistoryInput): ItemVariantKind {
  return variantKindFromPayload(history.rawPayload) ?? variantKindForName(history.marketHashName);
}

function variantKindFromPayload(payload: unknown): ItemVariantKind | null {
  const object = readJsonRecord(payload);

  if (object === null) {
    return null;
  }

  if (hasTruthyVariantField(object, ["souvenir"])) {
    return "souvenir";
  }

  if (hasTruthyVariantField(object, ["stattrak", "stat_trak"])) {
    return "stattrak";
  }

  for (const key of ["market_hash_name", "market_name", "name", "ru_name"]) {
    const value = object[key];

    if (typeof value === "string") {
      const variantKind = variantKindForName(value);

      if (variantKind !== "regular") {
        return variantKind;
      }
    }
  }

  return null;
}

function hasTruthyVariantField(object: JsonRecord, keys: readonly string[]): boolean {
  return keys.some((key) => isTruthyVariantValue(object[key]));
}

function isTruthyVariantValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    return ["1", "true", "yes", "stattrak", "souvenir"].includes(normalized);
  }

  return false;
}

function variantKindForName(marketHashName: string): ItemVariantKind {
  const normalized = marketHashName.trim().toLowerCase();

  if (normalized.startsWith("stattrak")) {
    return "stattrak";
  }

  if (normalized.startsWith("souvenir")) {
    return "souvenir";
  }

  return "regular";
}

function readJsonRecord(value: unknown): JsonRecord | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return null;
}

function referencePriceFor(history: readonly HistoryInput[], lookbackCutoff: Date): bigint | null {
  const beforeCutoff = history.filter((entry) => entry.observedAt.getTime() <= lookbackCutoff.getTime());

  if (beforeCutoff.length > 0) {
    return beforeCutoff[beforeCutoff.length - 1]?.priceMinor ?? null;
  }

  return history[0]?.priceMinor ?? null;
}

function volatilityBps(samples: readonly { readonly priceMinor: bigint; readonly observedAt: Date }[]): number {
  const sorted = [...samples].sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
  const returns: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (previous !== undefined && current !== undefined && previous.priceMinor > 0n && current.priceMinor > 0n) {
      returns.push(logReturnBps(previous.priceMinor, current.priceMinor));
    }
  }

  if (returns.length === 0) {
    return 0;
  }

  const medianReturn = median(returns);

  return median(returns.map((value) => Math.abs(value - medianReturn)));
}

function liquidityScoreBps(salesCount: number | null, eligibleListingRows: number): number {
  return clamp((salesCount ?? 0) * 500 + eligibleListingRows * 100, 0, 10_000);
}

function baselineWeight(salesCount: number | null, eligibleListingRows: number): number {
  const salesWeight = salesCount === null ? 1 : Math.ceil(salesCount / 10);
  const listingWeight = Math.ceil(eligibleListingRows / 50);

  return clamp(Math.max(1, salesWeight, listingWeight), 1, 5);
}

function buyConfidenceBps(feature: ItemPriceFeatureDecision, settings: SignalStrategySettings): number {
  const residualScore = clamp(Math.round((Math.abs(feature.residualBps) * 3_500) / settings.buyResidualBps), 0, 3_500);
  const zScore = feature.zScoreBps === null ? 1_000 : clamp(Math.round((Math.abs(feature.zScoreBps) * 2_500) / 10_000), 0, 2_500);
  const liquidityScore = Math.round(feature.liquidityScoreBps * 0.2);
  const dataScore = clamp(Math.round((feature.volatilityBps === 0 ? 1_000 : 1_500_000 / feature.volatilityBps)), 0, 1_500);

  return clamp(1_000 + residualScore + zScore + liquidityScore + dataScore, 0, 10_000);
}

function sellConfidenceBps(
  feature: ItemPriceFeatureDecision,
  expectedEdgeBps: number,
  settings: SignalStrategySettings
): number {
  const residualScore = clamp(Math.round((Math.max(0, feature.residualBps) * 3_000) / Math.max(1, settings.sellResidualBps)), 0, 3_000);
  const profitScore = clamp(Math.round((expectedEdgeBps * 3_000) / Math.max(1, settings.takeProfitBps)), 0, 3_000);
  const liquidityScore = Math.round(feature.liquidityScoreBps * 0.2);

  return clamp(1_500 + residualScore + profitScore + liquidityScore, 0, 10_000);
}

function signalEvidence(feature: ItemPriceFeatureDecision, expectedEdgeBps: number): Record<string, unknown> {
  return {
    priceMinor: feature.priceMinor.toString(),
    externalId: feature.externalId ?? null,
    marketUrl: marketCsgoItemUrl(feature.marketHashName),
    fairValueMinor: feature.fairValueMinor.toString(),
    referencePriceMinor: feature.referencePriceMinor.toString(),
    rollingMedianPriceMinor: feature.rollingMedianPriceMinor.toString(),
    itemReturnBps: feature.itemReturnBps,
    baselineReturnBps: feature.baselineReturnBps,
    residualBps: feature.residualBps,
    zScoreBps: feature.zScoreBps,
    expectedEdgeBps,
    volatilityBps: feature.volatilityBps,
    liquidityScoreBps: feature.liquidityScoreBps,
    salesCount: feature.salesCount,
    quantity: feature.quantity,
    variantKind: feature.listingStats.variantKind,
    variantFilteredRows: feature.listingStats.variantFilteredRows,
    currentListingRows: feature.listingStats.currentListingRows,
    eligibleListingRows: feature.listingStats.eligibleListingRows,
    selectedPriceRank: feature.listingStats.selectedPriceRank,
    nearbyListingRows: feature.listingStats.nearbyListingRows,
    minPriceMinor: feature.listingStats.minPriceMinor.toString(),
    p10PriceMinor: feature.listingStats.p10PriceMinor.toString(),
    p25PriceMinor: feature.listingStats.p25PriceMinor.toString(),
    medianPriceMinor: feature.listingStats.medianPriceMinor.toString(),
    maxPriceMinor: feature.listingStats.maxPriceMinor.toString(),
    selectedPriceVsMedianBps: feature.listingStats.selectedPriceVsMedianBps,
    cohortKey: feature.cohortKey,
    baselineKey: feature.baselineKey
  };
}

function marketCsgoItemUrl(marketHashName: string): string {
  return `https://market.csgo.com/en/${encodeURIComponent(marketHashName)}`;
}

function expectedBuyProfitMinor(currentPriceMinor: bigint, fairValueMinor: bigint, settings: SignalStrategySettings): bigint {
  const buyCost = applyBuyFee(currentPriceMinor, settings.buyFeeBps);
  const expectedSale = applySellFee(fairValueMinor, settings.sellFeeBps + settings.safetyMarginBps);

  return expectedSale - buyCost;
}

function applyBuyFee(amount: bigint, feeBps: number): bigint {
  return applyBps(amount, 10_000 + feeBps);
}

function applySellFee(amount: bigint, feeBps: number): bigint {
  return applyBps(amount, 10_000 - feeBps);
}

function applyBps(amount: bigint, multiplierBps: number): bigint {
  return (amount * BigInt(multiplierBps)) / 10_000n;
}

function profitBps(profitMinor: bigint, costMinor: bigint): number {
  if (costMinor <= 0n) {
    return 0;
  }

  return Number((profitMinor * 10_000n) / costMinor);
}

function logReturnBps(referencePrice: bigint, currentPrice: bigint): number {
  return Math.round(Math.log(Number(currentPrice) / Number(referencePrice)) * 10_000);
}

function fairValueFromResidual(priceMinor: bigint, residualBps: number): bigint {
  const fairValue = Math.round(Number(priceMinor) / Math.exp(residualBps / 10_000));

  return BigInt(Math.max(1, fairValue));
}

function medianBigInt(values: readonly bigint[]): bigint {
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  if (sorted.length === 0) {
    return 0n;
  }

  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle] ?? 0n;

  if (sorted.length % 2 === 1) {
    return middleValue;
  }

  return ((sorted[middle - 1] ?? middleValue) + middleValue) / 2n;
}

function percentileBigInt(values: readonly bigint[], percentile: number): bigint {
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  if (sorted.length === 0) {
    return 0n;
  }

  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile)));

  return sorted[index] ?? 0n;
}

function minBigInt(values: readonly bigint[]): bigint {
  return values.reduce<bigint | null>((minimum, value) => (minimum === null || value < minimum ? value : minimum), null) ?? 0n;
}

function maxBigInt(values: readonly bigint[]): bigint {
  return values.reduce<bigint | null>((maximum, value) => (maximum === null || value > maximum ? value : maximum), null) ?? 0n;
}

function relativeBps(value: bigint, baseline: bigint): number {
  if (baseline <= 0n) {
    return 0;
  }

  return Number(((value - baseline) * 10_000n) / baseline);
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle] ?? 0;

  if (sorted.length % 2 === 1) {
    return middleValue;
  }

  return Math.round(((sorted[middle - 1] ?? middleValue) + middleValue) / 2);
}

function weightedMedian(values: readonly { readonly value: number; readonly weight: number }[]): number {
  const sorted = [...values].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  let runningWeight = 0;

  for (const entry of sorted) {
    runningWeight += entry.weight;

    if (runningWeight >= totalWeight / 2) {
      return entry.value;
    }
  }

  return sorted[sorted.length - 1]?.value ?? 0;
}

function groupBy<T>(items: readonly T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const key = keyFor(item);
    const group = grouped.get(key);

    if (group === undefined) {
      grouped.set(key, [item]);
    } else {
      group.push(item);
    }
  }

  return grouped;
}

function cohortKeyFor(marketHashName: string, priceMinor: bigint): string {
  const exterior = /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/.exec(marketHashName)?.[1] ?? "unknown";
  const price = Number(priceMinor);
  const priceBucket = price < 1_000 ? "sub10" : price < 5_000 ? "10_50" : price < 20_000 ? "50_200" : "200_plus";

  return `exterior:${exterior}:price:${priceBucket}`;
}

function parseEnvWatchlist(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function hoursBefore(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 60 * 60 * 1000);
}

function daysAfter(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected integer, got ${value}`);
  }

  return parsed;
}

function parseOptionalBigInt(value: string | undefined): bigint | undefined {
  return value === undefined ? undefined : BigInt(value);
}

function parseRequiredBigInt(value: string | undefined, flag: string): bigint {
  if (value === undefined) {
    throw new Error(`${flag} is required`);
  }

  return BigInt(value);
}

function parseOptionalDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : parseRequiredDate(value, "date");
}

function parseRequiredDate(value: string | undefined, flag: string): Date {
  if (value === undefined) {
    throw new Error(`${flag} is required`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }

  return date;
}
