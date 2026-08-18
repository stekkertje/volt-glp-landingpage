import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";

export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Te veel pogingen. Probeer het later opnieuw.");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export type RateLimitOptions = {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
  now?: Date;
};

const globalRateLimitRef = globalThis as typeof globalThis & {
  __voltRateLimitCleanupAt__?: number;
  __voltRateLimitHashSecret__?: Buffer;
};

function hashSecret(): Buffer {
  if (!globalRateLimitRef.__voltRateLimitHashSecret__) {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    globalRateLimitRef.__voltRateLimitHashSecret__ = databaseUrl
      ? createHash("sha256")
          .update("volt-rate-limit\0")
          .update(databaseUrl)
          .digest()
      : randomBytes(32);
  }
  return globalRateLimitRef.__voltRateLimitHashSecret__;
}

function keyHash(scope: string, identifier: string): string {
  return createHmac("sha256", hashSecret())
    .update(scope)
    .update("\0")
    .update(identifier)
    .digest("hex");
}

async function cleanupExpiredBuckets(now: Date): Promise<void> {
  const timestamp = now.getTime();
  if (
    globalRateLimitRef.__voltRateLimitCleanupAt__ &&
    timestamp - globalRateLimitRef.__voltRateLimitCleanupAt__ < 60 * 60 * 1_000
  ) {
    return;
  }
  globalRateLimitRef.__voltRateLimitCleanupAt__ = timestamp;
  const sql = await getSql();
  await sql`delete from rate_limit_buckets where expires_at < ${now.toISOString()}`;
}

export async function consumeRateLimit(options: RateLimitOptions): Promise<{
  count: number;
  remaining: number;
  retryAfterMs: number;
}> {
  if (
    !options.scope ||
    !options.identifier ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    !Number.isInteger(options.windowMs) ||
    options.windowMs < 1_000
  ) {
    throw new Error("Ongeldige rate-limitconfiguratie.");
  }

  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const windowKey = Math.floor(nowMs / options.windowMs);
  const windowEndMs = (windowKey + 1) * options.windowMs;
  const expiresAt = new Date(windowEndMs + options.windowMs);
  const sql = await getSql();
  await cleanupExpiredBuckets(now);
  const rows = await sql<{ request_count: number }>`
    insert into rate_limit_buckets (
      scope, key_hash, window_key, request_count, expires_at, created_at, updated_at
    ) values (
      ${options.scope}, ${keyHash(options.scope, options.identifier)}, ${windowKey},
      1, ${expiresAt.toISOString()}, ${now.toISOString()}, ${now.toISOString()}
    )
    on conflict (scope, key_hash, window_key) do update
      set request_count = rate_limit_buckets.request_count + 1,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at
    returning request_count
  `;
  const count = rows[0]?.request_count ?? options.limit + 1;
  const retryAfterMs = Math.max(1, windowEndMs - nowMs);
  if (count > options.limit) throw new RateLimitError(retryAfterMs);
  return {
    count,
    remaining: Math.max(0, options.limit - count),
    retryAfterMs,
  };
}

export async function clearRateLimit(
  scope: string,
  identifier: string,
): Promise<void> {
  const sql = await getSql();
  await sql`
    delete from rate_limit_buckets
    where scope = ${scope} and key_hash = ${keyHash(scope, identifier)}
  `;
}
