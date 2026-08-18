import type { CreateOrderInput } from "@/lib/server/order-schema";

type CheckoutPayload = Omit<CreateOrderInput, "idempotencyKey">;

export type CheckoutAttemptSeed = {
  version: 1;
  seed: string;
  expiresAt: number;
};

type CheckoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const CHECKOUT_ATTEMPT_STORAGE_KEY = "volt-checkout-attempt-v1";
// Match the server's replay window so even a late retry after an ambiguous
// response cannot create a second order with a fresh key.
export const CHECKOUT_ATTEMPT_TTL_MS = 72 * 60 * 60 * 1_000;
const CHECKOUT_ATTEMPT_VERSION = 1;
const CHECKOUT_SEED_PATTERN = /^[a-f0-9]{64}$/;
const CHECKOUT_MARKER_PROOF_PATTERN = /^[a-f0-9]{64}$/;
const CHECKOUT_IDEMPOTENCY_CONTEXT = "volt-checkout-attempt-v2";
const CHECKOUT_CONSUMED_CONTEXT = "volt-checkout-consumed-v1";
export const CHECKOUT_STORAGE_LOCK_NAME = "volt-checkout-attempt-storage-v1";
const CHECKOUT_PRODUCTION_MARKER_COOKIE =
  "__Host-volt-checkout-attempt-marker-v1";
const CHECKOUT_LOCAL_MARKER_COOKIE = "volt-checkout-attempt-marker-local-v1";
export const CHECKOUT_STORAGE_LOCK_TIMEOUT_MS = 2_000;
export const CHECKOUT_REPLAY_EXPIRED_ERROR_MESSAGE =
  "De tijdelijke toegang tot deze bestelling is verlopen.";
const consumedCheckoutSeeds = new Set<string>();
const replayExpiredCheckoutSeeds = new Set<string>();
const committedCartCheckoutSeeds = new Set<string>();

export type CheckoutAttemptMarkerKind =
  "consumed" | "replay-expired" | "committed-cart";

type CheckoutAttemptMarker = {
  kind: CheckoutAttemptMarkerKind;
  proof: string;
};

export type CheckoutAttemptPreparation =
  | { ok: true; attempt: CheckoutAttemptSeed }
  | {
      ok: false;
      reason:
        "stale" | "storage" | "lock" | "replay-expired" | "committed-cart";
    };

class CheckoutStorageLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutStorageLockError";
  }
}

