import { createHash } from "node:crypto";
import type { z } from "zod";
import type Bottleneck from "bottleneck";
import type { ConnectorRawSnapshot, ConnectorRateLimitObservation, Marketplace } from "./types.js";

export type ConnectorFetch = typeof fetch;

export interface ConnectorLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface RequestEndpointOptions<T> {
  readonly marketplace: Marketplace;
  readonly baseUrl: string;
  readonly endpoint: string;
  readonly path: string;
  readonly searchParams?: Readonly<Record<string, string>> | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly schema: z.ZodType<T>;
  readonly limiter: Bottleneck;
  readonly fetchImpl: ConnectorFetch;
  readonly logger?: ConnectorLogger | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retries?: number | undefined;
}

export interface RequestEndpointResult<T> {
  readonly parsedBody: T;
  readonly rawSnapshot: ConnectorRawSnapshot;
  readonly rateLimitObservation: ConnectorRateLimitObservation;
}

export interface FetchJsonWithRetryOptions {
  readonly marketplace: Marketplace;
  readonly endpoint: string;
  readonly url: string;
  readonly method?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly fetchImpl?: ConnectorFetch | undefined;
  readonly limiter?: Bottleneck | undefined;
  readonly logger?: ConnectorLogger | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retries?: number | undefined;
  readonly baseDelayMs?: number | undefined;
  readonly maxDelayMs?: number | undefined;
  readonly sleep?: ((delayMs: number) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
}

export interface FetchJsonWithRetryResult {
  readonly body: unknown;
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly fetchedAt: Date;
}

export class MarketplaceHttpError extends Error {
  readonly marketplace: Marketplace;
  readonly endpoint: string;
  readonly status: number | null;
  readonly attempts: number;
  readonly retryable: boolean;
  readonly responsePreview: string | null;
  readonly code: string | null;

  constructor(options: {
    readonly marketplace: Marketplace;
    readonly endpoint: string;
    readonly status: number | null;
    readonly attempts: number;
    readonly retryable: boolean;
    readonly message: string;
    readonly responsePreview?: string | null;
    readonly code?: string | null;
    readonly cause?: unknown;
  }) {
    super(
      `${options.marketplace} ${options.endpoint} failed after ${options.attempts} attempt(s): ${options.message}`,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "MarketplaceHttpError";
    this.marketplace = options.marketplace;
    this.endpoint = options.endpoint;
    this.status = options.status;
    this.attempts = options.attempts;
    this.retryable = options.retryable;
    this.responsePreview = options.responsePreview ?? null;
    this.code = options.code ?? null;
  }
}

export async function requestEndpoint<T>(options: RequestEndpointOptions<T>): Promise<RequestEndpointResult<T>> {
  const url = new URL(options.path, options.baseUrl);

  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const requestUrl = url.toString();
  const response = await fetchJsonWithRetry({
    marketplace: options.marketplace,
    endpoint: options.endpoint,
    url: requestUrl,
    method: "GET",
    headers: options.headers,
    fetchImpl: options.fetchImpl,
    limiter: options.limiter,
    logger: options.logger,
    timeoutMs: options.timeoutMs,
    retries: options.retries
  });
  const responseBody = response.body;
  const parsedBody = options.schema.parse(responseBody);
  const rawSnapshot: ConnectorRawSnapshot = {
    marketplace: options.marketplace,
    endpoint: options.endpoint,
    requestUrl,
    paramsHash: hashParams(options.searchParams ?? {}),
    statusCode: response.status,
    responseHeaders: response.headers,
    responseBody,
    fetchedAt: response.fetchedAt
  };

  return {
    parsedBody,
    rawSnapshot,
    rateLimitObservation: {
      marketplace: options.marketplace,
      endpoint: options.endpoint,
      limit: parseHeaderInteger(response.headers, ["x-ratelimit-limit", "rate-limit-limit"]),
      remaining: parseHeaderInteger(response.headers, ["x-ratelimit-remaining", "rate-limit-remaining"]),
      resetAt: parseHeaderDate(response.headers, ["x-ratelimit-reset", "rate-limit-reset"]),
      retryAfterSeconds: parseHeaderInteger(response.headers, ["retry-after"]),
      responseHeaders: response.headers,
      observedAt: response.fetchedAt,
      snapshotIndex: -1
    }
  };
}

export async function fetchJsonWithRetry(options: FetchJsonWithRetryOptions): Promise<FetchJsonWithRetryResult> {
  const method = options.method ?? "GET";
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retries = options.retries ?? 3;
  const totalAttempts = retries + 1;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? sleepMs;
  const random = options.random ?? Math.random;
  let lastFailure: MarketplaceHttpError | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const startedAt = Date.now();

    options.logger?.info(
      {
        marketplace: options.marketplace,
        endpoint: options.endpoint,
        method,
        attempt,
        safeUrl: safeUrl(options.url)
      },
      "api request started"
    );

    try {
      const requestInit: RequestInit = { method };

      if (options.headers !== undefined) {
        requestInit.headers = options.headers;
      }

      const response = await scheduleFetch(options.limiter, () => fetchWithTimeout(fetchImpl, options.url, requestInit, timeoutMs));
      const fetchedAt = new Date();
      const responseHeaders = headersToRecord(response.headers);
      const durationMs = Date.now() - startedAt;
      const retryable = isRetryableStatus(response.status);

      if (!response.ok) {
        const responsePreview = preview(await response.text(), 500);
        const failure = new MarketplaceHttpError({
          marketplace: options.marketplace,
          endpoint: options.endpoint,
          status: response.status,
          attempts: attempt,
          retryable,
          message: `HTTP ${response.status}`,
          responsePreview
        });

        options.logger?.warn(
          {
            marketplace: options.marketplace,
            endpoint: options.endpoint,
            method,
            attempt,
            status: response.status,
            durationMs,
            retryable,
            responsePreview,
            safeUrl: safeUrl(options.url)
          },
          "api request failed"
        );

        lastFailure = failure;

        if (!retryable || attempt === totalAttempts) {
          throw failure;
        }

        await sleep(retryDelayMs({ attempt, responseHeaders, baseDelayMs, maxDelayMs, random }));
        continue;
      }

      const body = (await response.json()) as unknown;

      options.logger?.info(
        {
          marketplace: options.marketplace,
          endpoint: options.endpoint,
          method,
          attempt,
          status: response.status,
          durationMs,
          retryable: false,
          safeUrl: safeUrl(options.url)
        },
        "api request finished"
      );

      return {
        body,
        status: response.status,
        headers: responseHeaders,
        fetchedAt
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const failure =
        error instanceof MarketplaceHttpError
          ? error
          : new MarketplaceHttpError({
              marketplace: options.marketplace,
              endpoint: options.endpoint,
              status: null,
              attempts: attempt,
              retryable: isRetryableNetworkError(error),
              message: error instanceof Error ? error.message : "Unknown HTTP failure",
              code: errorCode(error),
              cause: error
            });

      lastFailure = failure;

      if (!(error instanceof MarketplaceHttpError)) {
        options.logger?.warn(
          {
            marketplace: options.marketplace,
            endpoint: options.endpoint,
            method,
            attempt,
            status: null,
            durationMs,
            retryable: failure.retryable,
            err: error,
            safeUrl: safeUrl(options.url)
          },
          "api request failed"
        );
      }

      if (!failure.retryable || attempt === totalAttempts) {
        throw failure;
      }

      await sleep(retryDelayMs({ attempt, baseDelayMs, maxDelayMs, random }));
    }
  }

  throw lastFailure ?? new Error(`${options.marketplace} ${options.endpoint} failed without an error`);
}

function scheduleFetch<T>(limiter: Bottleneck | undefined, task: () => Promise<T>): Promise<T> {
  return limiter === undefined ? task() : limiter.schedule(task);
}

async function fetchWithTimeout(
  fetchImpl: ConnectorFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return true;
  }

  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return true;
    }

