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
