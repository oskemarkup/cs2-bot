import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

const redactPaths = [
  "authorization",
  "headers.authorization",
  "req.headers.authorization",
  "apiKey",
  "api_key",
  "key",
  "token",
  "access_token",
  "refresh_token",
  "MARKET_CSGO_API_KEY",
  "SKINPORT_API_KEY",
  "CSFLOAT_API_KEY",
  "DMARKET_API_KEY"
];

export function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  const serialized = pino.stdSerializers.err(error) as Record<string, unknown>;
  const code = readStringLikeProperty(error, "code");

  if (code !== undefined) {
    serialized["code"] = code;
  }

  if ("cause" in error && error.cause !== undefined) {
    serialized["cause"] = serializeError(error.cause);
  }

  return serialized;
}

export function createLogger(options: LoggerOptions = {}, stream?: DestinationStream): Logger {
  const serializers = {
    err: serializeError,
    error: serializeError,
    ...options.serializers
  };
  const loggerOptions: LoggerOptions = {
    ...options,
    serializers,
    redact: options.redact ?? {
      paths: redactPaths,
      censor: "[Redacted]"
    }
  };

  return stream === undefined ? pino(loggerOptions) : pino(loggerOptions, stream);
}

function readStringLikeProperty(error: Error, property: string): string | number | undefined {
  const value = (error as Error & Record<string, unknown>)[property];

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return undefined;
}

const moneyMinorBrand: unique symbol = Symbol("moneyMinor");

export type MoneyMinor = bigint & {
  readonly [moneyMinorBrand]: "MoneyMinor";
};

export type CurrencyCode = string & {
  readonly __currencyCode: "CurrencyCode";
};

export function currencyCode(value: string): CurrencyCode {
  const normalized = value.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`Invalid ISO-like currency code: ${value}`);
  }

  return normalized as CurrencyCode;
}

export function moneyMinor(value: bigint): MoneyMinor {
  if (value < 0n) {
    throw new Error("Money minor units must be non-negative");
  }

  return value as MoneyMinor;
}

export function formatMoneyMinor(amount: bigint, currency: CurrencyCode, fractionDigits = 2): string {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new Error("fractionDigits must be a non-negative integer");
  }

  const sign = amount < 0n ? "-" : "";
  const absoluteAmount = amount < 0n ? -amount : amount;
  const scale = 10n ** BigInt(fractionDigits);
  const major = absoluteAmount / scale;
  const minor = absoluteAmount % scale;
  const minorText = fractionDigits === 0 ? "" : `.${minor.toString().padStart(fractionDigits, "0")}`;

  return `${sign}${major.toString()}${minorText} ${currency}`;
}