function compareVariant(
  left: { slug: string; optionId: string },
  right: { slug: string; optionId: string },
): number {
  const leftKey = `${left.slug}\0${left.optionId}`;
  const rightKey = `${right.slug}\0${right.optionId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function canonicalLines(lines: CheckoutPayload["lines"]) {
  const quantities = new Map<
    string,
    { slug: string; optionId: string; qty: number }
  >();
  for (const line of lines) {
    const key = `${line.slug}\0${line.optionId}`;
    const existing = quantities.get(key);
    quantities.set(key, {
      slug: line.slug,
      optionId: line.optionId,
      qty: (existing?.qty ?? 0) + line.qty,
    });
  }
  return [...quantities.values()].sort(compareVariant);
}

export function canonicalCheckoutPayload(input: CheckoutPayload): string {
  return JSON.stringify({
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    street: input.street,
    houseNumber: input.houseNumber,
    postcode: input.postcode,
    city: input.city,
    country: input.country,
    note: input.note ?? null,
    discountCode: input.discountCode?.trim().toUpperCase() || null,
    lines: canonicalLines(input.lines),
  });
}

function browserCheckoutStorage(): CheckoutStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // The random seed contains no checkout details. localStorage lets an
    // unresolved attempt survive a tab close for the server's 72-hour replay
    // window; names, addresses and other form values are never stored here.
    return window.localStorage;
  } catch {
    return null;
  }
}

async function withCheckoutStorageLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  // Server-side and explicit unit-test storage have no competing tabs. In a
  // browser the Web Locks API is required: silently continuing would let two
  // tabs overwrite the durable attempt and defeat idempotency.
  if (typeof window === "undefined") {
    return operation();
  }
  if (typeof navigator === "undefined" || !navigator.locks) {
    throw new CheckoutStorageLockError(
      "Veilige checkoutvergrendeling is niet beschikbaar.",
    );
  }

  const controller = new AbortController();
  let acquired = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new CheckoutStorageLockError(
    "Wachten op de veilige checkoutvergrendeling duurde te lang.",
  );
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      if (acquired) return;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, CHECKOUT_STORAGE_LOCK_TIMEOUT_MS);
  });
  const requested = navigator.locks
    .request(
      CHECKOUT_STORAGE_LOCK_NAME,
      { signal: controller.signal },
      async () => {
        acquired = true;
        if (timeout) clearTimeout(timeout);
        return operation();
      },
    )
    .catch((error: unknown) => {
      if (controller.signal.aborted) throw timeoutError;
      throw error;
    });

  try {
    return await Promise.race([requested, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function checkoutAttemptMarkerCookieName(protocol: string): string {
  return protocol === "https:"
    ? CHECKOUT_PRODUCTION_MARKER_COOKIE
    : CHECKOUT_LOCAL_MARKER_COOKIE;
}

export function parseCheckoutAttemptMarkerCookies(
  cookieHeader: string,
  cookieName: string,
): CheckoutAttemptMarker[] {
  const markers: CheckoutAttemptMarker[] = [];
  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim();
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator) !== cookieName) continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(separator + 1));
    } catch {
      continue;
    }
    const match =
      /^(consumed|replay-expired|committed-cart)\.([a-f0-9]{64})$/.exec(value);
    if (!match || !CHECKOUT_MARKER_PROOF_PATTERN.test(match[2] ?? "")) {
      continue;
    }
    markers.push({
      kind: match[1] as CheckoutAttemptMarkerKind,
      proof: match[2]!,
    });
  }
  return markers;
}

export function checkoutAttemptMarkerCookieDirective(
  protocol: string,
  kind: CheckoutAttemptMarkerKind,
  proof: string,
): string {
  if (!CHECKOUT_MARKER_PROOF_PATTERN.test(proof)) {
    throw new Error("Checkout-marker is ongeldig.");
  }
  const secure = protocol === "https:" ? "; Secure" : "";
  return `${checkoutAttemptMarkerCookieName(protocol)}=${encodeURIComponent(`${kind}.${proof}`)}; Max-Age=${CHECKOUT_ATTEMPT_TTL_MS / 1_000}; Path=/; SameSite=Strict${secure}`;
}

function readAttemptMarkers(): CheckoutAttemptMarker[] {
  if (typeof document === "undefined" || typeof location === "undefined") {
    return [];
  }
  return parseCheckoutAttemptMarkerCookies(
    document.cookie,
    checkoutAttemptMarkerCookieName(location.protocol),
  );
}

function persistAttemptMarker(
  kind: CheckoutAttemptMarkerKind,
  proof: string,
): boolean {
  if (typeof document === "undefined" || typeof location === "undefined") {
    return false;
  }
  document.cookie = checkoutAttemptMarkerCookieDirective(
    location.protocol,
    kind,
    proof,
  );
  return readAttemptMarkers().some(
    (marker) => marker.kind === kind && marker.proof === proof,
  );
}

function randomCheckoutSeed(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseCheckoutAttemptSeed(
  raw: string | null,
): CheckoutAttemptSeed | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as Partial<CheckoutAttemptSeed>;
    const keys = Object.keys(candidate);
    if (
      keys.length !== 3 ||
      !keys.every((key) => ["version", "seed", "expiresAt"].includes(key)) ||
      candidate.version !== CHECKOUT_ATTEMPT_VERSION ||
      typeof candidate.seed !== "string" ||
      !CHECKOUT_SEED_PATTERN.test(candidate.seed) ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isFinite(candidate.expiresAt) ||
      candidate.expiresAt <= 0
    ) {
      return null;
    }
    return candidate as CheckoutAttemptSeed;
  } catch {
    return null;
  }
}

export function createCheckoutAttemptSeed(
  now: number = Date.now(),
  createSeed: () => string = randomCheckoutSeed,
): CheckoutAttemptSeed {
  const seed = createSeed();
  if (!CHECKOUT_SEED_PATTERN.test(seed)) {
    throw new Error("Checkout-seed is ongeldig.");
  }
  return {
    version: CHECKOUT_ATTEMPT_VERSION,
    seed,
    expiresAt: now + CHECKOUT_ATTEMPT_TTL_MS,
  };
}

export function refreshCheckoutAttemptSeed(
  attempt: CheckoutAttemptSeed,
  now: number = Date.now(),
): CheckoutAttemptSeed {
  if (
    attempt.version !== CHECKOUT_ATTEMPT_VERSION ||
    !CHECKOUT_SEED_PATTERN.test(attempt.seed)
  ) {
    throw new Error("Checkout-seed is ongeldig.");
  }
  return {
    version: CHECKOUT_ATTEMPT_VERSION,
    seed: attempt.seed,
    expiresAt: now + CHECKOUT_ATTEMPT_TTL_MS,
  };
}

export function loadCheckoutAttemptSeed(
  storage: CheckoutStorage | null = browserCheckoutStorage(),
  _now: number = Date.now(),
): CheckoutAttemptSeed | null {
  if (!storage) return null;
  try {
    const parsed = parseCheckoutAttemptSeed(
      storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY),
    );
    if (parsed && consumedCheckoutSeeds.has(parsed.seed)) {
      try {
        storage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      } catch {
        // The consumed in-memory marker still prevents reuse in this tab.
      }
      return null;
    }
    if (!parsed) storage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function persistCheckoutAttemptSeed(
  attempt: CheckoutAttemptSeed,
  storage: CheckoutStorage | null = browserCheckoutStorage(),
): boolean {
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(attempt);
    storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, serialized);
    return storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

function checkoutStorageIsReadable(storage: CheckoutStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

async function checkoutSeedProof(
  seed: string,
  context: string,
): Promise<string> {
  if (!CHECKOUT_SEED_PATTERN.test(seed)) {
    throw new Error("Checkout-seed is ongeldig.");
  }
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(seed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(context),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadUsableCheckoutAttemptSeed(
  storage: CheckoutStorage | null,
  now: number,
): Promise<{
  attempt: CheckoutAttemptSeed;
  marker: CheckoutAttemptMarkerKind | null;
} | null> {
  const attempt = loadCheckoutAttemptSeed(storage, now);
  if (!attempt) return null;
  const expectedProof = await checkoutSeedProof(
    attempt.seed,
    CHECKOUT_CONSUMED_CONTEXT,
  );
  const matchingMarkers = readAttemptMarkers().filter(
    (candidate) => candidate.proof === expectedProof,
  );
  if (
    matchingMarkers.some((candidate) => candidate.kind === "replay-expired") ||
    replayExpiredCheckoutSeeds.has(attempt.seed)
  ) {
    replayExpiredCheckoutSeeds.add(attempt.seed);
    return { attempt, marker: "replay-expired" };
  }
  if (
    matchingMarkers.some((candidate) => candidate.kind === "committed-cart") ||
    committedCartCheckoutSeeds.has(attempt.seed)
  ) {
    committedCartCheckoutSeeds.add(attempt.seed);
    return { attempt, marker: "committed-cart" };
  }
  if (matchingMarkers.some((candidate) => candidate.kind === "consumed")) {
    consumedCheckoutSeeds.add(attempt.seed);
    try {
      storage?.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    } catch {
      // The persistent marker still prevents this seed from being adopted.
    }
    return null;
  }
  return { attempt, marker: null };
}

export async function initializeCheckoutAttemptSeed(
  storage: CheckoutStorage | null = browserCheckoutStorage(),
  now: number = Date.now(),
  createSeed: () => string = randomCheckoutSeed,
): Promise<CheckoutAttemptSeed | null> {
  try {
    return await withCheckoutStorageLock(async () => {
      if (!checkoutStorageIsReadable(storage)) return null;
      const restored = await loadUsableCheckoutAttemptSeed(storage, now);
      if (restored) return restored.attempt;
      const created = createCheckoutAttemptSeed(now, createSeed);
      return persistCheckoutAttemptSeed(created, storage) ? created : null;
    });
  } catch {
    return null;
  }
}

export async function prepareCheckoutAttemptSeedForSubmit(
  expected: CheckoutAttemptSeed | null,
  storage: CheckoutStorage | null = browserCheckoutStorage(),
  now: number = Date.now(),
  createSeed: () => string = randomCheckoutSeed,
): Promise<CheckoutAttemptPreparation> {
  try {
    return await withCheckoutStorageLock(async () => {
      if (!checkoutStorageIsReadable(storage)) {
        return { ok: false, reason: "storage" };
      }
      const durable = await loadUsableCheckoutAttemptSeed(storage, now);
      if (expected && durable?.attempt.seed !== expected.seed) {
        return { ok: false, reason: "stale" };
      }
      if (durable?.marker === "replay-expired") {
        return { ok: false, reason: "replay-expired" };
      }
      if (durable?.marker === "committed-cart") {
        return { ok: false, reason: "committed-cart" };
      }
      const current =
        durable?.attempt ?? createCheckoutAttemptSeed(now, createSeed);
      // An expired client deadline must keep the same seed for one
      // authoritative replay. The server will either return the existing order
      // or 410; rotating here could create a duplicate order.
      if (current.expiresAt <= now) {
        return { ok: true, attempt: current };
      }
      const refreshed = refreshCheckoutAttemptSeed(current, now);
      if (!persistCheckoutAttemptSeed(refreshed, storage)) {
        return { ok: false, reason: "storage" };
      }
      return { ok: true, attempt: refreshed };
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof CheckoutStorageLockError ? "lock" : "storage",
    };
  }
}

export function clearCheckoutAttemptSeedIfMatches(
  attempt: CheckoutAttemptSeed,
  storage: CheckoutStorage | null = browserCheckoutStorage(),
): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    if (!raw) return false;
    const candidate = JSON.parse(raw) as Partial<CheckoutAttemptSeed>;
    if (
      candidate.version !== attempt.version ||
      candidate.seed !== attempt.seed
    ) {
      return false;
    }
    storage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    return storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export async function finalizeCheckoutAttemptAfterSuccess(
  attempt: CheckoutAttemptSeed,
  storage: CheckoutStorage | null = browserCheckoutStorage(),
  now: number = Date.now(),
  createSeed: () => string = randomCheckoutSeed,
): Promise<CheckoutAttemptSeed | null> {
  try {
    return await withCheckoutStorageLock(async () => {
      if (clearCheckoutAttemptSeedIfMatches(attempt, storage)) return null;

      consumedCheckoutSeeds.add(attempt.seed);
      const existingReplacement = await loadUsableCheckoutAttemptSeed(
        storage,
        now,
      );
      if (existingReplacement) {
        consumedCheckoutSeeds.delete(attempt.seed);
        return existingReplacement.attempt;
      }
      const replacement = createCheckoutAttemptSeed(now, createSeed);
      if (persistCheckoutAttemptSeed(replacement, storage)) {
        consumedCheckoutSeeds.delete(attempt.seed);
        return replacement;
      }
      persistAttemptMarker(
        "consumed",
        await checkoutSeedProof(attempt.seed, CHECKOUT_CONSUMED_CONTEXT),
      );
      return null;
    });
  } catch {
    consumedCheckoutSeeds.add(attempt.seed);
    try {
      persistAttemptMarker(
        "consumed",
        await checkoutSeedProof(attempt.seed, CHECKOUT_CONSUMED_CONTEXT),
      );
    } catch {
      // The order is already confirmed. Never hold back recovery/navigation.
    }
    return null;
  }
}

export function isCheckoutReplayExpiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    name?: unknown;
    message?: unknown;
  };
  return (
    candidate.status === 410 ||
    candidate.statusCode === 410 ||
    candidate.name === "IdempotencyReplayExpiredError" ||
    candidate.message === CHECKOUT_REPLAY_EXPIRED_ERROR_MESSAGE
  );
}

export async function markCheckoutAttemptReplayExpired(
  attempt: CheckoutAttemptSeed,
): Promise<void> {
  replayExpiredCheckoutSeeds.add(attempt.seed);
  try {
    persistAttemptMarker(
      "replay-expired",
      await checkoutSeedProof(attempt.seed, CHECKOUT_CONSUMED_CONTEXT),
    );
  } catch {
    // The in-memory marker still makes all later submits in this tab fail closed.
  }
}

/**
 * A confirmed order whose cart could not be persisted as empty must keep its
 * original attempt terminal. Rotating that seed on reload would let the stale
 * persisted cart create a second order with a new idempotency key.
 */
export async function markCheckoutAttemptWithCommittedCart(
  attempt: CheckoutAttemptSeed,
): Promise<void> {
  committedCartCheckoutSeeds.add(attempt.seed);
  try {
    persistAttemptMarker(
      "committed-cart",
      await checkoutSeedProof(attempt.seed, CHECKOUT_CONSUMED_CONTEXT),
    );
  } catch {
    // The in-memory marker still blocks retries for the lifetime of this page.
  }
}

export async function checkoutIdempotencyKeyFromSeed(
  seed: string,
): Promise<string> {
  const proof = await checkoutSeedProof(seed, CHECKOUT_IDEMPOTENCY_CONTEXT);
  return `checkout-v2-${proof}`;
}