    if (error instanceof TypeError && error.message === "terminated") {
      return true;
    }
  }

  const code = errorCode(error);

  return code !== null && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(code);
}

function errorCode(error: unknown): string | null {
  if (error !== null && typeof error === "object") {
    const code = (error as Record<string, unknown>)["code"];

    if (typeof code === "string") {
      return code;
    }

    const cause = (error as Record<string, unknown>)["cause"];
    const causeCode = errorCode(cause);

    if (causeCode !== null) {
      return causeCode;
    }
  }

  return null;
}

function retryDelayMs(options: {
  readonly attempt: number;
  readonly responseHeaders?: Record<string, string>;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly random: () => number;
}): number {
  const retryAfterMs =
    options.responseHeaders === undefined ? null : parseRetryAfterMs(options.responseHeaders["retry-after"]);
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** Math.max(0, options.attempt - 1));
  const jitter = Math.floor(exponential * 0.25 * options.random());
  const backoffMs = exponential + jitter;

  return retryAfterMs === null ? backoffMs : Math.max(retryAfterMs, backoffMs);
}

function parseRetryAfterMs(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);

  if (Number.isInteger(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const dateMs = new Date(value).getTime();

  if (Number.isNaN(dateMs)) {
    return null;
  }

  return Math.max(0, dateMs - Date.now());
}

function preview(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function safeUrl(value: string): string {
  const url = new URL(value);
  const secretParams = [
    "key",
    "token",
    "api_key",
    "apikey",
    "api-token",
    "access_token",
    "refresh_token",
    "authorization",
    "auth",
    "secret",
    "password"
  ];

  for (const param of secretParams) {
    if (url.searchParams.has(param)) {
      url.searchParams.set(param, "[Redacted]");
    }
  }

  return url.toString();
}

function sleepMs(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });

  return result;
}

function hashParams(params: Readonly<Record<string, string>>): string {
  const orderedParams = Object.keys(params)
    .sort()
    .map((key) => [key, params[key]] as const);

  return createHash("sha256").update(JSON.stringify(orderedParams)).digest("hex");
}

function parseHeaderInteger(headers: Record<string, string>, names: readonly string[]): number | null {
  for (const name of names) {
    const value = headers[name];

    if (value === undefined) {
      continue;
    }

    const parsed = Number.parseInt(value, 10);

    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseHeaderDate(headers: Record<string, string>, names: readonly string[]): Date | null {
  for (const name of names) {
    const value = headers[name];

    if (value === undefined) {
      continue;
    }

    const epochSeconds = Number.parseInt(value, 10);

    if (Number.isInteger(epochSeconds)) {
      return new Date(epochSeconds * 1_000);
    }

    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}
